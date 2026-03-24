from django.db import migrations, models
import stratagem.models


class Migration(migrations.Migration):

    initial = True

    dependencies = []

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.CreateModel(
                    name="Stratagem_Class",
                    fields=[
                        ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                        ("gem_class", models.CharField(max_length=128, verbose_name="스트라타잼 분류")),
                    ],
                    options={"db_table": "main_stratagem_class"},
                ),
                migrations.CreateModel(
                    name="Stratagem",
                    fields=[
                        ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                        ("order", stratagem.models.OrderField(blank=True, null=True)),
                        ("name", models.CharField(max_length=200, verbose_name="이름")),
                        ("icon", models.FileField(upload_to=stratagem.models.upload_stratagem, verbose_name="아이콘")),
                        ("stratagem_class", models.ManyToManyField(to="stratagem.stratagem_class", verbose_name="스트라타잼 분류")),
                        ("command", models.IntegerField(verbose_name="Command")),
                    ],
                    options={"db_table": "main_stratagem", "ordering": ["order"]},
                ),
                migrations.CreateModel(
                    name="Stratagem_Hero_Score",
                    fields=[
                        ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                        ("name", models.CharField(max_length=128, verbose_name="이름")),
                        ("score", models.FloatField(verbose_name="점수")),
                    ],
                    options={"db_table": "main_stratagem_hero_score", "ordering": ["score"]},
                ),
                migrations.CreateModel(
                    name="Disciple_icon",
                    fields=[
                        ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                        ("name", models.CharField(max_length=200, verbose_name="이름")),
                        ("icon", models.FileField(upload_to=stratagem.models.upload_disciple_icon, verbose_name="아이콘")),
                    ],
                    options={"db_table": "main_disciple_icon"},
                ),
            ],
            database_operations=[],
        ),
    ]
