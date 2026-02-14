from django.contrib import admin

from .models import City, Region


@admin.register(Region)
class RegionAdmin(admin.ModelAdmin):
    list_display = ["name", "slug", "created_at"]
    search_fields = ["name", "slug"]


@admin.register(City)
class CityAdmin(admin.ModelAdmin):
    list_display = ["name", "region", "slug", "created_at"]
    search_fields = ["name", "slug", "region__name"]
    list_filter = ["region"]
