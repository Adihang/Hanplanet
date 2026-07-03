from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("main", "0051_handrivesharedlink_can_edit"),
    ]

    operations = [
        migrations.AddField(
            model_name="userprofile",
            name="handrive_tutorial_completed",
            field=models.BooleanField(default=False, verbose_name="HanDrive 튜토리얼 완료"),
        ),
    ]
