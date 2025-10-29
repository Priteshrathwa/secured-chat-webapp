import logging
from django.utils.deprecation import MiddlewareMixin
from django.http import HttpResponseForbidden
from django.core.cache import cache
from django.utils import timezone

logger = logging.getLogger(__name__)


class SecurityHeadersMiddleware(MiddlewareMixin):
    """Add security headers to all responses."""
    
    def process_response(self, request, response):
        """Add security headers."""
        # Content Security Policy - Allow Bootstrap CDN
        response['Content-Security-Policy'] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com; "
            "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; "
            "img-src 'self' data: https:; "
            "font-src 'self' data: https://cdnjs.cloudflare.com; "
            "connect-src 'self' ws: wss:; "
            "frame-ancestors 'none';"
        )
        
        # X-Content-Type-Options
        response['X-Content-Type-Options'] = 'nosniff'
        
        # X-Frame-Options
        response['X-Frame-Options'] = 'DENY'
        
        # X-XSS-Protection
        response['X-XSS-Protection'] = '1; mode=block'
        
        # Referrer-Policy
        response['Referrer-Policy'] = 'strict-origin-when-cross-origin'
        
        # Permissions-Policy
        response['Permissions-Policy'] = (
            'geolocation=(), '
            'microphone=(), '
            'camera=()'
        )
        
        return response


class RateLimitMiddleware(MiddlewareMixin):
    """Rate limiting middleware to prevent abuse."""
    
    def process_request(self, request):
        """Check rate limits."""
        # Skip rate limiting for static files
        if request.path.startswith('/static/'):
            return None
        
        # Get client IP
        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded_for:
            ip = x_forwarded_for.split(',')[0]
        else:
            ip = request.META.get('REMOTE_ADDR')
        
        # Rate limit key
        cache_key = f'rate_limit_{ip}_{request.path}'
        
        # Get current request count
        request_count = cache.get(cache_key, 0)
        
        # Allow 100 requests per minute
        if request_count >= 100:
            logger.warning(f'Rate limit exceeded for IP {ip} on path {request.path}')
            return HttpResponseForbidden('Rate limit exceeded. Please try again later.')
        
        # Increment counter
        cache.set(cache_key, request_count + 1, 60)
        
        return None
