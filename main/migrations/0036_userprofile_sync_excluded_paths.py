from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("main", "0035_syncuploadsession_syncfile_syncchangelog"),
    ]

    operations = [
        migrations.AddField(
            model_name="userprofile",
            name="sync_excluded_paths",
            field=models.JSONField(blank=True, default=list, verbose_name="HanDrive 동기화 제외 경로"),
        ),
    ]
