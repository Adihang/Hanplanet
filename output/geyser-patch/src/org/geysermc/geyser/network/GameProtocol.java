package org.geysermc.geyser.network;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

import org.cloudburstmc.protocol.bedrock.codec.BedrockCodec;
import org.cloudburstmc.protocol.bedrock.codec.v1001.Bedrock_v1001;
import org.cloudburstmc.protocol.bedrock.codec.v924.Bedrock_v924;
import org.cloudburstmc.protocol.bedrock.codec.v944.Bedrock_v944;
import org.cloudburstmc.protocol.bedrock.codec.v975.Bedrock_v975;
import org.geysermc.geyser.api.util.MinecraftVersion;
import org.geysermc.geyser.impl.MinecraftVersionImpl;
import org.geysermc.geyser.platform.spigot.shaded.it.unimi.dsi.fastutil.ints.IntArrayList;
import org.geysermc.geyser.platform.spigot.shaded.it.unimi.dsi.fastutil.ints.IntList;
import org.geysermc.mcprotocollib.protocol.codec.MinecraftCodec;
import org.geysermc.mcprotocollib.protocol.codec.PacketCodec;

public final class GameProtocol {
    static final List<BedrockCodec> SUPPORTED_BEDROCK_CODECS = new ArrayList<>();
    public static final IntList SUPPORTED_BEDROCK_PROTOCOLS = new IntArrayList();
    public static final List<MinecraftVersion> SUPPORTED_BEDROCK_VERSIONS = new ArrayList<>();

    public static final int DEFAULT_BEDROCK_PROTOCOL;
    public static final String DEFAULT_BEDROCK_VERSION;

    private static final PacketCodec DEFAULT_JAVA_CODEC = MinecraftCodec.CODEC;

    private static void register(BedrockCodec codec, String... versions) {
        codec = CodecProcessor.processCodec(codec);
        SUPPORTED_BEDROCK_CODECS.add(codec);
        SUPPORTED_BEDROCK_PROTOCOLS.add(codec.getProtocolVersion());
        for (String version : versions) {
            SUPPORTED_BEDROCK_VERSIONS.add(new MinecraftVersionImpl(version, codec.getProtocolVersion()));
        }
    }

    private static void register(BedrockCodec codec) {
        register(codec, codec.getMinecraftVersion());
    }

    public static BedrockCodec getBedrockCodec(int protocolVersion) {
        for (BedrockCodec codec : SUPPORTED_BEDROCK_CODECS) {
            if (codec.getProtocolVersion() == protocolVersion) {
                return codec;
            }
        }
        return null;
    }

    public static boolean is26_10orHigher(int protocolVersion) {
        return protocolVersion >= Bedrock_v944.CODEC.getProtocolVersion();
    }

    public static boolean is26_20orHigher(int protocolVersion) {
        return protocolVersion >= Bedrock_v975.CODEC.getProtocolVersion();
    }

    public static boolean is26_30orHigher(int protocolVersion) {
        return protocolVersion >= Bedrock_v1001.CODEC.getProtocolVersion();
    }

    public static List<String> getJavaVersions() {
        return List.of(DEFAULT_JAVA_CODEC.getMinecraftVersion(), "26.1.1", "26.1.2");
    }

    public static int getJavaProtocolVersion() {
        return DEFAULT_JAVA_CODEC.getProtocolVersion();
    }

    public static String getJavaMinecraftVersion() {
        return DEFAULT_JAVA_CODEC.getMinecraftVersion();
    }

    public static String getAllSupportedBedrockVersions() {
        return SUPPORTED_BEDROCK_VERSIONS.stream()
            .map(MinecraftVersion::versionString)
            .collect(Collectors.joining(","));
    }

    public static String getAllSupportedJavaVersions() {
        return String.join(",", getJavaVersions());
    }

    private GameProtocol() {
    }

    static {
        register(Bedrock_v924.CODEC, "26.0", "26.1", "26.2", "26.3");
        register(Bedrock_v944.CODEC, "26.10");
        register(Bedrock_v975.CODEC, "26.20", "26.21", "26.22", "26.23");
        register(Bedrock_v1001.CODEC, "26.30", "26.31");

        MinecraftVersion latestVersion = SUPPORTED_BEDROCK_VERSIONS.getLast();
        DEFAULT_BEDROCK_VERSION = latestVersion.versionString();
        DEFAULT_BEDROCK_PROTOCOL = latestVersion.protocolVersion();
    }
}
