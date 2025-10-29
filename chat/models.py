from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone


class UserProfile(models.Model):
    """Extended user profile with encryption keys."""
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    public_key = models.TextField(blank=True, null=True)  # Legacy RSA public key
    ecdh_public_key = models.TextField(blank=True, null=True)  # ECDH P-256 public key for key exchange
    created_at = models.DateTimeField(auto_now_add=True)
    last_seen = models.DateTimeField(default=timezone.now)
    
    def __str__(self):
        return f"{self.user.username}'s profile"
    
    class Meta:
        db_table = 'user_profiles'


class Message(models.Model):
    """Encrypted message model."""
    sender = models.ForeignKey(
        User, 
        on_delete=models.CASCADE, 
        related_name='sent_messages'
    )
    receiver = models.ForeignKey(
        User, 
        on_delete=models.CASCADE, 
        related_name='received_messages'
    )
    ciphertext = models.TextField()
    timestamp = models.DateTimeField(auto_now_add=True)
    is_read = models.BooleanField(default=False)
    key_version = models.IntegerField(default=1)  # For key rotation
    message_number = models.IntegerField(default=0)  # For per-message keys
    
    def __str__(self):
        return f"Message from {self.sender.username} to {self.receiver.username} at {self.timestamp}"
    
    class Meta:
        db_table = 'messages'
        ordering = ['timestamp']
        indexes = [
            models.Index(fields=['sender', 'receiver', 'timestamp']),
            models.Index(fields=['receiver', 'is_read']),
        ]


class ChatSession(models.Model):
    """Represents a chat session between two users."""
    user1 = models.ForeignKey(
        User, 
        on_delete=models.CASCADE, 
        related_name='chat_sessions_as_user1'
    )
    user2 = models.ForeignKey(
        User, 
        on_delete=models.CASCADE, 
        related_name='chat_sessions_as_user2'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    last_activity = models.DateTimeField(auto_now=True)
    
    def __str__(self):
        return f"Chat between {self.user1.username} and {self.user2.username}"
    
    class Meta:
        db_table = 'chat_sessions'
        unique_together = [['user1', 'user2']]
        ordering = ['-last_activity']


class LoginAttempt(models.Model):
    """Track login attempts for rate limiting."""
    username = models.CharField(max_length=150)
    ip_address = models.GenericIPAddressField()
    timestamp = models.DateTimeField(auto_now_add=True)
    successful = models.BooleanField(default=False)
    
    def __str__(self):
        return f"Login attempt for {self.username} from {self.ip_address}"
    
    class Meta:
        db_table = 'login_attempts'
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['username', 'timestamp']),
            models.Index(fields=['ip_address', 'timestamp']),
        ]


class SecurityLog(models.Model):
    """Log security-related events."""
    EVENT_TYPES = [
        ('LOGIN', 'Login'),
        ('LOGOUT', 'Logout'),
        ('FAILED_LOGIN', 'Failed Login'),
        ('RATE_LIMIT', 'Rate Limit Exceeded'),
        ('SUSPICIOUS', 'Suspicious Activity'),
        ('MESSAGE_SENT', 'Message Sent'),
        ('MESSAGE_RECEIVED', 'Message Received'),
    ]
    
    user = models.ForeignKey(
        User, 
        on_delete=models.SET_NULL, 
        null=True, 
        blank=True
    )
    event_type = models.CharField(max_length=20, choices=EVENT_TYPES)
    ip_address = models.GenericIPAddressField()
    user_agent = models.TextField(blank=True)
    description = models.TextField()
    timestamp = models.DateTimeField(auto_now_add=True)
    
    def __str__(self):
        return f"{self.event_type} - {self.timestamp}"
    
    class Meta:
        db_table = 'security_logs'
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['event_type', 'timestamp']),
            models.Index(fields=['user', 'timestamp']),
        ]
