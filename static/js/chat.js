/**
 * Real-time chat functionality with WebSocket and E2E encryption
 */

class ChatApp {
    constructor() {
        this.socket = null;
        this.currentChat = null;
        this.currentChatPublicKey = null;
        this.sessionKey = null;
        this.username = document.getElementById('userData').dataset.username;
        this.publicKey = document.getElementById('userData').dataset.publicKey;
        this.typingTimeout = null;
        
        // Clear keys if different user is logged in (prevents key reuse across users)
        this.validateUserKeys();
        
        this.initializeWebSocket();
        this.attachEventListeners();
    }
    
    /**
     * Validate that localStorage keys belong to current user
     * Clear keys from previous user if different user is now logged in
     */
    validateUserKeys() {
        const storedUser = localStorage.getItem('current_user');
        
        if (storedUser && storedUser !== this.username) {
            console.log(`🔄 User changed from ${storedUser} to ${this.username} - clearing old keys`);
            // Clear all encryption-related keys from previous user
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && (
                    key.startsWith('ecdh_') || 
                    key.startsWith('session_key_') || 
                    key.startsWith('trusted_pubkey_') ||
                    key.startsWith('msg_count_') ||
                    key.startsWith('key_version_') ||
                    key.startsWith('key_created_')
                )) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(key => localStorage.removeItem(key));
        }
        
        // Store current user for future validation
        localStorage.setItem('current_user', this.username);
    }

    /**
     * Initialize WebSocket connection
     */
    initializeWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/chat/`;
        
        this.socket = new WebSocket(wsUrl);
        
        this.socket.onopen = () => {
            this.updateConnectionStatus(true);
        };
        
        this.socket.onclose = () => {
            this.updateConnectionStatus(false);
            // Attempt to reconnect after 3 seconds
            setTimeout(() => this.initializeWebSocket(), 3000);
        };
        
        this.socket.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.showNotification('Connection error. Retrying...', 'danger');
        };
        
        this.socket.onmessage = async (event) => {
            await this.handleMessage(JSON.parse(event.data));
        };
    }

    /**
     * Handle incoming WebSocket message
     */
    async handleMessage(data) {
        switch (data.type) {
            case 'chat_message':
                await this.receiveMessage(data.message);
                break;
            case 'typing':
                this.handleTypingIndicator(data);
                break;
            case 'message_sent':
                break;
            case 'error':
                this.showNotification(data.error, 'danger');
                break;
        }
    }

    /**
     * Attach event listeners
     */
    attachEventListeners() {
        // User selection
        document.querySelectorAll('.user-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                this.selectUser(
                    item.dataset.username,
                    item.dataset.publicKey,
                    e
                );
            });
        });

        // Message form
        const messageForm = document.getElementById('messageForm');
        messageForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.sendMessage();
        });

        // Typing indicator
        const messageInput = document.getElementById('messageInput');
        messageInput.addEventListener('input', () => {
            this.handleTyping();
        });
        // Enable/disable send button based on input content
        const sendButton = document.getElementById('sendButton');
        messageInput.addEventListener('input', () => {
            const val = messageInput.value.trim();
            if (this.currentChat && val.length > 0) {
                sendButton.disabled = false;
            } else if (this.currentChat) {
                sendButton.disabled = true;
            }
        });

        // Search/filter contacts
        const searchInput = document.querySelector('.chat-search input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const q = e.target.value.trim().toLowerCase();
                const users = document.querySelectorAll('.contact-item');
                users.forEach(u => {
                    const uname = (u.dataset.username || u.querySelector('.contact-name')?.textContent || '').toLowerCase();
                    if (!q || uname.includes(q)) {
                        u.style.display = '';
                    } else {
                        u.style.display = 'none';
                    }
                });
            });
        }
        
        // Delete conversation button
        const deleteConversationBtn = document.getElementById('deleteConversationBtn');
        if (deleteConversationBtn) {
            deleteConversationBtn.addEventListener('click', async () => {
                await this.deleteConversation();
            });
        }
    }

    /**
     * Select user to chat with
     */
    async selectUser(username, publicKey, event) {
        this.currentChat = username;
        this.currentChatPublicKey = publicKey;
        
        // Update UI
        document.querySelectorAll('.user-item').forEach(item => {
            item.classList.remove('active');
        });
        if (event) {
            event.target.closest('.user-item').classList.add('active');
        }
        
        document.getElementById('chatUsername').textContent = username;
        const presenceStatus = document.getElementById('chatPresenceStatus');
        if (presenceStatus) {
            presenceStatus.textContent = 'Secure session initializing…';
        }
        const chatAvatar = document.getElementById('chatAvatar');
        const chatAvatarText = document.getElementById('chatAvatarText');
        if (chatAvatar && chatAvatarText) {
            chatAvatarText.textContent = username.slice(0, 1).toUpperCase();
            chatAvatar.style.display = 'flex';
            chatAvatar.classList.add('is-active');
        }
        document.getElementById('messageInput').disabled = false;
        document.getElementById('sendButton').disabled = false;
        
        // Show verify and delete buttons
        document.getElementById('viewSafetyNumberBtn').style.display = 'block';
        document.getElementById('deleteConversationBtn').style.display = 'block';
        
        // === ECDH KEY EXCHANGE WITH VERIFICATION ===
        try {
            // Clear cached session key to force re-derivation with current ECDH public keys
            // This ensures that after logout/login, we always derive from fresh server keys
            cryptoManager.clearSessionKey(username, this.username);
            
            // Clean up any old per-conversation ECDH keys (migration from old system)
            const users = [username, this.username].sort();
            const oldConversationId = users.join('_');
            localStorage.removeItem(`ecdh_private_${oldConversationId}`);
            localStorage.removeItem(`ecdh_public_${oldConversationId}`);
            localStorage.removeItem(`ecdh_timestamp_${oldConversationId}`);
            
            // 1. Generate or get our ECDH key pair (per-user, not per-conversation)
            const myPublicKey = await cryptoManager.getMyPublicKey(username, this.username);
            
            // 2. Store our public key on server (updates if regenerated)
            await this.storeMyPublicKey(myPublicKey);
            
            // 3. Fetch other user's public key from server (always fresh)
            const otherUserPublicKey = await this.fetchPublicKey(username);
            
            // 4. VERIFY PUBLIC KEY (Trust-On-First-Use)
            const verification = await cryptoManager.verifyPublicKey(username, otherUserPublicKey);
            
            // 5. Handle verification result
            await this.handleKeyVerification(username, otherUserPublicKey, myPublicKey, verification);
            
            // 6. Derive shared secret using ECDH (will now be freshly derived)
            this.sessionKey = await cryptoManager.getSessionKey(username, this.username, otherUserPublicKey);
            
        } catch (error) {
            console.error('Key exchange failed:', error);
            // Fallback to deterministic key (backward compatibility)
            this.sessionKey = await cryptoManager.getSessionKey(username, this.username);
        }
        
        // Load message history
        await this.loadMessages(username);
    }

    /**
     * Handle key verification results
     */
    async handleKeyVerification(username, theirPublicKey, myPublicKey, verification) {
        // Generate safety number for this conversation
        const safetyNumber = await cryptoManager.generateSafetyNumber(
            myPublicKey, 
            theirPublicKey,
            this.username,
            username
        );
        
        // Store safety number for display
        this.currentSafetyNumber = safetyNumber;
        
        // Update UI based on verification status
        const statusIcon = document.querySelector('#verificationStatus');
        const presenceStatusLabel = document.getElementById('chatPresenceStatus');
        if (statusIcon) {
            if (verification.status === 'verified') {
                statusIcon.innerHTML = '🔒';
                statusIcon.title = 'Secure connection - Key verified';
                statusIcon.className = 'verification-status verified';
            } else if (verification.status === 'new') {
                statusIcon.innerHTML = '🔓';
                statusIcon.title = 'New conversation - Verify safety number';
                statusIcon.className = 'verification-status new';
            } else if (verification.status === 'changed') {
                statusIcon.innerHTML = '⚠️';
                statusIcon.title = 'WARNING: Encryption key changed!';
                statusIcon.className = 'verification-status warning';
            }
        }

        if (presenceStatusLabel) {
            if (verification.status === 'verified') {
                presenceStatusLabel.textContent = 'Keys verified • End-to-end encryption active';
            } else if (verification.status === 'new') {
                presenceStatusLabel.textContent = 'New secure session • Verify safety number';
            } else if (verification.status === 'changed') {
                presenceStatusLabel.textContent = 'Key changed • Review safety number';
            } else {
                presenceStatusLabel.textContent = 'Secure session ready';
            }
        }
        
        // Show appropriate notification
        if (verification.status === 'new') {
            this.showSecurityNotification(
                `🔐 First conversation with ${username}`,
                'Click the lock icon to view and verify the safety number.',
                'info'
            );
        } else if (verification.status === 'changed') {
            this.showSecurityWarning(username, verification);
        } else if (verification.status === 'verified') {
            // Already verified, no notification needed
            console.log(`✅ Secure verified connection with ${username}`);
        }
    }

    /**
     * Show security warning for key changes
     */
    showSecurityWarning(username, verification) {
        const warningHtml = `
            <div class="security-warning alert alert-danger" role="alert">
                <h5>⚠️ Security Warning</h5>
                <p><strong>${verification.warning}</strong></p>
                <p>${verification.message}</p>
                <p><small>Key changed ${verification.daysSinceFirst} days after first exchange.</small></p>
                <div class="mt-3">
                    <button class="btn btn-sm btn-primary" onclick="chatApp.verifySafetyNumber()">
                        Verify Safety Number
                    </button>
                    <button class="btn btn-sm btn-warning" onclick="chatApp.acceptKeyChange('${username}', '${verification.newKey}')">
                        Accept Key Change
                    </button>
                </div>
            </div>
        `;
        
        // Insert warning at top of chat
        const chatMessages = document.getElementById('chatMessages');
        const warningDiv = document.createElement('div');
        warningDiv.innerHTML = warningHtml;
        chatMessages.insertBefore(warningDiv, chatMessages.firstChild);
    }

    /**
     * Show security notification
     */
    showSecurityNotification(title, message, type) {
        const notification = document.createElement('div');
        notification.className = `alert alert-${type} alert-dismissible fade show security-notification`;
        notification.innerHTML = `
            <strong>${title}</strong><br>
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        
        const container = document.querySelector('.chat-header') || document.body;
        container.appendChild(notification);
        
        // Auto-dismiss after 8 seconds
        setTimeout(() => {
            notification.remove();
        }, 8000);
    }

    /**
     * Show safety number verification modal
     */
    async verifySafetyNumber() {
        if (!this.currentSafetyNumber || !this.currentChat) {
            this.showNotification('Please select a chat first', 'warning');
            return;
        }
        
        const isVerified = cryptoManager.isVerified(this.currentChat);
        
        const modalHtml = `
            <div class="modal fade" id="safetyNumberModal" tabindex="-1">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">
                                🔐 Safety Number Verification
                            </h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <p><strong>Conversation with: ${this.currentChat}</strong></p>
                            
                            <div class="alert alert-info">
                                <small>
                                    This safety number is unique to this conversation. 
                                    Compare it with ${this.currentChat} using a trusted channel 
                                    (phone call, in person, etc.) to verify your connection is secure.
                                </small>
                            </div>
                            
                            <div class="safety-number-display">
                                <code style="font-size: 18px; display: block; text-align: center; padding: 20px; background: #f8f9fa; border-radius: 5px; line-height: 1.8;">
                                    ${this.currentSafetyNumber.split(' ').map((group, i) => 
                                        (i % 2 === 0 ? '<br>' : '') + group
                                    ).join(' ')}
                                </code>
                            </div>
                            
                            <div class="mt-3 text-center">
                                <p class="mb-2"><small>Verification Status:</small></p>
                                <div class="verification-badge ${isVerified ? 'verified' : 'unverified'}">
                                    ${isVerified ? '✅ Verified' : '⚠️ Not Verified'}
                                </div>
                            </div>
                            
                            <div class="alert alert-warning mt-3">
                                <small>
                                    <strong>How to verify:</strong><br>
                                    1. Ask ${this.currentChat} to open their safety number<br>
                                    2. Compare all 60 digits (they should match exactly)<br>
                                    3. If they match, click "Mark as Verified" below<br>
                                    4. If they don't match, DO NOT continue chatting (possible MITM attack)
                                </small>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                            ${!isVerified ? `
                                <button type="button" class="btn btn-success" onclick="chatApp.markUserAsVerified()">
                                    ✅ Mark as Verified
                                </button>
                            ` : ''}
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Remove existing modal if present
        const existingModal = document.getElementById('safetyNumberModal');
        if (existingModal) {
            existingModal.remove();
        }
        
        // Add modal to page
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        // Show modal
        const modal = new bootstrap.Modal(document.getElementById('safetyNumberModal'));
        modal.show();
    }

    /**
     * Mark current user as verified
     */
    markUserAsVerified() {
        if (!this.currentChat || !this.currentChatPublicKey) {
            return;
        }
        
        cryptoManager.markAsVerified(this.currentChat, this.currentChatPublicKey);
        
        // Update UI
        const statusIcon = document.querySelector('#verificationStatus');
        if (statusIcon) {
            statusIcon.innerHTML = '🔒';
            statusIcon.title = 'Secure verified connection';
            statusIcon.className = 'verification-status verified';
        }

        const presenceStatusLabel = document.getElementById('chatPresenceStatus');
        if (presenceStatusLabel) {
            presenceStatusLabel.textContent = 'Keys verified • End-to-end encryption active';
        }
        
        // Close modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('safetyNumberModal'));
        if (modal) {
            modal.hide();
        }
        
        this.showNotification(`✅ ${this.currentChat} marked as verified`, 'success');
    }

    /**
     * Accept a changed encryption key
     */
    acceptKeyChange(username, newKey) {
        cryptoManager.acceptKeyChange(username, newKey);
        
        // Remove warning
        document.querySelector('.security-warning')?.remove();
        
        // Update status
        const statusIcon = document.querySelector('#verificationStatus');
        if (statusIcon) {
            statusIcon.innerHTML = '🔓';
            statusIcon.title = 'Key updated - Please verify new safety number';
            statusIcon.className = 'verification-status new';
        }

        const presenceStatusLabel = document.getElementById('chatPresenceStatus');
        if (presenceStatusLabel) {
            presenceStatusLabel.textContent = 'Key updated • Please verify safety number';
        }
        
        this.showNotification(
            `Key change accepted. Please verify the new safety number with ${username}.`,
            'warning'
        );
    }

    /**
     * Store our ECDH public key on server
     */
    async storeMyPublicKey(publicKey) {
        try {
            const csrfToken = this.getCsrfToken();
            const response = await fetch(`/api/ecdh-key/${this.username}/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrfToken
                },
                body: JSON.stringify({ ecdh_public_key: publicKey })
            });
            
            if (!response.ok) {
                // Key might already be stored, that's okay
            }
        } catch (error) {
            console.error('Failed to store public key:', error);
        }
    }

    /**
     * Fetch other user's ECDH public key from server
     */
    async fetchPublicKey(username) {
        try {
            const response = await fetch(`/api/ecdh-key/${username}/`);
            if (!response.ok) {
                throw new Error('Public key not found');
            }
            const data = await response.json();
            return data.ecdh_public_key;
        } catch (error) {
            throw new Error(`Failed to fetch public key for ${username}: ${error.message}`);
        }
    }

    /**
     * Load message history
     */
    async loadMessages(username) {
        try {
            const response = await fetch(`/api/messages/${username}/`);
            const data = await response.json();
            
            if (data.error) {
                this.showNotification(data.error, 'danger');
                return;
            }
            
            // Clear messages container
            const container = document.getElementById('messagesContainer');
            container.innerHTML = '';
            
            // Get session key for this conversation
            const sessionKey = await cryptoManager.getSessionKey(username, this.username);
            
            // Display messages
            for (const msg of data.messages) {
                await this.displayMessage(msg, false, sessionKey);
            }
            
            // Scroll to bottom
            this.scrollToBottom();
            
        } catch (error) {
            console.error('Error loading messages:', error);
            this.showNotification('Failed to load messages', 'danger');
        }
    }

    /**
     * Send message
     */
    async sendMessage() {
        const input = document.getElementById('messageInput');
        const message = input.value.trim();
        
        if (!message || !this.currentChat) {
            return;
        }
        
        try {
            // Get conversation ID
            const users = [this.username, this.currentChat].sort();
            const conversationId = users.join('_');
            
            // Increment message count
            const msgCount = cryptoManager.incrementMessageCount(conversationId);
            
            // Rotate key if needed (every 100 messages)
            const keyData = await cryptoManager.rotateKey(conversationId, this.sessionKey, msgCount);
            this.sessionKey = keyData.key;
            const keyVersion = keyData.version;
            
            // Encrypt message with session key
            const ciphertext = await cryptoManager.encryptAES(message, this.sessionKey);
            
            // Send through WebSocket (server will echo it back with ID)
            this.socket.send(JSON.stringify({
                type: 'chat_message',
                receiver: this.currentChat,
                ciphertext: ciphertext,
                key_version: keyVersion,
                message_number: msgCount
            }));
            
            // Store the plaintext temporarily so we can use it when server echoes back
            if (!this.pendingMessages) {
                this.pendingMessages = new Map();
            }
            this.pendingMessages.set(ciphertext, message);
            
            // Clear input
            input.value = '';
            
        } catch (error) {
            console.error('Error sending message:', error);
            this.showNotification('Failed to send message', 'danger');
        }
    }

    /**
     * Receive message
     */
    async receiveMessage(message) {
        // Get the session key for this conversation
        const otherUser = message.sender === this.username ? message.receiver : message.sender;
        const sessionKey = await cryptoManager.getSessionKey(otherUser, this.username);
        
        // Check if this message is relevant to the current chat
        const isFromCurrentChat = message.sender === this.currentChat;
        const isSentToCurrentChat = message.sender === this.username && message.receiver === this.currentChat;
        
        if (isFromCurrentChat || isSentToCurrentChat) {
            // If this is our own message coming back from server, check for stored plaintext
            if (isSentToCurrentChat && this.pendingMessages && this.pendingMessages.has(message.ciphertext)) {
                // Use the stored plaintext for instant display
                message.plaintext = this.pendingMessages.get(message.ciphertext);
                this.pendingMessages.delete(message.ciphertext);
            }
            
            // Display the message
            await this.displayMessage(message, !message.plaintext, sessionKey);
            this.scrollToBottom();
            
            // Send read receipt (only for received messages, not our own)
            if (isFromCurrentChat && !isSentToCurrentChat) {
                this.socket.send(JSON.stringify({
                    type: 'read_receipt',
                    message_id: message.id
                }));
            }
        } else {
            // Show notification for new message from other users
            this.showNotification(`New message from ${message.sender}`, 'info');
        }
    }

    /**
     * Display message in UI
     */
    async displayMessage(message, decrypt = true, sessionKey = null) {
        const container = document.getElementById('messagesContainer');
        const isSent = message.sender === this.username;
        
        // Check if plaintext is already provided (for sent messages)
        let messageText;
        if (message.plaintext) {
            // Use the plaintext directly (for messages we just sent)
            messageText = message.plaintext;
        } else {
            // Need to decrypt - ensure we have a session key
            const otherUser = isSent ? message.receiver : message.sender;
            
            // Always ensure we have a session key
            let keyToUse = sessionKey || this.sessionKey;
            if (!keyToUse && otherUser) {
                keyToUse = await cryptoManager.getSessionKey(otherUser, this.username);
            }
            
            if (keyToUse) {
                // Decrypt messages with session key
                try {
                    messageText = await cryptoManager.decryptAES(message.ciphertext, keyToUse);
                    
                    // If decryption failed, try regenerating key once
                    if (messageText.includes('Unable to decrypt') && !message._retried) {
                        message._retried = true;
                        keyToUse = await cryptoManager.getSessionKey(otherUser, this.username);
                        messageText = await cryptoManager.decryptAES(message.ciphertext, keyToUse);
                    }
                } catch (error) {
                    messageText = '[Encrypted - Unable to decrypt]';
                }
            } else {
                messageText = '[No encryption key available]';
            }
        }
        
        // Create message element
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;
        messageDiv.dataset.messageId = message.id || '';
        
        const time = new Date(message.timestamp).toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        // Add delete button for sent messages
        const deleteBtn = isSent && message.id ? 
            `<button class="btn-delete-msg" title="Delete message" onclick="chatApp.deleteMessage(${message.id}, this.closest('.message'))">×</button>` : '';
        
        messageDiv.innerHTML = `
            <div class="message-bubble">
                ${!isSent ? `<div class="message-sender">${message.sender}</div>` : ''}
                <div class="message-text">${this.escapeHtml(messageText)}</div>
                <div class="message-info">
                    <span class="message-time">${time}</span>
                    <span class="encryption-badge">🔒</span>
                </div>
                ${deleteBtn}
            </div>
        `;
        
        container.appendChild(messageDiv);
    }

    /**
     * Handle typing indicator
     */
    handleTyping() {
        if (!this.currentChat) return;
        
        // Send typing notification
        this.socket.send(JSON.stringify({
            type: 'typing',
            receiver: this.currentChat,
            is_typing: true
        }));
        
        // Clear previous timeout
        clearTimeout(this.typingTimeout);
        
        // Set timeout to stop typing
        this.typingTimeout = setTimeout(() => {
            this.socket.send(JSON.stringify({
                type: 'typing',
                receiver: this.currentChat,
                is_typing: false
            }));
        }, 1000);
    }

    /**
     * Handle typing indicator from other user
     */
    handleTypingIndicator(data) {
        if (data.username === this.currentChat) {
            const indicator = document.getElementById('typingIndicator');
            if (indicator) {
                indicator.style.display = data.is_typing ? 'flex' : 'none';
            }
        }
    }

    /**
     * Update connection status
     */
    updateConnectionStatus(connected) {
        const status = document.createElement('div');
        status.className = `alert alert-${connected ? 'success' : 'danger'} alert-dismissible fade show`;
        status.style.position = 'fixed';
        status.style.top = '70px';
        status.style.right = '20px';
        status.style.zIndex = '9999';
        status.innerHTML = `
            ${connected ? '✓ Connected' : '⚠ Disconnected'}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        document.body.appendChild(status);
        
        setTimeout(() => status.remove(), 3000);
    }

    /**
     * Show notification
     */
    showNotification(message, type = 'info') {
        const alert = document.createElement('div');
        alert.className = `alert alert-${type} alert-dismissible fade show`;
        alert.style.position = 'fixed';
        alert.style.top = '70px';
        alert.style.right = '20px';
        alert.style.zIndex = '9999';
        alert.innerHTML = `
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        document.body.appendChild(alert);
        
        setTimeout(() => alert.remove(), 5000);
    }

    /**
     * Scroll messages to bottom
     */
    scrollToBottom() {
        const container = document.getElementById('messagesContainer');
        container.scrollTop = container.scrollHeight;
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    /**
     * Delete entire conversation
     */
    async deleteConversation() {
        if (!this.currentChat) {
            console.error('No chat selected');
            return;
        }
        
        // Confirm deletion
        if (!confirm(`Are you sure you want to delete all messages with ${this.currentChat}? This action cannot be undone.`)) {
            return;
        }
        
        try {
            const csrfToken = this.getCsrfToken();
            
            if (!csrfToken) {
                this.showNotification('Security token missing. Please refresh the page.', 'danger');
                return;
            }
            
            const response = await fetch(`/api/conversation/delete/${this.currentChat}/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrfToken
                }
            });
            
            const data = await response.json();
            
            if (response.ok) {
                this.showNotification(data.message, 'success');
                
                // Clear messages container
                document.getElementById('messagesContainer').innerHTML = `
                    <div class="text-center text-muted mt-5">
                        <i class="bi bi-trash" style="font-size: 3rem;"></i>
                        <p>Conversation deleted</p>
                    </div>
                `;
                
                // Clear localStorage session key
                cryptoManager.clearSessionKey(this.currentChat, this.username);
                
                // Reset UI
                setTimeout(() => {
                    this.currentChat = null;
                    document.getElementById('chatUsername').textContent = 'Select a user to start chatting';
                    const presenceStatus = document.getElementById('chatPresenceStatus');
                    if (presenceStatus) {
                        presenceStatus.textContent = 'Waiting for a secure connection';
                    }
                    const chatAvatar = document.getElementById('chatAvatar');
                    const chatAvatarText = document.getElementById('chatAvatarText');
                    if (chatAvatar) {
                        chatAvatar.style.display = 'none';
                        chatAvatar.classList.remove('is-active');
                    }
                    if (chatAvatarText) {
                        chatAvatarText.textContent = '';
                    }
                    document.getElementById('messageInput').disabled = true;
                    document.getElementById('sendButton').disabled = true;
                    document.getElementById('deleteConversationBtn').style.display = 'none';
                    const viewSafetyNumberBtn = document.getElementById('viewSafetyNumberBtn');
                    if (viewSafetyNumberBtn) {
                        viewSafetyNumberBtn.style.display = 'none';
                    }
                    const typingIndicator = document.getElementById('typingIndicator');
                    if (typingIndicator) {
                        typingIndicator.style.display = 'none';
                    }
                    document.querySelectorAll('.user-item').forEach(item => {
                        item.classList.remove('active');
                    });
                }, 1000);
                
            } else {
                console.error('Delete failed:', response.status, data);
                this.showNotification(data.error || 'Failed to delete conversation', 'danger');
            }
            
        } catch (error) {
            console.error('Error deleting conversation:', error);
            this.showNotification('Network error. Please check your connection.', 'danger');
        }
    }
    
    /**
     * Delete individual message
     */
    async deleteMessage(messageId, messageElement) {
        if (!confirm('Delete this message?')) {
            return;
        }
        
        try {
            const response = await fetch(`/api/message/delete/${messageId}/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': this.getCsrfToken()
                }
            });
            
            const data = await response.json();
            
            if (response.ok) {
                // Remove message from UI
                messageElement.style.opacity = '0';
                setTimeout(() => messageElement.remove(), 300);
                this.showNotification('Message deleted', 'success');
            } else {
                this.showNotification(data.error || 'Failed to delete message', 'danger');
            }
            
        } catch (error) {
            console.error('Error deleting message:', error);
            this.showNotification('Failed to delete message', 'danger');
        }
    }
    
    /**
     * Get CSRF token from cookie or DOM
     */
    getCsrfToken() {
        // Try to get from cookie first
        const name = 'csrftoken';
        let cookieValue = null;
        if (document.cookie && document.cookie !== '') {
            const cookies = document.cookie.split(';');
            for (let i = 0; i < cookies.length; i++) {
                const cookie = cookies[i].trim();
                if (cookie.substring(0, name.length + 1) === (name + '=')) {
                    cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                    break;
                }
            }
        }
        
        // If not in cookie, try to get from DOM (hidden input or meta tag)
        if (!cookieValue) {
            const csrfInput = document.querySelector('input[name="csrfmiddlewaretoken"]');
            if (csrfInput) {
                cookieValue = csrfInput.value;
            }
        }
        
        return cookieValue;
    }
}

// Initialize chat app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.chatApp = new ChatApp();
    
    // Start automatic key cleanup for Forward Secrecy
    cryptoManager.startAutoCleanup(60, 24);
});
