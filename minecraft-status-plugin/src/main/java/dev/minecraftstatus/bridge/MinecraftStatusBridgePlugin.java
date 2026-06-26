package dev.minecraftstatus.bridge;

import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.OfflinePlayer;
import org.bukkit.World;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.weather.ThunderChangeEvent;
import org.bukkit.event.weather.WeatherChangeEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.PlayerInventory;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

public final class MinecraftStatusBridgePlugin extends JavaPlugin implements Listener {
    private static final String ADMIN_PERMISSION = "minecraftstatus.admin";
    private Path statusPath;
    private long lastNonEmptyAtMillis;

    @Override
    public void onEnable() {
        statusPath = getServer().getWorldContainer().toPath().resolve("web").resolve("status.json");
        lastNonEmptyAtMillis = System.currentTimeMillis();
        getServer().getPluginManager().registerEvents(this, this);
        getServer().getScheduler().runTaskTimer(this, this::writeStatus, 20L, 100L);
        writeStatus();
    }

    @Override
    public void onDisable() {
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
            onlineNames.add(name.toLowerCase(Locale.ROOT));
            rows.add(new PlayerRow(name, true, player.getUniqueId(), buildPlayerDetailJson(player)));
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
            rows.add(new PlayerRow(name, false, player.getUniqueId(), ""));
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
        json.append('{');
        if (!prefixField.isEmpty()) {
            json.append(prefixField).append(',');
        }
        appendJsonField(json, "type", type).append(',');
        appendJsonField(json, "label", getItemLabel(item, type)).append(',');
        json.append("\"amount\":").append(item.getAmount()).append(',');
        json.append("\"enchanted\":").append(item.hasItemMeta() && item.getItemMeta() != null && item.getItemMeta().hasEnchants());
        json.append('}');
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

    private record PlayerRow(String name, boolean online, UUID uuid, String detailJson) {
    }
}
