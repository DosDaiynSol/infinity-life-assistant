from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from rest_framework.routers import DefaultRouter
from accounts.auth import PhoneAuthTokenView

from accounts.views import UserViewSet
from catalog.views import CategoryViewSet
from listings.views import ListingImageViewSet, ListingViewSet
from locations.views import CityViewSet, RegionViewSet


router = DefaultRouter()
router.register("users", UserViewSet, basename="user")
router.register("regions", RegionViewSet, basename="region")
router.register("cities", CityViewSet, basename="city")
router.register("categories", CategoryViewSet, basename="category")
router.register("listings", ListingViewSet, basename="listing")
router.register("listing-images", ListingImageViewSet, basename="listing-image")


def health(request):
    return JsonResponse({"status": "ok"})


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include(router.urls)),
    path("api/auth/token/", PhoneAuthTokenView.as_view()),
    path("health/", health),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
