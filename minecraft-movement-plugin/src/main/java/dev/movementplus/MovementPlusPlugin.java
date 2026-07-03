package dev.movementplus;

import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Pose;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitTask;
import org.bukkit.util.Vector;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

public final class MovementPlusPlugin extends JavaPlugin implements Listener {
    private static final String USE_PERMISSION = "movementplus.use";
    private static final String ADMIN_PERMISSION = "movementplus.admin";
    private static final BlockFace[] HORIZONTAL_FACES = {
        BlockFace.NORTH,
        BlockFace.EAST,
        BlockFace.SOUTH,
        BlockFace.WEST
    };

    private final Set<UUID> forcedCrawlers = new HashSet<>();
    private final Set<UUID> forcedClimbers = new HashSet<>();
    private final Set<Material> climbableMaterials = new HashSet<>();
    private final Map<UUID, Long> lastHorizontalMoveAtMillis = new HashMap<>();
    private BukkitTask movementTask;

    private boolean crawlEnabled;
    private boolean crawlRequireSneakToEnter;
    private double crawlForwardCheckDistance;
    private double crawlScanStep;
    private double crawlWidthProbeOffset;
    private boolean climbEnabled;
    private double climbSpeed;
    private double maxUpwardSpeed;
    private double slideSpeed;
    private double holdSpeed;
    private float lookUpPitch;
    private long recentMoveWindowMillis;
    private boolean climbForcePose;
    private Pose climbPose;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        loadSettings();
        getServer().getPluginManager().registerEvents(this, this);
        movementTask = getServer().getScheduler().runTaskTimer(this, this::tickMovement, 1L, 1L);
        getLogger().info("MovementPlus enabled.");
    }

    @Override
    public void onDisable() {
        if (movementTask != null) {
            movementTask.cancel();
            movementTask = null;
        }
        for (Player player : getServer().getOnlinePlayers()) {
            releaseForcedCrawl(player);
            releaseForcedClimb(player);
        }
        forcedCrawlers.clear();
        forcedClimbers.clear();
        lastHorizontalMoveAtMillis.clear();
        getLogger().info("MovementPlus disabled.");
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!command.getName().equalsIgnoreCase("movementplus")) {
            return false;
        }
        if (!sender.hasPermission(ADMIN_PERMISSION)) {
            sender.sendMessage("You do not have permission to manage MovementPlus.");
            return true;
        }
        if (args.length == 1 && args[0].equalsIgnoreCase("reload")) {
            loadSettings();
            sender.sendMessage("MovementPlus settings reloaded.");
            return true;
        }
        sender.sendMessage("Usage: /movementplus reload");
        return true;
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onPlayerMove(PlayerMoveEvent event) {
        Location from = event.getFrom();
        Location to = event.getTo();
        if (to == null) {
            return;
        }
        double dx = to.getX() - from.getX();
        double dz = to.getZ() - from.getZ();
        if ((dx * dx) + (dz * dz) > 0.0009D) {
            lastHorizontalMoveAtMillis.put(event.getPlayer().getUniqueId(), System.currentTimeMillis());
        }
    }

    @EventHandler
    public void onPlayerQuit(PlayerQuitEvent event) {
        UUID playerId = event.getPlayer().getUniqueId();
        forcedCrawlers.remove(playerId);
        forcedClimbers.remove(playerId);
        lastHorizontalMoveAtMillis.remove(playerId);
    }

    private void loadSettings() {
        reloadConfig();
        crawlEnabled = getConfig().getBoolean("crawl.enabled", true);
        crawlRequireSneakToEnter = getConfig().getBoolean("crawl.require-sneak-to-enter", true);
        crawlForwardCheckDistance = clamp(getConfig().getDouble("crawl.forward-check-distance", 1.75D), 0.1D, 2.5D);
        crawlScanStep = clamp(getConfig().getDouble("crawl.scan-step", 0.25D), 0.1D, 0.75D);
        crawlWidthProbeOffset = clamp(getConfig().getDouble("crawl.width-probe-offset", 0.28D), 0.0D, 0.35D);

        climbEnabled = getConfig().getBoolean("climb.enabled", true);
        climbSpeed = clamp(getConfig().getDouble("climb.speed", 0.18D), 0.02D, 0.6D);
        maxUpwardSpeed = clamp(getConfig().getDouble("climb.max-upward-speed", 0.28D), climbSpeed, 0.8D);
        slideSpeed = clamp(getConfig().getDouble("climb.slide-speed", -0.12D), -0.6D, 0.0D);
        holdSpeed = clamp(getConfig().getDouble("climb.hold-speed", -0.03D), -0.3D, 0.0D);
        lookUpPitch = (float) clamp(getConfig().getDouble("climb.look-up-pitch", -22.0D), -90.0D, 90.0D);
        recentMoveWindowMillis = (long) clamp(getConfig().getLong("climb.recent-move-window-ms", 350L), 0L, 2000L);
        climbForcePose = getConfig().getBoolean("climb.force-pose", true);
        climbPose = parsePose(getConfig().getString("climb.pose", "SNEAKING"), Pose.SNEAKING);

        loadClimbableMaterials();
    }

    private Pose parsePose(String value, Pose fallback) {
        if (value == null || value.isBlank()) {
            return fallback;
        }
        try {
            return Pose.valueOf(value.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException error) {
            getLogger().warning("Unknown pose in MovementPlus config: " + value + ". Using " + fallback.name() + ".");
            return fallback;
        }
    }

    private void loadClimbableMaterials() {
        climbableMaterials.clear();
        addClimbable("LADDER");
        addClimbable("VINE");
        addClimbable("CAVE_VINES");
        addClimbable("CAVE_VINES_PLANT");
        addClimbable("WEEPING_VINES");
        addClimbable("WEEPING_VINES_PLANT");
        addClimbable("TWISTING_VINES");
        addClimbable("TWISTING_VINES_PLANT");
        addClimbable("SCAFFOLDING");

        for (String materialName : getConfig().getStringList("climb.additional-climbable-materials")) {
            addClimbable(materialName);
        }
    }

    private void addClimbable(String materialName) {
        Material material = Material.matchMaterial(materialName);
        if (material == null) {
            getLogger().warning("Unknown climbable material in MovementPlus config: " + materialName);
            return;
        }
        climbableMaterials.add(material);
    }

    private void tickMovement() {
        for (Player player : getServer().getOnlinePlayers()) {
            handleCrawl(player);
            handleClimb(player);
        }
    }

    private void handleCrawl(Player player) {
        UUID playerId = player.getUniqueId();
        if (!crawlEnabled || !canUseMovementAssist(player) || player.isInWater() || player.isInLava()) {
            releaseForcedCrawl(player);
            return;
        }

        boolean alreadyForced = forcedCrawlers.contains(playerId);
        boolean wantsToEnter = !crawlRequireSneakToEnter || player.isSneaking() || alreadyForced;
        boolean shouldCrawl = wantsToEnter && isLowPassage(player);
        if (shouldCrawl) {
            forcedCrawlers.add(playerId);
            if (player.getPose() != Pose.SWIMMING || !player.hasFixedPose()) {
                player.setPose(Pose.SWIMMING, true);
            }
            if (!player.isSwimming()) {
                player.setSwimming(true);
            }
            return;
        }

        releaseForcedCrawl(player);
    }

    private void releaseForcedCrawl(Player player) {
        if (!forcedCrawlers.remove(player.getUniqueId())) {
            return;
        }
        if (!player.isInWater() && !player.isInLava() && player.isSwimming()) {
            player.setSwimming(false);
        }
        if (player.hasFixedPose() && player.getPose() == Pose.SWIMMING) {
            player.setPose(Pose.STANDING, false);
        }
    }

    private boolean isLowPassage(Player player) {
        Location location = player.getLocation();
        if (isCrawlSpace(location.getBlock())) {
            return true;
        }

        Vector direction = location.getDirection();
        direction.setY(0.0D);
        if (direction.lengthSquared() < 0.0001D) {
            return false;
        }
        direction.normalize();
        Vector lateral = new Vector(-direction.getZ(), 0.0D, direction.getX()).normalize().multiply(crawlWidthProbeOffset);

        for (double distance = crawlScanStep; distance <= crawlForwardCheckDistance; distance += crawlScanStep) {
            Vector forward = direction.clone().multiply(distance);
            Location center = location.clone().add(forward);
            if (isCrawlSpace(center.getBlock())) {
                return true;
            }
            if (crawlWidthProbeOffset > 0.0D
                && (isCrawlSpace(center.clone().add(lateral).getBlock()) || isCrawlSpace(center.clone().subtract(lateral).getBlock()))) {
                return true;
            }
        }
        return false;
    }

    private boolean isCrawlSpace(Block feetBlock) {
        Block headBlock = feetBlock.getRelative(BlockFace.UP);
        return canOccupy(feetBlock) && !canOccupy(headBlock);
    }

    private boolean canOccupy(Block block) {
        return block.isPassable() && !block.isLiquid();
    }

    private void handleClimb(Player player) {
        if (!climbEnabled || !canUseMovementAssist(player) || player.isInWater() || player.isInLava() || forcedCrawlers.contains(player.getUniqueId())) {
            releaseForcedClimb(player);
            return;
        }
        if (!isNearClimbable(player)) {
            releaseForcedClimb(player);
            return;
        }

        applyForcedClimbPose(player);
        Vector velocity = player.getVelocity();
        if (player.isSneaking()) {
            if (velocity.getY() < holdSpeed) {
                velocity.setY(holdSpeed);
                player.setVelocity(velocity);
            }
            player.setFallDistance(0.0F);
            return;
        }

        if (isTryingToClimb(player, velocity)) {
            double nextY = Math.min(maxUpwardSpeed, Math.max(velocity.getY(), climbSpeed));
            velocity.setY(nextY);
            player.setVelocity(velocity);
            player.setFallDistance(0.0F);
            return;
        }

        if (velocity.getY() < slideSpeed) {
            velocity.setY(slideSpeed);
            player.setVelocity(velocity);
            player.setFallDistance(0.0F);
        }
    }

    private void applyForcedClimbPose(Player player) {
        if (!climbForcePose) {
            releaseForcedClimb(player);
            return;
        }
        forcedClimbers.add(player.getUniqueId());
        if (player.getPose() != climbPose || !player.hasFixedPose()) {
            player.setPose(climbPose, true);
        }
    }

    private void releaseForcedClimb(Player player) {
        if (!forcedClimbers.remove(player.getUniqueId())) {
            return;
        }
        if (player.hasFixedPose() && player.getPose() == climbPose) {
            player.setPose(Pose.STANDING, false);
        }
    }

    private boolean isTryingToClimb(Player player, Vector velocity) {
        if (player.getLocation().getPitch() <= lookUpPitch) {
            return true;
        }
        if (velocity.getY() > 0.08D) {
            return true;
        }
        Long lastHorizontalMoveAt = lastHorizontalMoveAtMillis.get(player.getUniqueId());
        return lastHorizontalMoveAt != null && System.currentTimeMillis() - lastHorizontalMoveAt <= recentMoveWindowMillis;
    }

    private boolean isNearClimbable(Player player) {
        Location location = player.getLocation();
        Block feet = location.getBlock();
        Block head = feet.getRelative(BlockFace.UP);
        if (isClimbable(feet) || isClimbable(head)) {
            return true;
        }
        for (BlockFace face : HORIZONTAL_FACES) {
            if (isClimbable(feet.getRelative(face)) || isClimbable(head.getRelative(face))) {
                return true;
            }
        }
        return false;
    }

    private boolean isClimbable(Block block) {
        return climbableMaterials.contains(block.getType());
    }

    private boolean canUseMovementAssist(Player player) {
        if (!player.hasPermission(USE_PERMISSION) || player.isInsideVehicle() || player.isFlying()) {
            return false;
        }
        GameMode gameMode = player.getGameMode();
        return gameMode != GameMode.SPECTATOR;
    }

    private double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }
}
