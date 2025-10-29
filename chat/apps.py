"""
Django app configuration for chat application
"""

from django.apps import AppConfig


class ChatConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'chat'
    verbose_name = 'Secure Chat'
    
    def ready(self):
        """
        Import signal handlers when app is ready
        """
        pass
