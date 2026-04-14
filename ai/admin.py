from django.contrib import admin

from .models import AITokenUsage


@admin.register(AITokenUsage)
class AITokenUsageAdmin(admin.ModelAdmin):
    list_display = ["created_at", "user", "model_name", "prompt_tokens", "completion_tokens", "total_tokens", "is_stream"]
    list_filter = ["model_name", "is_stream", "user"]
    search_fields = ["user__username", "model_name"]
    ordering = ["-created_at"]
    date_hierarchy = "created_at"
    readonly_fields = ["user", "model_name", "prompt_tokens", "completion_tokens", "total_tokens", "is_stream", "created_at"]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
