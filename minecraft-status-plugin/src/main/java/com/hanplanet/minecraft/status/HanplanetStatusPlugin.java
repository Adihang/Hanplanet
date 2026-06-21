package com.hanplanet.minecraft.status;

import org.bukkit.Bukkit;
import org.bukkit.OfflinePlayer;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.weather.ThunderChangeEvent;
import org.bukkit.event.weather.WeatherChangeEvent;
import org.bukkit.plugin.java.JavaPlugin;

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

public final class HanplanetStatusPlugin extends JavaPlugin implements Listener {
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

    private void appendPlayersJson(StringBuilder json, Collection<? extends Player> onlinePlayers) {
        Set<String> onlineNames = new HashSet<>();
        List<PlayerRow> rows = new ArrayList<>();

        for (Player player : onlinePlayers) {
            String name = normalizePlayerName(player.getName());
            if (name.isEmpty()) {
                continue;
            }
            onlineNames.add(name.toLowerCase(Locale.ROOT));
            rows.add(new PlayerRow(name, true));
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
            rows.add(new PlayerRow(name, false));
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
            json.append('}');
        }
        json.append(']');
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

    private record PlayerRow(String name, boolean online) {
    }
}
