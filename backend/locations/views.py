from rest_framework import permissions, viewsets

from .models import City, Region
from .serializers import CitySerializer, RegionSerializer


class IsAdminOrReadOnly(permissions.BasePermission):
    def has_permission(self, request, view):
        if request.method in permissions.SAFE_METHODS:
            return True
        return request.user and request.user.is_staff


class RegionViewSet(viewsets.ModelViewSet):
    queryset = Region.objects.all()
    serializer_class = RegionSerializer
    permission_classes = [IsAdminOrReadOnly]


class CityViewSet(viewsets.ModelViewSet):
    queryset = City.objects.select_related("region").all()
    serializer_class = CitySerializer
    permission_classes = [IsAdminOrReadOnly]
