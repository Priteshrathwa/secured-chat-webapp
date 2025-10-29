from django.urls import path
from . import views

urlpatterns = [
    path('', views.index, name='index'),
    path('register/', views.register_view, name='register'),
    path('login/', views.login_view, name='login'),
    path('logout/', views.logout_view, name='logout'),
    path('chat/', views.chat_home, name='chat_home'),
    path('api/messages/<str:username>/', views.get_messages, name='get_messages'),
    path('api/public-key/<str:username>/', views.get_public_key, name='get_public_key'),
    path('api/ecdh-key/<str:username>/', views.ecdh_public_key, name='ecdh_public_key'),
    path('api/users/', views.user_list, name='user_list'),
    path('api/message/delete/<int:message_id>/', views.delete_message, name='delete_message'),
    path('api/conversation/delete/<str:username>/', views.delete_conversation, name='delete_conversation'),
]
