import unicodedata

from django.db import migrations


ONSCRIPTER_GAMES = [
    {
        "slug": "haruuru",
        "title": "하루우루",
        "folder_name": unicodedata.normalize("NFD", "하루우루"),
        "asset_folder_name": unicodedata.normalize("NFD", "하루우루_web"),
        "description_ko": "아득히 우러러본, 아름다운",
        "description_en": "An ONScripter web port playable in the browser. Saves are stored per user.",
        "thumbnail_path": "IMAGE/HARUURU_META.webp",
        "display_order": 10,
    },
    {
        "slug": "kanoina",
        "title": "Kanoina",
        "folder_name": "kanoina",
        "asset_folder_name": "kanoina_web",
        "description_ko": "×××인 그녀가 시골 생활을 만끽하는 비밀의 방법",
        "description_en": "An ONScripter web port playable in the browser. Saves are stored per user.",
        "thumbnail_path": "image/title.png",
        "display_order": 20,
    },
    {
        "slug": "konosora",
        "title": "KonoSora",
        "folder_name": "konosora",
        "asset_folder_name": "konosora_web",
        "description_ko": "이 넓은 하늘에, 날개를 펼치고",
        "description_en": "An ONScripter web port playable in the browser. Saves are stored per user.",
        "thumbnail_path": "image/title.png",
        "display_order": 30,
    },
    {
        "slug": "hoshizora",
        "title": "별하늘에 걸린 다리",
        "folder_name": unicodedata.normalize("NFD", "별하늘에 걸린 다리"),
        "asset_folder_name": unicodedata.normalize("NFD", "별하늘에 걸린 다리_web"),
        "description_ko": "별하늘에 걸린 다리",
        "description_en": "An ONScripter web port playable in the browser. Saves are stored per user.",
        "thumbnail_path": "image/menu.jpg",
        "meta_title": "hoshizora",
        "display_order": 40,
    },
    {
        "slug": "grisaia-kajitsu",
        "title": "그리자이아의 과실",
        "folder_name": unicodedata.normalize("NFD", "그리자이아의 과실"),
        "asset_folder_name": unicodedata.normalize("NFD", "그리자이아의 과실_web"),
        "description_ko": "그리자이아의 과실",
        "description_en": "An ONScripter web port playable in the browser. Saves are stored per user.",
        "thumbnail_path": "title.png",
        "display_order": 50,
    },
]


BUMPERCAR_SKINS = [
    {
        "name": "default",
        "asset_source_name": "default",
        "preview_icon_name": "main",
        "skin_type": "classic",
        "display_name_ko": "스핔이",
        "display_name_en": "Spiky",
        "unlock_condition_ko": "기본 해금",
        "unlock_condition_en": "Available from the start.",
        "description_ko": "셰이디의 차원문에서 튀어나온\n정체불명의 생명체 입니다.\n\"스핔이 네르지 마세요!\"",
        "description_en": "A mysterious lifeform that jumped out of Shady's dimensional gate.\n\"Don't Spiky Ner!\"",
        "display_order": 10,
    },
    {
        "name": "happy",
        "asset_source_name": "happy",
        "preview_icon_name": "main",
        "skin_type": "classic",
        "display_name_ko": "행복한 스핔이",
        "display_name_en": "Happy Spiky",
        "unlock_condition_ko": "2시간 이상 게임 플레이",
        "unlock_condition_en": "Play for 2 hours.",
        "description_ko": "스핔이는 호박 친구를 찾으러 다닐 필요 없이\n교주와 노는게 더 즐겁다는 것을 깨달았습니다.\n\"늙은 유령처럼 교주님 방에서\n뒹굴거리며 노는게 더 편한거에요\"",
        "description_en": "Spiky no longer needs to wander around looking for the pumpkin friend.\nPlaying with the cult leader is much more fun.\n\"It's much comfier to roll around in the cult leader's room\nlike an old ghost.\"",
        "unlock_stat_key": "play_seconds",
        "unlock_threshold": 7200,
        "visual_scale": 1.14,
        "display_order": 20,
    },
    {
        "name": "double",
        "asset_source_name": "double",
        "fallback_sound_source_name": "default",
        "preview_icon_name": "main",
        "skin_type": "double",
        "display_name_ko": "쌍핔이",
        "display_name_en": "Twin Spiky",
        "unlock_condition_ko": "사망 20회",
        "unlock_condition_en": "Die 20 times.",
        "description_ko": "차원문을 넘느라 상태가 불안정한 스핔이가\n네르당해 둘으로 분열되었습니다.\n\"스핔이 네르지 마세요!\"\n\"스핔이 네르지 마세요!\"",
        "description_en": "An unstable Spiky split in two while crossing a dimensional gate.\n\"Don't Spiky Ner!\"\n\"Don't Spiky Ner!\"",
        "unlock_stat_key": "deaths",
        "unlock_threshold": 20,
        "display_order": 30,
    },
    {
        "name": "many",
        "asset_source_name": "many",
        "fallback_sound_source_name": "default",
        "preview_icon_name": "main",
        "skin_type": "many",
        "display_name_ko": "스핔이들",
        "display_name_en": "Spikies",
        "unlock_condition_ko": "개발 중",
        "unlock_condition_en": "In development",
        "description_ko": "심심한 스핔이는 친구를 잔뜩 만들었습니다.\n\"그래도 호박친구가 보고 싶은 거에요\"",
        "description_en": "A bored Spiky made a lot of friends.\n\"I still miss my pumpkin friend.\"",
        "admin_only": True,
        "display_order": 40,
    },
    {
        "name": "pumkin",
        "asset_source_name": "pumkin",
        "fallback_sound_source_name": "default",
        "preview_icon_name": "main",
        "skin_type": "pumkin",
        "display_name_ko": "호핔이",
        "display_name_en": "Hopiki",
        "unlock_condition_ko": "친구와 네르 쓰러트리기",
        "unlock_condition_en": "Defeat Ner with a friend.",
        "description_ko": "스핔이가 새 친구를 사귀었습니다.\n다른 스핔이에게 빼앗기지 않게 조심하세요! \"호박친구가 나중에 스핔이 만큼 커지면\n같이 수다 떨면서 노는 거에요\"",
        "description_en": "Spiky made a new friend.\nBe careful not to let another Spiky steal it! \"No way, I'm the real Spiky!\"",
        "unlock_stat_key": "max_ner_party_size",
        "unlock_threshold": 2,
        "display_order": 50,
    },
    {
        "name": "evolution",
        "asset_source_name": "evolution",
        "preview_icon_name": "main",
        "skin_type": "evolution",
        "display_name_ko": "스피키",
        "display_name_en": "Speaki",
        "unlock_condition_ko": "게임 클리어",
        "unlock_condition_en": "Clear the game.",
        "description_ko": "스핔이중 가장 강한 스핔이 만이 살아남아 이족보행으로 진화했습니다.\n\"호박친구하고 거리가 멀어진 거에요ㅠ\"",
        "description_en": "Only the strongest Spiky survived and evolved into bipedal form.\n\"I think I've grown apart from my pumpkin friend.\"",
        "unlock_stat_key": "game_clears",
        "unlock_threshold": 1,
        "disabled_game_slugs": ["raise-speaki"],
        "display_order": 60,
    },
]


BUMPERCAR_SETTINGS = {
    "user_base_speed_multiplier": 1.3,
    "user_boost_distance": 399.3,
    "user_boost_duration_ms": 1238,
    "user_post_boost_cooldown_ms": 3000,
    "user_lives": 3,
    "npc_base_speed_multiplier": 0.8042,
    "npc_max_health": 100,
    "npc_phase_two_health_ratio": 0.6,
    "npc_phase_three_health_ratio": 0.2,
    "npc_charge_trigger_distance": 150.0,
    "npc_charge_distance_multiplier": 2.5,
    "npc_extra_charge_distance_multiplier": 1.5,
    "npc_charge_windup_ms": 500,
    "npc_rest_ms": 1800,
    "npc_max_boost_speed_multiplier": 9.7902,
    "npc_boost_acceleration": 1400.0,
    "npc_boost_cooldown": 1100.0,
    "npc_respawn_delay_ms": 60000,
    "npc_damage_min": 1,
    "npc_damage_max": 10,
    "character_settings": {
        "default": {"base_speed_multiplier": 1.0, "max_boost_speed_multiplier": 1.2555, "max_health_segments": 3, "movement_type": "classic"},
        "happy": {"base_speed_multiplier": 1.0, "max_boost_speed_multiplier": 1.2555, "max_health_segments": 3, "movement_type": "classic"},
        "double": {"base_speed_multiplier": 1.0, "max_boost_speed_multiplier": 1.2555, "max_health_segments": 4, "movement_type": "classic"},
        "many": {"base_speed_multiplier": 1.0, "max_boost_speed_multiplier": 1.2555, "max_health_segments": 5, "movement_type": "classic"},
        "pumkin": {"base_speed_multiplier": 1.4, "max_boost_speed_multiplier": 1.137, "max_health_segments": 3, "movement_type": "classic"},
        "evolution": {"base_speed_multiplier": 0.8, "max_boost_speed_multiplier": 1.2555, "max_health_segments": 5, "movement_type": "evolution"},
    },
}


def seed_game_catalog_settings(apps, schema_editor):
    OnscripterGameConfig = apps.get_model("main", "OnscripterGameConfig")
    BumpercarSkin = apps.get_model("main", "BumpercarSkin")
    BumpercarGameplaySettings = apps.get_model("main", "BumpercarGameplaySettings")

    for item in ONSCRIPTER_GAMES:
        payload = dict(item)
        slug = payload.pop("slug")
        OnscripterGameConfig.objects.update_or_create(slug=slug, defaults=payload)

    for item in BUMPERCAR_SKINS:
        payload = dict(item)
        name = payload.pop("name")
        BumpercarSkin.objects.update_or_create(name=name, defaults=payload)

    BumpercarGameplaySettings.objects.update_or_create(
        singleton_key=1,
        defaults={"payload": BUMPERCAR_SETTINGS},
    )


def remove_seeded_game_catalog_settings(apps, schema_editor):
    apps.get_model("main", "OnscripterGameConfig").objects.filter(
        slug__in=[item["slug"] for item in ONSCRIPTER_GAMES]
    ).delete()
    apps.get_model("main", "BumpercarSkin").objects.filter(
        name__in=[item["name"] for item in BUMPERCAR_SKINS]
    ).delete()
    apps.get_model("main", "BumpercarGameplaySettings").objects.filter(singleton_key=1).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("main", "0059_game_catalog_settings"),
    ]

    operations = [
        migrations.RunPython(
            seed_game_catalog_settings,
            remove_seeded_game_catalog_settings,
        ),
    ]
