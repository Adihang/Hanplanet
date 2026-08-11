package dev.hanplanet.simplyswordsconfigfix.mixin;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import net.sweenus.simplyswords.config.Config;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Overwrite;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.Unique;

import java.io.File;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/**
 * Simply Swords 1.56.0 reparses a whole config file every time a value is read.
 * Eldritch End calls that path from every player tick, so cache each section/type
 * pair after the first read while keeping the original value maps and fallbacks.
 */
@Mixin(value = Config.class, remap = false)
public abstract class SimplySwordsConfigMixin {
    @Shadow
    @Final
    private static HashMap<String, Boolean> BOOLEAN;

    @Shadow
    @Final
    private static HashMap<String, Float> FLOAT;

    @Shadow
    @Final
    private static HashMap<String, Double> DOUBLE;

    @Shadow
    @Final
    private static HashMap<String, Integer> INT;

    @Unique
    private static final Set<String> HANPLANET_LOADED_VALUES = new HashSet<>();

    /**
     * @author Hanplanet
     * @reason The upstream method performs synchronous disk I/O and JSON parsing
     * on every config lookup, including lookups from LivingEntity.tick().
     */
    @Overwrite
    public static void safeValueFetch(String valueType, String section) {
        String cacheKey = valueType + "\u0000" + section;
        synchronized (HANPLANET_LOADED_VALUES) {
            if (!HANPLANET_LOADED_VALUES.add(cacheKey)) {
                return;
            }
        }

        if (!new File("config/simplyswords_main/").exists()) {
            return;
        }

        JsonObject values = switch (section) {
            case "GemEffects" -> read("gem_effects.json5");
            case "General" -> read("general.json5");
            case "Loot" -> read("loot.json5");
            case "RunicEffects" -> read("runic_effects.json5");
            case "StatusEffects" -> read("status_effects.json5");
            case "UniqueEffects" -> read("unique_effects.json5");
            case "WeaponAttributes" -> read("weapon_attributes.json5");
            default -> null;
        };

        if (values == null) {
            return;
        }

        for (Map.Entry<String, JsonElement> entry : values.entrySet()) {
            try {
                switch (valueType) {
                    case "boolean" -> BOOLEAN.put(entry.getKey(), entry.getValue().getAsBoolean());
                    case "float" -> FLOAT.put(entry.getKey(), entry.getValue().getAsFloat());
                    case "double" -> DOUBLE.put(entry.getKey(), entry.getValue().getAsDouble());
                    case "int" -> INT.put(entry.getKey(), entry.getValue().getAsInt());
                    default -> {
                        return;
                    }
                }
            } catch (Exception ignored) {
                // Match Simply Swords' per-value fallback behavior.
            }
        }
    }

    @Unique
    private static JsonObject read(String fileName) {
        return Config.getJsonObject(Config.readFile(new File("config/simplyswords_main/" + fileName)));
    }
}
