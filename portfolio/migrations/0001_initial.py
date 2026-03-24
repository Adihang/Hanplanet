from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import portfolio.models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.CreateModel(
                    name="Project_Tag",
                    fields=[
                        ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                        ("tag", models.CharField(max_length=128, verbose_name="태그")),
                    ],
                    options={"db_table": "main_project_tag"},
                ),
                migrations.CreateModel(
                    name="Project",
                    fields=[
                        ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                        ("order", portfolio.models.OrderField(blank=True, null=True)),
                        ("title", models.CharField(max_length=200, verbose_name="제목")),
                        ("title_en", models.CharField(blank=True, default="", max_length=200, verbose_name="영문 제목")),
                        ("banner_img", models.ImageField(upload_to=portfolio.models.upload_to_project, verbose_name="대표 이미지")),
                        ("tags", models.ManyToManyField(to="portfolio.project_tag", verbose_name="태그")),
                        ("content", models.TextField(verbose_name="내용")),
                        ("content_en", models.TextField(blank=True, default="", verbose_name="영문 내용")),
                        ("create_date", models.DateField(verbose_name="날짜")),
                    ],
                    options={"db_table": "main_project", "ordering": ["order"]},
                ),
                migrations.CreateModel(
                    name="Project_Comment",
                    fields=[
                        ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                        ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="portfolio.project")),
                        ("content", models.TextField(verbose_name="내용")),
                        ("create_date", models.DateTimeField(verbose_name="날짜")),
                    ],
                    options={"db_table": "main_project_comment"},
                ),
                migrations.CreateModel(
                    name="Career",
                    fields=[
                        ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                        ("order", portfolio.models.OrderField(blank=True, null=True)),
                        ("company", models.CharField(max_length=128, verbose_name="회사")),
                        ("company_en", models.CharField(blank=True, default="", max_length=128, verbose_name="영문 회사")),
                        ("position", models.CharField(max_length=128, verbose_name="직책")),
                        ("content", models.TextField(verbose_name="업무")),
                        ("content_en", models.TextField(blank=True, default="", verbose_name="영문 업무")),
                        ("join_date", models.DateField(verbose_name="입사일")),
                        ("leave_date", models.DateField(blank=True, help_text="재직 중이면 비워두세요.", null=True, verbose_name="퇴사일")),
                    ],
                    options={"db_table": "main_career", "ordering": ["order"]},
                ),
                migrations.CreateModel(
                    name="Hobby",
                    fields=[
                        ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                        ("order", portfolio.models.OrderField(blank=True, null=True)),
                        ("title", models.CharField(max_length=200, verbose_name="제목")),
                        ("banner_img", models.ImageField(upload_to=portfolio.models.upload_to_project, verbose_name="대표 이미지")),
                        ("content", models.TextField(verbose_name="내용")),
                    ],
                    options={"db_table": "main_hobby", "ordering": ["order"]},
                ),
                migrations.CreateModel(
                    name="PortfolioProfile",
                    fields=[
                        ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                        ("user", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="portfolio_profile", to=settings.AUTH_USER_MODEL, verbose_name="사용자")),
                        ("profile_img", models.ImageField(blank=True, null=True, upload_to=portfolio.models.upload_to_portfolio_profile, verbose_name="프로필 사진")),
                        ("main_title", models.CharField(blank=True, default="", max_length=255, verbose_name="메인 타이틀")),
                        ("main_title_en", models.CharField(blank=True, default="", max_length=255, verbose_name="영문 메인 타이틀")),
                        ("phone", models.CharField(blank=True, default="", max_length=50, verbose_name="휴대폰번호")),
                        ("email", models.EmailField(blank=True, default="", verbose_name="이메일")),
                        ("main_subtitle", models.TextField(blank=True, default="", verbose_name="메인 소개")),
                        ("main_subtitle_en", models.TextField(blank=True, default="", verbose_name="영문 메인 소개")),
                        ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="생성일")),
                        ("updated_at", models.DateTimeField(auto_now=True, verbose_name="수정일")),
                    ],
                    options={"db_table": "main_portfolioprofile", "verbose_name": "포트폴리오 프로필", "verbose_name_plural": "포트폴리오 프로필"},
                ),
                migrations.CreateModel(
                    name="PortfolioCareer",
                    fields=[
                        ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                        ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="portfolio_careers", to=settings.AUTH_USER_MODEL, verbose_name="사용자")),
                        ("order", portfolio.models.OrderField(blank=True, null=True)),
                        ("company", models.CharField(max_length=128, verbose_name="회사")),
                        ("company_en", models.CharField(blank=True, default="", max_length=128, verbose_name="영문 회사")),
                        ("position", models.CharField(max_length=128, verbose_name="직책")),
                        ("content", models.TextField(verbose_name="업무")),
                        ("content_en", models.TextField(blank=True, default="", verbose_name="영문 업무")),
                        ("join_date", models.DateField(verbose_name="입사일")),
                        ("leave_date", models.DateField(blank=True, help_text="재직 중이면 비워두세요.", null=True, verbose_name="퇴사일")),
                    ],
                    options={"db_table": "main_portfoliocareer", "ordering": ["-order", "-id"], "verbose_name": "포트폴리오 경력", "verbose_name_plural": "포트폴리오 경력"},
                ),
                migrations.CreateModel(
                    name="PortfolioProject",
                    fields=[
                        ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                        ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="portfolio_projects", to=settings.AUTH_USER_MODEL, verbose_name="사용자")),
                        ("number", models.PositiveIntegerField(blank=True, null=True, verbose_name="프로젝트 번호")),
                        ("order", portfolio.models.OrderField(blank=True, null=True)),
                        ("title", models.CharField(max_length=200, verbose_name="제목")),
                        ("title_en", models.CharField(blank=True, default="", max_length=200, verbose_name="영문 제목")),
                        ("banner_img", models.ImageField(blank=True, null=True, upload_to=portfolio.models.upload_to_portfolio_project, verbose_name="대표 이미지")),
                        ("tags", models.ManyToManyField(blank=True, to="portfolio.project_tag", verbose_name="태그")),
                        ("content", models.TextField(verbose_name="내용")),
                        ("content_en", models.TextField(blank=True, default="", verbose_name="영문 내용")),
                        ("create_date", models.DateField(verbose_name="날짜")),
                    ],
                    options={"db_table": "main_portfolioproject", "ordering": ["-create_date", "-id"], "verbose_name": "포트폴리오 프로젝트", "verbose_name_plural": "포트폴리오 프로젝트"},
                ),
                migrations.AddConstraint(
                    model_name="portfolioproject",
                    constraint=models.UniqueConstraint(fields=("user", "number"), name="unique_portfolio_project_number_per_user"),
                ),
                migrations.CreateModel(
                    name="PortfolioActionButton",
                    fields=[
                        ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                        ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="portfolio_action_buttons", to=settings.AUTH_USER_MODEL, verbose_name="사용자")),
                        ("order", models.PositiveSmallIntegerField(default=1, verbose_name="순서")),
                        ("label", models.CharField(max_length=40, verbose_name="표시 텍스트")),
                        ("url", models.URLField(max_length=500, verbose_name="URL")),
                        ("icon_url", models.URLField(blank=True, default="", max_length=500, verbose_name="아이콘 URL")),
                        ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="생성일")),
                        ("updated_at", models.DateTimeField(auto_now=True, verbose_name="수정일")),
                    ],
                    options={"db_table": "main_portfolioactionbutton", "ordering": ["order", "id"], "verbose_name": "포트폴리오 액션 버튼", "verbose_name_plural": "포트폴리오 액션 버튼"},
                ),
                migrations.AddConstraint(
                    model_name="portfolioactionbutton",
                    constraint=models.UniqueConstraint(fields=("user", "order"), name="unique_portfolio_action_button_order_per_user"),
                ),
            ],
            database_operations=[],
        ),
    ]
