from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("git", "0005_googleaccountmapping_google_drive_enabled"),
    ]

    operations = [
        migrations.AddField(
            model_name="googleaccountmapping",
            name="google_profile_synced_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
