from django.contrib import admin

from .models import AITokenUsage


@admin.register(AITokenUsage)
class AITokenUsageAdmin(admin.ModelAdmin):
    list_display = ["created_at", "requester", "model_name", "prompt_tokens", "completion_tokens", "total_tokens", "is_stream", "is_estimated"]
    list_filter = ["model_name", "is_stream", "is_estimated", "user", "request_user"]
    search_fields = ["user__username", "request_user", "model_name"]
    ordering = ["-created_at"]
    date_hierarchy = "created_at"
    readonly_fields = ["user", "request_user", "model_name", "prompt_tokens", "completion_tokens", "total_tokens", "is_stream", "is_estimated", "created_at"]

    @admin.display(description="요청자", ordering="request_user")
    def requester(self, obj):
        return obj.request_user or getattr(obj.user, "username", "-")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
