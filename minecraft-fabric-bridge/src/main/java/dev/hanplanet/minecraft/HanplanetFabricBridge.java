package dev.hanplanet.minecraft;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.ChatFormatting;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.minecraft.commands.Commands;
import net.minecraft.core.Holder;
import net.minecraft.core.component.DataComponents;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.food.FoodData;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.enchantment.ItemEnchantments;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.saveddata.WeatherData;
import net.minecraft.resources.Identifier;
import net.minecraft.resources.ResourceKey;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Small Fabric replacement for the former Bukkit bridge. The web application
 * intentionally talks to this through the same status file and command
 * markers, so the web UI does not need to know which server loader is active.
 */
public final class HanplanetFabricBridge implements ModInitializer {
    private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().create();
    private static final int MAX_TRADE_AMOUNT = 2304;
    private static final String TRADE_OK = "HANPLANET_TRADE_OK";
    private static final String TRADE_ERROR = "HANPLANET_TRADE_ERROR";
    private static final String TRADE_ITEM = "HANPLANET_TRADE_ITEM";
    private static final String DEFAULT_LINK_API = "http://127.0.0.1:8000/api/minecraft/link/complete";
    private static final String DEFAULT_SHARED_SECRET = "";

    private MinecraftServer server;
    private Path serverDirectory;
    private Path statusPath;
    private Path headsPath;
    private Path escrowPath;
    private Path noticePath;
    private final Map<String, Escrow> escrows = new ConcurrentHashMap<>();
    private final Map<String, List<String>> pendingNotices = new ConcurrentHashMap<>();
    private final Map<String, String> config = new HashMap<>();
    private long lastNonEmptyTick;
    private int pauseWhenEmptySeconds;
    private boolean statusPauseAnnounced;
    private int statusTick;

    @Override
    public void onInitialize() {
        ServerLifecycleEvents.SERVER_STARTED.register(this::onServerStarted);
        ServerLifecycleEvents.SERVER_STOPPING.register(this::onServerStopping);
        ServerTickEvents.END_SERVER_TICK.register(this::onServerTick);
        CommandRegistrationCallback.EVENT.register((dispatcher, registryAccess, environment) -> registerCommands(dispatcher));
    }

    private void onServerStarted(MinecraftServer minecraftServer) {
        server = minecraftServer;
        serverDirectory = server.getServerDirectory();
        statusPath = serverDirectory.resolve("web").resolve("status.json");
        headsPath = serverDirectory.resolve("web").resolve("player-heads");
        escrowPath = serverDirectory.resolve("config").resolve("hanplanet-bridge-trades.json");
        noticePath = serverDirectory.resolve("config").resolve("hanplanet-bridge-notices.json");
        loadConfig();
        loadEscrows();
        loadNotices();
        pauseWhenEmptySeconds = readPauseWhenEmptySeconds();
        statusPauseAnnounced = false;
        lastNonEmptyTick = server.getTickCount();
        writeStatus();
        server.sendSystemMessage(Component.literal("Hanplanet Fabric bridge enabled."));
    }

    private void onServerStopping(MinecraftServer minecraftServer) {
        saveEscrows();
        writeOfflineStatus();
    }

    private void onServerTick(MinecraftServer minecraftServer) {
        if (server == null) {
            return;
        }
        deliverQueuedNotices();
        boolean hasPlayers = !server.getPlayerList().getPlayers().isEmpty();
        if (hasPlayers) {
            boolean wasPaused = statusPauseAnnounced;
            lastNonEmptyTick = server.getTickCount();
            statusPauseAnnounced = false;
            if (wasPaused) {
                writeStatus(false);
            }
        } else if (!statusPauseAnnounced && (server.isPaused() || shouldAnnouncePause())) {
            statusPauseAnnounced = true;
            writeStatus(true);
        }
        if (++statusTick >= 100) {
            statusTick = 0;
            writeStatus();
            saveEscrows();
        }
    }

    private int readPauseWhenEmptySeconds() {
        if (serverDirectory == null) return 0;
        Path propertiesPath = serverDirectory.resolve("server.properties");
        Properties properties = new Properties();
        try (var reader = Files.newBufferedReader(propertiesPath, StandardCharsets.UTF_8)) {
            properties.load(reader);
            return Math.max(0, Integer.parseInt(properties.getProperty("pause-when-empty-seconds", "0").trim()));
        } catch (IOException | NumberFormatException ignored) {
            return 0;
        }
    }

    private boolean shouldAnnouncePause() {
        if (pauseWhenEmptySeconds <= 0 || server == null) return false;
        long pauseTicks = Math.max(1L, pauseWhenEmptySeconds * 20L - 1L);
        return server.getTickCount() - lastNonEmptyTick >= pauseTicks;
    }

    private void registerCommands(com.mojang.brigadier.CommandDispatcher<net.minecraft.commands.CommandSourceStack> dispatcher) {
        dispatcher.register(
            Commands.literal("minecraftstatus")
                .requires(source -> Commands.LEVEL_ADMINS.check(source.permissions()))
                .then(Commands.argument("arguments", StringArgumentType.greedyString())
                    .executes(context -> handleMinecraftStatus(context.getSource(), StringArgumentType.getString(context, "arguments"))))
        );
        dispatcher.register(
            Commands.literal("link")
                .then(Commands.argument("code", StringArgumentType.word())
                    .executes(context -> handleLink(context.getSource(), StringArgumentType.getString(context, "code"))))
        );
        dispatcher.register(
            Commands.literal("accountlink")
                .then(Commands.argument("code", StringArgumentType.word())
                    .executes(context -> handleLink(context.getSource(), StringArgumentType.getString(context, "code"))))
        );
    }

    private int handleMinecraftStatus(net.minecraft.commands.CommandSourceStack source, String rawArguments) {
        String[] args = splitArguments(rawArguments);
        if (args.length == 0) {
            source.sendFailure(Component.literal("Usage: minecraftstatus <set|trade> ..."));
            return 0;
        }
        if ("trade".equalsIgnoreCase(args[0])) {
            return handleTrade(source, args);
        }
        if ("set".equalsIgnoreCase(args[0])) {
            return handleSet(source, args);
        }
        source.sendFailure(Component.literal("Usage: minecraftstatus <set|trade> ..."));
        return 0;
    }

    private int handleSet(net.minecraft.commands.CommandSourceStack source, String[] args) {
        if (args.length < 4) {
            source.sendFailure(Component.literal("Usage: minecraftstatus set <player> <field> <value>"));
            return 0;
        }
        ServerPlayer player = onlinePlayer(args[1]);
        if (player == null) {
            source.sendFailure(Component.literal("Player is not online: " + args[1]));
            return 0;
        }
        String field = args[2].toLowerCase(Locale.ROOT);
        try {
            switch (field) {
                case "health" -> player.setHealth((float) clamp(Double.parseDouble(args[3]), 0, player.getMaxHealth()));
                case "food" -> setFood(player, Integer.parseInt(args[3]));
                case "level" -> player.setExperienceLevels((int) clamp(Integer.parseInt(args[3]), 0, 21863));
                case "exp", "experience" -> player.experienceProgress = (float) clamp(Double.parseDouble(args[3]), 0, 1);
                case "gamemode" -> {
                    GameType gameType = GameType.byName(args[3], GameType.SURVIVAL);
                    if (gameType == null) throw new IllegalArgumentException("game mode");
                    player.setGameMode(gameType);
                }
                case "location", "teleport" -> {
                    if (args.length < 7) throw new IllegalArgumentException("location");
                    ServerLevel level = findLevel(args[3]);
                    if (level == null) throw new IllegalArgumentException("world");
                    player.teleportTo(level, Double.parseDouble(args[4]), Double.parseDouble(args[5]), Double.parseDouble(args[6]), Set.of(), player.getYRot(), player.getXRot(), false);
                }
                case "effects" -> setEffects(player, args);
                case "inventory" -> setInventory(player, args);
                default -> throw new IllegalArgumentException("field");
            }
            writeStatus();
            source.sendSuccess(() -> Component.literal("Updated " + player.getName().getString() + "."), true);
            return 1;
        } catch (RuntimeException error) {
            source.sendFailure(Component.literal("Minecraft status update failed: " + error.getMessage()));
            return 0;
        }
    }

    private void setFood(ServerPlayer player, int food) {
        FoodData data = player.getFoodData();
        data.setFoodLevel((int) clamp(food, 0, 20));
        data.setSaturation(Math.min(data.getSaturationLevel(), data.getFoodLevel()));
    }

    private void setEffects(ServerPlayer player, String[] args) {
        if (args.length < 4) throw new IllegalArgumentException("effects");
        if ("clear".equalsIgnoreCase(args[3])) {
            player.removeAllEffects();
            return;
        }
        if (!"add".equalsIgnoreCase(args[3]) || args.length < 7) throw new IllegalArgumentException("effects add <effect> <level> <seconds>");
        Identifier id = Identifier.withDefaultNamespace(args[4].toLowerCase(Locale.ROOT));
        var effect = BuiltInRegistries.MOB_EFFECT.get(id).orElseThrow(() -> new IllegalArgumentException("unknown effect"));
        int amplifier = (int) clamp(Integer.parseInt(args[5]) - 1, 0, 255);
        int duration = (int) clamp(Integer.parseInt(args[6]) * 20L, 1, 1728000);
        player.addEffect(new MobEffectInstance(effect, duration, amplifier, false, true, true));
    }

    private void setInventory(ServerPlayer player, String[] args) {
        if (args.length < 4) throw new IllegalArgumentException("inventory set|clear");
        Inventory inventory = player.getInventory();
        if ("clear".equalsIgnoreCase(args[3])) {
            if (args.length == 4) {
                inventory.clearContent();
                for (EquipmentSlot slot : List.of(EquipmentSlot.HEAD, EquipmentSlot.CHEST, EquipmentSlot.LEGS, EquipmentSlot.FEET, EquipmentSlot.OFFHAND)) {
                    player.setItemSlot(slot, ItemStack.EMPTY);
                }
            } else {
                setInventorySlot(player, args[4], ItemStack.EMPTY);
            }
            inventory.setChanged();
            return;
        }
        if (!"set".equalsIgnoreCase(args[3]) || args.length < 7) throw new IllegalArgumentException("inventory set <slot> <item> <amount>");
        Item item = resolveItem(args[5]);
        if (item == null) throw new IllegalArgumentException("unknown item");
        int amount = (int) clamp(Integer.parseInt(args[6]), 1, Math.min(MAX_TRADE_AMOUNT, item.getDefaultMaxStackSize()));
        setInventorySlot(player, args[4], new ItemStack(item, amount));
        inventory.setChanged();
    }

    private void setInventorySlot(ServerPlayer player, String slotValue, ItemStack item) {
        Inventory inventory = player.getInventory();
        String slot = slotValue.toLowerCase(Locale.ROOT);
        if (slot.matches("\\d+")) {
            int index = Integer.parseInt(slot);
            if (index < 0 || index > 35) throw new IllegalArgumentException("slot");
            inventory.setItem(index, item);
            return;
        }
        EquipmentSlot equipment = switch (slot) {
            case "helmet", "head" -> EquipmentSlot.HEAD;
            case "chestplate", "chest" -> EquipmentSlot.CHEST;
            case "leggings", "legs" -> EquipmentSlot.LEGS;
            case "boots", "feet" -> EquipmentSlot.FEET;
            case "offhand" -> EquipmentSlot.OFFHAND;
            default -> null;
        };
        if (equipment == null) throw new IllegalArgumentException("slot");
        player.setItemSlot(equipment, item);
    }

    private int handleTrade(net.minecraft.commands.CommandSourceStack source, String[] args) {
        if (args.length < 2) return tradeError(source, "usage", "invalid");
        return switch (args[1].toLowerCase(Locale.ROOT)) {
            case "reserve-escrow" -> reserveEscrow(source, args);
            case "release-escrow" -> releaseEscrow(source, args);
            case "exchange-escrow" -> exchangeEscrow(source, args);
            case "payout-escrow" -> payoutEscrow(source, args);
            case "settle-escrow" -> settleEscrow(source, args);
            case "npc-exchange" -> npcExchange(source, args);
            case "reserve" -> reserveDirect(source, args);
            case "return", "claim", "payout", "settle", "exchange" -> directCompatibility(source, args);
            default -> tradeError(source, args[1], "invalid");
        };
    }

    private int reserveEscrow(net.minecraft.commands.CommandSourceStack source, String[] args) {
        if (args.length < 8) return tradeError(source, "reserve-escrow", "invalid");
        String listingId = args[2];
        ServerPlayer seller = onlinePlayer(args[3]);
        int slot = parseSlot(args[4]);
        int amount = parseAmount(args[5]);
        int priceAmount = parseAmount(args[7]);
        if (seller == null) return tradeError(source, "reserve-escrow", "player_offline");
        if (slot < 0 || amount < 1 || priceAmount < 1) return tradeError(source, "reserve-escrow", "invalid");
        ItemStack stack = seller.getInventory().getItem(slot);
        if (stack.isEmpty() || stack.getCount() < amount) return tradeError(source, "reserve-escrow", "insufficient_item");
        ItemStack held = stack.copyWithCount(amount);
        stack.shrink(amount);
        seller.getInventory().setChanged();
        escrows.put(listingId, new Escrow(listingId, seller.getName().getString(), itemId(held), amount, 0, "", 0, held));
        saveEscrows();
        String language = args.length > 8 ? args[8] : "ko";
        String sellLabel = decodeNoticeLabel(args.length > 9 ? args[9] : "", itemId(held));
        String priceLabel = decodeNoticeLabel(args.length > 10 ? args[10] : "", args[6]);
        notifyTrade(seller, noticeTag(language, "[거래 등록]", "[Trade listed]") + " " + noticeItem(sellLabel, amount) + " -> " + noticeItem(priceLabel, priceAmount));
        notifyTrade(seller, noticeTag(language, "[보관]", "[Stored]") + " " + noticeItem(sellLabel, amount));
        sendTradeItem(source, "reserve-escrow", listingId, held);
        return tradeOk(source, "reserve-escrow");
    }

    private int releaseEscrow(net.minecraft.commands.CommandSourceStack source, String[] args) {
        if (args.length < 3) return tradeError(source, "release-escrow", "invalid");
        Escrow escrow = escrows.remove(args[2]);
        if (escrow == null) return tradeError(source, "release-escrow", "escrow_missing");
        ServerPlayer seller = onlinePlayer(escrow.seller);
        if (seller == null || !canFit(seller, escrow.stack)) {
            escrows.put(escrow.id, escrow);
            return tradeError(source, "release-escrow", seller == null ? "player_offline" : "inventory_full");
        }
        give(seller, escrow.stack.copyWithCount(escrow.amount));
        saveEscrows();
        return tradeOk(source, "release-escrow");
    }

    private int exchangeEscrow(net.minecraft.commands.CommandSourceStack source, String[] args) {
        if (args.length < 9) return tradeError(source, "exchange-escrow", "invalid");
        Escrow escrow = escrows.get(args[2]);
        ServerPlayer buyer = onlinePlayer(args[3]);
        Item priceItem = resolveItem(args[4]);
        int priceAmount = parseAmount(args[5]);
        int sellAmount = parseAmount(args[6]);
        if (escrow == null) return tradeError(source, "exchange-escrow", "escrow_missing");
        if (buyer == null) return tradeError(source, "exchange-escrow", "player_offline");
        if (priceItem == null || priceAmount < 1 || sellAmount < 1 || sellAmount > escrow.amount) return tradeError(source, "exchange-escrow", "invalid");
        ItemStack payment = new ItemStack(priceItem, priceAmount);
        if (countItem(buyer, priceItem) < priceAmount) return tradeError(source, "exchange-escrow", "insufficient_item");
        ItemStack sale = escrow.stack.copyWithCount(sellAmount);
        if (!canFit(buyer, sale)) return tradeError(source, "exchange-escrow", "inventory_full");
        String buyerLanguage = args.length > 8 ? args[8] : "ko";
        String sellerLanguage = args.length > 9 ? args[9] : buyerLanguage;
        String buyerPriceLabel = decodeNoticeLabel(args.length > 10 ? args[10] : "", itemId(payment));
        String buyerSellLabel = decodeNoticeLabel(args.length > 11 ? args[11] : "", itemId(sale));
        String sellerSellLabel = decodeNoticeLabel(args.length > 12 ? args[12] : "", itemId(sale));
        String sellerPriceLabel = decodeNoticeLabel(args.length > 13 ? args[13] : "", itemId(payment));
        removeItems(buyer, priceItem, priceAmount);
        give(buyer, sale);
        escrow.amount -= sellAmount;
        escrow.pendingPriceAmount += priceAmount;
        escrow.pendingPriceItem = itemId(priceItem);
        if (escrow.amount <= 0) {
            escrow.amount = 0;
        }
        saveEscrows();
        notifyTrade(buyer, noticeTag(buyerLanguage, "[거래 완료]", "[Trade completed]") + " " + noticeItem(buyerPriceLabel, priceAmount) + " -> " + noticeItem(buyerSellLabel, sellAmount));
        notifyTrade(buyer, noticeTag(buyerLanguage, "[수령]", "[Received]") + " " + noticeItem(buyerSellLabel, sellAmount));
        ServerPlayer seller = onlinePlayer(escrow.seller);
        if (seller != null) {
            notifyTrade(seller, noticeTag(sellerLanguage, "[거래완료]", "[Trade completed]") + " " + noticeItem(sellerSellLabel, sellAmount) + " -> " + noticeItem(sellerPriceLabel, priceAmount));
            notifyTrade(seller, noticeTag(sellerLanguage, "[보관]", "[Stored]") + " " + noticeItem(sellerPriceLabel, priceAmount));
        } else {
            queueNotice(escrow.seller, noticeTag(sellerLanguage, "[거래완료]", "[Trade completed]") + " " + noticeItem(sellerSellLabel, sellAmount) + " -> " + noticeItem(sellerPriceLabel, priceAmount));
            queueNotice(escrow.seller, noticeTag(sellerLanguage, "[보관]", "[Stored]") + " " + noticeItem(sellerPriceLabel, priceAmount));
        }
        return tradeOk(source, "exchange-escrow");
    }

    private int payoutEscrow(net.minecraft.commands.CommandSourceStack source, String[] args) {
        if (args.length < 6) return tradeError(source, "payout-escrow", "invalid");
        Escrow escrow = escrows.get(args[2]);
        ServerPlayer seller = onlinePlayer(args[3]);
        Item priceItem = resolveItem(args[4]);
        int priceAmount = parseAmount(args[5]);
        if (escrow == null) return tradeError(source, "payout-escrow", "escrow_missing");
        if (seller == null) return tradeError(source, "payout-escrow", "player_offline");
        if (!escrow.seller.equalsIgnoreCase(seller.getName().getString())) {
            return tradeError(source, "payout-escrow", "invalid");
        }
        if (priceItem == null || priceAmount < 1 || escrow.pendingPriceAmount != priceAmount) {
            return tradeError(source, "payout-escrow", "invalid");
        }
        if (!escrow.pendingPriceItem.isBlank() && !escrow.pendingPriceItem.equals(itemId(priceItem))) {
            return tradeError(source, "payout-escrow", "invalid");
        }

        ItemStack payout = new ItemStack(priceItem, priceAmount);
        if (!canFit(seller, payout)) return tradeError(source, "payout-escrow", "inventory_full");
        give(seller, payout);
        escrow.pendingPriceAmount = 0;
        escrow.pendingPriceItem = "";
        saveEscrows();

        String language = args.length > 6 ? args[6] : "ko";
        String priceLabel = decodeNoticeLabel(args.length > 7 ? args[7] : "", itemId(payout));
        notifyTrade(seller, noticeTag(language, "[수령]", "[Received]") + " " + noticeItem(priceLabel, priceAmount));
        return tradeOk(source, "payout-escrow");
    }

    private int settleEscrow(net.minecraft.commands.CommandSourceStack source, String[] args) {
        if (args.length < 5) return tradeError(source, "settle-escrow", "invalid");
        Escrow escrow = escrows.get(args[2]);
        ServerPlayer seller = onlinePlayer(args[3]);
        Item priceItem = resolveItem(args[4]);
        if (escrow == null) return tradeError(source, "settle-escrow", "escrow_missing");
        if (seller == null) return tradeError(source, "settle-escrow", "player_offline");
        if (priceItem == null) return tradeError(source, "settle-escrow", "invalid");
        ItemStack payout = new ItemStack(priceItem, escrow.pendingPriceAmount);
        ItemStack remainder = escrow.stack.copyWithCount(escrow.amount);
        String language = args.length > 6 ? args[6] : "ko";
        String priceLabel = decodeNoticeLabel(args.length > 7 ? args[7] : "", itemId(payout));
        String sellLabel = decodeNoticeLabel(args.length > 8 ? args[8] : "", itemId(remainder));
        if (escrow.pendingPriceAmount > 0 && !canFit(seller, payout)) return tradeError(source, "settle-escrow", "inventory_full");
        if (escrow.amount > 0 && !canFit(seller, remainder)) return tradeError(source, "settle-escrow", "inventory_full");
        if (!payout.isEmpty()) give(seller, payout);
        if (!remainder.isEmpty()) give(seller, remainder);
        escrows.remove(escrow.id);
        saveEscrows();
        List<String> receivedItems = new ArrayList<>();
        if (!payout.isEmpty()) receivedItems.add(noticeItem(priceLabel, payout.getCount()));
        if (!remainder.isEmpty()) receivedItems.add(noticeItem(sellLabel, remainder.getCount()));
        if (!receivedItems.isEmpty()) {
            notifyTrade(seller, noticeTag(language, "[수령]", "[Received]") + " " + String.join(", ", receivedItems));
        }
        return tradeOk(source, "settle-escrow");
    }

    private int npcExchange(net.minecraft.commands.CommandSourceStack source, String[] args) {
        if (args.length < 7) return tradeError(source, "npc-exchange", "invalid");
        ServerPlayer buyer = onlinePlayer(args[2]);
        Item priceItem = resolveItem(args[3]);
        Item sellItem = resolveItem(args[5]);
        int priceAmount = parseAmount(args[4]);
        int sellAmount = parseAmount(args[6]);
        if (buyer == null || priceItem == null || sellItem == null || priceAmount < 1 || sellAmount < 1) return tradeError(source, "npc-exchange", "invalid");
        if (countItem(buyer, priceItem) < priceAmount) return tradeError(source, "npc-exchange", "insufficient_item");
        ItemStack sale = new ItemStack(sellItem, sellAmount);
        if (!canFit(buyer, sale)) return tradeError(source, "npc-exchange", "inventory_full");
        String language = args.length > 7 ? args[7] : "ko";
        String priceLabel = decodeNoticeLabel(args.length > 8 ? args[8] : "", itemId(new ItemStack(priceItem, priceAmount)));
        String sellLabel = decodeNoticeLabel(args.length > 9 ? args[9] : "", itemId(sale));
        removeItems(buyer, priceItem, priceAmount);
        give(buyer, sale);
        notifyTrade(buyer, noticeTag(language, "[거래 완료]", "[Trade completed]") + " " + noticeItem(priceLabel, priceAmount) + " -> " + noticeItem(sellLabel, sellAmount));
        notifyTrade(buyer, noticeTag(language, "[수령]", "[Received]") + " " + noticeItem(sellLabel, sellAmount));
        return tradeOk(source, "npc-exchange");
    }

    private int reserveDirect(net.minecraft.commands.CommandSourceStack source, String[] args) {
        if (args.length < 5) return tradeError(source, "reserve", "invalid");
        ServerPlayer player = onlinePlayer(args[2]);
        Item item = resolveItem(args[3]);
        int amount = parseAmount(args[4]);
        if (player == null || item == null || amount < 1) return tradeError(source, "reserve", "invalid");
        if (countItem(player, item) < amount) return tradeError(source, "reserve", "insufficient_item");
        removeItems(player, item, amount);
        notifyTrade(player, "[보관] " + itemKey(item) + "x" + amount);
        return tradeOk(source, "reserve");
    }

    private int directCompatibility(net.minecraft.commands.CommandSourceStack source, String[] args) {
        // New web listings always use escrow. Keep the legacy markers available
        // for old pages and return a clear error instead of silently changing items.
        return tradeError(source, args[1], "unsupported_on_fabric");
    }

    private int tradeOk(net.minecraft.commands.CommandSourceStack source, String action) {
        source.sendSuccess(() -> Component.literal(TRADE_OK + " " + action), false);
        return 1;
    }

    private int tradeError(net.minecraft.commands.CommandSourceStack source, String action, String code) {
        source.sendFailure(Component.literal(TRADE_ERROR + " " + action + " " + code));
        return 0;
    }

    private void sendTradeItem(net.minecraft.commands.CommandSourceStack source, String action, String id, ItemStack stack) {
        JsonObject value = new JsonObject();
        value.addProperty("type", itemId(stack));
        value.addProperty("amount", stack.getCount());
        String encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(GSON.toJson(value).getBytes(StandardCharsets.UTF_8));
        source.sendSuccess(() -> Component.literal(TRADE_ITEM + " " + action + " " + id + " " + encoded), false);
    }

    private int handleLink(net.minecraft.commands.CommandSourceStack source, String code) {
        ServerPlayer player = source.getPlayer();
        if (player == null) {
            source.sendFailure(Component.literal("This command can only be used by a player."));
            return 0;
        }
        String normalizedCode = code.trim().toUpperCase(Locale.ROOT);
        String apiUrl = config.getOrDefault("api-url", DEFAULT_LINK_API);
        String secret = config.getOrDefault("shared-secret", DEFAULT_SHARED_SECRET);
        if (secret.isBlank()) {
            source.sendFailure(Component.literal("Minecraft account linking is not configured."));
            return 0;
        }
        JsonObject payload = new JsonObject();
        payload.addProperty("code", normalizedCode);
        payload.addProperty("minecraftUuid", player.getUUID().toString());
        payload.addProperty("minecraftName", player.getName().getString());
        payload.addProperty("edition", player.getName().getString().startsWith("BE_") ? "bedrock" : "java");
        long timestamp = Instant.now().getEpochSecond();
        String body = GSON.toJson(payload);
        String signature = hmac(secret, timestamp + "." + body);
        HttpRequest request = HttpRequest.newBuilder(URI.create(apiUrl))
            .timeout(java.time.Duration.ofSeconds(6))
            .header("Content-Type", "application/json")
            .header("X-Hanplanet-Minecraft-Timestamp", Long.toString(timestamp))
            .header("X-Hanplanet-Minecraft-Signature", "sha256=" + signature)
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build();
        HttpClient.newHttpClient().sendAsync(request, HttpResponse.BodyHandlers.ofString())
            .thenAccept(response -> server.execute(() -> {
                if (response.statusCode() >= 200 && response.statusCode() < 300) {
                    player.sendSystemMessage(Component.literal("Minecraft 계정이 Hanplanet 계정에 연동되었습니다."));
                } else {
                    player.sendSystemMessage(Component.literal("계정 연동에 실패했습니다: " + response.body()));
                }
            }))
            .exceptionally(error -> {
                server.execute(() -> player.sendSystemMessage(Component.literal("계정 연동 서버에 연결할 수 없습니다.")));
                return null;
            });
        source.sendSuccess(() -> Component.literal("계정 연동을 확인하는 중입니다."), false);
        return 1;
    }

    private void writeStatus() {
        writeStatus(server != null && server.isPaused());
    }

    private void writeStatus(boolean paused) {
        if (server == null || statusPath == null) return;
        JsonObject status = new JsonObject();
        status.addProperty("generatedAt", Instant.now().toString());
        status.addProperty("source", "fabric-mod");
        status.addProperty("serverOnline", true);
        status.add("version", object("name", server.getServerModName() + " " + server.getServerVersion()));
        status.addProperty("motd", server.getMotd());
        status.add("world", worldStatus(server.overworld(), paused));
        JsonArray worlds = new JsonArray();
        for (ServerLevel level : server.getAllLevels()) {
            JsonObject world = new JsonObject();
            world.addProperty("name", level.dimension().identifier().getPath());
            world.addProperty("key", level.dimension().identifier().toString());
            String environment = level.dimension().equals(Level.OVERWORLD)
                ? "normal"
                : level.dimension().equals(Level.NETHER)
                    ? "nether"
                    : level.dimension().equals(Level.END) ? "the_end" : level.dimension().identifier().getPath();
            world.addProperty("environment", environment);
            worlds.add(world);
        }
        status.add("worlds", worlds);
        status.add("items", itemOptions());
        List<ServerPlayer> online = server.getPlayerList().getPlayers();
        status.addProperty("onlineCount", online.size());
        status.addProperty("maxPlayers", server.getPlayerList().getMaxPlayers());
        status.add("players", playerRows(online));
        atomicWrite(statusPath, GSON.toJson(status) + "\n");
    }

    private JsonObject worldStatus(ServerLevel level, boolean paused) {
        long ticks = level.getOverworldClockTime();
        WeatherData weatherData = level.getWeatherData();
        String weather = weatherData.isThundering() ? "thunder" : weatherData.isRaining() ? "rain" : "clear";
        JsonObject world = new JsonObject();
        world.addProperty("timeTicks", ticks);
        world.addProperty("timeLabel", formatTime(ticks));
        world.addProperty("weather", weather);
        world.addProperty("paused", paused || server.isPaused());
        return world;
    }

    private JsonArray itemOptions() {
        JsonArray items = new JsonArray();
        BuiltInRegistries.ITEM.entrySet().stream()
            .sorted(Comparator.comparing(entry -> entry.getKey().identifier().toString()))
            .forEach(entry -> {
                String id = entry.getKey().identifier().getPath();
                Item item = entry.getValue();
                JsonObject row = new JsonObject();
                row.addProperty("value", id);
                row.addProperty("label", prettyName(id));
                row.addProperty("maxStackSize", item.getDefaultMaxStackSize());
                items.add(row);
            });
        return items;
    }

    private JsonArray playerRows(Collection<ServerPlayer> online) {
        JsonArray players = new JsonArray();
        Set<String> current = new HashSet<>();
        for (ServerPlayer player : online) {
            String name = player.getName().getString();
            current.add(name.toLowerCase(Locale.ROOT));
            JsonObject row = new JsonObject();
            row.addProperty("name", name);
            row.addProperty("online", true);
            row.addProperty("uuid", player.getUUID().toString());
            addHeadUrl(row, player.getUUID());
            row.add("detail", playerDetail(player));
            players.add(row);
        }
        // usercache.json is intentionally read only for names and UUIDs; no
        // offline inventory or private data is exposed to the public endpoint.
        Path usercache = serverDirectory.resolve("usercache.json");
        try {
            JsonElement parsed = JsonParser.parseString(Files.readString(usercache));
            if (parsed.isJsonArray()) {
                for (JsonElement element : parsed.getAsJsonArray()) {
                    JsonObject cached = element.getAsJsonObject();
                    String name = cached.get("name").getAsString();
                    if (current.contains(name.toLowerCase(Locale.ROOT))) continue;
                    JsonObject row = new JsonObject();
                    row.addProperty("name", name);
                    row.addProperty("online", false);
                    row.addProperty("uuid", cached.get("uuid").getAsString());
                    try { addHeadUrl(row, UUID.fromString(cached.get("uuid").getAsString())); } catch (IllegalArgumentException ignored) { }
                    players.add(row);
                }
            }
        } catch (Exception ignored) {
            // A missing cache is normal on a new server.
        }
        return players;
    }

    private void addHeadUrl(JsonObject row, UUID uuid) {
        if (headsPath == null || uuid == null) return;
        if (Files.isRegularFile(headsPath.resolve(uuid + ".png"))) {
            row.addProperty("headUrl", "/player-heads/" + uuid + ".png");
        }
    }

    private JsonObject playerDetail(ServerPlayer player) {
        JsonObject detail = new JsonObject();
        detail.addProperty("health", player.getHealth());
        detail.addProperty("maxHealth", player.getMaxHealth());
        detail.addProperty("absorption", player.getAbsorptionAmount());
        detail.addProperty("food", player.getFoodData().getFoodLevel());
        detail.addProperty("saturation", player.getFoodData().getSaturationLevel());
        detail.addProperty("level", player.experienceLevel);
        detail.addProperty("experience", player.experienceProgress);
        detail.addProperty("heldSlot", player.getInventory().getSelectedSlot());
        detail.addProperty("gameMode", player.gameMode().getSerializedName());
        detail.addProperty("world", player.level().dimension().identifier().getPath());
        JsonObject location = new JsonObject();
        location.addProperty("x", player.getX());
        location.addProperty("y", player.getY());
        location.addProperty("z", player.getZ());
        detail.add("location", location);
        JsonArray effects = new JsonArray();
        for (MobEffectInstance effect : player.getActiveEffects()) {
            JsonObject value = new JsonObject();
            value.addProperty("type", effect.getDescriptionId().replace("effect.minecraft.", ""));
            value.addProperty("label", prettyName(effect.getDescriptionId().replace("effect.minecraft.", "")));
            value.addProperty("amplifier", effect.getAmplifier());
            value.addProperty("durationTicks", effect.getDuration());
            value.addProperty("infinite", effect.isInfiniteDuration());
            effects.add(value);
        }
        detail.add("effects", effects);
        JsonObject inventory = new JsonObject();
        JsonArray storage = new JsonArray();
        Inventory playerInventory = player.getInventory();
        for (int slot = 0; slot < 36; slot++) {
            ItemStack item = playerInventory.getItem(slot);
            if (!item.isEmpty()) storage.add(itemJson(item, "slot", slot));
        }
        inventory.add("inventory", storage);
        JsonArray armor = new JsonArray();
        addEquipment(armor, player, EquipmentSlot.FEET, "boots");
        addEquipment(armor, player, EquipmentSlot.LEGS, "leggings");
        addEquipment(armor, player, EquipmentSlot.CHEST, "chestplate");
        addEquipment(armor, player, EquipmentSlot.HEAD, "helmet");
        inventory.add("armor", armor);
        ItemStack offhand = player.getItemBySlot(EquipmentSlot.OFFHAND);
        inventory.add("offhand", offhand.isEmpty() ? null : itemJson(offhand, null, null));
        detail.add("inventory", storage);
        detail.add("armor", armor);
        detail.add("offhand", offhand.isEmpty() ? null : itemJson(offhand, null, null));
        return detail;
    }

    private void addEquipment(JsonArray target, ServerPlayer player, EquipmentSlot slot, String label) {
        ItemStack item = player.getItemBySlot(slot);
        if (!item.isEmpty()) target.add(itemJson(item, "slot", label));
    }

    private JsonObject itemJson(ItemStack item, String key, Object value) {
        JsonObject json = new JsonObject();
        if (key != null) {
            if (value instanceof Number number) json.addProperty(key, number);
            else json.addProperty(key, String.valueOf(value));
        }
        String type = itemId(item);
        json.addProperty("type", type);
        json.addProperty("label", item.getHoverName().getString());
        json.addProperty("customName", item.has(DataComponents.CUSTOM_NAME));
        json.addProperty("amount", item.getCount());
        json.addProperty("enchanted", item.hasFoil());
        if (item.isDamageableItem()) {
            json.addProperty("damage", item.getDamageValue());
            json.addProperty("maxDamage", item.getMaxDamage());
        }
        ItemEnchantments enchantments = item.getEnchantments();
        if (!enchantments.isEmpty()) {
            JsonArray values = new JsonArray();
            for (var entry : enchantments.entrySet()) {
                JsonObject enchantment = new JsonObject();
                enchantment.addProperty("key", entry.getKey().unwrapKey().map(keyValue -> keyValue.identifier().getPath()).orElse(""));
                enchantment.addProperty("level", entry.getIntValue());
                values.add(enchantment);
            }
            json.add("enchantments", values);
        }
        return json;
    }

    private void writeOfflineStatus() {
        if (statusPath == null) return;
        JsonObject status = new JsonObject();
        status.addProperty("generatedAt", Instant.now().toString());
        status.addProperty("source", "fabric-mod");
        status.addProperty("serverOnline", false);
        status.add("version", object("name", server == null ? "Fabric 26.2" : server.getServerVersion()));
        status.addProperty("motd", server == null ? "" : server.getMotd());
        status.add("world", worldStatus(server.overworld(), true));
        status.add("worlds", new JsonArray());
        status.add("items", new JsonArray());
        status.addProperty("onlineCount", 0);
        status.addProperty("maxPlayers", server == null ? 0 : server.getPlayerList().getMaxPlayers());
        status.add("players", new JsonArray());
        atomicWrite(statusPath, GSON.toJson(status) + "\n");
    }

    private void loadConfig() {
        config.clear();
        Path path = serverDirectory.resolve("config").resolve("hanplanet-bridge.properties");
        Properties properties = new Properties();
        try (var reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
            properties.load(reader);
            for (String name : properties.stringPropertyNames()) config.put(name, properties.getProperty(name, "").trim());
        } catch (IOException ignored) {
            config.put("api-url", DEFAULT_LINK_API);
            config.put("shared-secret", DEFAULT_SHARED_SECRET);
        }
    }

    private void loadEscrows() {
        escrows.clear();
        try {
            JsonElement parsed = JsonParser.parseString(Files.readString(escrowPath));
            if (!parsed.isJsonObject()) return;
            for (Map.Entry<String, JsonElement> entry : parsed.getAsJsonObject().entrySet()) {
                JsonObject row = entry.getValue().getAsJsonObject();
                Item item = resolveItem(row.get("item").getAsString());
                if (item == null) continue;
                escrows.put(entry.getKey(), new Escrow(
                    entry.getKey(), row.get("seller").getAsString(), row.get("item").getAsString(),
                    row.get("amount").getAsInt(), row.get("pendingPriceAmount").getAsInt(),
                    row.has("pendingPriceItem") ? row.get("pendingPriceItem").getAsString() : "", 0,
                    restoreStack(item, row)
                ));
            }
        } catch (Exception ignored) {
            // An absent or partially written escrow file should not block boot.
        }
    }

    private void saveEscrows() {
        if (escrowPath == null) return;
        JsonObject output = new JsonObject();
        for (Escrow escrow : escrows.values()) {
            JsonObject row = new JsonObject();
            row.addProperty("seller", escrow.seller);
            row.addProperty("item", escrow.item);
            row.addProperty("amount", escrow.amount);
            row.addProperty("originalAmount", escrow.stack.getCount());
            row.addProperty("pendingPriceAmount", escrow.pendingPriceAmount);
            row.addProperty("pendingPriceItem", escrow.pendingPriceItem);
            Integer damage = escrow.stack.get(DataComponents.DAMAGE);
            if (damage != null) {
                row.addProperty("damage", damage);
            }
            ItemEnchantments enchantments = escrow.stack.getEnchantments();
            if (!enchantments.isEmpty()) {
                JsonObject values = new JsonObject();
                for (var entry : enchantments.entrySet()) {
                    entry.getKey().unwrapKey().ifPresent(key -> values.addProperty(key.identifier().toString(), entry.getIntValue()));
                }
                row.add("enchantments", values);
            }
            output.add(escrow.id, row);
        }
        atomicWrite(escrowPath, GSON.toJson(output) + "\n");
    }

    private ItemStack restoreStack(Item item, JsonObject row) {
        int amount = Math.max(1, row.has("originalAmount") ? row.get("originalAmount").getAsInt() : row.get("amount").getAsInt());
        ItemStack stack = new ItemStack(item, amount);
        if (row.has("damage")) {
            stack.set(DataComponents.DAMAGE, Math.max(0, row.get("damage").getAsInt()));
        }
        if (row.has("enchantments") && row.get("enchantments").isJsonObject()) {
            ItemEnchantments.Mutable values = new ItemEnchantments.Mutable(ItemEnchantments.EMPTY);
            for (Map.Entry<String, JsonElement> entry : row.getAsJsonObject("enchantments").entrySet()) {
                Identifier id = Identifier.parse(entry.getKey());
                server.registryAccess().lookup(Registries.ENCHANTMENT)
                    .flatMap(registry -> registry.get(id))
                    .ifPresent(holder -> values.set(holder, entry.getValue().getAsInt()));
            }
            stack.set(DataComponents.ENCHANTMENTS, values.toImmutable());
        }
        return stack;
    }

    private void loadNotices() {
        pendingNotices.clear();
        if (noticePath == null || !Files.isRegularFile(noticePath)) return;
        try {
            JsonElement parsed = JsonParser.parseString(Files.readString(noticePath));
            if (!parsed.isJsonObject()) return;
            for (Map.Entry<String, JsonElement> entry : parsed.getAsJsonObject().entrySet()) {
                if (!entry.getValue().isJsonArray()) continue;
                List<String> messages = new ArrayList<>();
                for (JsonElement value : entry.getValue().getAsJsonArray()) messages.add(value.getAsString());
                if (!messages.isEmpty()) pendingNotices.put(entry.getKey(), messages);
            }
        } catch (Exception ignored) {
            // A missing or partially written notice file should not block boot.
        }
    }

    private void saveNotices() {
        if (noticePath == null) return;
        JsonObject output = new JsonObject();
        for (Map.Entry<String, List<String>> entry : pendingNotices.entrySet()) {
            JsonArray messages = new JsonArray();
            entry.getValue().forEach(messages::add);
            output.add(entry.getKey(), messages);
        }
        atomicWrite(noticePath, GSON.toJson(output) + "\n");
    }

    private void deliverQueuedNotices() {
        boolean noticesChanged = false;
        for (ServerPlayer player : server.getPlayerList().getPlayers()) {
            List<String> messages = new ArrayList<>();
            for (String key : noticeKeysForPlayer(player.getName().getString())) {
                List<String> queued = pendingNotices.remove(key);
                if (queued != null) {
                    noticesChanged = true;
                    messages.addAll(queued);
                }
            }
            messages.forEach(message -> {
                playTradeNotificationSound(player);
                player.sendSystemMessage(formatTradeNotice(message));
            });
        }
        if (noticesChanged) saveNotices();
    }

    private void queueNotice(String playerName, String message) {
        if (playerName == null || playerName.isBlank()) return;
        ServerPlayer player = onlineNoticePlayer(playerName);
        if (player != null) {
            notifyTrade(player, message);
            return;
        }
        String key = playerName.toLowerCase(Locale.ROOT);
        pendingNotices.computeIfAbsent(key, ignored -> new ArrayList<>()).add(message);
        saveNotices();
    }

    private List<String> noticeKeysForPlayer(String playerName) {
        String normalized = playerName == null ? "" : playerName.trim();
        List<String> keys = new ArrayList<>();
        if (normalized.isBlank()) return keys;
        keys.add(normalized.toLowerCase(Locale.ROOT));
        return keys;
    }

    private ServerPlayer onlineNoticePlayer(String playerName) {
        for (String key : noticeKeysForPlayer(playerName)) {
            ServerPlayer player = onlinePlayer(key);
            if (player != null) return player;
        }
        return null;
    }

    private void notifyTrade(ServerPlayer player, String message) {
        if (player != null) {
            playTradeNotificationSound(player);
            player.sendSystemMessage(formatTradeNotice(message));
        }
    }

    private void playTradeNotificationSound(ServerPlayer player) {
        player.playSound(SoundEvents.EXPERIENCE_ORB_PICKUP, 0.7f, 1.15f);
    }

    private Component formatTradeNotice(String message) {
        String normalized = message == null ? "" : message.trim();
        if (normalized.isEmpty()) return Component.empty();

        int categoryEnd = normalized.indexOf(']');
        if (normalized.startsWith("[") && categoryEnd > 1) {
            MutableComponent category = Component.literal(normalized.substring(0, categoryEnd + 1))
                .withStyle(ChatFormatting.GOLD);
            Component body = Component.literal(normalized.substring(categoryEnd + 1))
                .withStyle(ChatFormatting.WHITE);
            return category.append(body);
        }
        return Component.literal(normalized).withStyle(ChatFormatting.WHITE);
    }

    private String noticeTag(String language, String korean, String english) {
        return "en".equalsIgnoreCase(String.valueOf(language).trim()) ? english : korean;
    }

    private String decodeNoticeLabel(String encoded, String fallback) {
        if (encoded == null || encoded.isBlank()) return fallback;
        try {
            String decoded = new String(Base64.getUrlDecoder().decode(encoded), StandardCharsets.UTF_8).trim();
            return decoded.isEmpty() ? fallback : decoded;
        } catch (IllegalArgumentException error) {
            return fallback;
        }
    }

    private String noticeItem(String label, int amount) {
        return label + "x" + amount;
    }

    private ServerPlayer onlinePlayer(String name) {
        return server == null ? null : server.getPlayerList().getPlayer(name);
    }

    private ServerLevel findLevel(String name) {
        String normalized = name.toLowerCase(Locale.ROOT);
        for (ServerLevel level : server.getAllLevels()) {
            String id = level.dimension().identifier().toString().toLowerCase(Locale.ROOT);
            if (id.equals(normalized) || level.dimension().identifier().getPath().equalsIgnoreCase(name)) return level;
        }
        return null;
    }

    private Item resolveItem(String value) {
        String normalized = value.toLowerCase(Locale.ROOT);
        if (normalized.startsWith("minecraft:")) normalized = normalized.substring("minecraft:".length());
        if (!normalized.matches("[a-z0-9_]+")) return null;
        return BuiltInRegistries.ITEM.get(Identifier.withDefaultNamespace(normalized)).map(Holder.Reference::value).orElse(null);
    }

    private int parseSlot(String value) {
        try { return Integer.parseInt(value); } catch (NumberFormatException error) { return -1; }
    }

    private int parseAmount(String value) {
        try {
            int amount = Integer.parseInt(value);
            return amount >= 1 && amount <= MAX_TRADE_AMOUNT ? amount : -1;
        } catch (NumberFormatException error) { return -1; }
    }

    private int countItem(ServerPlayer player, Item item) {
        int total = 0;
        for (int slot = 0; slot < 36; slot++) {
            ItemStack stack = player.getInventory().getItem(slot);
            if (!stack.isEmpty() && stack.is(item)) total += stack.getCount();
        }
        return total;
    }

    private void removeItems(ServerPlayer player, Item item, int amount) {
        int remaining = amount;
        for (int slot = 0; slot < 36 && remaining > 0; slot++) {
            ItemStack stack = player.getInventory().getItem(slot);
            if (stack.isEmpty() || !stack.is(item)) continue;
            int removed = Math.min(remaining, stack.getCount());
            stack.shrink(removed);
            remaining -= removed;
        }
        player.getInventory().setChanged();
    }

    private boolean canFit(ServerPlayer player, ItemStack item) {
        int remaining = item.getCount();
        Item prototype = item.getItem();
        for (int slot = 0; slot < 36 && remaining > 0; slot++) {
            ItemStack existing = player.getInventory().getItem(slot);
            if (existing.isEmpty()) {
                remaining -= prototype.getDefaultMaxStackSize();
            } else if (existing.is(prototype) && existing.getCount() < existing.getMaxStackSize()) {
                remaining -= existing.getMaxStackSize() - existing.getCount();
            }
        }
        return remaining <= 0;
    }

    private void give(ServerPlayer player, ItemStack item) {
        player.getInventory().add(item.copy());
        player.getInventory().setChanged();
    }

    private String itemId(ItemStack stack) { return itemId(stack.getItem()); }
    private String itemId(Item item) { return itemKey(item); }
    private String itemKey(Item item) { return BuiltInRegistries.ITEM.getKey(item).getPath(); }

    private static JsonObject object(String key, String value) {
        JsonObject json = new JsonObject();
        json.addProperty(key, value);
        return json;
    }

    private static String[] splitArguments(String value) {
        return value.trim().isEmpty() ? new String[0] : value.trim().split("\\s+");
    }

    private static String formatTime(long ticks) {
        long dayTicks = Math.floorMod(ticks, 24000);
        int totalMinutes = (int) (((dayTicks + 6000) % 24000) * 1440 / 24000);
        return String.format(Locale.ROOT, "%02d:%02d", totalMinutes / 60, totalMinutes % 60);
    }

    private static String prettyName(String value) {
        String[] words = value.replace('_', ' ').split("\\s+");
        StringBuilder result = new StringBuilder();
        for (String word : words) {
            if (word.isEmpty()) continue;
            if (result.length() > 0) result.append(' ');
            result.append(Character.toUpperCase(word.charAt(0))).append(word.substring(1));
        }
        return result.toString();
    }

    private static double clamp(double value, double min, double max) { return Math.max(min, Math.min(max, value)); }

    private static String hmac(String secret, String value) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] digest = mac.doFinal(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder(digest.length * 2);
            for (byte item : digest) result.append(String.format(Locale.ROOT, "%02x", item));
            return result.toString();
        } catch (Exception error) {
            return "";
        }
    }

    private static void atomicWrite(Path path, String value) {
        try {
            Files.createDirectories(path.getParent());
            Path temporary = Files.createTempFile(path.getParent(), path.getFileName().toString(), ".tmp");
            Files.writeString(temporary, value, StandardCharsets.UTF_8);
            Files.move(temporary, path, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException ignored) {
            // The next scheduled status pass retries the write.
        }
    }

    private static final class Escrow {
        private final String id;
        private final String seller;
        private final String item;
        private int amount;
        private int pendingPriceAmount;
        private String pendingPriceItem;
        private final int unused;
        private final ItemStack stack;

        private Escrow(String id, String seller, String item, int amount, int pendingPriceAmount, String pendingPriceItem, int unused, ItemStack stack) {
            this.id = id;
            this.seller = seller;
            this.item = item;
            this.amount = amount;
            this.pendingPriceAmount = pendingPriceAmount;
            this.pendingPriceItem = pendingPriceItem;
            this.unused = unused;
            this.stack = stack;
        }
    }
}
