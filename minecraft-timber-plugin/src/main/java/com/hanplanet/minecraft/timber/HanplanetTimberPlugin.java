package com.hanplanet.minecraft.timber;

import org.bukkit.Axis;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.data.BlockData;
import org.bukkit.block.data.Orientable;
import org.bukkit.entity.BlockDisplay;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.entity.EntityChangeBlockEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.Damageable;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitRunnable;
import org.bukkit.util.Transformation;
import org.bukkit.util.Vector;
import org.joml.AxisAngle4f;
import org.joml.Vector3f;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;

public final class HanplanetTimberPlugin extends JavaPlugin implements Listener {
    private static final String FALLING_TREE_TAG = "hanplanet_timber_falling_tree";

    private final Set<Material> logMaterials = new HashSet<>();
    private final Set<Material> leafMaterials = new HashSet<>();

    private boolean requireAxe;
    private boolean sneakToBypass;
    private boolean breakLeaves;
    private boolean fallingAnimation;
    private boolean placeFallenLogs;
    private boolean fallingBlocksDamageEntities;
    private boolean logActions;
    private int maxLogs;
    private int maxLeaves;
    private int minLeaves;
    private int leafSearchRadius;
    private int horizontalLimit;
    private int upwardLimit;
    private int downwardLimit;
    private int animationTicks;
    private double horizontalVelocity;
    private double verticalVelocity;
    private double fallingBlockBaseDamage;
    private double fallingBlockDamagePerHeight;
    private int fallingBlockMaxDamage;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        loadSettings();
        getServer().getPluginManager().registerEvents(this, this);
        getLogger().info("HanplanetTimber enabled with " + logMaterials.size() + " log materials and " + leafMaterials.size() + " leaf materials.");
    }

    @Override
    public void onDisable() {
        getLogger().info("HanplanetTimber disabled.");
    }

    @EventHandler(priority = EventPriority.NORMAL, ignoreCancelled = true)
    public void onBlockBreak(BlockBreakEvent event) {
        Player player = event.getPlayer();
        Block origin = event.getBlock();
        ItemStack tool = player.getInventory().getItemInMainHand();

        if (!isLog(origin.getType())) {
            return;
        }
        if (!player.hasPermission("hanplanettimber.use")) {
            return;
        }
        if (sneakToBypass && player.isSneaking()) {
            return;
        }
        if (requireAxe && !isAxe(tool.getType())) {
            return;
        }

        TreeBlocks tree = collectTree(origin);
        if (tree == null || tree.logs.size() <= 1) {
            return;
        }

        event.setCancelled(true);
        breakTree(player, tool, origin, tree);
    }

    @EventHandler(priority = EventPriority.NORMAL, ignoreCancelled = true)
    public void onFallingBlockChangeBlock(EntityChangeBlockEvent event) {
        if (event.getEntity().getScoreboardTags().contains(FALLING_TREE_TAG)) {
            event.setCancelled(true);
            event.getEntity().remove();
        }
    }

    private void loadSettings() {
        reloadConfig();
        requireAxe = getConfig().getBoolean("require-axe", false);
        sneakToBypass = getConfig().getBoolean("sneak-to-bypass", true);
        breakLeaves = getConfig().getBoolean("break-leaves", true);
        fallingAnimation = getConfig().getBoolean("falling-animation", true);
        placeFallenLogs = getConfig().getBoolean("place-fallen-logs", true);
        fallingBlocksDamageEntities = getConfig().getBoolean("falling-blocks-damage-entities", true);
        logActions = getConfig().getBoolean("log-actions", true);
        maxLogs = Math.max(1, getConfig().getInt("max-logs", 180));
        maxLeaves = Math.max(0, getConfig().getInt("max-leaves", 360));
        minLeaves = Math.max(0, getConfig().getInt("min-leaves", 4));
        leafSearchRadius = Math.max(1, getConfig().getInt("leaf-search-radius", 3));
        horizontalLimit = Math.max(1, getConfig().getInt("horizontal-limit", 8));
        upwardLimit = Math.max(1, getConfig().getInt("upward-limit", 36));
        downwardLimit = Math.max(0, getConfig().getInt("downward-limit", 2));
        animationTicks = Math.max(5, getConfig().getInt("animation-ticks", 24));
        horizontalVelocity = Math.max(0.05D, getConfig().getDouble("fall-horizontal-velocity", 0.26D));
        verticalVelocity = getConfig().getDouble("fall-vertical-velocity", 0.04D);
        fallingBlockBaseDamage = Math.max(0.0D, getConfig().getDouble("falling-block-base-damage", getConfig().getDouble("falling-block-damage", 2.0D)));
        fallingBlockDamagePerHeight = Math.max(0.0D, getConfig().getDouble("falling-block-damage-per-height", 0.75D));
        fallingBlockMaxDamage = Math.max(0, getConfig().getInt("falling-block-max-damage", 8));

        logMaterials.clear();
        leafMaterials.clear();
        addMaterials(logMaterials,
            "OAK_LOG", "SPRUCE_LOG", "BIRCH_LOG", "JUNGLE_LOG", "ACACIA_LOG", "DARK_OAK_LOG",
            "MANGROVE_LOG", "CHERRY_LOG", "PALE_OAK_LOG",
            "CRIMSON_STEM", "WARPED_STEM",
            "OAK_WOOD", "SPRUCE_WOOD", "BIRCH_WOOD", "JUNGLE_WOOD", "ACACIA_WOOD", "DARK_OAK_WOOD",
            "MANGROVE_WOOD", "CHERRY_WOOD", "PALE_OAK_WOOD",
            "CRIMSON_HYPHAE", "WARPED_HYPHAE"
        );
        addMaterials(leafMaterials,
            "OAK_LEAVES", "SPRUCE_LEAVES", "BIRCH_LEAVES", "JUNGLE_LEAVES", "ACACIA_LEAVES",
            "DARK_OAK_LEAVES", "MANGROVE_LEAVES", "CHERRY_LEAVES", "PALE_OAK_LEAVES",
            "AZALEA_LEAVES", "FLOWERING_AZALEA_LEAVES",
            "NETHER_WART_BLOCK", "WARPED_WART_BLOCK", "SHROOMLIGHT"
        );
    }

    private void addMaterials(Set<Material> target, String... names) {
        for (String name : names) {
            Material material = Material.matchMaterial(name);
            if (material != null) {
                target.add(material);
            }
        }
    }

    private TreeBlocks collectTree(Block origin) {
        LinkedHashSet<Block> logs = new LinkedHashSet<>();
        LinkedHashSet<Block> leaves = new LinkedHashSet<>();
        Set<String> visited = new HashSet<>();
        Set<String> acceptedLogs = new HashSet<>();
        Set<String> trunkColumns = resolveTrunkColumns(origin);
        ArrayDeque<Block> queue = new ArrayDeque<>();
        queue.add(origin);
        visited.add(key(origin));

        while (!queue.isEmpty() && logs.size() < maxLogs) {
            Block current = queue.removeFirst();
            if (!isLog(current.getType()) || !withinBounds(origin, current)) {
                continue;
            }
            logs.add(current);
            acceptedLogs.add(key(current));
            for (int dx = -1; dx <= 1; dx += 1) {
                for (int dy = -1; dy <= 1; dy += 1) {
                    for (int dz = -1; dz <= 1; dz += 1) {
                        if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) != 1) {
                            continue;
                        }
                        Block neighbor = current.getRelative(dx, dy, dz);
                        String key = key(neighbor);
                        if (!visited.add(key)) {
                            continue;
                        }
                        if (shouldQueueLog(origin, neighbor, acceptedLogs, trunkColumns)) {
                            queue.add(neighbor);
                        }
                    }
                }
            }
        }

        for (Block log : logs) {
            collectNearbyLeaves(log, leaves);
            if (leaves.size() >= maxLeaves) {
                break;
            }
        }

        if (leaves.size() < minLeaves) {
            return null;
        }
        return new TreeBlocks(new ArrayList<>(logs), new ArrayList<>(leaves));
    }

    private boolean shouldQueueLog(Block origin, Block candidate, Set<String> acceptedLogs, Set<String> trunkColumns) {
        if (!isLog(candidate.getType()) || !withinBounds(origin, candidate)) {
            return false;
        }
        if (trunkColumns.contains(columnKey(candidate))) {
            return true;
        }
        if (candidate.getY() < origin.getY()) {
            return false;
        }

        Block below = candidate.getRelative(BlockFace.DOWN);
        if (candidate.getY() <= origin.getY() && below.getType().isSolid()) {
            return false;
        }
        return !isLog(below.getType()) || acceptedLogs.contains(key(below));
    }

    private Set<String> resolveTrunkColumns(Block origin) {
        Set<String> columns = new HashSet<>();
        columns.add(columnKey(origin));

        for (int baseDx = -1; baseDx <= 0; baseDx += 1) {
            for (int baseDz = -1; baseDz <= 0; baseDz += 1) {
                List<Block> square = new ArrayList<>(4);
                for (int dx = 0; dx <= 1; dx += 1) {
                    for (int dz = 0; dz <= 1; dz += 1) {
                        square.add(origin.getRelative(baseDx + dx, 0, baseDz + dz));
                    }
                }
                if (isTwoByTwoTrunk(origin, square)) {
                    for (Block block : square) {
                        columns.add(columnKey(block));
                    }
                    return columns;
                }
            }
        }

        return columns;
    }

    private boolean isTwoByTwoTrunk(Block origin, List<Block> blocks) {
        for (Block block : blocks) {
            if (block.getType() != origin.getType()) {
                return false;
            }
            Block above = block.getRelative(BlockFace.UP);
            Block below = block.getRelative(BlockFace.DOWN);
            if (above.getType() != origin.getType() && below.getType() != origin.getType()) {
                return false;
            }
        }
        return true;
    }

    private void collectNearbyLeaves(Block log, Set<Block> leaves) {
        for (int dx = -leafSearchRadius; dx <= leafSearchRadius; dx += 1) {
            for (int dy = -leafSearchRadius; dy <= leafSearchRadius; dy += 1) {
                for (int dz = -leafSearchRadius; dz <= leafSearchRadius; dz += 1) {
                    Block block = log.getRelative(dx, dy, dz);
                    if (isLeaf(block.getType())) {
                        leaves.add(block);
                        if (leaves.size() >= maxLeaves) {
                            return;
                        }
                    }
                }
            }
        }
    }

    private void breakTree(Player player, ItemStack tool, Block origin, TreeBlocks tree) {
        FallDirection direction = resolveFallDirection();
        List<LogSnapshot> logs = snapshotLogs(tree.logs, origin, direction.axis);
        int logsBroken = 0;
        int leavesBroken = 0;
        List<BlockDisplay> fallingBlocks = new ArrayList<>();
        Map<UUID, Double> fallingBlockDamageById = new HashMap<>();

        for (LogSnapshot log : logs) {
            if (!isLog(log.material)) {
                continue;
            }
            log.block.setType(Material.AIR, false);
            logsBroken += 1;
        }

        if (breakLeaves) {
            for (Block leaf : tree.leaves) {
                if (!isLeaf(leaf.getType())) {
                    continue;
                }
                if (leaf.breakNaturally(tool, true)) {
                    leavesBroken += 1;
                }
            }
        }

        if (fallingAnimation) {
            fallingBlocks = spawnFallingLogs(origin, logs, direction, fallingBlockDamageById);
            if (fallingBlocksDamageEntities) {
                monitorFallingBlockDamage(fallingBlocks, fallingBlockDamageById);
            }
        }

        List<BlockDisplay> spawnedBlocks = fallingBlocks;
        long settleDelay = fallingAnimation ? animationTicks + 2L : 1L;
        getServer().getScheduler().runTaskLater(this, () -> settleFallenLogs(origin, logs, direction, spawnedBlocks), settleDelay);

        damageAxe(player, tool, Math.max(0, logsBroken - 1));
        if (logActions && logsBroken > 0) {
            getLogger().info("Felled tree for " + player.getName() + ": " + logsBroken + " logs, " + leavesBroken + " leaves, direction " + direction.face.name() + ".");
        }
    }

    private List<LogSnapshot> snapshotLogs(List<Block> blocks, Block origin, Axis axis) {
        List<LogSnapshot> logs = new ArrayList<>();
        for (Block block : blocks) {
            BlockData originalData = block.getBlockData().clone();
            int heightAboveOrigin = Math.max(0, block.getY() - origin.getY());
            logs.add(new LogSnapshot(block, block.getType(), originalData, makeHorizontal(originalData.clone(), axis), heightAboveOrigin));
        }
        logs.sort((first, second) -> {
            int y = Integer.compare(first.block.getY(), second.block.getY());
            if (y != 0) {
                return y;
            }
            int x = Integer.compare(first.block.getX(), second.block.getX());
            if (x != 0) {
                return x;
            }
            return Integer.compare(first.block.getZ(), second.block.getZ());
        });
        return logs;
    }

    private BlockData makeHorizontal(BlockData data, Axis axis) {
        if (data instanceof Orientable orientable && orientable.getAxes().contains(axis)) {
            orientable.setAxis(axis);
        }
        return data;
    }

    private List<BlockDisplay> spawnFallingLogs(Block origin, List<LogSnapshot> logs, FallDirection direction, Map<UUID, Double> fallingBlockDamageById) {
        List<BlockDisplay> displays = new ArrayList<>();
        List<AnimatedLog> animatedLogs = new ArrayList<>();
        Vector hinge = blockCenter(origin);
        Vector fallVector = direction.vector();
        Vector rotationAxis = direction.rotationAxis();

        for (LogSnapshot log : logs) {
            Vector center = blockCenter(log.block);
            Location spawnLocation = center.toLocation(log.block.getWorld());
            BlockDisplay fallingBlock = log.block.getWorld().spawn(spawnLocation, BlockDisplay.class);
            fallingBlock.setBlock(log.originalData);
            fallingBlock.setPersistent(false);
            fallingBlock.setViewRange(64.0F);
            fallingBlock.setShadowRadius(0.18F);
            fallingBlock.setTeleportDuration(1);
            fallingBlock.setInterpolationDuration(2);
            fallingBlock.setTransformation(new Transformation(
                centeredBlockTranslation(new Vector(0.0D, 1.0D, 0.0D), 0.0D),
                new AxisAngle4f(0.0F, 0.0F, 1.0F, 0.0F),
                new Vector3f(1.0F, 1.0F, 1.0F),
                new AxisAngle4f(0.0F, 0.0F, 1.0F, 0.0F)
            ));
            double damage = calculateFallingBlockDamage(log.heightAboveOrigin);
            fallingBlock.addScoreboardTag(FALLING_TREE_TAG);
            fallingBlockDamageById.put(fallingBlock.getUniqueId(), damage);
            displays.add(fallingBlock);
            animatedLogs.add(new AnimatedLog(fallingBlock, center.subtract(hinge)));
        }

        animateFallingTree(animatedLogs, hinge, fallVector, rotationAxis);
        return displays;
    }

    private void animateFallingTree(List<AnimatedLog> logs, Vector hinge, Vector fallVector, Vector rotationAxis) {
        new BukkitRunnable() {
            private int tick;

            @Override
            public void run() {
                tick += 1;
                if (tick > animationTicks || logs.isEmpty()) {
                    cancel();
                    return;
                }

                double progress = Math.min(1.0D, tick / (double) animationTicks);
                double eased = easeOutCubic(progress);
                double angle = eased * (Math.PI / 2.0D);
                Vector baseShift = fallVector.clone().multiply(Math.sin(angle));
                double groundClearanceLift = rotatedCubeGroundClearanceLift(angle);

                for (AnimatedLog log : logs) {
                    if (!log.display.isValid()) {
                        continue;
                    }
                    Vector rotatedOffset = rotate(log.relativeCenter, rotationAxis, angle);
                    Vector nextCenter = hinge.clone().add(baseShift).add(rotatedOffset).add(new Vector(0.0D, groundClearanceLift, 0.0D));
                    log.display.teleport(nextCenter.toLocation(log.display.getWorld()));
                    log.display.setTransformation(new Transformation(
                        centeredBlockTranslation(rotationAxis, angle),
                        new AxisAngle4f((float) angle, (float) rotationAxis.getX(), (float) rotationAxis.getY(), (float) rotationAxis.getZ()),
                        new Vector3f(1.0F, 1.0F, 1.0F),
                        new AxisAngle4f(0.0F, 0.0F, 1.0F, 0.0F)
                    ));
                }
            }
        }.runTaskTimer(this, 1L, 1L);
    }

    private Vector3f centeredBlockTranslation(Vector rotationAxis, double angle) {
        Vector centeredOffset = rotate(new Vector(-0.5D, -0.5D, -0.5D), rotationAxis, angle);
        return new Vector3f((float) centeredOffset.getX(), (float) centeredOffset.getY(), (float) centeredOffset.getZ());
    }

    private double rotatedCubeGroundClearanceLift(double angle) {
        double verticalHalfExtent = (Math.abs(Math.cos(angle)) + Math.abs(Math.sin(angle))) * 0.5D;
        return Math.max(0.0D, verticalHalfExtent - 0.5D);
    }

    private double easeOutCubic(double value) {
        double inverse = 1.0D - value;
        return 1.0D - (inverse * inverse * inverse);
    }

    private Vector rotate(Vector vector, Vector axis, double angle) {
        double cos = Math.cos(angle);
        double sin = Math.sin(angle);
        Vector termA = vector.clone().multiply(cos);
        Vector termB = axis.clone().crossProduct(vector).multiply(sin);
        Vector termC = axis.clone().multiply(axis.dot(vector) * (1.0D - cos));
        return termA.add(termB).add(termC);
    }

    private Vector blockCenter(Block block) {
        return new Vector(block.getX() + 0.5D, block.getY() + 0.5D, block.getZ() + 0.5D);
    }

    private double calculateFallingBlockDamage(int heightAboveOrigin) {
        double damage = fallingBlockBaseDamage + (heightAboveOrigin * fallingBlockDamagePerHeight);
        if (fallingBlockMaxDamage > 0) {
            damage = Math.min(fallingBlockMaxDamage, damage);
        }
        return Math.max(0.0D, damage);
    }

    private void monitorFallingBlockDamage(List<BlockDisplay> fallingBlocks, Map<UUID, Double> fallingBlockDamageById) {
        Set<UUID> damagedEntities = new HashSet<>();
        new BukkitRunnable() {
            private int ticks;

            @Override
            public void run() {
                ticks += 1;
                if (ticks > animationTicks || fallingBlocks.isEmpty()) {
                    cancel();
                    return;
                }

                for (BlockDisplay fallingBlock : fallingBlocks) {
                    if (!fallingBlock.isValid()) {
                        continue;
                    }
                    for (Entity entity : fallingBlock.getNearbyEntities(0.75D, 0.75D, 0.75D)) {
                        if (!(entity instanceof org.bukkit.entity.Damageable damageable) || entity.getUniqueId().equals(fallingBlock.getUniqueId())) {
                            continue;
                        }
                        if (!damagedEntities.add(entity.getUniqueId())) {
                            continue;
                        }
                        double damage = fallingBlockDamageById.getOrDefault(fallingBlock.getUniqueId(), fallingBlockBaseDamage);
                        damageable.damage(damage, fallingBlock);
                    }
                }
            }
        }.runTaskTimer(this, 1L, 1L);
    }

    private void settleFallenLogs(Block origin, List<LogSnapshot> logs, FallDirection direction, List<BlockDisplay> fallingBlocks) {
        for (BlockDisplay fallingBlock : fallingBlocks) {
            if (fallingBlock.isValid()) {
                fallingBlock.remove();
            }
        }

        if (!placeFallenLogs) {
            for (LogSnapshot log : logs) {
                origin.getWorld().dropItemNaturally(origin.getLocation(), new ItemStack(log.material, 1));
            }
            return;
        }

        Set<String> usedTargets = new HashSet<>();
        int placed = 0;
        for (LogSnapshot log : logs) {
            Block target = findLandingBlock(origin, direction, log.heightAboveOrigin + 1, usedTargets);
            if (target == null) {
                origin.getWorld().dropItemNaturally(origin.getLocation(), new ItemStack(log.material, 1));
                continue;
            }
            target.setBlockData(log.fallenData, true);
            usedTargets.add(key(target));
            placed += 1;
        }

        if (logActions && placed > 0) {
            getLogger().info("Placed " + placed + " fallen log blocks.");
        }
    }

    private Block findLandingBlock(Block origin, FallDirection direction, int preferredStep, Set<String> usedTargets) {
        int maxStep = Math.max(preferredStep + 12, maxLogs + 12);
        for (int step = Math.max(1, preferredStep); step <= maxStep; step += 1) {
            int x = origin.getX() + (direction.x * step);
            int z = origin.getZ() + (direction.z * step);
            Block target = findLandingBlockAt(origin, x, z);
            if (target != null && !usedTargets.contains(key(target))) {
                return target;
            }
        }
        return null;
    }

    private Block findLandingBlockAt(Block origin, int x, int z) {
        int maxY = Math.min(origin.getWorld().getMaxHeight() - 1, origin.getY() + 8);
        int minY = Math.max(origin.getWorld().getMinHeight() + 1, origin.getY() - 12);
        for (int y = maxY; y >= minY; y -= 1) {
            Block target = origin.getWorld().getBlockAt(x, y, z);
            Block support = target.getRelative(BlockFace.DOWN);
            if (canReplace(target) && support.getType().isSolid()) {
                return target;
            }
        }
        return null;
    }

    private boolean canReplace(Block block) {
        return block.isEmpty() || block.isLiquid() || block.getBlockData().isReplaceable();
    }

    private FallDirection resolveFallDirection() {
        FallDirection[] directions = FallDirection.values();
        return directions[ThreadLocalRandom.current().nextInt(directions.length)];
    }

    private boolean withinBounds(Block origin, Block block) {
        if (!origin.getWorld().equals(block.getWorld())) {
            return false;
        }
        int dx = Math.abs(block.getX() - origin.getX());
        int dz = Math.abs(block.getZ() - origin.getZ());
        int dy = block.getY() - origin.getY();
        return dx <= horizontalLimit && dz <= horizontalLimit && dy >= -downwardLimit && dy <= upwardLimit;
    }

    private boolean isLog(Material material) {
        return logMaterials.contains(material);
    }

    private boolean isLeaf(Material material) {
        return leafMaterials.contains(material);
    }

    private boolean isAxe(Material material) {
        return material != null && material.name().toUpperCase(Locale.ROOT).endsWith("_AXE");
    }

    private void damageAxe(Player player, ItemStack tool, int amount) {
        if (amount <= 0 || tool == null || !isAxe(tool.getType())) {
            return;
        }
        ItemMeta meta = tool.getItemMeta();
        if (!(meta instanceof Damageable damageable)) {
            return;
        }
        int maxDurability = tool.getType().getMaxDurability();
        if (maxDurability <= 0) {
            return;
        }
        int nextDamage = damageable.getDamage() + amount;
        if (nextDamage >= maxDurability) {
            tool.setAmount(Math.max(0, tool.getAmount() - 1));
            player.playSound(player.getLocation(), Sound.ENTITY_ITEM_BREAK, 1.0f, 1.0f);
            return;
        }
        damageable.setDamage(nextDamage);
        tool.setItemMeta(meta);
    }

    private boolean sameBlock(Block first, Block second) {
        return first.getWorld().equals(second.getWorld())
            && first.getX() == second.getX()
            && first.getY() == second.getY()
            && first.getZ() == second.getZ();
    }

    private String key(Block block) {
        UUID worldId = block.getWorld().getUID();
        return worldId + ":" + block.getX() + ":" + block.getY() + ":" + block.getZ();
    }

    private String columnKey(Block block) {
        UUID worldId = block.getWorld().getUID();
        return worldId + ":" + block.getX() + ":" + block.getZ();
    }

    private static final class TreeBlocks {
        private final List<Block> logs;
        private final List<Block> leaves;

        private TreeBlocks(List<Block> logs, List<Block> leaves) {
            this.logs = logs;
            this.leaves = leaves;
        }
    }

    private static final class LogSnapshot {
        private final Block block;
        private final Material material;
        private final BlockData originalData;
        private final BlockData fallenData;
        private final int heightAboveOrigin;

        private LogSnapshot(Block block, Material material, BlockData originalData, BlockData fallenData, int heightAboveOrigin) {
            this.block = block;
            this.material = material;
            this.originalData = originalData;
            this.fallenData = fallenData;
            this.heightAboveOrigin = heightAboveOrigin;
        }
    }

    private static final class AnimatedLog {
        private final BlockDisplay display;
        private final Vector relativeCenter;

        private AnimatedLog(BlockDisplay display, Vector relativeCenter) {
            this.display = display;
            this.relativeCenter = relativeCenter;
        }
    }

    private enum FallDirection {
        NORTH(BlockFace.NORTH, 0, -1, Axis.Z),
        SOUTH(BlockFace.SOUTH, 0, 1, Axis.Z),
        EAST(BlockFace.EAST, 1, 0, Axis.X),
        WEST(BlockFace.WEST, -1, 0, Axis.X);

        private final BlockFace face;
        private final int x;
        private final int z;
        private final Axis axis;

        FallDirection(BlockFace face, int x, int z, Axis axis) {
            this.face = face;
            this.x = x;
            this.z = z;
            this.axis = axis;
        }

        private Vector vector() {
            return new Vector(x, 0.0D, z);
        }

        private Vector rotationAxis() {
            Vector up = new Vector(0.0D, 1.0D, 0.0D);
            return up.crossProduct(vector()).normalize();
        }
    }
}
