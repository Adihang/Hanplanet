from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("main", "0044_handrivesharedlink_allowed_usernames"),
    ]

    operations = [
        migrations.CreateModel(
            name="EmailTwoFactorBypassUser",
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
                        related_name="email_2fa_bypass",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="사용자",
                    ),
                ),
            ],
            options={
                "verbose_name": "이메일 2차 인증 생략 사용자",
                "verbose_name_plural": "이메일 2차 인증 생략 사용자",
                "db_table": "main_emailtwofactorbypassuser",
                "ordering": ["user__username"],
            },
        ),
    ]
