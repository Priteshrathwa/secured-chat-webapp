import json
import logging
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth.models import User
from .models import Message, ChatSession, SecurityLog, UserProfile
from .utils.encryption import EncryptionManager

logger = logging.getLogger(__name__)


class ChatConsumer(AsyncWebsocketConsumer):
    """WebSocket consumer for real-time chat."""
    
    async def connect(self):
        """Handle WebSocket connection."""
        self.user = self.scope['user']
        
        # Reject anonymous users
        if not self.user.is_authenticated:
            await self.close()
            return
        
        # Create a unique room for this user
        self.room_name = f'user_{self.user.id}'
        self.room_group_name = f'chat_{self.room_name}'
        
        # Join room group
        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )
        
        await self.accept()
        
        # Log connection
        await self.log_security_event('MESSAGE_RECEIVED', 'User connected to chat')
        
        logger.info(f"User {self.user.username} connected to chat")
    
    async def disconnect(self, close_code):
        """Handle WebSocket disconnection."""
        if hasattr(self, 'room_group_name'):
            await self.channel_layer.group_discard(
                self.room_group_name,
                self.channel_name
            )
        
        if hasattr(self, 'user') and self.user.is_authenticated:
            logger.info(f"User {self.user.username} disconnected from chat")
    
    async def receive(self, text_data):
        """Receive message from WebSocket."""
        try:
            data = json.loads(text_data)
            message_type = data.get('type', 'chat_message')
            
            if message_type == 'chat_message':
                await self.handle_chat_message(data)
            elif message_type == 'typing':
                await self.handle_typing(data)
            elif message_type == 'read_receipt':
                await self.handle_read_receipt(data)
            
        except json.JSONDecodeError:
            logger.error(f"Invalid JSON received from {self.user.username}")
            await self.send(text_data=json.dumps({
                'error': 'Invalid message format'
            }))
        except Exception as e:
            logger.error(f"Error in receive: {str(e)}")
            await self.send(text_data=json.dumps({
                'error': 'An error occurred processing your message'
            }))
    
    async def handle_chat_message(self, data):
        """Handle incoming chat message."""
        receiver_username = data.get('receiver')
        ciphertext = data.get('ciphertext')
        key_version = data.get('key_version', 1)
        message_number = data.get('message_number', 0)
        
        if not receiver_username or not ciphertext:
            await self.send(text_data=json.dumps({
                'error': 'Missing receiver or message content'
            }))
            return
        
        # Get receiver
        receiver = await self.get_user_by_username(receiver_username)
        if not receiver:
            await self.send(text_data=json.dumps({
                'error': 'Receiver not found'
            }))
            return
        
        # Save encrypted message to database with key metadata
        message = await self.save_message(self.user, receiver, ciphertext, key_version, message_number)
        
        # Prepare message data
        message_data = {
            'id': message.id,
            'sender': self.user.username,
            'receiver': receiver.username,
            'ciphertext': ciphertext,
            'timestamp': message.timestamp.isoformat()
        }
        
        logger.info(f"Broadcasting message {message.id} from {self.user.username} to {receiver.username}")
        
        # Send message to receiver's room
        receiver_room = f'chat_user_{receiver.id}'
        logger.info(f"Sending to receiver room: {receiver_room}")
        await self.channel_layer.group_send(
            receiver_room,
            {
                'type': 'chat_message',
                'message': message_data
            }
        )
        
        # Send message back to sender's room (so they see it with the ID)
        sender_room = f'chat_user_{self.user.id}'
        logger.info(f"Sending to sender room: {sender_room}")
        await self.channel_layer.group_send(
            sender_room,
            {
                'type': 'chat_message',
                'message': message_data
            }
        )
        
        # Log security event
        await self.log_security_event('MESSAGE_SENT', f'Message sent to {receiver_username}')
    
    async def handle_typing(self, data):
        """Handle typing indicator."""
        receiver_username = data.get('receiver')
        is_typing = data.get('is_typing', False)
        
        if receiver_username:
            receiver = await self.get_user_by_username(receiver_username)
            if receiver:
                await self.channel_layer.group_send(
                    f'chat_user_{receiver.id}',
                    {
                        'type': 'typing_indicator',
                        'username': self.user.username,
                        'is_typing': is_typing
                    }
                )
    
    async def handle_read_receipt(self, data):
        """Handle message read receipt."""
        message_id = data.get('message_id')
        if message_id:
            await self.mark_message_read(message_id)
    
    async def chat_message(self, event):
        """Send chat message to WebSocket."""
        await self.send(text_data=json.dumps({
            'type': 'chat_message',
            'message': event['message']
        }))
    
    async def typing_indicator(self, event):
        """Send typing indicator to WebSocket."""
        await self.send(text_data=json.dumps({
            'type': 'typing',
            'username': event['username'],
            'is_typing': event['is_typing']
        }))
    
    @database_sync_to_async
    def get_user_by_username(self, username):
        """Get user by username."""
        try:
            return User.objects.get(username=username)
        except User.DoesNotExist:
            return None
    
    @database_sync_to_async
    def save_message(self, sender, receiver, ciphertext, key_version=1, message_number=0):
        """Save message to database with key rotation metadata."""
        message = Message.objects.create(
            sender=sender,
            receiver=receiver,
            ciphertext=ciphertext,
            key_version=key_version,
            message_number=message_number
        )
        
        # Update or create chat session
        ChatSession.objects.update_or_create(
            user1=min(sender, receiver, key=lambda u: u.id),
            user2=max(sender, receiver, key=lambda u: u.id),
        )
        
        return message
    
    @database_sync_to_async
    def mark_message_read(self, message_id):
        """Mark message as read."""
        try:
            message = Message.objects.get(id=message_id, receiver=self.user)
            message.is_read = True
            message.save()
        except Message.DoesNotExist:
            pass
    
    @database_sync_to_async
    def log_security_event(self, event_type, description):
        """Log security event."""
        try:
            SecurityLog.objects.create(
                user=self.user,
                event_type=event_type,
                ip_address=self.scope.get('client', ['0.0.0.0'])[0],
                user_agent=dict(self.scope.get('headers', {})).get(b'user-agent', b'').decode(),
                description=description
            )
        except Exception as e:
            logger.error(f"Failed to log security event: {str(e)}")
