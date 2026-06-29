from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("main", "0047_userprofile_weather_location_label"),
    ]

    operations = [
        migrations.CreateModel(
            name="OnscripterAccessUser",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="등록일")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="수정일")),
                (
                    "user",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="onscripter_access",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="사용자",
                    ),
                ),
            ],
            options={
                "db_table": "main_onscripteraccessuser",
                "ordering": ["user__username"],
                "verbose_name": "ONScripter 허용 사용자",
                "verbose_name_plural": "ONScripter 허용 사용자",
            },
        ),
    ]
