"""
Encryption utilities for secure messaging.
Implements AES-256 encryption and RSA key exchange.
"""

import base64
import os
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.backends import default_backend
from Crypto.Cipher import AES
from Crypto.Random import get_random_bytes
from Crypto.Util.Padding import pad, unpad


class EncryptionManager:
    """Manages encryption and decryption operations."""
    
    def __init__(self):
        self.backend = default_backend()
    
    def generate_rsa_key_pair(self, key_size=2048):
        """
        Generate RSA public/private key pair.
        
        Args:
            key_size: Size of the key in bits (default: 2048)
        
        Returns:
            Tuple of (public_key_pem, private_key_pem) as strings
        """
        # Generate private key
        private_key = rsa.generate_private_key(
            public_exponent=65537,
            key_size=key_size,
            backend=self.backend
        )
        
        # Get public key
        public_key = private_key.public_key()
        
        # Serialize keys to PEM format
        private_pem = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption()
        ).decode('utf-8')
        
        public_pem = public_key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo
        ).decode('utf-8')
        
        return public_pem, private_pem
    
    def encrypt_rsa(self, message, public_key_pem):
        """
        Encrypt message using RSA public key.
        
        Args:
            message: String message to encrypt
            public_key_pem: Public key in PEM format
        
        Returns:
            Base64 encoded ciphertext
        """
        # Load public key
        public_key = serialization.load_pem_public_key(
            public_key_pem.encode('utf-8'),
            backend=self.backend
        )
        
        # Encrypt message
        ciphertext = public_key.encrypt(
            message.encode('utf-8'),
            padding.OAEP(
                mgf=padding.MGF1(algorithm=hashes.SHA256()),
                algorithm=hashes.SHA256(),
                label=None
            )
        )
        
        return base64.b64encode(ciphertext).decode('utf-8')
    
    def decrypt_rsa(self, ciphertext_b64, private_key_pem):
        """
        Decrypt message using RSA private key.
        
        Args:
            ciphertext_b64: Base64 encoded ciphertext
            private_key_pem: Private key in PEM format
        
        Returns:
            Decrypted message string
        """
        # Load private key
        private_key = serialization.load_pem_private_key(
            private_key_pem.encode('utf-8'),
            password=None,
            backend=self.backend
        )
        
        # Decrypt message
        ciphertext = base64.b64decode(ciphertext_b64)
        plaintext = private_key.decrypt(
            ciphertext,
            padding.OAEP(
                mgf=padding.MGF1(algorithm=hashes.SHA256()),
                algorithm=hashes.SHA256(),
                label=None
            )
        )
        
        return plaintext.decode('utf-8')
    
    def generate_aes_key(self):
        """
        Generate AES-256 symmetric key.
        
        Returns:
            Base64 encoded key
        """
        key = get_random_bytes(32)  # 256 bits
        return base64.b64encode(key).decode('utf-8')
    
    def encrypt_aes(self, message, key_b64):
        """
        Encrypt message using AES-256 in CBC mode.
        
        Args:
            message: String message to encrypt
            key_b64: Base64 encoded AES key
        
        Returns:
            Base64 encoded ciphertext with IV prepended
        """
        key = base64.b64decode(key_b64)
        
        # Generate random IV
        iv = get_random_bytes(16)
        
        # Create cipher
        cipher = AES.new(key, AES.MODE_CBC, iv)
        
        # Pad and encrypt
        padded_message = pad(message.encode('utf-8'), AES.block_size)
        ciphertext = cipher.encrypt(padded_message)
        
        # Combine IV and ciphertext
        combined = iv + ciphertext
        
        return base64.b64encode(combined).decode('utf-8')
    
    def decrypt_aes(self, ciphertext_b64, key_b64):
        """
        Decrypt message using AES-256 in CBC mode.
        
        Args:
            ciphertext_b64: Base64 encoded ciphertext with IV prepended
            key_b64: Base64 encoded AES key
        
        Returns:
            Decrypted message string
        """
        key = base64.b64decode(key_b64)
        combined = base64.b64decode(ciphertext_b64)
        
        # Extract IV and ciphertext
        iv = combined[:16]
        ciphertext = combined[16:]
        
        # Create cipher
        cipher = AES.new(key, AES.MODE_CBC, iv)
        
        # Decrypt and unpad
        padded_plaintext = cipher.decrypt(ciphertext)
        plaintext = unpad(padded_plaintext, AES.block_size)
        
        return plaintext.decode('utf-8')
    
    @staticmethod
    def hash_password(password, salt=None):
        """
        Hash password using bcrypt.
        
        Args:
            password: Plain text password
            salt: Optional salt (will be generated if not provided)
        
        Returns:
            Hashed password string
        """
        import bcrypt
        
        if salt is None:
            salt = bcrypt.gensalt()
        
        hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
        return hashed.decode('utf-8')
    
    @staticmethod
    def verify_password(password, hashed_password):
        """
        Verify password against hash.
        
        Args:
            password: Plain text password
            hashed_password: Hashed password
        
        Returns:
            Boolean indicating if password matches
        """
        import bcrypt
        
        return bcrypt.checkpw(
            password.encode('utf-8'),
            hashed_password.encode('utf-8')
        )
