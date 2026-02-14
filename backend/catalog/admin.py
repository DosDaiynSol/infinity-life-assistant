from django.contrib import admin

from .models import Category


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ["name", "parent", "slug", "is_active"]
    search_fields = ["name", "slug"]
    list_filter = ["is_active"]
