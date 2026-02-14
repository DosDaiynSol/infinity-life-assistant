from rest_framework import serializers

from .models import City, Region


class RegionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Region
        fields = ["id", "name", "slug"]
        read_only_fields = ["id", "slug"]


class CitySerializer(serializers.ModelSerializer):
    class Meta:
        model = City
        fields = ["id", "region", "name", "slug"]
        read_only_fields = ["id", "slug"]
