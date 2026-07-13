import calendar
import re
import unicodedata
import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

from config.utils import build_model_field_upload_path, build_user_profile_upload_path, make_new_path


class OrderField(models.PositiveIntegerField):
    def __init__(self, *args, **kwargs):
        kwargs["blank"] = True
        kwargs["null"] = True
        super().__init__(*args, **kwargs)


def upload_to_project(instance, filename):
    return make_new_path(
        path_ext=filename,
        dirname="uploads/contents/project",
        new_filename=str(uuid.uuid4().hex),
    )


def upload_to_portfolio_profile(instance, filename):
    username = getattr(getattr(instance, "user", None), "username", "") or "anon"
    return build_user_profile_upload_path(username, filename)


def upload_to_portfolio_project(instance, filename):
    username = getattr(getattr(instance, "user", None), "username", "") or "anon"
    return build_model_field_upload_path(username, "portfolioproject", "banner_img", filename)


def upload_to_portfolio_project_image(instance, filename):
    project = getattr(instance, "project", None)
    username = getattr(getattr(project, "user", None), "username", "") or "anon"
    return build_model_field_upload_path(username, "portfolioproject", "project_images", filename)


class Project_Tag(models.Model):
    tag = models.CharField("태그", max_length=128)

    class Meta:
        db_table = "main_project_tag"

    def __str__(self):
        return self.tag


class Project(models.Model):
    order = OrderField()
    title = models.CharField("제목", max_length=200)
    title_en = models.CharField("영문 제목", max_length=200, blank=True, default="")
    banner_img = models.ImageField("대표 이미지", upload_to=upload_to_project)
    tags = models.ManyToManyField(Project_Tag, verbose_name="태그")
    content = models.TextField("내용")
    content_en = models.TextField("영문 내용", blank=True, default="")
    create_date = models.DateField("날짜")

    class Meta:
        db_table = "main_project"
        ordering = ["order"]

    def get_absolute_url(self):
        return f"/project/{self.id}/"


class Project_Comment(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE)
    content = models.TextField("내용")
    create_date = models.DateTimeField("날짜")

    class Meta:
        db_table = "main_project_comment"


class Career(models.Model):
    order = OrderField()
    company = models.CharField("회사", max_length=128)
    company_en = models.CharField("영문 회사", max_length=128, blank=True, default="")
    position = models.CharField("직책", max_length=128)
    content = models.TextField("업무")
    content_en = models.TextField("영문 업무", blank=True, default="")
    join_date = models.DateField("입사일")
    leave_date = models.DateField("퇴사일", blank=True, null=True, help_text="재직 중이면 비워두세요.")

    class Meta:
        db_table = "main_career"
        ordering = ["order"]

    @property
    def is_currently_employed(self):
        return self.leave_date is None

    @property
    def effective_leave_date(self):
        return timezone.localdate() if self.is_currently_employed else self.leave_date

    @staticmethod
    def _calculate_date_delta(start_date, end_date):
        if not start_date or not end_date or end_date < start_date:
            return 0, 0, 0
        years = end_date.year - start_date.year
        months = end_date.month - start_date.month
        days = end_date.day - start_date.day
        if days < 0:
            months -= 1
            prev_month = 12 if end_date.month == 1 else end_date.month - 1
            prev_year = end_date.year - 1 if end_date.month == 1 else end_date.year
            days += calendar.monthrange(prev_year, prev_month)[1]
        if months < 0:
            years -= 1
            months += 12
        return max(years, 0), max(months, 0), max(days, 0)

    @classmethod
    def _format_period_ko(cls, start_date, end_date):
        years, months, days = cls._calculate_date_delta(start_date, end_date)
        parts = []
        if years:
            parts.append(f"{years}년")
        if months:
            parts.append(f"{months}개월")
        if days or not parts:
            parts.append(f"{days}일")
        return " ".join(parts)

    @classmethod
    def _format_period_en(cls, start_date, end_date):
        years, months, days = cls._calculate_date_delta(start_date, end_date)
        parts = []
        if years:
            parts.append(f"{years}y")
        if months:
            parts.append(f"{months}m")
        if days or not parts:
            parts.append(f"{days}d")
        return " ".join(parts)

    @property
    def display_period(self):
        return self._format_period_ko(self.join_date, self.effective_leave_date)

    @property
    def display_period_en(self):
        return self._format_period_en(self.join_date, self.effective_leave_date)

    @classmethod
    def _calculate_rounded_month_period(cls, start_date, end_date):
        years, months, days = cls._calculate_date_delta(start_date, end_date)
        if days >= 15:
            months += 1
        if months >= 12:
            years += months // 12
            months = months % 12
        return years, months

    @property
    def display_period_rounded(self):
        years, months = self._calculate_rounded_month_period(self.join_date, self.effective_leave_date)
        parts = []
        if years:
            parts.append(f"{years}년")
        if months:
            parts.append(f"{months}개월")
        if not parts:
            return "0개월"
        return " ".join(parts)

    @property
    def display_period_en_rounded(self):
        years, months = self._calculate_rounded_month_period(self.join_date, self.effective_leave_date)
        parts = []
        if years:
            parts.append(f"{years} year")
        if months:
            parts.append(f"{months} month")
        if not parts:
            return "0 month"
        return " ".join(parts)

    @staticmethod
    def _format_korean_date(value):
        if not value:
            return ""
        return f"{value.year}년 {value.month}월 {value.day}일"

    @property
    def formatted_join_date(self):
        return self._format_korean_date(self.join_date)

    @property
    def formatted_leave_date(self):
        return self._format_korean_date(self.effective_leave_date)

    @property
    def formatted_date_range(self):
        return f"{self.formatted_join_date} ~ {self.formatted_leave_date}"


class Hobby(models.Model):
    order = OrderField()
    title = models.CharField("제목", max_length=200)
    banner_img = models.ImageField("대표 이미지", upload_to=upload_to_project)
    content = models.TextField("내용")

    class Meta:
        db_table = "main_hobby"
        ordering = ["order"]


class PortfolioProfile(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="portfolio_profile",
        verbose_name="사용자",
    )
    profile_img = models.ImageField("프로필 사진", upload_to=upload_to_portfolio_profile, blank=True, null=True)
    main_title = models.CharField("메인 타이틀", max_length=255, blank=True, default="")
    main_title_en = models.CharField("영문 메인 타이틀", max_length=255, blank=True, default="")
    phone = models.CharField("휴대폰번호", max_length=50, blank=True, default="")
    email = models.EmailField("이메일", blank=True, default="")
    main_subtitle = models.TextField("메인 소개", blank=True, default="")
    main_subtitle_en = models.TextField("영문 메인 소개", blank=True, default="")
    created_at = models.DateTimeField("생성일", auto_now_add=True)
    updated_at = models.DateTimeField("수정일", auto_now=True)

    class Meta:
        db_table = "main_portfolioprofile"
        verbose_name = "포트폴리오 프로필"
        verbose_name_plural = "포트폴리오 프로필"

    def __str__(self):
        return f"{self.user} 포트폴리오"


class PortfolioCareer(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="portfolio_careers",
        verbose_name="사용자",
    )
    order = OrderField()
    company = models.CharField("회사", max_length=128)
    company_en = models.CharField("영문 회사", max_length=128, blank=True, default="")
    position = models.CharField("직책", max_length=128)
    content = models.TextField("업무")
    content_en = models.TextField("영문 업무", blank=True, default="")
    join_date = models.DateField("입사일")
    leave_date = models.DateField("퇴사일", blank=True, null=True, help_text="재직 중이면 비워두세요.")

    class Meta:
        db_table = "main_portfoliocareer"
        ordering = ["-order", "-id"]
        verbose_name = "포트폴리오 경력"
        verbose_name_plural = "포트폴리오 경력"

    @property
    def is_currently_employed(self):
        return self.leave_date is None

    @property
    def effective_leave_date(self):
        return timezone.localdate() if self.is_currently_employed else self.leave_date

    @classmethod
    def _calculate_rounded_month_period(cls, start_date, end_date):
        if not start_date or not end_date or end_date < start_date:
            return 0, 0
        years = end_date.year - start_date.year
        months = end_date.month - start_date.month
        days = end_date.day - start_date.day
        if days >= 15:
            months += 1
        if months < 0:
            years -= 1
            months += 12
        if months >= 12:
            years += months // 12
            months = months % 12
        return max(years, 0), max(months, 0)

    @property
    def display_period_rounded(self):
        years, months = self._calculate_rounded_month_period(self.join_date, self.effective_leave_date)
        parts = []
        if years:
            parts.append(f"{years}년")
        if months:
            parts.append(f"{months}개월")
        if not parts:
            return "0개월"
        return " ".join(parts)

    @property
    def display_period_en_rounded(self):
        years, months = self._calculate_rounded_month_period(self.join_date, self.effective_leave_date)
        parts = []
        if years:
            parts.append(f"{years} year")
        if months:
            parts.append(f"{months} month")
        if not parts:
            return "0 month"
        return " ".join(parts)

    @staticmethod
    def _format_korean_date(value):
        if not value:
            return ""
        return f"{value.year}년 {value.month}월 {value.day}일"

    @property
    def formatted_join_date(self):
        return self._format_korean_date(self.join_date)

    @property
    def formatted_leave_date(self):
        return self._format_korean_date(self.effective_leave_date)

    @property
    def formatted_date_range(self):
        return f"{self.formatted_join_date} ~ {self.formatted_leave_date}"

    def __str__(self):
        return f"{self.user} - {self.company}"


class PortfolioProject(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="portfolio_projects",
        verbose_name="사용자",
    )
    number = models.PositiveIntegerField("프로젝트 번호", blank=True, null=True)
    order = OrderField()
    title = models.CharField("제목", max_length=200)
    title_en = models.CharField("영문 제목", max_length=200, blank=True, default="")
    banner_img = models.ImageField("대표 이미지", upload_to=upload_to_portfolio_project, blank=True, null=True)
    tags = models.ManyToManyField(Project_Tag, verbose_name="태그", blank=True)
    organization = models.CharField("소속", max_length=160, blank=True, default="")
    organization_url = models.URLField("소속 URL", max_length=500, blank=True, default="")
    position = models.CharField("직책", max_length=160, blank=True, default="")
    project_url_name = models.CharField("URL 이름", max_length=120, blank=True, default="")
    project_url = models.URLField("URL", max_length=500, blank=True, default="")
    content = models.TextField("내용")
    content_en = models.TextField("영문 내용", blank=True, default="")
    create_date = models.DateField("날짜")

    class Meta:
        db_table = "main_portfolioproject"
        ordering = ["-create_date", "-id"]
        constraints = [
            models.UniqueConstraint(fields=["user", "number"], name="unique_portfolio_project_number_per_user"),
        ]
        verbose_name = "포트폴리오 프로젝트"
        verbose_name_plural = "포트폴리오 프로젝트"

    def save(self, *args, **kwargs):
        if self.number is None:
            max_number = (
                PortfolioProject.objects.filter(user=self.user)
                .aggregate(max_value=models.Max("number"))
                .get("max_value")
                or 0
            )
            self.number = max_number + 1
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.user} - #{self.number} {self.title}"


class PortfolioProjectImage(models.Model):
    project = models.ForeignKey(
        PortfolioProject,
        on_delete=models.CASCADE,
        related_name="project_images",
        verbose_name="프로젝트",
    )
    image = models.ImageField("프로젝트 이미지", upload_to=upload_to_portfolio_project_image, blank=True, default="")
    external_url = models.URLField("외부 이미지 URL", max_length=800, blank=True, default="")
    order = models.PositiveIntegerField("순서", default=0)
    alt_text = models.CharField("대체 텍스트", max_length=255, blank=True, default="")
    created_at = models.DateTimeField("생성일", auto_now_add=True)

    class Meta:
        db_table = "main_portfolioprojectimage"
        ordering = ["order", "id"]
        verbose_name = "포트폴리오 프로젝트 이미지"
        verbose_name_plural = "포트폴리오 프로젝트 이미지"

    def __str__(self):
        return f"{self.project} image #{self.order or self.id}"

    @property
    def display_url(self):
        if self.external_url:
            return self.external_url
        if self.image:
            return self.image.url
        return ""


class PortfolioActionButton(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="portfolio_action_buttons",
        verbose_name="사용자",
    )
    order = models.PositiveSmallIntegerField("순서", default=1)
    label = models.CharField("표시 텍스트", max_length=40)
    url = models.URLField("URL", max_length=500)
    icon_url = models.URLField("아이콘 URL", max_length=500, blank=True, default="")
    created_at = models.DateTimeField("생성일", auto_now_add=True)
    updated_at = models.DateTimeField("수정일", auto_now=True)

    class Meta:
        db_table = "main_portfolioactionbutton"
        ordering = ["order", "id"]
        constraints = [
            models.UniqueConstraint(fields=["user", "order"], name="unique_portfolio_action_button_order_per_user"),
        ]
        verbose_name = "포트폴리오 액션 버튼"
        verbose_name_plural = "포트폴리오 액션 버튼"

    def __str__(self):
        return f"{self.user} - {self.label}"


class PortfolioCoverLetter(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="portfolio_cover_letters",
        verbose_name="사용자",
    )
    company = models.CharField("회사명", max_length=120)
    slug = models.CharField("URL 회사명", max_length=180)
    name = models.CharField("이름", max_length=120)
    content = models.TextField("내용")
    created_at = models.DateTimeField("생성일", auto_now_add=True)
    updated_at = models.DateTimeField("수정일", auto_now=True)

    class Meta:
        db_table = "main_portfoliocoverletter"
        ordering = ["company", "id"]
        constraints = [
            models.UniqueConstraint(fields=["user", "slug"], name="unique_portfolio_cover_letter_slug_per_user"),
        ]
        verbose_name = "포트폴리오 자기소개서"
        verbose_name_plural = "포트폴리오 자기소개서"

    @staticmethod
    def build_slug(company):
        value = unicodedata.normalize("NFKC", str(company or "")).strip()
        value = re.sub(r"[\\/#?]+", "-", value)
        value = re.sub(r"\s+", "-", value)
        value = re.sub(r"-{2,}", "-", value).strip(" .-")
        return (value or "coverletter")[:180]

    def save(self, *args, **kwargs):
        self.company = str(self.company or "").strip()
        self.name = str(self.name or "").strip()
        self.slug = self.build_slug(self.company)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.user} - {self.company}"
