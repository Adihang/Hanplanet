from django.db import migrations


def update_evolution_skin_unlock(apps, schema_editor):
    BumpercarSkin = apps.get_model("main", "BumpercarSkin")
    BumpercarSkin.objects.filter(name="evolution").update(
        unlock_condition_ko="스핔이 키우기에서 승리",
        unlock_condition_en="Win in Raise Speaki.",
        unlock_stat_key="raise_speaki_wins",
        unlock_threshold=1,
    )


class Migration(migrations.Migration):

    dependencies = [
        ("main", "0064_minecraft_trade_npc_listing"),
    ]

    operations = [
        migrations.RunPython(update_evolution_skin_unlock, migrations.RunPython.noop),
    ]
