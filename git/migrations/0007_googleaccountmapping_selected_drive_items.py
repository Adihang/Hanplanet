from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("git", "0006_googleaccountmapping_google_profile_synced_at"),
    ]

    operations = [
        migrations.AddField(
            model_name="googleaccountmapping",
            name="selected_drive_items",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
