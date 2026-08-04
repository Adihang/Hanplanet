package dev.hanplanet.saplingreplant;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.minecraft.core.BlockPos;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.tags.BlockTags;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;

/** Plants dropped saplings after they have rested on valid ground for a while. */
public final class SaplingReplant implements ModInitializer {
    private static final int PLANT_AFTER_TICKS = 20 * 10;
    private static final int TREE_SEARCH_RADIUS = 4;
    private static final int CHECK_INTERVAL_TICKS = 10;
    private int tickCounter;

    @Override
    public void onInitialize() {
        ServerTickEvents.END_SERVER_TICK.register(this::onServerTick);
    }

    private void onServerTick(MinecraftServer server) {
        if (++tickCounter < CHECK_INTERVAL_TICKS) {
            return;
        }
        tickCounter = 0;

        for (ServerLevel level : server.getAllLevels()) {
            for (var entity : level.getAllEntities()) {
                if (entity instanceof ItemEntity itemEntity) {
                    tryPlant(level, itemEntity);
                }
            }
        }
    }

    private void tryPlant(ServerLevel level, ItemEntity itemEntity) {
        if (itemEntity.isRemoved() || !itemEntity.onGround() || itemEntity.getAge() < PLANT_AFTER_TICKS) {
            return;
        }

        ItemStack stack = itemEntity.getItem();
        if (!(stack.getItem() instanceof BlockItem blockItem)) {
            return;
        }

        Block block = blockItem.getBlock();
        BlockState saplingState = block.defaultBlockState();
        if (!isSapling(saplingState)) {
            return;
        }

        BlockPos supportPos = itemEntity.getBlockPosBelowThatAffectsMyMovement();
        BlockPos plantPos = supportPos.above();
        BlockState currentState = level.getBlockState(plantPos);
        if (!(currentState.isAir() || currentState.is(BlockTags.REPLACEABLE))) {
            return;
        }
        if (!saplingState.canSurvive(level, plantPos) || hasNearbyTree(level, plantPos)) {
            return;
        }

        if (level.setBlock(plantPos, saplingState, Block.UPDATE_ALL)) {
            stack.shrink(1);
            if (stack.isEmpty()) {
                itemEntity.discard();
            } else {
                itemEntity.setItem(stack);
            }
        }
    }

    private boolean isSapling(BlockState state) {
        String path = BuiltInRegistries.BLOCK.getKey(state.getBlock()).getPath();
        return path.endsWith("_sapling") || "mangrove_propagule".equals(path);
    }

    private boolean hasNearbyTree(ServerLevel level, BlockPos center) {
        int minX = center.getX() - TREE_SEARCH_RADIUS;
        int maxX = center.getX() + TREE_SEARCH_RADIUS;
        int minY = center.getY() - TREE_SEARCH_RADIUS;
        int maxY = center.getY() + TREE_SEARCH_RADIUS;
        int minZ = center.getZ() - TREE_SEARCH_RADIUS;
        int maxZ = center.getZ() + TREE_SEARCH_RADIUS;
        int radiusSquared = TREE_SEARCH_RADIUS * TREE_SEARCH_RADIUS;

        for (BlockPos position : BlockPos.betweenClosed(minX, minY, minZ, maxX, maxY, maxZ)) {
            int dx = position.getX() - center.getX();
            int dy = position.getY() - center.getY();
            int dz = position.getZ() - center.getZ();
            if (dx * dx + dy * dy + dz * dz > radiusSquared) {
                continue;
            }

            BlockState state = level.getBlockState(position);
            if (state.is(BlockTags.LOGS) || state.is(BlockTags.LEAVES)) {
                return true;
            }
        }
        return false;
    }
}
