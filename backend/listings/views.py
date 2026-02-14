from rest_framework import permissions, viewsets
from rest_framework.exceptions import PermissionDenied

from .models import Listing, ListingImage
from .serializers import ListingImageSerializer, ListingSerializer


class IsOwnerOrAdmin(permissions.BasePermission):
    def has_object_permission(self, request, view, obj):
        if request.method in permissions.SAFE_METHODS:
            return True
        owner_id = getattr(obj, "owner_id", None)
        if owner_id is None and hasattr(obj, "listing"):
            owner_id = obj.listing.owner_id
        return request.user and (request.user.is_staff or owner_id == request.user.id)


class ListingViewSet(viewsets.ModelViewSet):
    queryset = Listing.objects.select_related("category", "region", "city", "owner").prefetch_related("images")
    serializer_class = ListingSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly, IsOwnerOrAdmin]

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)


class ListingImageViewSet(viewsets.ModelViewSet):
    queryset = ListingImage.objects.select_related("listing", "listing__owner")
    serializer_class = ListingImageSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly, IsOwnerOrAdmin]

    def perform_create(self, serializer):
        listing = serializer.validated_data.get("listing")
        if not self.request.user.is_staff and listing.owner_id != self.request.user.id:
            raise PermissionDenied("You can only add images to your own listings.")
        serializer.save()
