from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.utils import timezone

from catalog.models import Category
from locations.models import City, Region


class ListingCurrency(models.TextChoices):
    NAD = "NAD", "NAD"
    ZAR = "ZAR", "ZAR"


class ListingStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    ACTIVE = "active", "Active"
    SOLD = "sold", "Sold"
    ARCHIVED = "archived", "Archived"


STATUS_TRANSITIONS = {
    ListingStatus.DRAFT: {ListingStatus.ACTIVE, ListingStatus.ARCHIVED},
    ListingStatus.ACTIVE: {ListingStatus.SOLD, ListingStatus.ARCHIVED},
    ListingStatus.SOLD: {ListingStatus.ARCHIVED},
    ListingStatus.ARCHIVED: set(),
}


class Listing(models.Model):
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="listings",
    )
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    category = models.ForeignKey(Category, on_delete=models.PROTECT, related_name="listings")
    region = models.ForeignKey(Region, on_delete=models.PROTECT, related_name="listings")
    city = models.ForeignKey(City, on_delete=models.PROTECT, related_name="listings")
    price_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    currency = models.CharField(max_length=3, choices=ListingCurrency.choices, default=ListingCurrency.NAD)
    is_negotiable = models.BooleanField(default=False)
    status = models.CharField(max_length=12, choices=ListingStatus.choices, default=ListingStatus.DRAFT)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    published_at = models.DateTimeField(null=True, blank=True)
    sold_at = models.DateTimeField(null=True, blank=True)
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status"], name="listing_status_idx"),
            models.Index(fields=["category"], name="listing_category_idx"),
            models.Index(fields=["region"], name="listing_region_idx"),
            models.Index(fields=["city"], name="listing_city_idx"),
        ]
        constraints = [
            models.CheckConstraint(
                check=Q(price_amount__gte=0) | Q(price_amount__isnull=True),
                name="listing_price_non_negative",
            ),
        ]

    def clean(self):
        super().clean()
        if self.city_id and self.region_id and self.city.region_id != self.region_id:
            raise ValidationError({"city": "City must belong to the selected region."})
        if self.status in {ListingStatus.ACTIVE, ListingStatus.SOLD} and self.price_amount is None:
            raise ValidationError({"price_amount": "Price is required for active or sold listings."})

    def can_transition_to(self, new_status: str) -> bool:
        if new_status == self.status:
            return True
        return new_status in STATUS_TRANSITIONS.get(self.status, set())

    def _apply_status_timestamps(self, previous_status: str | None):
        now = timezone.now()
        if self.status == ListingStatus.ACTIVE and (previous_status != ListingStatus.ACTIVE):
            self.published_at = self.published_at or now
        if self.status == ListingStatus.SOLD and (previous_status != ListingStatus.SOLD):
            self.sold_at = self.sold_at or now
        if self.status == ListingStatus.ARCHIVED and (previous_status != ListingStatus.ARCHIVED):
            self.archived_at = self.archived_at or now

    def save(self, *args, **kwargs):
        previous_status = None
        if self.pk:
            previous_status = Listing.objects.filter(pk=self.pk).values_list("status", flat=True).first()
            if previous_status and previous_status != self.status:
                if not Listing(status=previous_status).can_transition_to(self.status):
                    raise ValidationError({"status": "Invalid status transition."})
        else:
            if self.status != ListingStatus.DRAFT:
                if not Listing(status=ListingStatus.DRAFT).can_transition_to(self.status):
                    raise ValidationError({"status": "Invalid status transition."})
        self.full_clean()
        self._apply_status_timestamps(previous_status)
        return super().save(*args, **kwargs)

    def __str__(self):
        return self.title


class ListingImage(models.Model):
    listing = models.ForeignKey(Listing, on_delete=models.CASCADE, related_name="images")
    image = models.ImageField(upload_to="listings/%Y/%m/%d/")
    sort_order = models.PositiveIntegerField(default=0)
    is_primary = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["sort_order", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["listing"],
                condition=Q(is_primary=True),
                name="unique_primary_listing_image",
            )
        ]

    def __str__(self):
        return f"Image for {self.listing_id}"
