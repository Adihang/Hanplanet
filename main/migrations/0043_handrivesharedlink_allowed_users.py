from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("main", "0042_wargamesolve_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="handrivesharedlink",
            name="allowed_users",
            field=models.ManyToManyField(
                blank=True,
                related_name="handrive_allowed_shared_links",
                to=settings.AUTH_USER_MODEL,
                verbose_name="공유 허용 사용자",
            ),
        ),
    ]
