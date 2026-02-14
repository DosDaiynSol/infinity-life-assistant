from django.contrib.auth import authenticate
from rest_framework import serializers
from rest_framework.authtoken.models import Token
from rest_framework.authtoken.views import ObtainAuthToken
from rest_framework.response import Response


class PhoneAuthTokenSerializer(serializers.Serializer):
    phone_number = serializers.CharField()
    password = serializers.CharField(style={"input_type": "password"})

    def validate(self, attrs):
        phone_number = attrs.get("phone_number")
        password = attrs.get("password")
        user = authenticate(phone_number=phone_number, password=password)
        if not user:
            raise serializers.ValidationError("Invalid phone number or password.")
        if not user.is_active:
            raise serializers.ValidationError("User account is disabled.")
        attrs["user"] = user
        return attrs


class PhoneAuthTokenView(ObtainAuthToken):
    serializer_class = PhoneAuthTokenSerializer

    def post(self, request, *args, **kwargs):
        serializer = self.serializer_class(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        token, _ = Token.objects.get_or_create(user=user)
        return Response({"token": token.key})
