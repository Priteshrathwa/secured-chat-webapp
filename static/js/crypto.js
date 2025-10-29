/**
 * Client-side encryption utilities
 * Handles AES-256 encryption/decryption and key management
 */

class CryptoManager {
    constructor() {
        this.sessionKeys = new Map(); // Store session keys for each user
        this.keyPairs = new Map(); // Store ECDH key pairs for each conversation
        this.DEVELOPMENT_MODE = true; // Set to false in production
    }

    // ==================== ECDH Key Exchange ====================

    /**
     * Generate ECDH key pair for secure key exchange
     * Uses P-256 elliptic curve (NIST standard)
     * @returns {Promise<CryptoKeyPair>} Key pair with private and public keys
     */
    async generateECDHKeyPair() {
        return await crypto.subtle.generateKey(
            {
                name: 'ECDH',
                namedCurve: 'P-256' // NIST P-256 curve (256-bit security)
            },
            true, // Extractable (so we can export public key)
            ['deriveKey', 'deriveBits']
        );
    }

    /**
     * Export public key to Base64 for transmission
     * @param {CryptoKey} publicKey - ECDH public key
     * @returns {Promise<string>} Base64 encoded public key
     */
    async exportPublicKey(publicKey) {
        const exported = await crypto.subtle.exportKey('spki', publicKey);
        return this.arrayBufferToBase64(exported);
    }

    /**
     * Import public key from Base64
     * @param {string} publicKeyBase64 - Base64 encoded public key
     * @returns {Promise<CryptoKey>} Imported public key
     */
    async importPublicKey(publicKeyBase64) {
        const keyData = this.base64ToArrayBuffer(publicKeyBase64);
        return await crypto.subtle.importKey(
            'spki',
            keyData,
            {
                name: 'ECDH',
                namedCurve: 'P-256'
            },
            true,
            []
        );
    }

    /**
     * Derive shared secret from ECDH key exchange
     * Both users derive the same shared secret from their private key + other's public key
     * @param {CryptoKey} privateKey - Your ECDH private key
     * @param {CryptoKey} publicKey - Other user's ECDH public key
     * @returns {Promise<string>} Base64 encoded shared secret (256-bit AES key)
     */
    async deriveSharedSecret(privateKey, publicKey) {
        // Derive 256 bits for AES-256 key
        const sharedSecret = await crypto.subtle.deriveBits(
            {
                name: 'ECDH',
                public: publicKey
            },
            privateKey,
            256 // 256 bits = 32 bytes for AES-256
        );
        
        return this.arrayBufferToBase64(new Uint8Array(sharedSecret));
    }

    /**
     * Get or generate ECDH key pair for a conversation
     * @param {string} conversationId - Conversation identifier
     * @returns {Promise<CryptoKeyPair>} ECDH key pair
     */
    async getECDHKeyPair(conversationId) {
        // Check if we already have a key pair for this conversation
        if (this.keyPairs.has(conversationId)) {
            return this.keyPairs.get(conversationId);
        }

        // Check localStorage for stored private key
        const storedPrivateKey = localStorage.getItem(`ecdh_private_${conversationId}`);
        
        if (storedPrivateKey) {
            try {
                // Import stored private key
                const privateKeyData = this.base64ToArrayBuffer(storedPrivateKey);
                const privateKey = await crypto.subtle.importKey(
                    'pkcs8',
                    privateKeyData,
                    {
                        name: 'ECDH',
                        namedCurve: 'P-256'
                    },
                    true,
                    ['deriveKey', 'deriveBits']
                );

                // Reconstruct public key from stored value
                const storedPublicKey = localStorage.getItem(`ecdh_public_${conversationId}`);
                const publicKey = await this.importPublicKey(storedPublicKey);

                const keyPair = { privateKey, publicKey };
                this.keyPairs.set(conversationId, keyPair);
                return keyPair;
            } catch (error) {
                // If import fails, generate new key pair
            }
        }

        // Generate new key pair
        const keyPair = await this.generateECDHKeyPair();
        
        // Store in memory
        this.keyPairs.set(conversationId, keyPair);
        
        // Export and store private key in localStorage
        const exportedPrivateKey = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
        localStorage.setItem(`ecdh_private_${conversationId}`, this.arrayBufferToBase64(exportedPrivateKey));
        
        // Export and store public key
        const exportedPublicKey = await this.exportPublicKey(keyPair.publicKey);
        localStorage.setItem(`ecdh_public_${conversationId}`, exportedPublicKey);
        
        // Store key generation timestamp for tracking
        localStorage.setItem(`ecdh_timestamp_${conversationId}`, Date.now().toString());
        
        return keyPair;
    }

    // ==================== AES Encryption ====================

    /**
     * Generate a random AES-256 key
     * @returns {string} Base64 encoded key
     */
    async generateAESKey() {
        const key = new Uint8Array(32); // 256 bits
        crypto.getRandomValues(key);
        return this.arrayBufferToBase64(key);
    }

    // ==================== HMAC Message Authentication ====================

    /**
     * Derive HMAC key from session key
     * @param {string} sessionKeyBase64 - Base64 encoded session key
     * @returns {Promise<CryptoKey>} HMAC key for message authentication
     */
    async deriveHMACKey(sessionKeyBase64) {
        const keyData = this.base64ToArrayBuffer(sessionKeyBase64);
        
        // Import the session key as HMAC key
        return await crypto.subtle.importKey(
            'raw',
            keyData,
            {
                name: 'HMAC',
                hash: 'SHA-256'
            },
            false,
            ['sign', 'verify']
        );
    }

    /**
     * Generate HMAC signature for data
     * @param {Uint8Array} data - Data to sign
     * @param {string} sessionKeyBase64 - Base64 encoded session key
     * @returns {Promise<string>} Base64 encoded HMAC signature
     */
    async generateHMAC(data, sessionKeyBase64) {
        const hmacKey = await this.deriveHMACKey(sessionKeyBase64);
        const signature = await crypto.subtle.sign('HMAC', hmacKey, data);
        return this.arrayBufferToBase64(signature);
    }

    /**
     * Verify HMAC signature
     * @param {Uint8Array} data - Data to verify
     * @param {string} signatureBase64 - Base64 encoded HMAC signature
     * @param {string} sessionKeyBase64 - Base64 encoded session key
     * @returns {Promise<boolean>} True if signature is valid
     */
    async verifyHMAC(data, signatureBase64, sessionKeyBase64) {
        const hmacKey = await this.deriveHMACKey(sessionKeyBase64);
        const signature = this.base64ToArrayBuffer(signatureBase64);
        return await crypto.subtle.verify('HMAC', hmacKey, signature, data);
    }

    // ==================== Safety Numbers & Key Verification ====================

    /**
     * Generate safety number (fingerprint) for verifying encryption keys
     * This creates a unique 60-digit code that both users can compare to detect MITM attacks
     * @param {string} publicKey1 - First user's public key (Base64)
     * @param {string} publicKey2 - Second user's public key (Base64)
     * @param {string} username1 - First username (for consistent ordering)
     * @param {string} username2 - Second username (for consistent ordering)
     * @returns {Promise<string>} Formatted safety number (60 digits in 12 groups of 5)
     */
    async generateSafetyNumber(publicKey1, publicKey2, username1, username2) {
        // Sort by username to ensure both users generate same safety number
        const users = [
            { username: username1, publicKey: publicKey1 },
            { username: username2, publicKey: publicKey2 }
        ].sort((a, b) => a.username.localeCompare(b.username));

        // Combine both public keys in sorted order
        const combined = users[0].publicKey + '|' + users[1].publicKey + '|' + 
                        users[0].username + '|' + users[1].username;
        
        // Hash to create fingerprint
        const encoder = new TextEncoder();
        const data = encoder.encode(combined);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        
        // Convert to numeric string
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        
        // Create 60-digit safety number from hash
        let safetyNumber = '';
        for (let i = 0; i < 60; i++) {
            // Use hash bytes cyclically to generate digits
            const byte = hashArray[i % hashArray.length];
            const digit = byte % 10;
            safetyNumber += digit;
        }
        
        // Format as 12 groups of 5 digits
        return safetyNumber.match(/.{1,5}/g).join(' ');
    }

    /**
     * Generate QR code data for safety number verification
     * @param {string} safetyNumber - The 60-digit safety number
     * @param {string} myUsername - Current user's username
     * @param {string} otherUsername - Other user's username
     * @returns {string} QR code data string
     */
    generateQRCodeData(safetyNumber, myUsername, otherUsername) {
        return JSON.stringify({
            type: 'safety_number',
            number: safetyNumber.replace(/\s/g, ''),
            users: [myUsername, otherUsername].sort(),
            version: 1
        });
    }

    /**
     * Verify public key using Trust-On-First-Use (TOFU) pattern
     * Stores first public key seen for a user and warns if it changes
     * @param {string} username - Username to verify
     * @param {string} publicKey - Their current ECDH public key
     * @returns {Promise<Object>} Verification result with trust status
     */
    async verifyPublicKey(username, publicKey) {
        const storageKey = `trusted_pubkey_${username}`;
        const trustedKey = localStorage.getItem(storageKey);
        
        if (!trustedKey) {
            // First time seeing this user's key - trust and store
            localStorage.setItem(storageKey, publicKey);
            localStorage.setItem(`${storageKey}_timestamp`, Date.now().toString());
            
            return { 
                trusted: true, 
                firstTime: true,
                status: 'new',
                message: 'First key exchange with this user. Verify safety number to confirm identity.'
            };
        }
        
        if (trustedKey !== publicKey) {
            // Key changed - possible MITM attack or legitimate key rotation
            const oldTimestamp = localStorage.getItem(`${storageKey}_timestamp`);
            const daysSinceFirst = oldTimestamp ? 
                Math.floor((Date.now() - parseInt(oldTimestamp)) / (1000 * 60 * 60 * 24)) : 
                'unknown';
            
            return { 
                trusted: false,
                firstTime: false,
                status: 'changed',
                oldKey: trustedKey,
                newKey: publicKey,
                daysSinceFirst: daysSinceFirst,
                warning: `⚠️ ${username}'s encryption key changed!`,
                message: 'This could be a security risk. Verify the new safety number with this user before continuing.',
                action: 'verify_required'
            };
        }
        
        // Key matches - trusted
        return { 
            trusted: true, 
            firstTime: false,
            status: 'verified',
            message: 'Key verified - secure connection established.'
        };
    }

    /**
     * Mark a user's public key as verified after out-of-band confirmation
     * @param {string} username - Username to mark as verified
     * @param {string} publicKey - Their verified public key
     */
    markAsVerified(username, publicKey) {
        const storageKey = `trusted_pubkey_${username}`;
        localStorage.setItem(storageKey, publicKey);
        localStorage.setItem(`${storageKey}_verified`, 'true');
        localStorage.setItem(`${storageKey}_verified_timestamp`, Date.now().toString());
        
        console.log(`✅ ${username} marked as verified`);
    }

    /**
     * Check if a user has been manually verified
     * @param {string} username - Username to check
     * @returns {boolean} True if user has been verified
     */
    isVerified(username) {
        const verified = localStorage.getItem(`trusted_pubkey_${username}_verified`);
        return verified === 'true';
    }

    /**
     * Accept a changed key (after user verification)
     * @param {string} username - Username whose key changed
     * @param {string} newPublicKey - The new public key to trust
     */
    acceptKeyChange(username, newPublicKey) {
        const storageKey = `trusted_pubkey_${username}`;
        const oldKey = localStorage.getItem(storageKey);
        
        // Store old key in history
        const historyKey = `${storageKey}_history`;
        const history = JSON.parse(localStorage.getItem(historyKey) || '[]');
        history.push({
            key: oldKey,
            replaced: Date.now()
        });
        localStorage.setItem(historyKey, JSON.stringify(history));
        
        // Update to new key
        localStorage.setItem(storageKey, newPublicKey);
        localStorage.setItem(`${storageKey}_timestamp`, Date.now().toString());
        // Reset verification status - user must verify again
        localStorage.removeItem(`${storageKey}_verified`);
        
        console.log(`✅ Accepted key change for ${username}. Please verify new safety number.`);
    }

    /**
     * Get key verification history for a user
     * @param {string} username - Username to check
     * @returns {Array} Array of key history objects
     */
    getKeyHistory(username) {
        const historyKey = `trusted_pubkey_${username}_history`;
        return JSON.parse(localStorage.getItem(historyKey) || '[]');
    }

    // ==================== AES Encryption ====================

    /**
     * Encrypt message with AES-256-CBC and add HMAC for authentication
     * @param {string} message - Plain text message
     * @param {string} sessionKeyBase64 - Base64 encoded session key
     * @returns {Promise<string>} Base64 encoded ciphertext with IV and HMAC
     */
    async encryptAES(message, sessionKeyBase64) {
        try {
            // Decode the key
            const keyData = this.base64ToArrayBuffer(sessionKeyBase64);
            
            // Import key
            const key = await crypto.subtle.importKey(
                'raw',
                keyData,
                { name: 'AES-CBC', length: 256 },
                false,
                ['encrypt']
            );

            // Generate IV
            const iv = crypto.getRandomValues(new Uint8Array(16));

            // Encode message
            const encoder = new TextEncoder();
            const data = encoder.encode(message);

            // Encrypt
            const encrypted = await crypto.subtle.encrypt(
                { name: 'AES-CBC', iv: iv },
                key,
                data
            );

            // Combine IV and ciphertext
            const combined = new Uint8Array(iv.length + encrypted.byteLength);
            combined.set(iv, 0);
            combined.set(new Uint8Array(encrypted), iv.length);

            // Generate HMAC over the combined IV+ciphertext
            const hmacSignature = await this.generateHMAC(combined, sessionKeyBase64);

            // Return format: Base64(IV+ciphertext)|Base64(HMAC)
            return this.arrayBufferToBase64(combined) + '|' + hmacSignature;
        } catch (error) {
            throw new Error('Failed to encrypt message');
        }
    }

    /**
     * Decrypt message with AES-256-CBC and verify HMAC
     * @param {string} encryptedData - Base64 encoded ciphertext with IV and HMAC (format: Base64(IV+ciphertext)|Base64(HMAC))
     * @param {string} sessionKeyBase64 - Base64 encoded session key
     * @returns {Promise<string>} Decrypted plain text message
     */
    async decryptAES(encryptedData, sessionKeyBase64) {
        try {
            if (!sessionKeyBase64) {
                return '[Encrypted - Key missing]';
            }
            
            // Split ciphertext and HMAC
            let ciphertextBase64, hmacSignature;
            if (encryptedData.includes('|')) {
                // New format with HMAC
                const parts = encryptedData.split('|');
                ciphertextBase64 = parts[0];
                hmacSignature = parts[1];
            } else {
                // Old format without HMAC (backward compatibility)
                ciphertextBase64 = encryptedData;
                hmacSignature = null;
            }
            
            // Decode key and ciphertext
            const keyData = this.base64ToArrayBuffer(sessionKeyBase64);
            const combined = this.base64ToArrayBuffer(ciphertextBase64);

            // Verify HMAC if present
            if (hmacSignature) {
                const isValid = await this.verifyHMAC(new Uint8Array(combined), hmacSignature, sessionKeyBase64);
                if (!isValid) {
                    throw new Error('HMAC verification failed - message may have been tampered with');
                }
            }

            // Extract IV and ciphertext
            const iv = combined.slice(0, 16);
            const ciphertext = combined.slice(16);

            // Import key
            const key = await crypto.subtle.importKey(
                'raw',
                keyData,
                { name: 'AES-CBC', length: 256 },
                false,
                ['decrypt']
            );

            // Decrypt
            const decrypted = await crypto.subtle.decrypt(
                { name: 'AES-CBC', iv: iv },
                key,
                ciphertext
            );

            // Decode message
            const decoder = new TextDecoder();
            return decoder.decode(decrypted);
        } catch (error) {
            return '[Encrypted message - Unable to decrypt]';
        }
    }

    /**
     * Get or create session key for a user using ECDH key exchange
     * @param {string} username - Username
     * @param {string} currentUser - Current logged-in user
     * @param {string} otherUserPublicKey - Other user's ECDH public key (Base64)
     * @returns {Promise<string>} Base64 encoded session key
     */
    async getSessionKey(username, currentUser, otherUserPublicKey = null) {
        const users = [username, currentUser].sort();
        const conversationId = users.join('_');
        
        // Check in-memory cache first
        if (this.sessionKeys.has(conversationId)) {
            return this.sessionKeys.get(conversationId);
        }
        
        // Check localStorage for existing shared secret
        let storedKey = localStorage.getItem(`session_key_${conversationId}`);
        
        // If key exists and not expired, use it
        if (storedKey && !this.isKeyExpired(conversationId, 24)) {
            this.sessionKeys.set(conversationId, storedKey);
            return storedKey;
        }
        
        // If we have other user's public key, perform ECDH key exchange
        if (otherUserPublicKey) {
            try {
                // Get OUR per-user ECDH key pair (not per-conversation)
                const ourKeyPair = await this.getECDHKeyPair(currentUser);
                
                // Import other user's public key
                const theirPublicKey = await this.importPublicKey(otherUserPublicKey);
                
                // Derive shared secret using ECDH
                const sharedSecret = await this.deriveSharedSecret(ourKeyPair.privateKey, theirPublicKey);
                
                // Store the shared secret (still per-conversation for isolation)
                this.sessionKeys.set(conversationId, sharedSecret);
                localStorage.setItem(`session_key_${conversationId}`, sharedSecret);
                this.storeKeyTimestamp(conversationId);
                
                return sharedSecret;
            } catch (error) {
                console.error('ECDH key exchange failed, falling back to deterministic key');
            }
        }
        
        // Fallback: Generate deterministic key (for backward compatibility)
        const key = await this.generateDeterministicKey(conversationId);
        this.sessionKeys.set(conversationId, key);
        localStorage.setItem(`session_key_${conversationId}`, key);
        this.storeKeyTimestamp(conversationId);
        
        return key;
    }
    
    /**
     * Get our public key for a conversation
     * @param {string} username - Username (other user)
     * @param {string} currentUser - Current logged-in user  
     * @returns {Promise<string>} Base64 encoded public key
     */
    async getMyPublicKey(username, currentUser) {
        // Use per-USER key instead of per-conversation
        // This ensures one consistent key pair per user across all conversations
        const userId = currentUser;
        
        // Check if we already have a key for this user
        const existingKey = localStorage.getItem(`ecdh_private_${userId}`);
        const hadNoKey = !existingKey;
        
        // Get or generate ECDH key pair for this user
        const keyPair = await this.getECDHKeyPair(userId);
        
        // If we just generated a NEW key (incognito mode or first login),
        // clear all trusted public keys to force re-verification
        if (hadNoKey) {
            console.log('🔑 New ECDH key generated - clearing trusted key cache');
            // Clear all trusted_pubkey entries
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('trusted_pubkey_')) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(key => localStorage.removeItem(key));
        }
        
        // Export public key
        return await this.exportPublicKey(keyPair.publicKey);
    }
    
    /**
     * Generate a deterministic key from conversation ID (FALLBACK ONLY)
     * @deprecated Use ECDH key exchange instead
     * @param {string} conversationId - Unique conversation identifier
     * @returns {Promise<string>} Base64 encoded session key
     */
    async generateDeterministicKey(conversationId) {
        const encoder = new TextEncoder();
        const data = encoder.encode(conversationId + '_secure_chat_key');
        const hash = await crypto.subtle.digest('SHA-256', data);
        return this.arrayBufferToBase64(hash);
    }

    /**
     * Load session key from localStorage
     * @param {string} username - Username
     * @param {string} currentUser - Current logged-in user
     */
    loadSessionKey(username, currentUser) {
        const users = [username, currentUser].sort();
        const conversationId = users.join('_');
        const key = localStorage.getItem(`session_key_${conversationId}`);
        if (key) {
            this.sessionKeys.set(conversationId, key);
        }
    }

    /**
     * Clear session key for a user
     * @param {string} username - Username
     * @param {string} currentUser - Current logged-in user
     */
    clearSessionKey(username, currentUser) {
        const users = [username, currentUser].sort();
        const conversationId = users.join('_');
        this.sessionKeys.delete(conversationId);
        localStorage.removeItem(`session_key_${conversationId}`);
        localStorage.removeItem(`msg_count_${conversationId}`);
        localStorage.removeItem(`key_version_${conversationId}`);
        localStorage.removeItem(`key_created_${conversationId}`);
    }

    /**
     * Rotate encryption key for a conversation
     * Generates new key every N messages for improved security
     * @param {string} conversationId - Conversation identifier
     * @param {string} oldKey - Current encryption key
     * @param {number} messageCount - Current message count
     * @param {number} rotateInterval - Rotate key every N messages (default: 100)
     * @returns {Promise<{key: string, version: number}>} New key and version
     */
    async rotateKey(conversationId, oldKey, messageCount, rotateInterval = 100) {
        const currentVersion = parseInt(localStorage.getItem(`key_version_${conversationId}`) || '1');
        
        // Check if rotation is needed
        if (messageCount % rotateInterval === 0 && messageCount > 0) {
            const newVersion = currentVersion + 1;
            
            // Derive new key from old key + version number
            const encoder = new TextEncoder();
            const data = encoder.encode(oldKey + '_v' + newVersion + '_' + Date.now());
            const hash = await crypto.subtle.digest('SHA-256', data);
            const newKey = this.arrayBufferToBase64(hash);
            
            // Store new key and version
            localStorage.setItem(`session_key_${conversationId}`, newKey);
            localStorage.setItem(`key_version_${conversationId}`, newVersion.toString());
            this.sessionKeys.set(conversationId, newKey);
            
            // Update timestamp for forward secrecy
            this.storeKeyTimestamp(conversationId);
            
            return { key: newKey, version: newVersion };
        }
        
        return { key: oldKey, version: currentVersion };
    }

    /**
     * Get current key version for a conversation
     * @param {string} conversationId - Conversation identifier
     * @returns {number} Current key version
     */
    getKeyVersion(conversationId) {
        return parseInt(localStorage.getItem(`key_version_${conversationId}`) || '1');
    }

    /**
     * Get message count for a conversation
     * @param {string} conversationId - Conversation identifier
     * @returns {number} Message count
     */
    getMessageCount(conversationId) {
        return parseInt(localStorage.getItem(`msg_count_${conversationId}`) || '0');
    }

    /**
     * Increment message count for a conversation
     * @param {string} conversationId - Conversation identifier
     * @returns {number} New message count
     */
    incrementMessageCount(conversationId) {
        const count = this.getMessageCount(conversationId) + 1;
        localStorage.setItem(`msg_count_${conversationId}`, count.toString());
        return count;
    }

    /**
     * Store key creation timestamp for forward secrecy
     * @param {string} conversationId - Conversation identifier
     */
    storeKeyTimestamp(conversationId) {
        const timestamp = Date.now();
        localStorage.setItem(`key_created_${conversationId}`, timestamp.toString());
    }

    /**
     * Get key creation timestamp
     * @param {string} conversationId - Conversation identifier
     * @returns {number} Timestamp in milliseconds
     */
    getKeyTimestamp(conversationId) {
        return parseInt(localStorage.getItem(`key_created_${conversationId}`) || Date.now().toString());
    }

    /**
     * Check if encryption key has expired (Forward Secrecy)
     * @param {string} conversationId - Conversation identifier
     * @param {number} expiryHours - Hours until key expires (default: 24)
     * @returns {boolean} True if key has expired
     */
    isKeyExpired(conversationId, expiryHours = 24) {
        const createdAt = this.getKeyTimestamp(conversationId);
        const now = Date.now();
        const expiryMs = expiryHours * 60 * 60 * 1000;
        return (now - createdAt) > expiryMs;
    }

    /**
     * Cleanup expired keys for forward secrecy
     * Automatically deletes keys older than expiry period
     * @param {number} expiryHours - Hours until key expires (default: 24)
     * @returns {number} Number of keys deleted
     */
    cleanupExpiredKeys(expiryHours = 24) {
        let deletedCount = 0;
        const now = Date.now();
        const expiryMs = expiryHours * 60 * 60 * 1000;
        
        // Scan localStorage for session keys
        const keysToDelete = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('session_key_')) {
                const conversationId = key.replace('session_key_', '');
                const createdKey = `key_created_${conversationId}`;
                const createdAt = parseInt(localStorage.getItem(createdKey) || now.toString());
                
                if ((now - createdAt) > expiryMs) {
                    keysToDelete.push({
                        sessionKey: key,
                        created: createdKey,
                        msgCount: `msg_count_${conversationId}`,
                        keyVersion: `key_version_${conversationId}`,
                        conversationId: conversationId
                    });
                }
            }
        }
        
        // Delete expired keys
        keysToDelete.forEach(keySet => {
            localStorage.removeItem(keySet.sessionKey);
            localStorage.removeItem(keySet.created);
            localStorage.removeItem(keySet.msgCount);
            localStorage.removeItem(keySet.keyVersion);
            this.sessionKeys.delete(keySet.conversationId);
            deletedCount++;
        });
        
        return deletedCount;
    }

    /**
     * Get remaining hours until key expires
     * @param {string} conversationId - Conversation identifier
     * @param {number} expiryHours - Hours until key expires (default: 24)
     * @returns {number} Hours remaining (0 if expired)
     */
    getKeyExpiryRemaining(conversationId, expiryHours = 24) {
        const createdAt = this.getKeyTimestamp(conversationId);
        const now = Date.now();
        const expiryMs = expiryHours * 60 * 60 * 1000;
        const ageMs = now - createdAt;
        const remainingMs = expiryMs - ageMs;
        
        if (remainingMs <= 0) return 0;
        return Math.floor(remainingMs / 3600000);
    }

    /**
     * Start automatic key cleanup timer (Forward Secrecy)
     * @param {number} intervalMinutes - Check interval in minutes (default: 60)
     * @param {number} expiryHours - Hours until key expires (default: 24)
     */
    startAutoCleanup(intervalMinutes = 60, expiryHours = 24) {
        // Check if development mode
        if (this.DEVELOPMENT_MODE) {
            return;
        }
        
        // Initial cleanup
        this.cleanupExpiredKeys(expiryHours);
        
        // Schedule periodic cleanup
        setInterval(() => {
            this.cleanupExpiredKeys(expiryHours);
        }, intervalMinutes * 60 * 1000);
    }

    /**
     * Convert ArrayBuffer to Base64
     * @param {ArrayBuffer|Uint8Array} buffer
     * @returns {string}
     */
    arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    /**
     * Convert Base64 to ArrayBuffer
     * @param {string} base64
     * @returns {Uint8Array}
     */
    base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    /**
     * Hash a string using SHA-256
     * @param {string} message
     * @returns {Promise<string>}
     */
    async hashString(message) {
        const encoder = new TextEncoder();
        const data = encoder.encode(message);
        const hash = await crypto.subtle.digest('SHA-256', data);
        return this.arrayBufferToBase64(hash);
    }
}

// Export global instance
window.cryptoManager = new CryptoManager();
