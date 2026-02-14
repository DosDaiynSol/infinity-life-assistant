from django.db import models
from django.utils.text import slugify


class Region(models.Model):
    name = models.CharField(max_length=100, unique=True)
    slug = models.SlugField(max_length=120, unique=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class City(models.Model):
    region = models.ForeignKey(Region, on_delete=models.CASCADE, related_name="cities")
    name = models.CharField(max_length=100)
    slug = models.SlugField(max_length=120, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["region", "name"], name="unique_city_per_region"),
            models.UniqueConstraint(fields=["region", "slug"], name="unique_city_slug_per_region"),
        ]

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.name}, {self.region.name}"
