from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("main", "0043_handrivesharedlink_allowed_users"),
    ]

    operations = [
        migrations.AddField(
            model_name="handrivesharedlink",
            name="allowed_usernames",
            field=models.JSONField(
                blank=True,
                default=list,
                verbose_name="공유 허용 사용자명",
            ),
        ),
    ]
