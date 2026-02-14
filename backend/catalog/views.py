from rest_framework import permissions, viewsets

from .models import Category
from .serializers import CategorySerializer


class IsAdminOrReadOnly(permissions.BasePermission):
    def has_permission(self, request, view):
        if request.method in permissions.SAFE_METHODS:
            return True
        return request.user and request.user.is_staff


class CategoryViewSet(viewsets.ModelViewSet):
    queryset = Category.objects.select_related("parent").all()
    serializer_class = CategorySerializer
    permission_classes = [IsAdminOrReadOnly]
