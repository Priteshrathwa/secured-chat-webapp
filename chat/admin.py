from django.contrib import admin
from .models import UserProfile, Message, ChatSession, LoginAttempt, SecurityLog


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ['user', 'created_at', 'last_seen']
    search_fields = ['user__username', 'user__email']
    list_filter = ['created_at', 'last_seen']
    readonly_fields = ['created_at']


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ['sender', 'receiver', 'timestamp', 'is_read']
    search_fields = ['sender__username', 'receiver__username']
    list_filter = ['timestamp', 'is_read']
    readonly_fields = ['timestamp']
    
    def has_change_permission(self, request, obj=None):
        # Messages should not be edited after creation
        return False


@admin.register(ChatSession)
class ChatSessionAdmin(admin.ModelAdmin):
    list_display = ['user1', 'user2', 'created_at', 'last_activity']
    search_fields = ['user1__username', 'user2__username']
    list_filter = ['created_at', 'last_activity']
    readonly_fields = ['created_at', 'last_activity']


@admin.register(LoginAttempt)
class LoginAttemptAdmin(admin.ModelAdmin):
    list_display = ['username', 'ip_address', 'timestamp', 'successful']
    search_fields = ['username', 'ip_address']
    list_filter = ['successful', 'timestamp']
    readonly_fields = ['timestamp']


@admin.register(SecurityLog)
class SecurityLogAdmin(admin.ModelAdmin):
    list_display = ['event_type', 'user', 'ip_address', 'timestamp']
    search_fields = ['user__username', 'ip_address', 'description']
    list_filter = ['event_type', 'timestamp']
    readonly_fields = ['timestamp']
    
    def has_add_permission(self, request):
        # Logs should only be created programmatically
        return False
    
    def has_change_permission(self, request, obj=None):
        # Logs should not be modified
        return False
