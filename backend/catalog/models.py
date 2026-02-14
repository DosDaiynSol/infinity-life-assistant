from django.core.exceptions import ValidationError
from django.db import models
from django.utils.text import slugify


class Category(models.Model):
    name = models.CharField(max_length=120)
    slug = models.SlugField(max_length=140, blank=True)
    parent = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="children",
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["parent", "name"], name="unique_category_per_parent"),
            models.UniqueConstraint(fields=["parent", "slug"], name="unique_category_slug_per_parent"),
        ]

    def clean(self):
        super().clean()
        if self.parent_id and self.parent_id == self.id:
            raise ValidationError({\"parent\": \"Category cannot be its own parent.\"})

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name
