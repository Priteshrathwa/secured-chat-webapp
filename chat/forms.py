from django import forms
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
import re


class RegistrationForm(forms.Form):
    """User registration form with validation."""
    username = forms.CharField(
        max_length=150,
        min_length=3,
        widget=forms.TextInput(attrs={
            'class': 'form-control',
            'placeholder': 'Username',
            'required': True
        })
    )
    email = forms.EmailField(
        widget=forms.EmailInput(attrs={
            'class': 'form-control',
            'placeholder': 'Email',
            'required': True
        })
    )
    password = forms.CharField(
        min_length=8,
        widget=forms.PasswordInput(attrs={
            'class': 'form-control',
            'placeholder': 'Password (min 8 characters)',
            'required': True
        })
    )
    confirm_password = forms.CharField(
        widget=forms.PasswordInput(attrs={
            'class': 'form-control',
            'placeholder': 'Confirm Password',
            'required': True
        })
    )
    
    def clean_username(self):
        """Validate username."""
        username = self.cleaned_data.get('username')
        
        # Check if username already exists
        if User.objects.filter(username=username).exists():
            raise ValidationError('Username already exists.')
        
        # Check for valid characters
        if not re.match(r'^[a-zA-Z0-9_]+$', username):
            raise ValidationError('Username can only contain letters, numbers, and underscores.')
        
        return username
    
    def clean_email(self):
        """Validate email."""
        email = self.cleaned_data.get('email')
        
        if User.objects.filter(email=email).exists():
            raise ValidationError('Email already registered.')
        
        return email
    
    def clean_password(self):
        """Validate password strength."""
        password = self.cleaned_data.get('password')
        
        # Check password complexity
        if not re.search(r'[A-Z]', password):
            raise ValidationError('Password must contain at least one uppercase letter.')
        
        if not re.search(r'[a-z]', password):
            raise ValidationError('Password must contain at least one lowercase letter.')
        
        if not re.search(r'[0-9]', password):
            raise ValidationError('Password must contain at least one digit.')
        
        if not re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
            raise ValidationError('Password must contain at least one special character.')
        
        return password
    
    def clean(self):
        """Validate password confirmation."""
        cleaned_data = super().clean()
        password = cleaned_data.get('password')
        confirm_password = cleaned_data.get('confirm_password')
        
        if password and confirm_password and password != confirm_password:
            raise ValidationError('Passwords do not match.')
        
        return cleaned_data


class LoginForm(forms.Form):
    """User login form."""
    username = forms.CharField(
        max_length=150,
        widget=forms.TextInput(attrs={
            'class': 'form-control',
            'placeholder': 'Username',
            'required': True
        })
    )
    password = forms.CharField(
        widget=forms.PasswordInput(attrs={
            'class': 'form-control',
            'placeholder': 'Password',
            'required': True
        })
    )
