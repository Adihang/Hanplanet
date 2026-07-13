from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("portfolio", "0003_portfolioprojectimage"),
    ]

    operations = [
        migrations.AddField(
            model_name="portfolioproject",
            name="project_url_name",
            field=models.CharField(blank=True, default="", max_length=120, verbose_name="URL 이름"),
        ),
        migrations.AddField(
            model_name="portfolioproject",
            name="project_url",
            field=models.URLField(blank=True, default="", max_length=500, verbose_name="URL"),
        ),
    ]
