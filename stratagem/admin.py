from django.contrib import admin

from .models import Stratagem, Stratagem_Class, Stratagem_Hero_Score


admin.site.register(Stratagem_Class)


@admin.register(Stratagem)
class StratagemAdmin(admin.ModelAdmin):
    list_display = ["name"]


@admin.register(Stratagem_Hero_Score)
class Stratagem_Hero_ScoreAdmin(admin.ModelAdmin):
    list_display = ["name"]
