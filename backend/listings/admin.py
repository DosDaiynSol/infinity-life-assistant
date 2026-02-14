from django.contrib import admin

from .models import Listing, ListingImage


class ListingImageInline(admin.TabularInline):
    model = ListingImage
    extra = 0


@admin.register(Listing)
class ListingAdmin(admin.ModelAdmin):
    list_display = ["title", "owner", "status", "price_amount", "currency", "created_at"]
    list_filter = ["status", "currency", "region", "category"]
    search_fields = ["title", "owner__phone_number"]
    inlines = [ListingImageInline]


@admin.register(ListingImage)
class ListingImageAdmin(admin.ModelAdmin):
    list_display = ["listing", "is_primary", "sort_order", "created_at"]
    list_filter = ["is_primary"]
