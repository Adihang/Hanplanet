from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("git", "0007_googleaccountmapping_selected_drive_items"),
    ]

    operations = [
        migrations.AddField(
            model_name="googleaccountmapping",
            name="google_drive_preference_set",
            field=models.BooleanField(default=False),
        ),
    ]
