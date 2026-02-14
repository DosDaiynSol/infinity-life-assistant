from rest_framework import permissions, viewsets

from .serializers import UserCreateSerializer, UserSerializer
from django.contrib.auth import get_user_model

User = get_user_model()


class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all().order_by("id")

    def get_permissions(self):
        if self.action == "create":
            return [permissions.AllowAny()]
        return [permissions.IsAuthenticated()]

    def get_serializer_class(self):
        if self.action == "create":
            return UserCreateSerializer
        return UserSerializer

    def get_queryset(self):
        if self.request.user.is_staff:
            return User.objects.all().order_by("id")
        return User.objects.filter(id=self.request.user.id)
