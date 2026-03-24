from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.CreateModel(
                    name="GitUserMapping",
                    fields=[
                        ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                        ("user", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL)),
                        ("forgejo_user_id", models.BigIntegerField()),
                        ("forgejo_username", models.CharField(max_length=255)),
                        ("forgejo_token", models.CharField(blank=True, default="", max_length=512)),
                    ],
                    options={"db_table": "main_gitusermapping"},
                ),
                migrations.CreateModel(
                    name="GitRepository",
                    fields=[
                        ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                        ("owner", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL)),
                        ("repo_name", models.CharField(max_length=255)),
                        ("forgejo_repo_id", models.BigIntegerField(blank=True, null=True)),
                        ("forgejo_owner", models.CharField(blank=True, max_length=255)),
                        ("forgejo_repo_name", models.CharField(blank=True, max_length=255)),
                        ("forgejo_clone_http_url", models.CharField(blank=True, max_length=1024)),
                        ("forgejo_clone_ssh_url", models.CharField(blank=True, max_length=1024)),
                        ("handrive_path", models.CharField(max_length=1024)),
                        ("status", models.CharField(choices=[("pending_create", "생성 중"), ("pending_import", "이관 중"), ("active", "활성"), ("failed", "실패"), ("deleted", "삭제됨")], default="pending_create", max_length=50)),
                        ("error_message", models.TextField(blank=True, null=True)),
                        ("created_at", models.DateTimeField(auto_now_add=True)),
                        ("updated_at", models.DateTimeField(auto_now=True)),
                    ],
                    options={"db_table": "main_gitrepository"},
                ),
                migrations.AlterUniqueTogether(
                    name="gitrepository",
                    unique_together={("handrive_path",), ("owner", "repo_name")},
                ),
                migrations.CreateModel(
                    name="GitCollaborator",
                    fields=[
                        ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                        ("repository", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="collaborators", to="git.gitrepository")),
                        ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL)),
                        ("permission", models.CharField(max_length=50)),
                    ],
                    options={"db_table": "main_gitcollaborator"},
                ),
                migrations.AlterUniqueTogether(
                    name="gitcollaborator",
                    unique_together={("repository", "user")},
                ),
                migrations.CreateModel(
                    name="GitDeviceCode",
                    fields=[
                        ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                        ("device_code", models.CharField(max_length=64, unique=True)),
                        ("user_code", models.CharField(max_length=16, unique=True)),
                        ("user", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to=settings.AUTH_USER_MODEL)),
                        ("expires_at", models.DateTimeField()),
                        ("approved", models.BooleanField(default=False)),
                        ("created_at", models.DateTimeField(auto_now_add=True)),
                    ],
                    options={"db_table": "main_gitdevicecode"},
                ),
            ],
            database_operations=[],
        ),
    ]
