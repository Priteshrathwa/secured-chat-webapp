"""
Input validation and sanitization utilities.
"""

import html
import re
from django.core.validators import validate_email
from django.core.exceptions import ValidationError


def sanitize_input(input_string):
    """
    Sanitize user input to prevent XSS attacks.
    
    Args:
        input_string: User input string
    
    Returns:
        Sanitized string
    """
    if not input_string:
        return input_string
    
    # HTML escape
    sanitized = html.escape(str(input_string))
    
    # Remove any script tags
    sanitized = re.sub(r'<script[^>]*>.*?</script>', '', sanitized, flags=re.IGNORECASE | re.DOTALL)
    
    # Remove any event handlers
    sanitized = re.sub(r'on\w+\s*=\s*["\'][^"\']*["\']', '', sanitized, flags=re.IGNORECASE)
    
    return sanitized


def validate_username(username):
    """
    Validate username format.
    
    Args:
        username: Username string
    
    Returns:
        Boolean indicating if username is valid
    """
    if not username or len(username) < 3 or len(username) > 150:
        return False
    
    # Only allow alphanumeric and underscore
    if not re.match(r'^[a-zA-Z0-9_]+$', username):
        return False
    
    return True


def validate_email_address(email):
    """
    Validate email format.
    
    Args:
        email: Email string
    
    Returns:
        Boolean indicating if email is valid
    """
    try:
        validate_email(email)
        return True
    except ValidationError:
        return False


def validate_password_strength(password):
    """
    Validate password strength.
    
    Args:
        password: Password string
    
    Returns:
        Tuple of (is_valid, error_message)
    """
    if len(password) < 10:
        return False, "Password must be at least 10 characters long."
    
    if not re.search(r'[A-Z]', password):
        return False, "Password must contain at least one uppercase letter."
    
    if not re.search(r'[a-z]', password):
        return False, "Password must contain at least one lowercase letter."
    
    if not re.search(r'[0-9]', password):
        return False, "Password must contain at least one digit."
    
    if not re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
        return False, "Password must contain at least one special character."
    
    return True, ""


def sanitize_message(message):
    """
    Sanitize chat message content.
    
    Args:
        message: Message string
    
    Returns:
        Sanitized message
    """
    if not message:
        return message
    
    # Limit message length
    max_length = 5000
    message = message[:max_length]
    
    # Basic HTML escaping (messages should be encrypted anyway)
    message = html.escape(message)
    
    return message


def validate_ciphertext(ciphertext):
    """
    Validate encrypted message format.
    
    Args:
        ciphertext: Encrypted message string
    
    Returns:
        Boolean indicating if format is valid
    """
    if not ciphertext:
        return False
    
    # Check if it's valid base64
    try:
        import base64
        base64.b64decode(ciphertext)
        return True
    except Exception:
        return False


def get_client_ip(request):
    """
    Get client IP address from request.
    
    Args:
        request: Django request object
    
    Returns:
        IP address string
    """
    x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded_for:
        ip = x_forwarded_for.split(',')[0].strip()
    else:
        ip = request.META.get('REMOTE_ADDR', '0.0.0.0')
    
    return ip


def is_safe_redirect_url(url, allowed_hosts):
    """
    Check if redirect URL is safe.
    
    Args:
        url: URL to check
        allowed_hosts: List of allowed hostnames
    
    Returns:
        Boolean indicating if URL is safe
    """
    if not url:
        return False
    
    # Only allow relative URLs or URLs from allowed hosts
    if url.startswith('/'):
        return True
    
    from urllib.parse import urlparse
    parsed = urlparse(url)
    
    return parsed.netloc in allowed_hosts
