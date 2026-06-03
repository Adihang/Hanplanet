from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("portfolio", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="PortfolioCoverLetter",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("company", models.CharField(max_length=120, verbose_name="회사명")),
                ("slug", models.CharField(max_length=180, verbose_name="URL 회사명")),
                ("name", models.CharField(max_length=120, verbose_name="이름")),
                ("content", models.TextField(verbose_name="내용")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="생성일")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="수정일")),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="portfolio_cover_letters",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="사용자",
                    ),
                ),
            ],
            options={
                "db_table": "main_portfoliocoverletter",
                "ordering": ["company", "id"],
                "verbose_name": "포트폴리오 자기소개서",
                "verbose_name_plural": "포트폴리오 자기소개서",
            },
        ),
        migrations.AddConstraint(
            model_name="portfoliocoverletter",
            constraint=models.UniqueConstraint(
                fields=("user", "slug"),
                name="unique_portfolio_cover_letter_slug_per_user",
            ),
        ),
    ]
