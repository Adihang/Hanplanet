package dev.minecraftlink.bridge;

import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabExecutor;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;
import org.geysermc.floodgate.api.FloodgateApi;
import org.geysermc.floodgate.api.player.FloodgatePlayer;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

public final class MinecraftAccountLinkPlugin extends JavaPlugin implements TabExecutor {
    private String apiUrl;
    private String sharedSecret;
    private HttpClient httpClient;
    private int requestTimeoutMillis;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        reloadLocalConfig();
        if (getCommand("link") != null) {
            getCommand("link").setExecutor(this);
            getCommand("link").setTabCompleter(this);
        }
    }

    private void reloadLocalConfig() {
        reloadConfig();
        apiUrl = getConfig().getString("api-url", "").trim();
        sharedSecret = getConfig().getString("shared-secret", "").trim();
        int connectTimeoutMillis = Math.max(1000, getConfig().getInt("connect-timeout-ms", 3000));
        requestTimeoutMillis = Math.max(1000, getConfig().getInt("request-timeout-ms", 6000));
        httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofMillis(connectTimeoutMillis))
            .build();

        if (apiUrl.isEmpty() || sharedSecret.isEmpty()) {
            getLogger().warning("Account linking is disabled until api-url and shared-secret are configured.");
        }
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!command.getName().equalsIgnoreCase("link")) {
            return false;
        }
        if (!(sender instanceof Player player)) {
            sender.sendMessage("Only players can link a Minecraft account.");
            return true;
        }
        if (args.length != 1) {
            player.sendMessage("Usage: /link <code>");
            return true;
        }
        if (apiUrl.isEmpty() || sharedSecret.isEmpty()) {
            player.sendMessage("Account linking is not configured on this server.");
            return true;
        }

        String code = args[0].trim();
        if (code.isEmpty() || code.length() > 32) {
            player.sendMessage("Invalid link code.");
            return true;
        }

        PlayerSnapshot snapshot = PlayerSnapshot.from(player, resolveFloodgateData(player.getUniqueId()));
        player.sendMessage("Checking link code...");
        getServer().getScheduler().runTaskAsynchronously(this, () -> completeLink(player, code, snapshot));
        return true;
    }

    @Override
    public List<String> onTabComplete(CommandSender sender, Command command, String alias, String[] args) {
        return Collections.emptyList();
    }

    private void completeLink(Player player, String code, PlayerSnapshot playerSnapshot) {
        String body = buildJsonBody(code, playerSnapshot);
        int statusCode;
        String responseBody;
        try {
            long timestamp = System.currentTimeMillis() / 1000L;
            HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(apiUrl))
                .timeout(Duration.ofMillis(requestTimeoutMillis))
                .header("Content-Type", "application/json")
                .header("X-Hanplanet-Minecraft-Timestamp", Long.toString(timestamp))
                .header("X-Hanplanet-Minecraft-Signature", hmacHex(timestamp + "." + body))
                .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                .build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            statusCode = response.statusCode();
            responseBody = response.body();
        } catch (IllegalArgumentException error) {
            getLogger().warning("Invalid account-link API URL: " + apiUrl);
            sendSync(player, "Account linking is misconfigured on this server.");
            return;
        } catch (IOException error) {
            getLogger().warning("Account-link API request failed: " + error.getMessage());
            sendSync(player, "Could not reach the account-link server.");
            return;
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            sendSync(player, "Account linking was interrupted.");
            return;
        } catch (Exception error) {
            getLogger().warning("Account-link request failed: " + error.getMessage());
            sendSync(player, "Account linking failed.");
            return;
        }

        if (statusCode >= 200 && statusCode < 300) {
            sendSync(player, "Account linked successfully.");
            return;
        }
        sendSync(player, messageForFailure(statusCode, responseBody));
    }

    private void sendSync(Player player, String message) {
        getServer().getScheduler().runTask(this, () -> {
            if (player.isOnline()) {
                player.sendMessage(message);
            }
        });
    }

    private String messageForFailure(int statusCode, String responseBody) {
        String body = responseBody == null ? "" : responseBody.toLowerCase(Locale.ROOT);
        if (statusCode == 404 || body.contains("invalid_code")) {
            return "Invalid link code.";
        }
        if (statusCode == 410 || body.contains("expired_code")) {
            return "This link code has expired.";
        }
        if (statusCode == 409 || body.contains("minecraft_account_already_linked")) {
            return "This Minecraft account is already linked to another website account.";
        }
        if (statusCode == 400 || body.contains("invalid_payload")) {
            return "Could not link this Minecraft account.";
        }
        if (statusCode == 403) {
            return "The account-link server rejected this request.";
        }
        if (statusCode == 503) {
            return "Account linking is not ready on the website.";
        }
        return "Account linking failed.";
    }

    private FloodgateData resolveFloodgateData(UUID uuid) {
        if (!getServer().getPluginManager().isPluginEnabled("floodgate")) {
            return new FloodgateData("java", "");
        }
        try {
            FloodgateApi api = FloodgateApi.getInstance();
            if (api != null && api.isFloodgatePlayer(uuid)) {
                FloodgatePlayer floodgatePlayer = api.getPlayer(uuid);
                String xuid = floodgatePlayer == null ? "" : safe(floodgatePlayer.getXuid());
                return new FloodgateData("bedrock", xuid);
            }
        } catch (Throwable error) {
            getLogger().fine("Floodgate lookup failed: " + error.getMessage());
        }
        return new FloodgateData("java", "");
    }

    private String buildJsonBody(String code, PlayerSnapshot player) {
        return "{"
            + "\"code\":" + jsonString(code)
            + ",\"minecraftUuid\":" + jsonString(player.uuid)
            + ",\"minecraftName\":" + jsonString(player.name)
            + ",\"edition\":" + jsonString(player.edition)
            + ",\"floodgateXuid\":" + jsonString(player.floodgateXuid)
            + "}";
    }

    private String hmacHex(String message) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(sharedSecret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        byte[] digest = mac.doFinal(message.getBytes(StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder(digest.length * 2);
        for (byte value : digest) {
            hex.append(String.format("%02x", value & 0xff));
        }
        return hex.toString();
    }

    private static String jsonString(String value) {
        StringBuilder builder = new StringBuilder("\"");
        String safeValue = safe(value);
        for (int index = 0; index < safeValue.length(); index += 1) {
            char character = safeValue.charAt(index);
            switch (character) {
                case '"':
                    builder.append("\\\"");
                    break;
                case '\\':
                    builder.append("\\\\");
                    break;
                case '\b':
                    builder.append("\\b");
                    break;
                case '\f':
                    builder.append("\\f");
                    break;
                case '\n':
                    builder.append("\\n");
                    break;
                case '\r':
                    builder.append("\\r");
                    break;
                case '\t':
                    builder.append("\\t");
                    break;
                default:
                    if (character < 0x20) {
                        builder.append(String.format("\\u%04x", (int) character));
                    } else {
                        builder.append(character);
                    }
            }
        }
        builder.append("\"");
        return builder.toString();
    }

    private static String safe(String value) {
        return value == null ? "" : value;
    }

    private record FloodgateData(String edition, String xuid) {
    }

    private record PlayerSnapshot(String uuid, String name, String edition, String floodgateXuid) {
        static PlayerSnapshot from(Player player, FloodgateData floodgateData) {
            return new PlayerSnapshot(
                player.getUniqueId().toString(),
                player.getName(),
                floodgateData.edition(),
                floodgateData.xuid()
            );
        }
    }
}
