from rest_framework import serializers

from .models import Listing, ListingImage


class ListingImageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ListingImage
        fields = ["id", "listing", "image", "sort_order", "is_primary", "created_at"]
        read_only_fields = ["id", "created_at"]


class ListingSerializer(serializers.ModelSerializer):
    owner = serializers.PrimaryKeyRelatedField(read_only=True)
    images = ListingImageSerializer(many=True, read_only=True)

    class Meta:
        model = Listing
        fields = [
            "id",
            "owner",
            "title",
            "description",
            "category",
            "region",
            "city",
            "price_amount",
            "currency",
            "is_negotiable",
            "status",
            "created_at",
            "updated_at",
            "published_at",
            "sold_at",
            "archived_at",
            "images",
        ]
        read_only_fields = [
            "id",
            "created_at",
            "updated_at",
            "published_at",
            "sold_at",
            "archived_at",
            "images",
        ]
