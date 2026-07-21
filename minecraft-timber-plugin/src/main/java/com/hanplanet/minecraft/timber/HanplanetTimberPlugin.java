package com.hanplanet.minecraft.timber;

import org.bukkit.Axis;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.data.BlockData;
import org.bukkit.block.data.Orientable;
import org.bukkit.block.data.type.Leaves;
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
import java.util.Collections;
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
    private int fallenLeafDecayTicks;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        loadSettings();
        getServer().getPluginManager().registerEvents(this, this);
    }

    @Override
    public void onDisable() {
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
        logActions = getConfig().getBoolean("log-actions", false);
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
        fallenLeafDecayTicks = Math.max(0, getConfig().getInt("fallen-leaf-decay-ticks", 600));

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
        List<LeafSnapshot> leaves = breakLeaves ? snapshotLeaves(tree.leaves, origin) : List.of();
        Set<LeafSnapshot> instantLeaves = breakLeaves ? selectInstantBreakLeaves(leaves) : Set.of();
        List<LeafSnapshot> fallingLeaves = new ArrayList<>();
        int logsBroken = 0;
        int leavesBroken = 0;
        List<BlockDisplay> fallingBlocks = new ArrayList<>();
        List<BlockDisplay> damagingBlocks = new ArrayList<>();
        Map<UUID, Double> fallingBlockDamageById = new HashMap<>();

        for (LogSnapshot log : logs) {
            if (!isLog(log.material)) {
                continue;
            }
            log.block.setType(Material.AIR, false);
            logsBroken += 1;
        }

        if (breakLeaves) {
            for (LeafSnapshot leaf : leaves) {
                if (instantLeaves.contains(leaf)) {
                    if (!leaf.block.breakNaturally(tool, true)) {
                        leaf.block.setType(Material.AIR, false);
                    }
                    leavesBroken += 1;
                    continue;
                }
                leaf.block.setType(Material.AIR, false);
                fallingLeaves.add(leaf);
                leavesBroken += 1;
            }
        }

        if (fallingAnimation) {
            fallingBlocks = spawnFallingTreeBlocks(origin, logs, fallingLeaves, direction, fallingBlockDamageById, damagingBlocks);
            if (fallingBlocksDamageEntities) {
                monitorFallingBlockDamage(damagingBlocks, fallingBlockDamageById);
            }
        }

        List<BlockDisplay> spawnedBlocks = fallingBlocks;
        long settleDelay = fallingAnimation ? animationTicks + 2L : 1L;
        getServer().getScheduler().runTaskLater(this, () -> settleFallenTree(origin, logs, fallingLeaves, direction, spawnedBlocks), settleDelay);

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
            logs.add(new LogSnapshot(
                block,
                block.getType(),
                originalData,
                makeHorizontal(originalData.clone(), axis),
                heightAboveOrigin,
                block.getX() - origin.getX(),
                block.getZ() - origin.getZ()
            ));
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

    private List<LeafSnapshot> snapshotLeaves(List<Block> blocks, Block origin) {
        List<LeafSnapshot> leaves = new ArrayList<>();
        for (Block block : blocks) {
            if (!isLeaf(block.getType())) {
                continue;
            }
            leaves.add(new LeafSnapshot(
                block,
                block.getType(),
                block.getBlockData().clone(),
                Math.max(0, block.getY() - origin.getY()),
                block.getX() - origin.getX(),
                block.getZ() - origin.getZ()
            ));
        }
        leaves.sort((first, second) -> {
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
        return leaves;
    }

    private Set<LeafSnapshot> selectInstantBreakLeaves(List<LeafSnapshot> leaves) {
        int remainingCount = Math.max(1, leaves.size() / 3);
        int instantCount = Math.max(0, leaves.size() - remainingCount);
        if (instantCount <= 0) {
            return Set.of();
        }
        List<LeafSnapshot> shuffledLeaves = new ArrayList<>(leaves);
        Collections.shuffle(shuffledLeaves, ThreadLocalRandom.current());
        Set<LeafSnapshot> instantLeaves = new HashSet<>();
        for (int index = 0; index < instantCount; index += 1) {
            instantLeaves.add(shuffledLeaves.get(index));
        }
        return instantLeaves;
    }

    private BlockData makeHorizontal(BlockData data, Axis axis) {
        if (data instanceof Orientable orientable && orientable.getAxes().contains(axis)) {
            orientable.setAxis(axis);
        }
        return data;
    }

    private List<BlockDisplay> spawnFallingTreeBlocks(Block origin, List<LogSnapshot> logs, List<LeafSnapshot> leaves, FallDirection direction, Map<UUID, Double> fallingBlockDamageById, List<BlockDisplay> damagingBlocks) {
        List<BlockDisplay> displays = new ArrayList<>();
        List<AnimatedBlock> animatedBlocks = new ArrayList<>();
        Vector rotationAxis = direction.rotationAxis();
        Map<LogSnapshot, Block> landingTargets = resolveLandingTargets(origin, logs, direction);
        Set<String> usedLeafTargets = new HashSet<>();
        for (Block target : landingTargets.values()) {
            usedLeafTargets.add(key(target));
        }
        ThreadLocalRandom random = ThreadLocalRandom.current();

        for (LogSnapshot log : logs) {
            Vector center = blockCenter(log.block);
            log.landingBlock = landingTargets.get(log);
            Vector targetCenter = log.landingBlock == null
                ? fallbackLandingCenter(origin, direction, log)
                : blockCenter(log.landingBlock);
            int delayTicks = Math.min(Math.max(0, animationTicks / 4), Math.max(0, log.heightAboveOrigin / 2) + random.nextInt(0, 3));
            double arcHeight = Math.min(1.6D, 0.35D + (log.heightAboveOrigin * 0.08D));
            Location spawnLocation = center.toLocation(log.block.getWorld());
            BlockDisplay fallingBlock = log.block.getWorld().spawn(spawnLocation, BlockDisplay.class);
            fallingBlock.setBlock(log.originalData);
            fallingBlock.setPersistent(false);
            fallingBlock.setViewRange(64.0F);
            fallingBlock.setShadowRadius(0.18F);
            fallingBlock.setTeleportDuration(2);
            fallingBlock.setInterpolationDuration(3);
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
            damagingBlocks.add(fallingBlock);
            int durationTicks = Math.max(8, animationTicks - delayTicks - 5);
            animatedBlocks.add(new AnimatedBlock(fallingBlock, center, targetCenter, delayTicks, durationTicks, arcHeight, rotationAxis, Math.PI / 2.0D));
        }

        for (LeafSnapshot leaf : leaves) {
            Vector center = blockCenter(leaf.block);
            Block target = findLeafLandingBlock(origin, direction, leaf, usedLeafTargets, random);
            leaf.landingBlock = target;
            leaf.targetCenter = target == null
                ? fallbackLeafLandingCenter(origin, direction, leaf, random)
                : blockCenter(target);
            int delayTicks = Math.min(Math.max(0, animationTicks / 4), Math.max(0, leaf.heightAboveOrigin / 2) + random.nextInt(0, 3));
            double arcHeight = Math.min(2.8D, 0.85D + (leaf.heightAboveOrigin * 0.08D) + random.nextDouble(0.2D, 0.9D));
            Location spawnLocation = center.toLocation(leaf.block.getWorld());
            BlockDisplay fallingLeaf = leaf.block.getWorld().spawn(spawnLocation, BlockDisplay.class);
            fallingLeaf.setBlock(leaf.originalData);
            fallingLeaf.setPersistent(false);
            fallingLeaf.setViewRange(64.0F);
            fallingLeaf.setShadowRadius(0.1F);
            fallingLeaf.setTeleportDuration(2);
            fallingLeaf.setInterpolationDuration(3);
            fallingLeaf.setTransformation(new Transformation(
                centeredBlockTranslation(new Vector(0.0D, 1.0D, 0.0D), 0.0D),
                new AxisAngle4f(0.0F, 0.0F, 1.0F, 0.0F),
                new Vector3f(1.0F, 1.0F, 1.0F),
                new AxisAngle4f(0.0F, 0.0F, 1.0F, 0.0F)
            ));
            double damage = calculateFallingBlockDamage(leaf.heightAboveOrigin);
            fallingLeaf.addScoreboardTag(FALLING_TREE_TAG);
            fallingBlockDamageById.put(fallingLeaf.getUniqueId(), damage);
            displays.add(fallingLeaf);
            damagingBlocks.add(fallingLeaf);
            int durationTicks = Math.max(8, animationTicks - delayTicks - 5);
            animatedBlocks.add(new AnimatedBlock(fallingLeaf, center, leaf.targetCenter, delayTicks, durationTicks, arcHeight, randomRotationAxis(random), random.nextDouble(Math.PI * 1.1D, Math.PI * 2.4D)));
        }

        animateFallingTree(animatedBlocks);
        return displays;
    }

    private Block findLeafLandingBlock(Block origin, FallDirection direction, LeafSnapshot leaf, Set<String> usedTargets, ThreadLocalRandom random) {
        int preferredStep = Math.max(2, leaf.heightAboveOrigin + 1);
        int baseStep = Math.max(1, preferredStep + random.nextInt(-1, 3));
        int baseLateral = direction.lateralOffset(leaf.relativeX, leaf.relativeZ) + random.nextInt(-2, 3);

        for (int radius = 0; radius <= 5; radius += 1) {
            for (int stepDelta = -radius; stepDelta <= radius; stepDelta += 1) {
                for (int lateralDelta = -radius; lateralDelta <= radius; lateralDelta += 1) {
                    int step = Math.max(1, baseStep + stepDelta);
                    int lateral = baseLateral + lateralDelta;
                    int x = origin.getX() + (direction.x * step) + (direction.lateralX * lateral);
                    int z = origin.getZ() + (direction.z * step) + (direction.lateralZ * lateral);
                    Block candidate = findSupportedLeafBlockAt(origin, x, z, usedTargets);
                    if (candidate != null) {
                        usedTargets.add(key(candidate));
                        return candidate;
                    }
                }
            }
        }

        return null;
    }

    private Vector fallbackLeafLandingCenter(Block origin, FallDirection direction, LeafSnapshot leaf, ThreadLocalRandom random) {
        int preferredStep = Math.max(1, leaf.heightAboveOrigin + 1);
        double forward = preferredStep + random.nextDouble(0.4D, 2.0D);
        double lateral = direction.lateralOffset(leaf.relativeX, leaf.relativeZ) + random.nextDouble(-0.5D, 0.5D);
        double x = origin.getX() + 0.5D + (direction.x * forward) + (direction.lateralX * lateral);
        double z = origin.getZ() + 0.5D + (direction.z * forward) + (direction.lateralZ * lateral);
        Block target = findLandingBlockAt(origin, (int) Math.floor(x), (int) Math.floor(z));
        double y = target == null
            ? origin.getY() + 0.5D
            : target.getY() + 0.5D;
        return new Vector(x, y, z);
    }

    private Vector randomRotationAxis(ThreadLocalRandom random) {
        Vector axis = new Vector(
            random.nextDouble(-1.0D, 1.0D),
            random.nextDouble(0.2D, 1.0D),
            random.nextDouble(-1.0D, 1.0D)
        );
        if (axis.lengthSquared() < 0.001D) {
            return new Vector(0.0D, 1.0D, 0.0D);
        }
        return axis.normalize();
    }

    private void animateFallingTree(List<AnimatedBlock> blocks) {
        new BukkitRunnable() {
            private int tick;

            @Override
            public void run() {
                tick += 1;
                if (tick > animationTicks + 4 || blocks.isEmpty()) {
                    cancel();
                    return;
                }

                for (AnimatedBlock block : blocks) {
                    if (!block.display.isValid()) {
                        continue;
                    }
                    double progress = Math.min(1.0D, Math.max(0.0D, (tick - block.delayTicks) / (double) Math.max(1, block.durationTicks)));
                    double eased = smootherStep(progress);
                    double angle = eased * block.rotationAngle;
                    double arcLift = Math.sin(progress * Math.PI) * block.arcHeight;
                    double groundClearanceLift = rotatedCubeGroundClearanceLift(angle);
                    Vector nextCenter = lerp(block.startCenter, block.targetCenter, eased)
                        .add(new Vector(0.0D, arcLift + groundClearanceLift, 0.0D));
                    block.display.teleport(nextCenter.toLocation(block.display.getWorld()));
                    block.display.setTransformation(new Transformation(
                        centeredBlockTranslation(block.rotationAxis, angle),
                        new AxisAngle4f((float) angle, (float) block.rotationAxis.getX(), (float) block.rotationAxis.getY(), (float) block.rotationAxis.getZ()),
                        new Vector3f(1.0F, 1.0F, 1.0F),
                        new AxisAngle4f(0.0F, 0.0F, 1.0F, 0.0F)
                    ));
                }
            }
        }.runTaskTimer(this, 1L, 1L);
    }

    private Map<LogSnapshot, Block> resolveLandingTargets(Block origin, List<LogSnapshot> logs, FallDirection direction) {
        Map<LogSnapshot, Block> targets = new HashMap<>();
        Set<String> usedTargets = new HashSet<>();
        FallenLayout layout = resolveFallenLayout(logs, direction);
        for (LogSnapshot log : logs) {
            Block target = findLandingBlock(origin, direction, layout, log, usedTargets);
            if (target == null) {
                continue;
            }
            targets.put(log, target);
            usedTargets.add(key(target));
        }
        return targets;
    }

    private Vector fallbackLandingCenter(Block origin, FallDirection direction, LogSnapshot log) {
        int preferredStep = Math.max(1, log.heightAboveOrigin + 1);
        return blockCenter(origin)
            .add(direction.vector().multiply(preferredStep))
            .add(new Vector(log.relativeX * 0.15D, -Math.min(log.heightAboveOrigin, 6), log.relativeZ * 0.15D));
    }

    private Vector lerp(Vector start, Vector end, double amount) {
        return start.clone().multiply(1.0D - amount).add(end.clone().multiply(amount));
    }

    private Vector3f centeredBlockTranslation(Vector rotationAxis, double angle) {
        Vector centeredOffset = rotate(new Vector(-0.5D, -0.5D, -0.5D), rotationAxis, angle);
        return new Vector3f((float) centeredOffset.getX(), (float) centeredOffset.getY(), (float) centeredOffset.getZ());
    }

    private double rotatedCubeGroundClearanceLift(double angle) {
        double verticalHalfExtent = (Math.abs(Math.cos(angle)) + Math.abs(Math.sin(angle))) * 0.5D;
        return Math.max(0.0D, verticalHalfExtent - 0.5D);
    }

    private double smootherStep(double value) {
        double clamped = Math.min(1.0D, Math.max(0.0D, value));
        return clamped * clamped * clamped * (clamped * (clamped * 6.0D - 15.0D) + 10.0D);
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

    private void settleFallenTree(Block origin, List<LogSnapshot> logs, List<LeafSnapshot> leaves, FallDirection direction, List<BlockDisplay> fallingBlocks) {
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

        ensureLogLandingTargets(origin, logs, direction);
        Set<String> usedTargets = new HashSet<>();
        int placed = 0;
        for (LogSnapshot log : logs) {
            Block target = log.landingBlock;
            if (target == null || usedTargets.contains(key(target)) || !canReplace(target)) {
                origin.getWorld().dropItemNaturally(origin.getLocation(), new ItemStack(log.material, 1));
                continue;
            }
            target.setBlockData(log.fallenData, true);
            usedTargets.add(key(target));
            placed += 1;
        }

        ThreadLocalRandom random = ThreadLocalRandom.current();
        int placedLeaves = 0;
        List<Block> settledLeaves = new ArrayList<>();
        for (LeafSnapshot leaf : leaves) {
            Block target = leaf.landingBlock;
            if (target == null || !isSupportedLeafTarget(target, usedTargets)) {
                target = findLeafLandingBlock(origin, direction, leaf, usedTargets, random);
            } else {
                usedTargets.add(key(target));
            }
            if (target == null) {
                continue;
            }
            target.setBlockData(prepareFallenLeafData(leaf.originalData.clone()), true);
            settledLeaves.add(target);
            placedLeaves += 1;
        }

        if (!settledLeaves.isEmpty() && fallenLeafDecayTicks > 0) {
            getServer().getScheduler().runTaskLater(this, () -> decaySettledLeaves(settledLeaves), fallenLeafDecayTicks);
        }

        if (logActions && placed > 0) {
            getLogger().info("Placed " + placed + " fallen log blocks and " + placedLeaves + " fallen leaf blocks.");
        }
    }

    private void ensureLogLandingTargets(Block origin, List<LogSnapshot> logs, FallDirection direction) {
        for (LogSnapshot log : logs) {
            if (log.landingBlock == null) {
                Map<LogSnapshot, Block> landingTargets = resolveLandingTargets(origin, logs, direction);
                for (LogSnapshot targetLog : logs) {
                    targetLog.landingBlock = landingTargets.get(targetLog);
                }
                return;
            }
        }
    }

    private BlockData prepareFallenLeafData(BlockData data) {
        if (data instanceof Leaves leavesData) {
            leavesData.setPersistent(false);
            leavesData.setDistance(leavesData.getMaximumDistance());
        }
        return data;
    }

    private void decaySettledLeaves(List<Block> settledLeaves) {
        int decayed = 0;
        for (Block block : settledLeaves) {
            if (!isLeaf(block.getType())) {
                continue;
            }
            if (!block.breakNaturally(true, false)) {
                block.setType(Material.AIR, true);
            }
            decayed += 1;
        }
        if (logActions && decayed > 0) {
            getLogger().info("Decayed " + decayed + " fallen leaf blocks.");
        }
    }

    private FallenLayout resolveFallenLayout(List<LogSnapshot> logs, FallDirection direction) {
        int minForward = 0;
        int minLateral = 0;
        int maxLateral = 0;
        boolean initialized = false;
        for (LogSnapshot log : logs) {
            int forward = direction.forwardOffset(log.relativeX, log.relativeZ);
            int lateral = direction.lateralOffset(log.relativeX, log.relativeZ);
            if (!initialized) {
                minForward = forward;
                minLateral = lateral;
                maxLateral = lateral;
                initialized = true;
                continue;
            }
            minForward = Math.min(minForward, forward);
            minLateral = Math.min(minLateral, lateral);
            maxLateral = Math.max(maxLateral, lateral);
        }
        int lateralWidth = Math.max(1, maxLateral - minLateral + 1);
        return new FallenLayout(minForward, minLateral, lateralWidth);
    }

    private Block findLandingBlock(Block origin, FallDirection direction, FallenLayout layout, LogSnapshot log, Set<String> usedTargets) {
        int preferredStep = Math.max(1, log.heightAboveOrigin + 1);
        int forwardLayer = direction.forwardOffset(log.relativeX, log.relativeZ) - layout.minForward;
        int lateralLayer = direction.lateralOffset(log.relativeX, log.relativeZ) - layout.minLateral;
        int lateralOffset = layout.minLateral + lateralLayer + (forwardLayer * layout.lateralWidth);
        int baseX = origin.getX() + (direction.x * preferredStep) + (direction.lateralX * lateralOffset);
        int baseZ = origin.getZ() + (direction.z * preferredStep) + (direction.lateralZ * lateralOffset);
        int maxStep = Math.max(preferredStep + 12, maxLogs + 12);
        for (int step = preferredStep; step <= maxStep; step += 1) {
            int stepDelta = step - preferredStep;
            int x = baseX + (direction.x * stepDelta);
            int z = baseZ + (direction.z * stepDelta);
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

    private Block findSupportedLeafBlockAt(Block origin, int x, int z, Set<String> supportTargets) {
        int maxY = Math.min(origin.getWorld().getMaxHeight() - 1, origin.getY() + 8);
        int minY = Math.max(origin.getWorld().getMinHeight() + 1, origin.getY() - 12);
        for (int y = maxY; y >= minY; y -= 1) {
            Block target = origin.getWorld().getBlockAt(x, y, z);
            if (!isSupportedLeafTarget(target, supportTargets)) {
                continue;
            }
            return target;
        }
        return null;
    }

    private boolean isSupportedLeafTarget(Block target, Set<String> supportTargets) {
        if (usedAsTarget(target, supportTargets) || !canReplace(target)) {
            return false;
        }
        Block support = target.getRelative(BlockFace.DOWN);
        return support.getType().isSolid() || supportTargets.contains(key(support));
    }

    private boolean usedAsTarget(Block target, Set<String> usedTargets) {
        return usedTargets.contains(key(target));
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
        private final int relativeX;
        private final int relativeZ;
        private Block landingBlock;

        private LogSnapshot(Block block, Material material, BlockData originalData, BlockData fallenData, int heightAboveOrigin, int relativeX, int relativeZ) {
            this.block = block;
            this.material = material;
            this.originalData = originalData;
            this.fallenData = fallenData;
            this.heightAboveOrigin = heightAboveOrigin;
            this.relativeX = relativeX;
            this.relativeZ = relativeZ;
        }
    }

    private static final class LeafSnapshot {
        private final Block block;
        private final Material material;
        private final BlockData originalData;
        private final int heightAboveOrigin;
        private final int relativeX;
        private final int relativeZ;
        private Block landingBlock;
        private Vector targetCenter;

        private LeafSnapshot(Block block, Material material, BlockData originalData, int heightAboveOrigin, int relativeX, int relativeZ) {
            this.block = block;
            this.material = material;
            this.originalData = originalData;
            this.heightAboveOrigin = heightAboveOrigin;
            this.relativeX = relativeX;
            this.relativeZ = relativeZ;
        }
    }

    private static final class FallenLayout {
        private final int minForward;
        private final int minLateral;
        private final int lateralWidth;

        private FallenLayout(int minForward, int minLateral, int lateralWidth) {
            this.minForward = minForward;
            this.minLateral = minLateral;
            this.lateralWidth = lateralWidth;
        }
    }

    private static final class AnimatedBlock {
        private final BlockDisplay display;
        private final Vector startCenter;
        private final Vector targetCenter;
        private final int delayTicks;
        private final int durationTicks;
        private final double arcHeight;
        private final Vector rotationAxis;
        private final double rotationAngle;

        private AnimatedBlock(BlockDisplay display, Vector startCenter, Vector targetCenter, int delayTicks, int durationTicks, double arcHeight, Vector rotationAxis, double rotationAngle) {
            this.display = display;
            this.startCenter = startCenter;
            this.targetCenter = targetCenter;
            this.delayTicks = delayTicks;
            this.durationTicks = durationTicks;
            this.arcHeight = arcHeight;
            this.rotationAxis = rotationAxis;
            this.rotationAngle = rotationAngle;
        }
    }

    private enum FallDirection {
        NORTH(BlockFace.NORTH, 0, -1, Axis.Z, 1, 0),
        SOUTH(BlockFace.SOUTH, 0, 1, Axis.Z, 1, 0),
        EAST(BlockFace.EAST, 1, 0, Axis.X, 0, 1),
        WEST(BlockFace.WEST, -1, 0, Axis.X, 0, 1);

        private final BlockFace face;
        private final int x;
        private final int z;
        private final Axis axis;
        private final int lateralX;
        private final int lateralZ;

        FallDirection(BlockFace face, int x, int z, Axis axis, int lateralX, int lateralZ) {
            this.face = face;
            this.x = x;
            this.z = z;
            this.axis = axis;
            this.lateralX = lateralX;
            this.lateralZ = lateralZ;
        }

        private Vector vector() {
            return new Vector(x, 0.0D, z);
        }

        private Vector rotationAxis() {
            Vector up = new Vector(0.0D, 1.0D, 0.0D);
            return up.crossProduct(vector()).normalize();
        }

        private int forwardOffset(int relativeX, int relativeZ) {
            return (relativeX * x) + (relativeZ * z);
        }

        private int lateralOffset(int relativeX, int relativeZ) {
            return (relativeX * lateralX) + (relativeZ * lateralZ);
        }
    }
}
