from django.contrib import admin

from .models import (
    Career,
    Hobby,
    PortfolioActionButton,
    PortfolioCareer,
    PortfolioCoverLetter,
    PortfolioProfile,
    PortfolioProject,
    Project,
    Project_Tag,
)


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ["title", "title_en", "create_date"]
    fields = ["order", "title", "title_en", "banner_img", "tags", "content", "content_en", "create_date"]


admin.site.register(Project_Tag)


@admin.register(Career)
class CareerAdmin(admin.ModelAdmin):
    list_display = ["company", "company_en", "calculated_period", "join_date", "leave_date"]
    fields = ["order", "company", "company_en", "position", "content", "content_en", "join_date", "leave_date"]

    @admin.display(description="기간(자동 계산)")
    def calculated_period(self, obj):
        return obj.display_period


@admin.register(Hobby)
class HobbyAdmin(admin.ModelAdmin):
    list_display = ["title"]


@admin.register(PortfolioProfile)
class PortfolioProfileAdmin(admin.ModelAdmin):
    list_display = ["user", "phone", "email", "updated_at"]
    search_fields = ["user__username", "phone", "email", "main_title"]
    ordering = ["user__username"]


@admin.register(PortfolioCareer)
class PortfolioCareerAdmin(admin.ModelAdmin):
    list_display = ["user", "company", "position", "join_date", "leave_date", "order"]
    search_fields = ["user__username", "company", "position"]
    list_filter = ["user"]
    ordering = ["user__username", "-order", "-id"]


@admin.register(PortfolioProject)
class PortfolioProjectAdmin(admin.ModelAdmin):
    list_display = ["user", "number", "title", "create_date", "order"]
    search_fields = ["user__username", "title", "title_en"]
    list_filter = ["user"]
    ordering = ["user__username", "-create_date", "-id"]


@admin.register(PortfolioActionButton)
class PortfolioActionButtonAdmin(admin.ModelAdmin):
    list_display = ["user", "order", "label", "url", "updated_at"]
    search_fields = ["user__username", "label", "url"]
    list_filter = ["user"]
    ordering = ["user__username", "order", "id"]


@admin.register(PortfolioCoverLetter)
class PortfolioCoverLetterAdmin(admin.ModelAdmin):
    list_display = ["user", "company", "name", "slug", "updated_at"]
    search_fields = ["user__username", "company", "name", "content"]
    list_filter = ["user"]
    readonly_fields = ["slug", "created_at", "updated_at"]
    ordering = ["user__username", "company", "id"]
