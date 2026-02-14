import re
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.core.validators import RegexValidator
from django.db import models
from django.utils import timezone

PHONE_REGEX = r"^\+?[1-9]\d{7,14}$"
phone_validator = RegexValidator(
    PHONE_REGEX,
    "Phone number must be in E.164 format, e.g. +264XXXXXXXXX.",
)


def normalize_phone(value: str) -> str:
    if not value:
        return value
    value = value.strip()
    value = re.sub(r"[\s\-()]+", "", value)
    return value


class UserManager(BaseUserManager):
    def _create_user(self, phone_number, password, **extra_fields):
        if not phone_number:
            raise ValueError("Phone number must be set")
        phone_number = normalize_phone(phone_number)
        user = self.model(phone_number=phone_number, **extra_fields)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.full_clean()
        user.save(using=self._db)
        return user

    def create_user(self, phone_number, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(phone_number, password, **extra_fields)

    def create_superuser(self, phone_number, password, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        if extra_fields.get("is_staff") is not True:
            raise ValueError("Superuser must have is_staff=True")
        if extra_fields.get("is_superuser") is not True:
            raise ValueError("Superuser must have is_superuser=True")
        return self._create_user(phone_number, password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin):
    phone_number = models.CharField(
        max_length=20,
        unique=True,
        validators=[phone_validator],
    )
    email = models.EmailField(blank=True, null=True)
    first_name = models.CharField(max_length=150, blank=True)
    last_name = models.CharField(max_length=150, blank=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    date_joined = models.DateTimeField(default=timezone.now)

    objects = UserManager()

    USERNAME_FIELD = "phone_number"
    REQUIRED_FIELDS = []

    def clean(self):
        super().clean()
        if self.phone_number:
            self.phone_number = normalize_phone(self.phone_number)

    def __str__(self):
        return self.phone_number
