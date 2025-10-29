from django.shortcuts import render, redirect
from django.contrib.auth import login, logout, authenticate
from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.views.decorators.http import require_http_methods
from django.http import JsonResponse
from django.db.models import Q
from django.utils import timezone
from django.contrib import messages
import logging
import bcrypt
import json

from .models import Message, UserProfile, LoginAttempt, SecurityLog, ChatSession
from .forms import RegistrationForm, LoginForm
from .utils.encryption import EncryptionManager
from .utils.validators import sanitize_input

logger = logging.getLogger(__name__)

def get_client_ip(request):
    """Get client IP address."""
    x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded_for:
        ip = x_forwarded_for.split(',')[0]
    else:
        ip = request.META.get('REMOTE_ADDR')
    return ip


def log_security_event(user, event_type, request, description):
    """Log security event."""
    try:
        SecurityLog.objects.create(
            user=user,
            event_type=event_type,
            ip_address=get_client_ip(request),
            user_agent=request.META.get('HTTP_USER_AGENT', ''),
            description=description
        )
    except Exception as e:
        logger.error(f"Failed to log security event: {str(e)}")


def index(request):
    """Homepage view."""
    if request.user.is_authenticated:
        return redirect('chat_home')
    return render(request, 'chat/index.html')


@require_http_methods(["GET", "POST"])
def register_view(request):
    """User registration view."""
    if request.user.is_authenticated:
        return redirect('chat_home')
    
    if request.method == 'POST':
        form = RegistrationForm(request.POST)
        if form.is_valid():
            # Create user
            username = sanitize_input(form.cleaned_data['username'])
            email = sanitize_input(form.cleaned_data['email'])
            password = form.cleaned_data['password']
            
            # Hash password with bcrypt
            hashed_password = bcrypt.hashpw(
                password.encode('utf-8'), 
                bcrypt.gensalt()
            ).decode('utf-8')
            
            user = User.objects.create_user(
                username=username,
                email=email,
                password=password  # Django will hash it again
            )
            
            # Create user profile with encryption keys
            encryption_manager = EncryptionManager()
            public_key, private_key = encryption_manager.generate_rsa_key_pair()
            
            UserProfile.objects.create(
                user=user,
                public_key=public_key
            )
            
            # Log the registration
            log_security_event(user, 'LOGIN', request, 'User registered')
            
            # Log in the user
            login(request, user)
            messages.success(request, 'Registration successful! Welcome to Secure Chat.')
            
            return redirect('chat_home')
    else:
        form = RegistrationForm()
    
    return render(request, 'chat/register.html', {'form': form})


@require_http_methods(["GET", "POST"])
def login_view(request):
    """User login view."""
    if request.user.is_authenticated:
        return redirect('chat_home')
    
    if request.method == 'POST':
        form = LoginForm(request.POST)
        if form.is_valid():
            username = form.cleaned_data['username']
            password = form.cleaned_data['password']
            
            # Check rate limiting
            ip_address = get_client_ip(request)
            recent_attempts = LoginAttempt.objects.filter(
                username=username,
                ip_address=ip_address,
                timestamp__gte=timezone.now() - timezone.timedelta(minutes=5)
            ).count()
            
            if recent_attempts >= 5:
                log_security_event(None, 'RATE_LIMIT', request, 
                                 f'Too many login attempts for {username}')
                messages.error(request, 'Too many login attempts. Please try again later.')
                return render(request, 'chat/login.html', {'form': form})
            
            # Authenticate user
            user = authenticate(request, username=username, password=password)
            
            # Log attempt
            LoginAttempt.objects.create(
                username=username,
                ip_address=ip_address,
                successful=(user is not None)
            )
            
            if user is not None:
                login(request, user)
                log_security_event(user, 'LOGIN', request, 'User logged in')
                messages.success(request, f'Welcome back, {username}!')
                return redirect('chat_home')
            else:
                log_security_event(None, 'FAILED_LOGIN', request, 
                                 f'Failed login attempt for {username}')
                messages.error(request, 'Invalid username or password.')
    else:
        form = LoginForm()
    
    return render(request, 'chat/login.html', {'form': form})


@login_required
def logout_view(request):
    """User logout view."""
    log_security_event(request.user, 'LOGOUT', request, 'User logged out')
    logout(request)
    messages.success(request, 'You have been logged out successfully.')
    return redirect('index')


@login_required
def chat_home(request):
    """Main chat interface."""
    # Update last seen
    profile = request.user.profile
    profile.last_seen = timezone.now()
    profile.save()
    
    # Get all users except current user
    users = User.objects.exclude(id=request.user.id).select_related('profile')
    
    # Get recent chat sessions
    chat_sessions = ChatSession.objects.filter(
        Q(user1=request.user) | Q(user2=request.user)
    ).order_by('-last_activity')[:10]
    
    context = {
        'users': users,
        'chat_sessions': chat_sessions,
        'current_user': request.user,
        'public_key': request.user.profile.public_key
    }
    
    return render(request, 'chat/chat.html', context)


@login_required
@require_http_methods(["GET"])
def get_messages(request, username):
    """Get message history with a specific user."""
    try:
        other_user = User.objects.get(username=username)
        
        # Get messages between current user and other user
        messages = Message.objects.filter(
            Q(sender=request.user, receiver=other_user) |
            Q(sender=other_user, receiver=request.user)
        ).order_by('timestamp')
        
        # Mark received messages as read
        Message.objects.filter(
            sender=other_user,
            receiver=request.user,
            is_read=False
        ).update(is_read=True)
        
        messages_data = [{
            'id': msg.id,
            'sender': msg.sender.username,
            'receiver': msg.receiver.username,
            'ciphertext': msg.ciphertext,
            'timestamp': msg.timestamp.isoformat(),
            'is_read': msg.is_read
        } for msg in messages]
        
        return JsonResponse({
            'messages': messages_data,
            'other_user_public_key': other_user.profile.public_key
        })
        
    except User.DoesNotExist:
        return JsonResponse({'error': 'User not found'}, status=404)
    except Exception as e:
        logger.error(f"Error fetching messages: {str(e)}")
        return JsonResponse({'error': 'An error occurred'}, status=500)


@login_required
@require_http_methods(["GET"])
def get_public_key(request, username):
    """Get public key for a specific user."""
    try:
        user = User.objects.get(username=username)
        return JsonResponse({
            'username': username,
            'public_key': user.profile.public_key
        })
    except User.DoesNotExist:
        return JsonResponse({'error': 'User not found'}, status=404)


@login_required
@require_http_methods(["GET", "POST"])
def ecdh_public_key(request, username):
    """Get or set ECDH public key for key exchange."""
    if request.method == 'GET':
        # Get other user's ECDH public key
        try:
            user = User.objects.get(username=username)
            if not hasattr(user, 'profile') or not user.profile.ecdh_public_key:
                return JsonResponse({
                    'error': 'Public key not found',
                    'message': 'User has not generated ECDH key yet'
                }, status=404)
            
            return JsonResponse({
                'username': username,
                'ecdh_public_key': user.profile.ecdh_public_key
            })
        except User.DoesNotExist:
            return JsonResponse({'error': 'User not found'}, status=404)
    
    elif request.method == 'POST':
        # Store our ECDH public key
        try:
            data = json.loads(request.body)
            public_key = data.get('ecdh_public_key')
            
            if not public_key:
                return JsonResponse({'error': 'No public key provided'}, status=400)
            
            # Update or create user profile
            profile, created = UserProfile.objects.get_or_create(user=request.user)
            profile.ecdh_public_key = public_key
            profile.save()
            
            return JsonResponse({
                'success': True,
                'message': 'ECDH public key stored successfully'
            })
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON'}, status=400)
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=500)


@login_required
@require_http_methods(["GET"])
def user_list(request):
    """Get list of all users."""
    users = User.objects.exclude(id=request.user.id).select_related('profile')
    
    users_data = [{
        'username': user.username,
        'last_seen': user.profile.last_seen.isoformat(),
        'public_key': user.profile.public_key
    } for user in users]
    
    return JsonResponse({'users': users_data})


@login_required
@require_http_methods(["DELETE", "POST"])
def delete_message(request, message_id):
    """Delete a specific message."""
    try:
        message = Message.objects.get(
            id=message_id,
            sender=request.user  # Only sender can delete their own messages
        )
        message.delete()
        logger.info(f"User {request.user.username} deleted message {message_id}")
        return JsonResponse({'success': True, 'message': 'Message deleted'})
    except Message.DoesNotExist:
        return JsonResponse({'error': 'Message not found or unauthorized'}, status=404)
    except Exception as e:
        logger.error(f"Error deleting message: {str(e)}")
        return JsonResponse({'error': 'An error occurred'}, status=500)


@login_required
@require_http_methods(["DELETE", "POST"])
def delete_conversation(request, username):
    """Delete entire conversation with a specific user."""
    try:
        other_user = User.objects.get(username=username)
        
        # Delete all messages between current user and other user
        deleted_count = Message.objects.filter(
            Q(sender=request.user, receiver=other_user) |
            Q(sender=other_user, receiver=request.user)
        ).delete()[0]
        
        # Delete chat session if exists
        ChatSession.objects.filter(
            Q(user1=request.user, user2=other_user) |
            Q(user1=other_user, user2=request.user)
        ).delete()
        
        logger.info(f"User {request.user.username} deleted conversation with {username} ({deleted_count} messages)")
        return JsonResponse({
            'success': True, 
            'message': f'Conversation deleted ({deleted_count} messages removed)'
        })
        
    except User.DoesNotExist:
        return JsonResponse({'error': 'User not found'}, status=404)
    except Exception as e:
        logger.error(f"Error deleting conversation: {str(e)}")
        return JsonResponse({'error': 'An error occurred'}, status=500)
