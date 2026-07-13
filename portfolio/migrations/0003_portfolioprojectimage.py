from django.db import migrations, models
import django.db.models.deletion
import portfolio.models


class Migration(migrations.Migration):

    dependencies = [
        ("portfolio", "0002_portfoliocoverletter"),
    ]

    operations = [
        migrations.CreateModel(
            name="PortfolioProjectImage",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "image",
                    models.ImageField(
                        upload_to=portfolio.models.upload_to_portfolio_project_image,
                        verbose_name="프로젝트 이미지",
                    ),
                ),
                ("order", models.PositiveIntegerField(default=0, verbose_name="순서")),
                ("alt_text", models.CharField(blank=True, default="", max_length=255, verbose_name="대체 텍스트")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="생성일")),
                (
                    "project",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="project_images",
                        to="portfolio.portfolioproject",
                        verbose_name="프로젝트",
                    ),
                ),
            ],
            options={
                "db_table": "main_portfolioprojectimage",
                "ordering": ["order", "id"],
                "verbose_name": "포트폴리오 프로젝트 이미지",
                "verbose_name_plural": "포트폴리오 프로젝트 이미지",
            },
        ),
    ]
