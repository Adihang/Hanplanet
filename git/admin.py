from django.contrib import admin

from .models import GitCollaborator, GitHubAccountMapping, GitRepository, GitUserMapping, GoogleAccountMapping


@admin.register(GitUserMapping)
class GitUserMappingAdmin(admin.ModelAdmin):
    list_display = ["user", "forgejo_username", "forgejo_user_id"]
    search_fields = ["user__username", "forgejo_username"]


@admin.register(GitHubAccountMapping)
class GitHubAccountMappingAdmin(admin.ModelAdmin):
    list_display = ["user", "github_login", "github_user_id", "github_email", "updated_at"]
    search_fields = ["user__username", "github_login", "github_email"]
    readonly_fields = ["created_at", "updated_at"]


@admin.register(GoogleAccountMapping)
class GoogleAccountMappingAdmin(admin.ModelAdmin):
    list_display = ["user", "google_email", "google_user_id", "google_drive_enabled", "updated_at"]
    list_filter = ["google_drive_enabled"]
    search_fields = ["user__username", "google_email", "google_user_id"]
    readonly_fields = ["created_at", "updated_at"]


@admin.register(GitRepository)
class GitRepositoryAdmin(admin.ModelAdmin):
    list_display = ["owner", "repo_name", "status", "handrive_path", "created_at", "updated_at"]
    list_filter = ["status"]
    search_fields = ["owner__username", "repo_name", "handrive_path"]
    readonly_fields = ["forgejo_repo_id", "forgejo_clone_http_url", "forgejo_clone_ssh_url", "created_at", "updated_at"]
    ordering = ["-created_at"]


@admin.register(GitCollaborator)
class GitCollaboratorAdmin(admin.ModelAdmin):
    list_display = ["repository", "user", "permission"]
    list_filter = ["permission"]
    search_fields = ["repository__repo_name", "user__username"]
