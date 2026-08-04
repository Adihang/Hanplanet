package dev.minecraftstatus.bridge;

import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.OfflinePlayer;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.weather.ThunderChangeEvent;
import org.bukkit.event.weather.WeatherChangeEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.PlayerInventory;
import org.bukkit.inventory.meta.Damageable;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;
import org.bukkit.profile.PlayerProfile;
import org.bukkit.profile.PlayerTextures;

import javax.imageio.ImageIO;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collection;
import java.util.Comparator;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public final class MinecraftStatusBridgePlugin extends JavaPlugin implements Listener {
    private static final String ADMIN_PERMISSION = "minecraftstatus.admin";
    private static final int TRADE_MAX_AMOUNT = 2304;
    private static final String TRADE_MESSAGE_PREFIX = "\u00a76";
    private static final int PLAYER_HEAD_SIZE = 32;
    private static final int SKIN_CONNECT_TIMEOUT_MILLIS = 3500;
    private static final int SKIN_READ_TIMEOUT_MILLIS = 5000;
    private Path statusPath;
    private Path playerHeadsPath;
    private File tradeEscrowFile;
    private YamlConfiguration tradeEscrow;
    private Map<String, String> koreanTradeItemLabels = Collections.emptyMap();
    private long lastNonEmptyAtMillis;
    private final Set<UUID> pendingHeadBuilds = ConcurrentHashMap.newKeySet();

    @Override
    public void onEnable() {
        statusPath = getServer().getWorldContainer().toPath().resolve("web").resolve("status.json");
        playerHeadsPath = statusPath.getParent().resolve("player-heads");
        tradeEscrowFile = new File(getDataFolder(), "trade-escrow.yml");
        tradeEscrow = YamlConfiguration.loadConfiguration(tradeEscrowFile);
        koreanTradeItemLabels = loadKoreanTradeItemLabels();
        lastNonEmptyAtMillis = System.currentTimeMillis();
        getServer().getPluginManager().registerEvents(this, this);
        getServer().getScheduler().runTaskTimer(this, this::writeStatus, 20L, 100L);
        writeStatus();
    }

    @Override
    public void onDisable() {
        saveTradeEscrow();
        writeOfflineStatus();
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!command.getName().equalsIgnoreCase("minecraftstatus")) {
            return false;
        }
        if (!sender.hasPermission(ADMIN_PERMISSION)) {
            sender.sendMessage("You do not have permission to modify Minecraft server status.");
            return true;
        }
        return handleAdminCommand(sender, args);
    }

    private boolean handleAdminCommand(CommandSender sender, String[] args) {
        if (args.length >= 1 && args[0].equalsIgnoreCase("trade")) {
            return handleTradeCommand(sender, args);
        }
        if (args.length < 4 || !args[0].equalsIgnoreCase("set")) {
            sendAdminUsage(sender);
            return true;
        }

        Player player = Bukkit.getPlayerExact(args[1]);
        if (player == null) {
            sender.sendMessage("Player is not online: " + args[1]);
            return true;
        }

        String field = args[2].toLowerCase(Locale.ROOT);
        String value = args[3];
        switch (field) {
            case "health":
                return setPlayerHealth(sender, player, value);
            case "food":
                return setPlayerFood(sender, player, value);
            case "level":
                return setPlayerLevel(sender, player, value);
            case "exp":
            case "experience":
                return setPlayerExperience(sender, player, value);
            case "gamemode":
                return setPlayerGameMode(sender, player, value);
            case "location":
            case "teleport":
                return setPlayerLocation(sender, player, args);
            case "effects":
                return handlePlayerEffects(sender, player, args);
            case "inventory":
                return handlePlayerInventory(sender, player, args);
            default:
                sendAdminUsage(sender);
                return true;
        }
    }

    private boolean setPlayerHealth(CommandSender sender, Player player, String value) {
        Double health = parseDoubleArg(value);
        if (health == null) {
            sender.sendMessage("Health must be a number.");
            return true;
        }
        double clamped = clamp(health, 0.0D, player.getMaxHealth());
        player.setHealth(clamped);
        writeStatus();
        sender.sendMessage("Set " + player.getName() + " health to " + formatJsonNumber(clamped) + ".");
        return true;
    }

    private boolean handleTradeCommand(CommandSender sender, String[] args) {
        if (args.length < 2) {
            sendTradeUsage(sender);
            return true;
        }

        String action = args[1].toLowerCase(Locale.ROOT);
        switch (action) {
            case "reserve":
                return handleTradeReserve(sender, args);
            case "return":
                return handleTradeReturn(sender, args);
            case "claim":
                return handleTradeClaim(sender, args);
            case "payout":
                return handleTradePayout(sender, args);
            case "settle":
                return handleTradeSettle(sender, args);
            case "exchange":
                return handleTradeExchange(sender, args);
            case "npc-exchange":
                return handleTradeNpcExchange(sender, args);
            case "reserve-escrow":
                return handleTradeEscrowReserve(sender, args);
            case "release-escrow":
                return handleTradeEscrowRelease(sender, args);
            case "exchange-escrow":
                return handleTradeEscrowExchange(sender, args);
            case "settle-escrow":
                return handleTradeEscrowSettle(sender, args);
            default:
                sendTradeUsage(sender);
                return true;
        }
    }

    private boolean handleTradeReserve(CommandSender sender, String[] args) {
        if (args.length < 5) {
            sendTradeUsage(sender);
            return true;
        }
        Player player = resolveOnlineTradePlayer(sender, "reserve", args[2]);
        Material material = resolveTradeMaterial(sender, "reserve", args[3]);
        Integer amount = resolveTradeAmount(sender, "reserve", args[4]);
        if (player == null || material == null || amount == null) {
            return true;
        }

        PlayerInventory inventory = player.getInventory();
        if (countStorageMaterial(inventory, material) < amount) {
            sendTradeError(sender, "reserve", "insufficient_item");
            return true;
        }

        removeStorageMaterial(inventory, material, amount);
        player.updateInventory();
        writeStatus();
        String saleDescription = formatTradeItem(material, amount);
        String priceDescription = optionalTradeItemDescription(args, 5, 6, "ko");
        sendTradeNotice(player, "\uac70\ub798 \ub4f1\ub85d", formatTradeExchange(saleDescription, priceDescription));
        sendTradeNotice(player, "\ubcf4\uad00", saleDescription);
        sendTradeOk(sender, "reserve");
        return true;
    }

    private boolean handleTradeReturn(CommandSender sender, String[] args) {
        if (args.length < 5) {
            sendTradeUsage(sender);
            return true;
        }
        return handleTradeAddToPlayer(sender, "return", args[2], args[3], args[4], args);
    }

    private boolean handleTradeClaim(CommandSender sender, String[] args) {
        if (args.length < 5) {
            sendTradeUsage(sender);
            return true;
        }
        return handleTradeAddToPlayer(sender, "claim", args[2], args[3], args[4], args);
    }

    private boolean handleTradePayout(CommandSender sender, String[] args) {
        if (args.length < 5) {
            sendTradeUsage(sender);
            return true;
        }
        Player player = resolveOnlineTradePlayer(sender, "payout", args[2]);
        Material material = resolveTradeMaterial(sender, "payout", args[3]);
        Integer amount = resolveTradeAmount(sender, "payout", args[4]);
        String uiLang = optionalTradeUiLang(args, 5);
        if (player == null || material == null || amount == null) {
            return true;
        }
        if (!canFitStorageMaterial(player.getInventory(), material, amount)) {
            sendTradeError(sender, "payout", "inventory_full");
            return true;
        }

        addStorageMaterial(player.getInventory(), material, amount);
        player.updateInventory();
        writeStatus();
        sendTradeReceivedItems(player, uiLang, formatTradeItem(material, amount, uiLang));
        sendTradeOk(sender, "payout");
        return true;
    }

    private boolean handleTradeSettle(CommandSender sender, String[] args) {
        if (args.length < 7) {
            sendTradeUsage(sender);
            return true;
        }
        Player player = resolveOnlineTradePlayer(sender, "settle", args[2]);
        Material priceMaterial = resolveTradeMaterial(sender, "settle", args[3]);
        Integer priceAmount = resolveTradeAmountAllowZero(sender, "settle", args[4]);
        Material saleMaterial = resolveTradeMaterial(sender, "settle", args[5]);
        Integer saleAmount = resolveTradeAmountAllowZero(sender, "settle", args[6]);
        String uiLang = optionalTradeUiLang(args, 7);
        if (player == null || priceMaterial == null || priceAmount == null || saleMaterial == null || saleAmount == null) {
            return true;
        }
        if (priceAmount == 0 && saleAmount == 0) {
            sendTradeError(sender, "settle", "invalid_amount");
            return true;
        }
        if (!canFitStorageMaterials(player.getInventory(), priceMaterial, priceAmount, saleMaterial, saleAmount)) {
            sendTradeError(sender, "settle", "inventory_full");
            return true;
        }

        if (priceAmount > 0) {
            addStorageMaterial(player.getInventory(), priceMaterial, priceAmount);
        }
        if (saleAmount > 0) {
            addStorageMaterial(player.getInventory(), saleMaterial, saleAmount);
        }
        player.updateInventory();
        writeStatus();
        String priceDescription = priceAmount > 0 ? formatTradeItem(priceMaterial, priceAmount, uiLang) : "";
        String saleDescription = saleAmount > 0 ? formatTradeItem(saleMaterial, saleAmount, uiLang) : "";
        sendTradeReceivedItems(player, uiLang, saleDescription, priceDescription);
        sendTradeOk(sender, "settle");
        return true;
    }

    private boolean handleTradeAddToPlayer(
        CommandSender sender,
        String action,
        String playerName,
        String itemValue,
        String amountValue,
        String[] args
    ) {
        Player player = resolveOnlineTradePlayer(sender, action, playerName);
        Material material = resolveTradeMaterial(sender, action, itemValue);
        Integer amount = resolveTradeAmount(sender, action, amountValue);
        if (player == null || material == null || amount == null) {
            return true;
        }
        if (!canFitStorageMaterial(player.getInventory(), material, amount)) {
            sendTradeError(sender, action, "inventory_full");
            return true;
        }

        addStorageMaterial(player.getInventory(), material, amount);
        player.updateInventory();
        writeStatus();
        String itemDescription = formatTradeItem(material, amount);
        if (action.equals("return")) {
            sendTradeReceivedItems(player, "ko", itemDescription);
        } else if (action.equals("claim")) {
            sendTradeReceivedItems(player, "ko", itemDescription);
        }
        sendTradeOk(sender, action);
        return true;
    }

    private boolean handleTradeExchange(CommandSender sender, String[] args) {
        if (args.length < 7) {
            sendTradeUsage(sender);
            return true;
        }

        Player buyer = resolveOnlineTradePlayer(sender, "exchange", args[2]);
        Material priceMaterial = resolveTradeMaterial(sender, "exchange", args[3]);
        Integer priceAmount = resolveTradeAmount(sender, "exchange", args[4]);
        Material saleMaterial = resolveTradeMaterial(sender, "exchange", args[5]);
        Integer saleAmount = resolveTradeAmount(sender, "exchange", args[6]);
        if (buyer == null || priceMaterial == null || priceAmount == null || saleMaterial == null || saleAmount == null) {
            return true;
        }

        PlayerInventory inventory = buyer.getInventory();
        if (countStorageMaterial(inventory, priceMaterial) < priceAmount) {
            sendTradeError(sender, "exchange", "insufficient_item");
            return true;
        }
        if (!canFitStorageMaterial(inventory, saleMaterial, saleAmount)) {
            sendTradeError(sender, "exchange", "inventory_full");
            return true;
        }

        removeStorageMaterial(inventory, priceMaterial, priceAmount);
        addStorageMaterial(inventory, saleMaterial, saleAmount);
        buyer.updateInventory();
        writeStatus();
        String sellerName = optionalTradePartnerName(args, 7);
        String buyerUiLang = optionalTradeUiLang(args, 8);
        String sellerUiLang = optionalTradeUiLang(args, 9);
        String sellerSaleDescription = formatTradeItem(saleMaterial, saleAmount, sellerUiLang);
        String sellerPriceDescription = formatTradeItem(priceMaterial, priceAmount, sellerUiLang);
        String buyerSaleDescription = formatTradeItem(saleMaterial, saleAmount, buyerUiLang);
        String buyerPriceDescription = formatTradeItem(priceMaterial, priceAmount, buyerUiLang);
        Player seller = findOnlineTradePlayer(sellerName);
        if (seller != null) {
            sendTradeNotice(seller, tradeNoticeCategory("completed", sellerUiLang), formatTradeExchange(sellerSaleDescription, sellerPriceDescription));
            sendTradeNotice(seller, tradeNoticeCategory("stored", sellerUiLang), sellerPriceDescription);
        } else {
            queueTradeNotice(sellerName, tradeNoticeCategory("completed", sellerUiLang), formatTradeExchange(sellerSaleDescription, sellerPriceDescription));
            queueTradeNotice(sellerName, tradeNoticeCategory("stored", sellerUiLang), sellerPriceDescription);
        }
        sendTradeNotice(buyer, tradeNoticeCategory("completed", buyerUiLang), formatTradeExchange(buyerPriceDescription, buyerSaleDescription));
        sendTradeReceivedItems(buyer, buyerUiLang, buyerSaleDescription);
        sendTradeOk(sender, "exchange");
        return true;
    }

    private boolean handleTradeNpcExchange(CommandSender sender, String[] args) {
        if (args.length < 7) {
            sendTradeUsage(sender);
            return true;
        }

        Player buyer = resolveOnlineTradePlayer(sender, "npc-exchange", args[2]);
        Material priceMaterial = resolveTradeMaterial(sender, "npc-exchange", args[3]);
        Integer priceAmount = resolveTradeAmount(sender, "npc-exchange", args[4]);
        Material saleMaterial = resolveTradeMaterial(sender, "npc-exchange", args[5]);
        Integer saleAmount = resolveTradeAmount(sender, "npc-exchange", args[6]);
        if (buyer == null || priceMaterial == null || priceAmount == null || saleMaterial == null || saleAmount == null) {
            return true;
        }

        PlayerInventory inventory = buyer.getInventory();
        if (countStorageMaterial(inventory, priceMaterial) < priceAmount) {
            sendTradeError(sender, "npc-exchange", "insufficient_item");
            return true;
        }
        if (!canFitStorageMaterial(inventory, saleMaterial, saleAmount)) {
            sendTradeError(sender, "npc-exchange", "inventory_full");
            return true;
        }

        removeStorageMaterial(inventory, priceMaterial, priceAmount);
        addStorageMaterial(inventory, saleMaterial, saleAmount);
        buyer.updateInventory();
        writeStatus();
        String buyerUiLang = optionalTradeUiLang(args, 7);
        String saleDescription = formatTradeItem(saleMaterial, saleAmount, buyerUiLang);
        String priceDescription = formatTradeItem(priceMaterial, priceAmount, buyerUiLang);
        sendTradeNotice(buyer, tradeNoticeCategory("completed", buyerUiLang), formatTradeExchange(priceDescription, saleDescription));
        sendTradeReceivedItems(buyer, buyerUiLang, saleDescription);
        sendTradeOk(sender, "npc-exchange");
        return true;
    }

    private boolean handleTradeEscrowReserve(CommandSender sender, String[] args) {
        if (args.length < 6) {
            sendTradeUsage(sender);
            return true;
        }

        String listingId = resolveTradeListingId(sender, "reserve-escrow", args[2]);
        Player player = resolveOnlineTradePlayer(sender, "reserve-escrow", args[3]);
        String slot = resolveTradeInventorySlot(sender, "reserve-escrow", args[4]);
        Integer amount = resolveTradeAmount(sender, "reserve-escrow", args[5]);
        if (listingId == null || player == null || slot == null || amount == null) {
            return true;
        }

        PlayerInventory inventory = player.getInventory();
        ItemStack sourceItem = getTradeInventoryItem(inventory, slot);
        if (isEmptyItem(sourceItem) || sourceItem.getAmount() < amount) {
            sendTradeError(sender, "reserve-escrow", "insufficient_item");
            return true;
        }

        ItemStack escrowItem = sourceItem.clone();
        escrowItem.setAmount(amount);
        if (!storeTradeEscrowItem(listingId, escrowItem)) {
            sendTradeError(sender, "reserve-escrow", "escrow_unavailable");
            return true;
        }

        int remaining = sourceItem.getAmount() - amount;
        ItemStack nextItem = remaining > 0 ? sourceItem.clone() : null;
        if (nextItem != null) {
            nextItem.setAmount(remaining);
        }
        setTradeInventoryItem(inventory, slot, nextItem);
        player.updateInventory();
        writeStatus();

        String uiLang = optionalTradeUiLang(args, 8);
        String saleDescription = formatTradeItem(escrowItem.getType(), amount, uiLang);
        String priceDescription = optionalTradeItemDescription(args, 6, 7, uiLang);
        sendTradeNotice(player, tradeNoticeCategory("registered", uiLang), formatTradeExchange(saleDescription, priceDescription));
        sendTradeNotice(player, tradeNoticeCategory("stored", uiLang), saleDescription);
        sendTradeItem(sender, "reserve-escrow", listingId, escrowItem);
        sendTradeOk(sender, "reserve-escrow");
        return true;
    }

    private boolean handleTradeEscrowRelease(CommandSender sender, String[] args) {
        if (args.length < 4) {
            sendTradeUsage(sender);
            return true;
        }

        String listingId = resolveTradeListingId(sender, "release-escrow", args[2]);
        Player player = resolveOnlineTradePlayer(sender, "release-escrow", args[3]);
        if (listingId == null || player == null) {
            return true;
        }

        ItemStack escrowItem = getTradeEscrowItem(listingId);
        if (isEmptyItem(escrowItem)) {
            sendTradeError(sender, "release-escrow", "escrow_missing");
            return true;
        }
        if (!canFitStorageItem(player.getInventory(), escrowItem)) {
            sendTradeError(sender, "release-escrow", "inventory_full");
            return true;
        }
        if (!removeTradeEscrowItem(listingId)) {
            sendTradeError(sender, "release-escrow", "escrow_unavailable");
            return true;
        }

        addStorageItem(player.getInventory(), escrowItem);
        player.updateInventory();
        writeStatus();
        sendTradeReceivedItems(player, "ko", formatTradeItem(escrowItem.getType(), escrowItem.getAmount()));
        sendTradeOk(sender, "release-escrow");
        return true;
    }

    private boolean handleTradeEscrowExchange(CommandSender sender, String[] args) {
        if (args.length < 7) {
            sendTradeUsage(sender);
            return true;
        }

        String listingId = resolveTradeListingId(sender, "exchange-escrow", args[2]);
        Player buyer = resolveOnlineTradePlayer(sender, "exchange-escrow", args[3]);
        Material priceMaterial = resolveTradeMaterial(sender, "exchange-escrow", args[4]);
        Integer priceAmount = resolveTradeAmount(sender, "exchange-escrow", args[5]);
        Integer saleAmount = resolveTradeAmount(sender, "exchange-escrow", args[6]);
        if (listingId == null || buyer == null || priceMaterial == null || priceAmount == null || saleAmount == null) {
            return true;
        }

        ItemStack escrowItem = getTradeEscrowItem(listingId);
        if (isEmptyItem(escrowItem)) {
            sendTradeError(sender, "exchange-escrow", "escrow_missing");
            return true;
        }
        if (saleAmount > escrowItem.getAmount()) {
            sendTradeError(sender, "exchange-escrow", "invalid_amount");
            return true;
        }

        ItemStack saleItem = escrowItem.clone();
        saleItem.setAmount(saleAmount);
        PlayerInventory inventory = buyer.getInventory();
        if (countStorageMaterial(inventory, priceMaterial) < priceAmount) {
            sendTradeError(sender, "exchange-escrow", "insufficient_item");
            return true;
        }
        if (!canCompleteEscrowExchange(inventory, priceMaterial, priceAmount, saleItem)) {
            sendTradeError(sender, "exchange-escrow", "inventory_full");
            return true;
        }
        if (!consumeTradeEscrowItem(listingId, saleAmount)) {
            sendTradeError(sender, "exchange-escrow", "escrow_unavailable");
            return true;
        }

        removeStorageMaterial(inventory, priceMaterial, priceAmount);
        addStorageItem(inventory, saleItem);
        buyer.updateInventory();
        writeStatus();
        String sellerName = optionalTradePartnerName(args, 7);
        String buyerUiLang = optionalTradeUiLang(args, 8);
        String sellerUiLang = optionalTradeUiLang(args, 9);
        String sellerSaleDescription = formatTradeItem(saleItem.getType(), saleAmount, sellerUiLang);
        String sellerPriceDescription = formatTradeItem(priceMaterial, priceAmount, sellerUiLang);
        String buyerSaleDescription = formatTradeItem(saleItem.getType(), saleAmount, buyerUiLang);
        String buyerPriceDescription = formatTradeItem(priceMaterial, priceAmount, buyerUiLang);
        Player seller = findOnlineTradePlayer(sellerName);
        if (seller != null) {
            sendTradeNotice(seller, tradeNoticeCategory("completed", sellerUiLang), formatTradeExchange(sellerSaleDescription, sellerPriceDescription));
            sendTradeNotice(seller, tradeNoticeCategory("stored", sellerUiLang), sellerPriceDescription);
        } else {
            queueTradeNotice(sellerName, tradeNoticeCategory("completed", sellerUiLang), formatTradeExchange(sellerSaleDescription, sellerPriceDescription));
            queueTradeNotice(sellerName, tradeNoticeCategory("stored", sellerUiLang), sellerPriceDescription);
        }
        sendTradeNotice(buyer, tradeNoticeCategory("completed", buyerUiLang), formatTradeExchange(buyerPriceDescription, buyerSaleDescription));
        sendTradeReceivedItems(buyer, buyerUiLang, buyerSaleDescription);
        sendTradeOk(sender, "exchange-escrow");
        return true;
    }

    private boolean handleTradeEscrowSettle(CommandSender sender, String[] args) {
        if (args.length < 6) {
            sendTradeUsage(sender);
            return true;
        }

        String listingId = resolveTradeListingId(sender, "settle-escrow", args[2]);
        Player player = resolveOnlineTradePlayer(sender, "settle-escrow", args[3]);
        Material priceMaterial = resolveTradeMaterial(sender, "settle-escrow", args[4]);
        Integer priceAmount = resolveTradeAmountAllowZero(sender, "settle-escrow", args[5]);
        String uiLang = optionalTradeUiLang(args, 6);
        if (listingId == null || player == null || priceMaterial == null || priceAmount == null) {
            return true;
        }

        ItemStack escrowItem = getTradeEscrowItem(listingId);
        if (isEmptyItem(escrowItem)) {
            sendTradeError(sender, "settle-escrow", "escrow_missing");
            return true;
        }
        boolean canFitSettlementItems = priceAmount > 0
            ? canFitStorageItems(player.getInventory(), new ItemStack(priceMaterial, priceAmount), escrowItem)
            : canFitStorageItem(player.getInventory(), escrowItem);
        if (!canFitSettlementItems) {
            sendTradeError(sender, "settle-escrow", "inventory_full");
            return true;
        }
        if (!removeTradeEscrowItem(listingId)) {
            sendTradeError(sender, "settle-escrow", "escrow_unavailable");
            return true;
        }

        if (priceAmount > 0) {
            addStorageMaterial(player.getInventory(), priceMaterial, priceAmount);
        }
        addStorageItem(player.getInventory(), escrowItem);
        player.updateInventory();
        writeStatus();
        String priceDescription = priceAmount > 0 ? formatTradeItem(priceMaterial, priceAmount, uiLang) : "";
        String saleDescription = formatTradeItem(escrowItem.getType(), escrowItem.getAmount(), uiLang);
        sendTradeReceivedItems(player, uiLang, saleDescription, priceDescription);
        sendTradeOk(sender, "settle-escrow");
        return true;
    }

    private String resolveTradeListingId(CommandSender sender, String action, String value) {
        String listingId = strOrEmpty(value).trim();
        if (!listingId.matches("[1-9][0-9]{0,18}")) {
            sendTradeError(sender, action, "invalid_listing");
            return null;
        }
        return listingId;
    }

    private String resolveTradeInventorySlot(CommandSender sender, String action, String value) {
        Integer storageSlot = parseStorageSlot(value);
        if (storageSlot != null) {
            return String.valueOf(storageSlot);
        }
        String normalized = normalizeInventorySlotLabel(value);
        switch (normalized) {
            case "helmet":
            case "chestplate":
            case "leggings":
            case "boots":
            case "offhand":
                return normalized;
            default:
                sendTradeError(sender, action, "invalid_slot");
                return null;
        }
    }

    private ItemStack getTradeInventoryItem(PlayerInventory inventory, String slot) {
        Integer storageSlot = parseStorageSlot(slot);
        if (storageSlot != null) {
            return inventory.getItem(storageSlot);
        }
        switch (normalizeInventorySlotLabel(slot)) {
            case "helmet":
                return inventory.getHelmet();
            case "chestplate":
                return inventory.getChestplate();
            case "leggings":
                return inventory.getLeggings();
            case "boots":
                return inventory.getBoots();
            case "offhand":
                return inventory.getItemInOffHand();
            default:
                return null;
        }
    }

    private void setTradeInventoryItem(PlayerInventory inventory, String slot, ItemStack item) {
        setInventorySlot(inventory, slot, item);
    }

    private String tradeEscrowPath(String listingId) {
        return "trades." + listingId + ".item";
    }

    private String tradeNoticePath(String playerName) {
        String normalizedName = strOrEmpty(playerName).trim().toLowerCase(Locale.ROOT);
        String encodedName = Base64.getUrlEncoder().withoutPadding().encodeToString(
            normalizedName.getBytes(StandardCharsets.UTF_8)
        );
        return "pending-notices." + encodedName;
    }

    private ItemStack getTradeEscrowItem(String listingId) {
        if (tradeEscrow == null) {
            return null;
        }
        ItemStack item = tradeEscrow.getItemStack(tradeEscrowPath(listingId));
        return isEmptyItem(item) ? null : item.clone();
    }

    private boolean storeTradeEscrowItem(String listingId, ItemStack item) {
        if (tradeEscrow == null || isEmptyItem(item)) {
            return false;
        }
        String path = tradeEscrowPath(listingId);
        ItemStack previous = tradeEscrow.getItemStack(path);
        tradeEscrow.set(path, item.clone());
        if (saveTradeEscrow()) {
            return true;
        }
        tradeEscrow.set(path, previous == null ? null : previous.clone());
        return false;
    }

    private boolean consumeTradeEscrowItem(String listingId, int amount) {
        ItemStack escrowItem = getTradeEscrowItem(listingId);
        if (isEmptyItem(escrowItem) || amount < 1 || amount > escrowItem.getAmount()) {
            return false;
        }
        String path = tradeEscrowPath(listingId);
        ItemStack nextItem = escrowItem.getAmount() == amount ? null : escrowItem.clone();
        if (nextItem != null) {
            nextItem.setAmount(escrowItem.getAmount() - amount);
        }
        tradeEscrow.set(path, nextItem);
        if (saveTradeEscrow()) {
            return true;
        }
        tradeEscrow.set(path, escrowItem);
        return false;
    }

    private boolean removeTradeEscrowItem(String listingId) {
        ItemStack escrowItem = getTradeEscrowItem(listingId);
        if (isEmptyItem(escrowItem)) {
            return false;
        }
        String path = tradeEscrowPath(listingId);
        tradeEscrow.set(path, null);
        if (saveTradeEscrow()) {
            return true;
        }
        tradeEscrow.set(path, escrowItem);
        return false;
    }

    private boolean saveTradeEscrow() {
        if (tradeEscrowFile == null || tradeEscrow == null) {
            return false;
        }
        try {
            File parent = tradeEscrowFile.getParentFile();
            if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
                throw new IOException("Failed to create trade escrow directory.");
            }
            tradeEscrow.save(tradeEscrowFile);
            return true;
        } catch (IOException error) {
            getLogger().warning("Failed to save trade escrow: " + error.getMessage());
            return false;
        }
    }

    private void queueTradeNotice(String playerName, String category, String message) {
        String normalizedName = strOrEmpty(playerName).trim();
        String notice = formatTradeNotice(category, message);
        if (!normalizedName.matches("[A-Za-z0-9_.-]{1,32}") || notice.isEmpty() || tradeEscrow == null) {
            return;
        }
        String path = tradeNoticePath(normalizedName);
        List<String> notices = new ArrayList<>(tradeEscrow.getStringList(path));
        notices.add(notice);
        tradeEscrow.set(path, notices);
        if (!saveTradeEscrow()) {
            notices.remove(notices.size() - 1);
            tradeEscrow.set(path, notices.isEmpty() ? null : notices);
            getLogger().warning("Failed to queue offline trade notice for " + normalizedName + ".");
        }
    }

    private void deliverQueuedTradeNotices(Player player) {
        if (player == null || !player.isOnline() || tradeEscrow == null) {
            return;
        }
        String path = tradeNoticePath(player.getName());
        List<String> notices = new ArrayList<>(tradeEscrow.getStringList(path));
        if (notices.isEmpty()) {
            return;
        }
        tradeEscrow.set(path, null);
        if (!saveTradeEscrow()) {
            tradeEscrow.set(path, notices);
            getLogger().warning("Failed to deliver queued trade notices for " + player.getName() + ".");
            return;
        }
        for (String notice : notices) {
            if (!strOrEmpty(notice).isEmpty()) {
                player.playSound(player.getLocation(), Sound.ENTITY_EXPERIENCE_ORB_PICKUP, 0.7f, 1.15f);
                player.sendMessage(notice);
            }
        }
    }

    private void sendTradeItem(CommandSender sender, String action, String listingId, ItemStack item) {
        StringBuilder itemJson = new StringBuilder(256);
        appendItemFieldsJson(itemJson, item, "");
        String encodedItem = Base64.getUrlEncoder().withoutPadding().encodeToString(
            itemJson.toString().getBytes(StandardCharsets.UTF_8)
        );
        sender.sendMessage("HANPLANET_TRADE_ITEM " + action + " " + listingId + " " + encodedItem);
    }

    private Player resolveOnlineTradePlayer(CommandSender sender, String action, String playerName) {
        Player player = Bukkit.getPlayerExact(playerName);
        if (player == null) {
            sendTradeError(sender, action, "player_offline");
        }
        return player;
    }

    private Material resolveTradeMaterial(CommandSender sender, String action, String itemValue) {
        Material material = resolveMaterial(itemValue);
        if (material == null || material.isAir() || !material.isItem()) {
            sendTradeError(sender, action, "invalid_item");
            return null;
        }
        return material;
    }

    private Integer resolveTradeAmount(CommandSender sender, String action, String amountValue) {
        Integer amount = parseIntArg(amountValue);
        if (amount == null || amount < 1 || amount > TRADE_MAX_AMOUNT) {
            sendTradeError(sender, action, "invalid_amount");
            return null;
        }
        return amount;
    }

    private Integer resolveTradeAmountAllowZero(CommandSender sender, String action, String amountValue) {
        Integer amount = parseIntArg(amountValue);
        if (amount == null || amount < 0 || amount > TRADE_MAX_AMOUNT) {
            sendTradeError(sender, action, "invalid_amount");
            return null;
        }
        return amount;
    }

    private int countStorageMaterial(PlayerInventory inventory, Material material) {
        int count = 0;
        for (ItemStack item : inventory.getStorageContents()) {
            if (!isEmptyItem(item) && item.getType() == material) {
                count += item.getAmount();
            }
        }
        return count;
    }

    private boolean canFitStorageMaterial(PlayerInventory inventory, Material material, int amount) {
        return canFitStorageItem(inventory, new ItemStack(material, amount));
    }

    private boolean canFitStorageMaterials(
        PlayerInventory inventory,
        Material firstMaterial,
        int firstAmount,
        Material secondMaterial,
        int secondAmount
    ) {
        ItemStack[] simulatedContents = inventory.getStorageContents();
        for (int index = 0; index < simulatedContents.length; index += 1) {
            ItemStack item = simulatedContents[index];
            simulatedContents[index] = isEmptyItem(item) ? null : item.clone();
        }
        return canAddStorageMaterial(simulatedContents, firstMaterial, firstAmount)
            && canAddStorageMaterial(simulatedContents, secondMaterial, secondAmount);
    }

    private boolean canFitStorageItem(PlayerInventory inventory, ItemStack item) {
        if (isEmptyItem(item)) {
            return true;
        }
        return canAddStorageItem(copyStorageContents(inventory.getStorageContents()), item);
    }

    private boolean canFitStorageItems(PlayerInventory inventory, ItemStack firstItem, ItemStack secondItem) {
        ItemStack[] simulatedContents = copyStorageContents(inventory.getStorageContents());
        return canAddStorageItem(simulatedContents, firstItem)
            && canAddStorageItem(simulatedContents, secondItem);
    }

    private boolean canCompleteEscrowExchange(
        PlayerInventory inventory,
        Material priceMaterial,
        int priceAmount,
        ItemStack saleItem
    ) {
        ItemStack[] simulatedContents = copyStorageContents(inventory.getStorageContents());
        removeStorageMaterial(simulatedContents, priceMaterial, priceAmount);
        return canAddStorageItem(simulatedContents, saleItem);
    }

    private ItemStack[] copyStorageContents(ItemStack[] contents) {
        ItemStack[] copy = new ItemStack[contents.length];
        for (int index = 0; index < contents.length; index += 1) {
            ItemStack item = contents[index];
            copy[index] = isEmptyItem(item) ? null : item.clone();
        }
        return copy;
    }

    private boolean canAddStorageMaterial(ItemStack[] contents, Material material, int amount) {
        return canAddStorageItem(contents, new ItemStack(material, amount));
    }

    private boolean canAddStorageItem(ItemStack[] contents, ItemStack itemToAdd) {
        if (isEmptyItem(itemToAdd)) {
            return true;
        }
        int remaining = itemToAdd.getAmount();
        int maxStackSize = Math.max(1, itemToAdd.getMaxStackSize());
        for (ItemStack item : contents) {
            if (!isEmptyItem(item) && item.isSimilar(itemToAdd)) {
                int accepted = Math.min(remaining, Math.max(0, item.getMaxStackSize() - item.getAmount()));
                item.setAmount(item.getAmount() + accepted);
                remaining -= accepted;
                if (remaining == 0) {
                    return true;
                }
            }
        }
        for (int index = 0; index < contents.length && remaining > 0; index += 1) {
            if (!isEmptyItem(contents[index])) {
                continue;
            }
            int stackAmount = Math.min(remaining, maxStackSize);
            ItemStack nextItem = itemToAdd.clone();
            nextItem.setAmount(stackAmount);
            contents[index] = nextItem;
            remaining -= stackAmount;
        }
        return remaining == 0;
    }

    private void removeStorageMaterial(PlayerInventory inventory, Material material, int amount) {
        ItemStack[] contents = inventory.getStorageContents();
        removeStorageMaterial(contents, material, amount);
        inventory.setStorageContents(contents);
    }

    private void removeStorageMaterial(ItemStack[] contents, Material material, int amount) {
        int remaining = amount;
        for (int index = 0; index < contents.length && remaining > 0; index += 1) {
            ItemStack item = contents[index];
            if (isEmptyItem(item) || item.getType() != material) {
                continue;
            }
            int nextAmount = item.getAmount() - remaining;
            if (nextAmount > 0) {
                item.setAmount(nextAmount);
                remaining = 0;
            } else {
                contents[index] = null;
                remaining = Math.abs(nextAmount);
            }
        }
    }

    private void addStorageMaterial(PlayerInventory inventory, Material material, int amount) {
        addStorageItem(inventory, new ItemStack(material, amount));
    }

    private void addStorageItem(PlayerInventory inventory, ItemStack item) {
        if (isEmptyItem(item)) {
            return;
        }
        int remaining = item.getAmount();
        int maxStackSize = Math.max(1, item.getMaxStackSize());
        while (remaining > 0) {
            int stackAmount = Math.min(remaining, maxStackSize);
            ItemStack nextItem = item.clone();
            nextItem.setAmount(stackAmount);
            inventory.addItem(nextItem);
            remaining -= stackAmount;
        }
    }

    private void sendTradeUsage(CommandSender sender) {
        sender.sendMessage(
            "Usage: minecraftstatus trade <reserve|return|claim|payout|settle|exchange|npc-exchange|reserve-escrow|release-escrow|exchange-escrow|settle-escrow> ..."
        );
    }

    private String formatTradeItem(Material material, int amount) {
        return formatTradeItem(material, amount, "ko");
    }

    private String formatTradeItem(Material material, int amount, String uiLang) {
        return formatTradeItemLabel(material, uiLang) + " x" + amount;
    }

    private String formatTradeItemLabel(Material material, String uiLang) {
        if (material == null) {
            return "";
        }
        String itemId = material.getKey().getKey();
        if ("ko".equals(optionalTradeUiLang(uiLang))) {
            String koreanLabel = koreanTradeItemLabels.get(itemId);
            if (koreanLabel != null && !koreanLabel.isEmpty()) {
                return koreanLabel;
            }
        }
        return formatMaterialName(itemId);
    }

    private String optionalTradeItemDescription(String[] args, int itemIndex, int amountIndex, String uiLang) {
        if (args.length <= amountIndex) {
            return "";
        }
        Material material = resolveMaterial(args[itemIndex]);
        Integer amount = parseIntArg(args[amountIndex]);
        if (material == null || material.isAir() || !material.isItem() || amount == null || amount < 1 || amount > TRADE_MAX_AMOUNT) {
            return "";
        }
        return formatTradeItem(material, amount, uiLang);
    }

    private String optionalTradeUiLang(String[] args, int index) {
        if (args == null || args.length <= index) {
            return "ko";
        }
        return optionalTradeUiLang(args[index]);
    }

    private String optionalTradeUiLang(String value) {
        return "en".equalsIgnoreCase(strOrEmpty(value).trim()) ? "en" : "ko";
    }

    private String tradeNoticeCategory(String category, String uiLang) {
        boolean english = "en".equals(optionalTradeUiLang(uiLang));
        switch (strOrEmpty(category)) {
            case "registered":
                return english ? "Trade registered" : "거래 등록";
            case "stored":
                return english ? "Stored" : "보관";
            case "completed":
                return english ? "Trade completed" : "거래 완료";
            case "received":
                return english ? "Received" : "수령";
            default:
                return "";
        }
    }

    private Map<String, String> loadKoreanTradeItemLabels() {
        Map<String, String> labels = new HashMap<>();
        try (InputStream input = getResource("trade_item_labels_ko_kr.json")) {
            if (input == null) {
                getLogger().warning("Minecraft trade Korean item labels are unavailable.");
                return Collections.emptyMap();
            }
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    String trimmed = line.trim();
                    if (!trimmed.startsWith("\"") || !trimmed.endsWith("\",") && !trimmed.endsWith("\"")) {
                        continue;
                    }
                    int keyEnd = trimmed.indexOf('"', 1);
                    int valueStart = trimmed.indexOf('"', keyEnd + 1);
                    int valueEnd = trimmed.lastIndexOf('"');
                    if (keyEnd < 1 || valueStart <= keyEnd || valueEnd <= valueStart) {
                        continue;
                    }
                    String itemId = trimmed.substring(1, keyEnd);
                    String label = trimmed.substring(valueStart + 1, valueEnd);
                    if (itemId.matches("[a-z0-9_]{1,64}") && !label.isEmpty()) {
                        labels.put(itemId, label);
                    }
                }
            }
        } catch (IOException error) {
            getLogger().warning("Failed to load Minecraft trade Korean item labels: " + error.getMessage());
            return Collections.emptyMap();
        }
        return Collections.unmodifiableMap(labels);
    }

    private String optionalTradePartnerName(String[] args, int index) {
        if (args.length <= index) {
            return "";
        }
        String playerName = args[index].trim();
        return playerName.matches("[A-Za-z0-9_.-]{1,32}") ? playerName : "";
    }

    private Player findOnlineTradePlayer(String playerName) {
        String normalizedName = strOrEmpty(playerName).trim();
        if (!normalizedName.matches("[A-Za-z0-9_.-]{1,32}")) {
            return null;
        }
        Player exactPlayer = Bukkit.getPlayerExact(normalizedName);
        if (exactPlayer != null && exactPlayer.isOnline()) {
            return exactPlayer;
        }
        for (Player onlinePlayer : Bukkit.getOnlinePlayers()) {
            if (onlinePlayer.getName().equalsIgnoreCase(normalizedName)) {
                return onlinePlayer;
            }
        }
        return null;
    }

    private String formatTradeExchange(String saleDescription, String priceDescription) {
        if (saleDescription.isEmpty()) {
            return priceDescription;
        }
        if (priceDescription.isEmpty()) {
            return saleDescription;
        }
        return saleDescription + " -> " + priceDescription;
    }

    private void sendTradeReceivedItems(Player player, String uiLang, String... itemDescriptions) {
        StringBuilder message = new StringBuilder();
        for (String itemDescription : itemDescriptions) {
            String normalizedDescription = strOrEmpty(itemDescription).trim();
            if (normalizedDescription.isEmpty()) {
                continue;
            }
            if (message.length() > 0) {
                message.append(", ");
            }
            message.append(normalizedDescription);
        }
        if (message.length() > 0) {
            sendTradeNotice(player, tradeNoticeCategory("received", uiLang), message.toString());
        }
    }

    private void sendTradeNotice(Player player, String category, String message) {
        String notice = formatTradeNotice(category, message);
        if (player == null || notice.isEmpty()) {
            return;
        }
        player.playSound(player.getLocation(), Sound.ENTITY_EXPERIENCE_ORB_PICKUP, 0.7f, 1.15f);
        player.sendMessage(notice);
    }

    private String formatTradeNotice(String category, String message) {
        String normalizedCategory = strOrEmpty(category).trim();
        String normalizedMessage = strOrEmpty(message).trim();
        if (normalizedCategory.isEmpty()) {
            return "";
        }
        return TRADE_MESSAGE_PREFIX + "[" + normalizedCategory + "] \u00a7f" + normalizedMessage;
    }

    private void sendTradeOk(CommandSender sender, String action) {
        sender.sendMessage("HANPLANET_TRADE_OK " + action);
    }

    private void sendTradeError(CommandSender sender, String action, String code) {
        sender.sendMessage("HANPLANET_TRADE_ERROR " + action + " " + code);
    }

    private boolean setPlayerFood(CommandSender sender, Player player, String value) {
        Integer food = parseIntArg(value);
        if (food == null) {
            sender.sendMessage("Food must be an integer.");
            return true;
        }
        int clamped = (int) clamp(food, 0, 20);
        player.setFoodLevel(clamped);
        player.setSaturation((float) Math.min(player.getSaturation(), clamped));
        writeStatus();
        sender.sendMessage("Set " + player.getName() + " food to " + clamped + ".");
        return true;
    }

    private boolean setPlayerLevel(CommandSender sender, Player player, String value) {
        Integer level = parseIntArg(value);
        if (level == null) {
            sender.sendMessage("Level must be an integer.");
            return true;
        }
        int clamped = (int) clamp(level, 0, 21863);
        player.setLevel(clamped);
        writeStatus();
        sender.sendMessage("Set " + player.getName() + " level to " + clamped + ".");
        return true;
    }

    private boolean setPlayerExperience(CommandSender sender, Player player, String value) {
        Double experience = parseDoubleArg(value);
        if (experience == null) {
            sender.sendMessage("Experience must be a number from 0 to 1.");
            return true;
        }
        float clamped = (float) clamp(experience, 0.0D, 1.0D);
        player.setExp(clamped);
        writeStatus();
        sender.sendMessage("Set " + player.getName() + " experience progress to " + formatJsonNumber(clamped) + ".");
        return true;
    }

    private boolean setPlayerGameMode(CommandSender sender, Player player, String value) {
        GameMode gameMode;
        try {
            gameMode = GameMode.valueOf(value.toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException error) {
            sender.sendMessage("Game mode must be survival, creative, adventure, or spectator.");
            return true;
        }
        player.setGameMode(gameMode);
        writeStatus();
        sender.sendMessage("Set " + player.getName() + " game mode to " + gameMode.name().toLowerCase(Locale.ROOT) + ".");
        return true;
    }

    private boolean setPlayerLocation(CommandSender sender, Player player, String[] args) {
        if (args.length < 7) {
            sender.sendMessage("Usage: minecraftstatus set <player> location <world> <x> <y> <z>");
            return true;
        }

        World world = resolveWorld(args[3]);
        if (world == null) {
            sender.sendMessage("Unknown world: " + args[3]);
            return true;
        }

        Double x = parseDoubleArg(args[4]);
        Double y = parseDoubleArg(args[5]);
        Double z = parseDoubleArg(args[6]);
        if (x == null || y == null || z == null) {
            sender.sendMessage("Location coordinates must be finite numbers.");
            return true;
        }

        Location location = new Location(world, x, y, z, player.getLocation().getYaw(), player.getLocation().getPitch());
        if (!player.teleport(location)) {
            sender.sendMessage("Failed to teleport " + player.getName() + ".");
            return true;
        }
        writeStatus();
        sender.sendMessage(
            "Teleported " + player.getName() + " to " + world.getName() + " / X " +
            formatJsonNumber(x) + " / Y " + formatJsonNumber(y) + " / Z " + formatJsonNumber(z) + "."
        );
        return true;
    }

    private boolean handlePlayerEffects(CommandSender sender, Player player, String[] args) {
        String action = args[3];
        if (action.equalsIgnoreCase("clear")) {
            return clearPlayerEffects(sender, player);
        }
        if (action.equalsIgnoreCase("add")) {
            if (args.length < 7) {
                sender.sendMessage("Usage: minecraftstatus set <player> effects add <effect> <level> <seconds>");
                return true;
            }
            return addPlayerEffect(sender, player, args[4], args[5], args[6]);
        }
        sender.sendMessage("Effects command supports: add, clear");
        return true;
    }

    private boolean addPlayerEffect(CommandSender sender, Player player, String effectValue, String levelValue, String secondsValue) {
        PotionEffectType effectType = resolveEffectType(effectValue);
        if (effectType == null) {
            sender.sendMessage("Unknown effect: " + effectValue);
            return true;
        }
        Integer level = parseIntArg(levelValue);
        Integer seconds = parseIntArg(secondsValue);
        if (level == null || seconds == null) {
            sender.sendMessage("Effect level and seconds must be integers.");
            return true;
        }
        int clampedLevel = (int) clamp(level, 1, 256);
        int durationTicks = (int) clamp(seconds, 1, 86400) * 20;
        player.addPotionEffect(new PotionEffect(effectType, durationTicks, clampedLevel - 1, false, true, true));
        writeStatus();
        sender.sendMessage(
            "Added " + effectType.getKey().getKey() + " " + clampedLevel + " to " + player.getName() + " for " + (durationTicks / 20) + "s."
        );
        return true;
    }

    private PotionEffectType resolveEffectType(String value) {
        String normalized = strOrEmpty(value).trim().toLowerCase(Locale.ROOT);
        if (normalized.isEmpty()) {
            return null;
        }
        PotionEffectType byName = PotionEffectType.getByName(normalized.toUpperCase(Locale.ROOT));
        if (byName != null) {
            return byName;
        }
        String key = normalized.startsWith("minecraft:") ? normalized.substring("minecraft:".length()) : normalized;
        return PotionEffectType.getByKey(NamespacedKey.minecraft(key));
    }

    private boolean clearPlayerEffects(CommandSender sender, Player player) {
        for (PotionEffect effect : new ArrayList<>(player.getActivePotionEffects())) {
            player.removePotionEffect(effect.getType());
        }
        writeStatus();
        sender.sendMessage("Cleared active effects for " + player.getName() + ".");
        return true;
    }

    private boolean handlePlayerInventory(CommandSender sender, Player player, String[] args) {
        String action = args[3];
        if (action.equalsIgnoreCase("clear")) {
            if (args.length >= 5) {
                return clearPlayerInventorySlot(sender, player, args[4]);
            }
            return clearPlayerInventory(sender, player);
        }
        if (action.equalsIgnoreCase("set")) {
            if (args.length < 7) {
                sender.sendMessage("Usage: minecraftstatus set <player> inventory set <slot> <item> <amount>");
                return true;
            }
            return setPlayerInventorySlot(sender, player, args[4], args[5], args[6]);
        }
        sender.sendMessage("Inventory command supports: set, clear");
        return true;
    }

    private boolean setPlayerInventorySlot(CommandSender sender, Player player, String slotValue, String itemValue, String amountValue) {
        Material material = resolveMaterial(itemValue);
        if (material == null || material.isAir()) {
            sender.sendMessage("Unknown item: " + itemValue);
            return true;
        }

        Integer amount = parseIntArg(amountValue);
        if (amount == null) {
            sender.sendMessage("Item amount must be an integer.");
            return true;
        }

        int maxAmount = Math.max(1, Math.min(64, material.getMaxStackSize()));
        ItemStack item = new ItemStack(material, (int) clamp(amount, 1, maxAmount));
        if (!setInventorySlot(player.getInventory(), slotValue, item)) {
            sender.sendMessage("Inventory slot must be 0-35, helmet, chestplate, leggings, boots, or offhand.");
            return true;
        }

        player.updateInventory();
        writeStatus();
        sender.sendMessage(
            "Set " + player.getName() + " inventory slot " + normalizeInventorySlotLabel(slotValue) + " to " +
            material.getKey().getKey() + " x" + item.getAmount() + "."
        );
        return true;
    }

    private boolean clearPlayerInventorySlot(CommandSender sender, Player player, String slotValue) {
        if (!setInventorySlot(player.getInventory(), slotValue, null)) {
            sender.sendMessage("Inventory slot must be 0-35, helmet, chestplate, leggings, boots, or offhand.");
            return true;
        }
        player.updateInventory();
        writeStatus();
        sender.sendMessage("Cleared " + player.getName() + " inventory slot " + normalizeInventorySlotLabel(slotValue) + ".");
        return true;
    }

    private boolean clearPlayerInventory(CommandSender sender, Player player) {
        player.getInventory().clear();
        player.getInventory().setArmorContents(new ItemStack[4]);
        player.getInventory().setItemInOffHand(null);
        player.updateInventory();
        writeStatus();
        sender.sendMessage("Cleared inventory for " + player.getName() + ".");
        return true;
    }

    private Material resolveMaterial(String value) {
        String normalized = strOrEmpty(value).trim().toLowerCase(Locale.ROOT).replace('-', '_');
        if (normalized.startsWith("minecraft:")) {
            normalized = normalized.substring("minecraft:".length());
        }
        if (normalized.isEmpty() || !normalized.matches("[a-z0-9_]+")) {
            return null;
        }
        Material material = Material.matchMaterial(normalized);
        if (material != null) {
            return material;
        }
        return Material.matchMaterial("minecraft:" + normalized);
    }

    private World resolveWorld(String value) {
        String normalized = strOrEmpty(value).trim();
        if (normalized.isEmpty()) {
            return null;
        }

        World directWorld = Bukkit.getWorld(normalized);
        if (directWorld != null) {
            return directWorld;
        }

        String lower = normalized.toLowerCase(Locale.ROOT);
        switch (lower) {
            case "overworld":
            case "minecraft:overworld":
                return Bukkit.getWorld("world");
            case "nether":
            case "the_nether":
            case "minecraft:the_nether":
                return Bukkit.getWorld("world_nether");
            case "end":
            case "the_end":
            case "minecraft:the_end":
                return Bukkit.getWorld("world_the_end");
            default:
                break;
        }

        for (World world : Bukkit.getWorlds()) {
            if (
                world.getName().equalsIgnoreCase(normalized) ||
                world.getKey().toString().equalsIgnoreCase(normalized)
            ) {
                return world;
            }
        }
        return null;
    }

    private boolean setInventorySlot(PlayerInventory inventory, String slotValue, ItemStack item) {
        Integer storageSlot = parseStorageSlot(slotValue);
        if (storageSlot != null) {
            inventory.setItem(storageSlot, item);
            return true;
        }

        String normalized = normalizeInventorySlotLabel(slotValue);
        switch (normalized) {
            case "helmet":
                inventory.setHelmet(item);
                return true;
            case "chestplate":
                inventory.setChestplate(item);
                return true;
            case "leggings":
                inventory.setLeggings(item);
                return true;
            case "boots":
                inventory.setBoots(item);
                return true;
            case "offhand":
                inventory.setItemInOffHand(item);
                return true;
            default:
                return false;
        }
    }

    private Integer parseStorageSlot(String slotValue) {
        Integer slot = parseIntArg(slotValue);
        if (slot == null || slot < 0 || slot > 35) {
            return null;
        }
        return slot;
    }

    private String normalizeInventorySlotLabel(String slotValue) {
        return strOrEmpty(slotValue).trim().toLowerCase(Locale.ROOT).replace('-', '_');
    }

    private void sendAdminUsage(CommandSender sender) {
        sender.sendMessage(
            "Usage: minecraftstatus set <player> <health|food|level|exp|gamemode|location|effects|inventory> <value>"
        );
    }

    @EventHandler
    public void onPlayerJoin(PlayerJoinEvent event) {
        lastNonEmptyAtMillis = System.currentTimeMillis();
        scheduleStatusWrite();
        getServer().getScheduler().runTaskLater(
            this,
            () -> deliverQueuedTradeNotices(event.getPlayer()),
            10L
        );
    }

    @EventHandler
    public void onPlayerQuit(PlayerQuitEvent event) {
        lastNonEmptyAtMillis = System.currentTimeMillis();
        scheduleStatusWrite();
    }

    @EventHandler(ignoreCancelled = true)
    public void onWeatherChange(WeatherChangeEvent event) {
        writeStatus(event.getWorld(), event.toWeatherState(), null);
        scheduleStatusWrite();
    }

    @EventHandler(ignoreCancelled = true)
    public void onThunderChange(ThunderChangeEvent event) {
        writeStatus(event.getWorld(), null, event.toThunderState());
        scheduleStatusWrite();
    }

    private void scheduleStatusWrite() {
        getServer().getScheduler().runTaskLater(this, this::writeStatus, 1L);
    }

    private void writeStatus() {
        writeStatus(null, null, null);
    }

    private void writeStatus(World weatherOverrideWorld, Boolean stormOverride, Boolean thunderOverride) {
        try {
            Files.createDirectories(statusPath.getParent());
            writeAtomic(buildStatusJson(weatherOverrideWorld, stormOverride, thunderOverride));
        } catch (IOException error) {
            getLogger().warning("Failed to write Minecraft status JSON: " + error.getMessage());
        }
    }

    private void writeOfflineStatus() {
        if (statusPath == null) {
            return;
        }
        String json = "{"
            + "\"generatedAt\":\"" + escapeJson(Instant.now().toString()) + "\","
            + "\"source\":\"paper-plugin\","
            + "\"serverOnline\":false,"
            + "\"version\":{\"name\":\"" + escapeJson(versionName()) + "\"},"
            + "\"motd\":\"" + escapeJson(Bukkit.getMotd()) + "\","
            + "\"world\":{\"timeTicks\":0,\"timeLabel\":\"00:00\",\"weather\":\"unknown\",\"paused\":true},"
            + "\"worlds\":[],"
            + "\"items\":[],"
            + "\"onlineCount\":0,"
            + "\"maxPlayers\":" + Bukkit.getMaxPlayers() + ","
            + "\"players\":[]"
            + "}\n";
        try {
            Files.createDirectories(statusPath.getParent());
            writeAtomic(json);
        } catch (IOException error) {
            getLogger().warning("Failed to write offline Minecraft status JSON: " + error.getMessage());
        }
    }

    private String buildStatusJson(World weatherOverrideWorld, Boolean stormOverride, Boolean thunderOverride) {
        Collection<? extends Player> onlinePlayers = Bukkit.getOnlinePlayers();
        int onlineCount = onlinePlayers.size();
        if (onlineCount > 0) {
            lastNonEmptyAtMillis = System.currentTimeMillis();
        }

        StringBuilder json = new StringBuilder(768);
        json.append('{');
        appendJsonField(json, "generatedAt", Instant.now().toString()).append(',');
        appendJsonField(json, "source", "paper-plugin").append(',');
        json.append("\"serverOnline\":true,");
        json.append("\"version\":{");
        appendJsonField(json, "name", versionName());
        json.append("},");
        appendJsonField(json, "motd", Bukkit.getMotd()).append(',');
        json.append("\"world\":");
        appendWorldJson(json, weatherOverrideWorld, stormOverride, thunderOverride);
        json.append(',');
        appendWorldsJson(json);
        json.append(',');
        appendItemsJson(json);
        json.append(',');
        json.append("\"onlineCount\":").append(onlineCount).append(',');
        json.append("\"maxPlayers\":").append(Bukkit.getMaxPlayers()).append(',');
        appendPlayersJson(json, onlinePlayers);
        json.append("}\n");
        return json.toString();
    }

    private void appendWorldJson(StringBuilder json, World weatherOverrideWorld, Boolean stormOverride, Boolean thunderOverride) {
        World world = getPrimaryWorld();
        long timeTicks = world == null ? 0L : world.getFullTime();
        String weather = resolveWeather(world, weatherOverrideWorld, stormOverride, thunderOverride);
        boolean paused = isPauseLikelyActive();

        json.append('{');
        json.append("\"timeTicks\":").append(timeTicks).append(',');
        appendJsonField(json, "timeLabel", formatMinecraftTime(timeTicks)).append(',');
        appendJsonField(json, "weather", weather).append(',');
        json.append("\"paused\":").append(paused);
        json.append('}');
    }

    private void appendWorldsJson(StringBuilder json) {
        List<World> worlds = new ArrayList<>(Bukkit.getWorlds());
        worlds.sort(Comparator.comparing(world -> world.getName().toLowerCase(Locale.ROOT)));

        json.append("\"worlds\":[");
        for (int index = 0; index < worlds.size(); index += 1) {
            World world = worlds.get(index);
            if (index > 0) {
                json.append(',');
            }
            json.append('{');
            appendJsonField(json, "name", world.getName()).append(',');
            appendJsonField(json, "key", world.getKey().toString()).append(',');
            appendJsonField(json, "environment", world.getEnvironment().name().toLowerCase(Locale.ROOT));
            json.append('}');
        }
        json.append(']');
    }

    private void appendItemsJson(StringBuilder json) {
        List<Material> items = new ArrayList<>();
        for (Material material : Material.values()) {
            if (material.isAir() || !material.isItem() || material.isLegacy()) {
                continue;
            }
            items.add(material);
        }
        items.sort(Comparator.comparing(material -> material.getKey().getKey()));

        json.append("\"items\":[");
        for (int index = 0; index < items.size(); index += 1) {
            Material material = items.get(index);
            String key = material.getKey().getKey();
            if (index > 0) {
                json.append(',');
            }
            json.append('{');
            appendJsonField(json, "value", key).append(',');
            appendJsonField(json, "label", formatMaterialName(key)).append(',');
            json.append("\"maxStackSize\":").append(material.getMaxStackSize());
            json.append('}');
        }
        json.append(']');
    }

    private void appendPlayersJson(StringBuilder json, Collection<? extends Player> onlinePlayers) {
        Set<String> onlineNames = new HashSet<>();
        List<PlayerRow> rows = new ArrayList<>();

        for (Player player : onlinePlayers) {
            String name = normalizePlayerName(player.getName());
            if (name.isEmpty()) {
                continue;
            }
            UUID uuid = player.getUniqueId();
            ensurePlayerHead(uuid, playerSkinUrl(player));
            onlineNames.add(name.toLowerCase(Locale.ROOT));
            rows.add(new PlayerRow(name, true, uuid, playerHeadUrl(uuid), buildPlayerDetailJson(player)));
        }

        for (OfflinePlayer player : Bukkit.getOfflinePlayers()) {
            String name = normalizePlayerName(player.getName());
            if (name.isEmpty()) {
                continue;
            }
            String key = name.toLowerCase(Locale.ROOT);
            if (!onlineNames.add(key)) {
                continue;
            }
            UUID uuid = player.getUniqueId();
            ensurePlayerHead(uuid, playerSkinUrl(player));
            rows.add(new PlayerRow(name, false, uuid, playerHeadUrl(uuid), ""));
        }

        rows.sort(Comparator
            .comparing((PlayerRow row) -> !row.online)
            .thenComparing(row -> row.name.toLowerCase(Locale.ROOT)));

        json.append("\"players\":[");
        for (int index = 0; index < rows.size(); index += 1) {
            PlayerRow row = rows.get(index);
            if (index > 0) {
                json.append(',');
            }
            json.append('{');
            appendJsonField(json, "name", row.name).append(',');
            json.append("\"online\":").append(row.online);
            if (row.uuid != null) {
                json.append(',');
                appendJsonField(json, "uuid", row.uuid.toString());
            }
            if (!row.headUrl.isEmpty()) {
                json.append(',');
                appendJsonField(json, "headUrl", row.headUrl);
            }
            if (!row.detailJson.isEmpty()) {
                json.append(",\"detail\":").append(row.detailJson);
            }
            json.append('}');
        }
        json.append(']');
    }

    private String buildPlayerDetailJson(Player player) {
        StringBuilder json = new StringBuilder(1536);
        Location location = player.getLocation();

        json.append('{');
        json.append("\"health\":").append(formatJsonNumber(player.getHealth())).append(',');
        json.append("\"maxHealth\":").append(formatJsonNumber(player.getMaxHealth())).append(',');
        json.append("\"absorption\":").append(formatJsonNumber(player.getAbsorptionAmount())).append(',');
        json.append("\"food\":").append(player.getFoodLevel()).append(',');
        json.append("\"saturation\":").append(formatJsonNumber(player.getSaturation())).append(',');
        json.append("\"level\":").append(player.getLevel()).append(',');
        json.append("\"experience\":").append(formatJsonNumber(player.getExp())).append(',');
        json.append("\"heldSlot\":").append(player.getInventory().getHeldItemSlot()).append(',');
        appendJsonField(json, "gameMode", player.getGameMode().name().toLowerCase(Locale.ROOT)).append(',');
        appendJsonField(json, "world", player.getWorld().getName()).append(',');
        json.append("\"location\":{");
        json.append("\"x\":").append(formatJsonNumber(location.getX())).append(',');
        json.append("\"y\":").append(formatJsonNumber(location.getY())).append(',');
        json.append("\"z\":").append(formatJsonNumber(location.getZ()));
        json.append("},");
        appendEffectsJson(json, player.getActivePotionEffects()).append(',');
        appendInventoryJson(json, player.getInventory());
        json.append('}');
        return json.toString();
    }

    private StringBuilder appendEffectsJson(StringBuilder json, Collection<PotionEffect> effects) {
        List<PotionEffect> rows = new ArrayList<>(effects);
        rows.sort(Comparator.comparing(effect -> effect.getType().getKey().getKey()));

        json.append("\"effects\":[");
        for (int index = 0; index < rows.size(); index += 1) {
            PotionEffect effect = rows.get(index);
            if (index > 0) {
                json.append(',');
            }
            json.append('{');
            appendJsonField(json, "type", effect.getType().getKey().getKey()).append(',');
            appendJsonField(json, "label", formatMaterialName(effect.getType().getKey().getKey())).append(',');
            json.append("\"amplifier\":").append(effect.getAmplifier()).append(',');
            json.append("\"durationTicks\":").append(effect.getDuration()).append(',');
            json.append("\"infinite\":").append(effect.isInfinite());
            json.append('}');
        }
        json.append(']');
        return json;
    }

    private void appendInventoryJson(StringBuilder json, PlayerInventory inventory) {
        json.append("\"inventory\":[");
        ItemStack[] storage = inventory.getStorageContents();
        boolean hasPreviousItem = false;
        for (int slot = 0; slot < storage.length; slot += 1) {
            hasPreviousItem = appendItemJson(json, storage[slot], slot, hasPreviousItem);
        }
        json.append("],");

        json.append("\"armor\":[");
        ItemStack[] armor = inventory.getArmorContents();
        String[] armorSlots = {"boots", "leggings", "chestplate", "helmet"};
        hasPreviousItem = false;
        for (int slot = 0; slot < armor.length; slot += 1) {
            hasPreviousItem = appendNamedItemJson(
                json,
                armor[slot],
                slot < armorSlots.length ? armorSlots[slot] : "armor_" + slot,
                hasPreviousItem
            );
        }
        json.append("],");

        json.append("\"offhand\":");
        if (!appendSingleItemJson(json, inventory.getItemInOffHand())) {
            json.append("null");
        }
    }

    private boolean appendItemJson(StringBuilder json, ItemStack item, int slot, boolean hasPreviousItem) {
        if (isEmptyItem(item)) {
            return hasPreviousItem;
        }
        if (hasPreviousItem) {
            json.append(',');
        }
        appendItemFieldsJson(json, item, "\"slot\":" + slot);
        return true;
    }

    private boolean appendNamedItemJson(StringBuilder json, ItemStack item, String slot, boolean hasPreviousItem) {
        if (isEmptyItem(item)) {
            return hasPreviousItem;
        }
        if (hasPreviousItem) {
            json.append(',');
        }
        appendItemFieldsJson(json, item, "\"slot\":\"" + escapeJson(slot) + "\"");
        return true;
    }

    private boolean appendSingleItemJson(StringBuilder json, ItemStack item) {
        if (isEmptyItem(item)) {
            return false;
        }
        appendItemFieldsJson(json, item, "");
        return true;
    }

    private void appendItemFieldsJson(StringBuilder json, ItemStack item, String prefixField) {
        Material material = item.getType();
        String type = material.getKey().getKey();
        ItemMeta meta = item.hasItemMeta() ? item.getItemMeta() : null;
        json.append('{');
        if (!prefixField.isEmpty()) {
            json.append(prefixField).append(',');
        }
        appendJsonField(json, "type", type).append(',');
        appendJsonField(json, "label", getItemLabel(item, type)).append(',');
        json.append("\"customName\":").append(meta != null && meta.hasDisplayName()).append(',');
        json.append("\"amount\":").append(item.getAmount()).append(',');
        boolean enchanted = meta != null && meta.hasEnchants();
        json.append("\"enchanted\":").append(enchanted);
        if (enchanted) {
            json.append(',');
            appendItemEnchantmentsJson(json, meta);
        }
        int maxDamage = Math.max(0, material.getMaxDurability());
        if (maxDamage > 0) {
            int damage = meta instanceof Damageable ? Math.max(0, ((Damageable) meta).getDamage()) : 0;
            json.append(",\"damage\":").append(Math.min(damage, maxDamage)).append(',');
            json.append("\"maxDamage\":").append(maxDamage);
        }
        json.append('}');
    }

    private void appendItemEnchantmentsJson(StringBuilder json, ItemMeta meta) {
        List<Map.Entry<Enchantment, Integer>> enchantments = new ArrayList<>(meta.getEnchants().entrySet());
        enchantments.sort(Comparator.comparing(entry -> entry.getKey().getKey().getKey()));
        json.append("\"enchantments\":[");
        for (int index = 0; index < enchantments.size(); index += 1) {
            Map.Entry<Enchantment, Integer> enchantment = enchantments.get(index);
            if (index > 0) {
                json.append(',');
            }
            json.append('{');
            appendJsonField(json, "key", enchantment.getKey().getKey().getKey()).append(',');
            json.append("\"level\":").append(Math.max(1, enchantment.getValue()));
            json.append('}');
        }
        json.append(']');
    }

    private boolean isEmptyItem(ItemStack item) {
        return item == null || item.getType().isAir() || item.getAmount() <= 0;
    }

    private String getItemLabel(ItemStack item, String type) {
        if (item.hasItemMeta()) {
            ItemMeta meta = item.getItemMeta();
            if (meta != null && meta.hasDisplayName()) {
                return meta.getDisplayName();
            }
        }
        return formatMaterialName(type);
    }

    private World getPrimaryWorld() {
        World namedWorld = Bukkit.getWorld("world");
        if (namedWorld != null) {
            return namedWorld;
        }
        List<World> worlds = Bukkit.getWorlds();
        return worlds.isEmpty() ? null : worlds.get(0);
    }

    private String resolveWeather(World world, World weatherOverrideWorld, Boolean stormOverride, Boolean thunderOverride) {
        if (world == null) {
            return "unknown";
        }
        boolean storm = world.hasStorm();
        boolean thunder = world.isThundering();
        if (weatherOverrideWorld != null && weatherOverrideWorld.equals(world)) {
            if (stormOverride != null) {
                storm = stormOverride;
            }
            if (thunderOverride != null) {
                thunder = thunderOverride;
            }
        }
        if (thunder) {
            return "thunder";
        }
        return storm ? "rain" : "clear";
    }

    private boolean isPauseLikelyActive() {
        int pauseSeconds = Bukkit.getPauseWhenEmptyTime();
        if (!Bukkit.getOnlinePlayers().isEmpty() || pauseSeconds <= 0) {
            return false;
        }
        long emptyMillis = System.currentTimeMillis() - lastNonEmptyAtMillis;
        return emptyMillis >= pauseSeconds * 1000L;
    }

    private String versionName() {
        return Bukkit.getName() + " " + Bukkit.getMinecraftVersion();
    }

    private String normalizePlayerName(String name) {
        return name == null ? "" : name.trim();
    }

    private void ensurePlayerHead(UUID uuid, URL skinUrl) {
        if (uuid == null || playerHeadsPath == null) {
            return;
        }

        if (skinUrl == null || !isHttpUrl(skinUrl)) {
            return;
        }

        Path headPath = playerHeadPath(uuid);
        Path metadataPath = playerHeadMetadataPath(uuid);
        String skinUrlText = skinUrl.toString();
        if (isPlayerHeadCurrent(headPath, metadataPath, skinUrlText)) {
            return;
        }
        if (!pendingHeadBuilds.add(uuid)) {
            return;
        }

        getServer().getScheduler().runTaskAsynchronously(this, () -> {
            try {
                buildPlayerHead(skinUrl, headPath, metadataPath, skinUrlText);
            } catch (IOException | RuntimeException error) {
                getLogger().fine("Failed to build player head for " + uuid + ": " + error.getMessage());
            } finally {
                pendingHeadBuilds.remove(uuid);
            }
        });
    }

    private URL playerSkinUrl(Player player) {
        try {
            PlayerProfile profile = player.getPlayerProfile();
            if (profile == null) {
                return null;
            }
            PlayerTextures textures = profile.getTextures();
            return textures == null ? null : textures.getSkin();
        } catch (RuntimeException error) {
            return null;
        }
    }

    private URL playerSkinUrl(OfflinePlayer player) {
        try {
            PlayerProfile profile = player.getPlayerProfile();
            if (profile == null) {
                return null;
            }
            PlayerTextures textures = profile.getTextures();
            return textures == null ? null : textures.getSkin();
        } catch (RuntimeException error) {
            return null;
        }
    }

    private boolean isHttpUrl(URL url) {
        String protocol = url.getProtocol();
        return "https".equalsIgnoreCase(protocol) || "http".equalsIgnoreCase(protocol);
    }

    private Path playerHeadPath(UUID uuid) {
        return playerHeadsPath.resolve(uuid.toString() + ".png");
    }

    private Path playerHeadMetadataPath(UUID uuid) {
        return playerHeadsPath.resolve(uuid.toString() + ".txt");
    }

    private boolean isPlayerHeadCurrent(Path headPath, Path metadataPath, String skinUrl) {
        if (!Files.isRegularFile(headPath) || !Files.isRegularFile(metadataPath)) {
            return false;
        }
        try {
            return Files.readString(metadataPath, StandardCharsets.UTF_8).trim().equals(skinUrl);
        } catch (IOException error) {
            return false;
        }
    }

    private void buildPlayerHead(URL skinUrl, Path headPath, Path metadataPath, String skinUrlText) throws IOException {
        Files.createDirectories(playerHeadsPath);
        BufferedImage skin = readSkinImage(skinUrl);
        if (skin == null || skin.getWidth() < 48 || skin.getHeight() < 16) {
            throw new IOException("Invalid skin image");
        }

        BufferedImage head = renderPlayerHead(skin);
        Path tempPath = Files.createTempFile(playerHeadsPath, headPath.getFileName().toString(), ".tmp");
        try {
            if (!ImageIO.write(head, "png", tempPath.toFile())) {
                throw new IOException("PNG writer unavailable");
            }
            Files.move(tempPath, headPath, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            Files.writeString(metadataPath, skinUrlText + "\n", StandardCharsets.UTF_8);
        } finally {
            Files.deleteIfExists(tempPath);
        }
    }

    private BufferedImage readSkinImage(URL skinUrl) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) skinUrl.openConnection();
        connection.setConnectTimeout(SKIN_CONNECT_TIMEOUT_MILLIS);
        connection.setReadTimeout(SKIN_READ_TIMEOUT_MILLIS);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("User-Agent", "Hanplanet-MinecraftStatusBridge/1.7");
        try {
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                throw new IOException("Skin request failed with HTTP " + status);
            }
            try (InputStream stream = connection.getInputStream()) {
                return ImageIO.read(stream);
            }
        } finally {
            connection.disconnect();
        }
    }

    private BufferedImage renderPlayerHead(BufferedImage skin) {
        BufferedImage head = new BufferedImage(PLAYER_HEAD_SIZE, PLAYER_HEAD_SIZE, BufferedImage.TYPE_INT_ARGB);
        Graphics2D graphics = head.createGraphics();
        try {
            graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_NEAREST_NEIGHBOR);
            graphics.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_OFF);
            graphics.drawImage(skin, 0, 0, PLAYER_HEAD_SIZE, PLAYER_HEAD_SIZE, 8, 8, 16, 16, null);
            graphics.drawImage(skin, 0, 0, PLAYER_HEAD_SIZE, PLAYER_HEAD_SIZE, 40, 8, 48, 16, null);
        } finally {
            graphics.dispose();
        }
        return head;
    }

    private String playerHeadUrl(UUID uuid) {
        if (uuid == null || playerHeadsPath == null) {
            return "";
        }
        Path headPath = playerHeadPath(uuid);
        if (!Files.isRegularFile(headPath)) {
            return "";
        }
        long version = 0L;
        try {
            version = Files.getLastModifiedTime(headPath).toMillis();
        } catch (IOException error) {
            version = System.currentTimeMillis();
        }
        return "/player-heads/" + uuid + ".png?v=" + version;
    }

    private String formatMinecraftTime(long ticks) {
        long dayTicks = Math.floorMod(ticks, 24000L);
        long totalMinutes = ((dayTicks + 6000L) % 24000L) * 1440L / 24000L;
        long hours = totalMinutes / 60L;
        long minutes = totalMinutes % 60L;
        return String.format(Locale.ROOT, "%02d:%02d", hours, minutes);
    }

    private String formatMaterialName(String value) {
        String[] words = strOrEmpty(value).replace('-', '_').split("_+");
        StringBuilder label = new StringBuilder();
        for (String word : words) {
            if (word.isEmpty()) {
                continue;
            }
            if (!label.isEmpty()) {
                label.append(' ');
            }
            label.append(word.substring(0, 1).toUpperCase(Locale.ROOT));
            if (word.length() > 1) {
                label.append(word.substring(1).toLowerCase(Locale.ROOT));
            }
        }
        return label.isEmpty() ? strOrEmpty(value) : label.toString();
    }

    private String strOrEmpty(String value) {
        return value == null ? "" : value;
    }

    private String formatJsonNumber(double value) {
        if (!Double.isFinite(value)) {
            return "0";
        }
        double rounded = Math.round(value * 100.0D) / 100.0D;
        if (Math.rint(rounded) == rounded) {
            return Long.toString((long) rounded);
        }
        return Double.toString(rounded);
    }

    private double clamp(double value, double minValue, double maxValue) {
        return Math.max(minValue, Math.min(maxValue, value));
    }

    private Double parseDoubleArg(String value) {
        try {
            double parsed = Double.parseDouble(strOrEmpty(value));
            return Double.isFinite(parsed) ? parsed : null;
        } catch (NumberFormatException error) {
            return null;
        }
    }

    private Integer parseIntArg(String value) {
        try {
            return Integer.parseInt(strOrEmpty(value));
        } catch (NumberFormatException error) {
            return null;
        }
    }

    private StringBuilder appendJsonField(StringBuilder json, String key, String value) {
        json.append('"').append(escapeJson(key)).append("\":\"").append(escapeJson(value)).append('"');
        return json;
    }

    private String escapeJson(String value) {
        StringBuilder escaped = new StringBuilder(value == null ? 0 : value.length() + 16);
        for (int index = 0; value != null && index < value.length(); index += 1) {
            char ch = value.charAt(index);
            switch (ch) {
                case '\\':
                    escaped.append("\\\\");
                    break;
                case '"':
                    escaped.append("\\\"");
                    break;
                case '\b':
                    escaped.append("\\b");
                    break;
                case '\f':
                    escaped.append("\\f");
                    break;
                case '\n':
                    escaped.append("\\n");
                    break;
                case '\r':
                    escaped.append("\\r");
                    break;
                case '\t':
                    escaped.append("\\t");
                    break;
                default:
                    if (ch < 0x20) {
                        escaped.append(String.format(Locale.ROOT, "\\u%04x", (int) ch));
                    } else {
                        escaped.append(ch);
                    }
            }
        }
        return escaped.toString();
    }

    private void writeAtomic(String json) throws IOException {
        Path tempPath = Files.createTempFile(statusPath.getParent(), "status", ".tmp");
        Files.writeString(tempPath, json, StandardCharsets.UTF_8);
        Files.move(tempPath, statusPath, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    }

    private record PlayerRow(String name, boolean online, UUID uuid, String headUrl, String detailJson) {
    }
}
