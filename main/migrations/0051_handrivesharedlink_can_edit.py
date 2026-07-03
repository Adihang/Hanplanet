from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("main", "0050_userprofile_force_password_change"),
    ]

    operations = [
        migrations.AddField(
            model_name="handrivesharedlink",
            name="can_edit",
            field=models.BooleanField(default=False, verbose_name="편집 권한 허용"),
        ),
    ]
