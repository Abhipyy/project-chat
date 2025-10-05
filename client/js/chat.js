/**
 * --- NEW HELPER FUNCTION ---
 * Generates a universally unique identifier (UUID) that works in all browser contexts.
 * This is a reliable fallback for when crypto.randomUUID() is not available (e.g., on http://).
 */
function generateUUID() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}

// Chat functionality
class ChatApp {
    constructor() {
        this.currentUser = null;
        this.selectedRoom = null;
        this.socket = null;
        this.sidebarManager = null;
        this.init();
    }

    async init() {
        await this.loadCurrentUser();
        if (!this.currentUser) return;
        this.initializeSidebar();
        this.setupEventListeners();
        this.connectToSocket();
    }

    async loadCurrentUser() {
        const userData = localStorage.getItem('currentUser');
        if (userData) {
            this.currentUser = JSON.parse(userData);
            document.getElementById('currentUserName').textContent = this.currentUser.username;
            const avatarChar = this.currentUser.username.charAt(0).toUpperCase();
            document.getElementById('currentUserAvatar').textContent = avatarChar;
        } else {
            window.location.href = '../index.html';
        }
    }

    initializeSidebar() {
        this.sidebarManager = new SidebarManager(this);
        this.sidebarManager.onRoomSelected = (room) => this.selectRoom(room);
    }

    connectToSocket() {
        this.socket = io();
        this.socket.emit('user_joined', { username: this.currentUser.username });

        this.socket.on('initial_data', (data) => {
            this.sidebarManager.populate(data.groups, data.users);
            const firstRoom = this.sidebarManager.getRoomById('general');
            if (firstRoom) {
                this.sidebarManager.selectRoomElement(firstRoom.id);
                this.selectRoom(firstRoom);
            }
        });

        this.socket.on('room_history', async ({ roomId, messages }) => {
            for (const msg of messages) {
                await window.chatStorage.saveMessage(msg);
            }
            if (this.selectedRoom && this.selectedRoom.id === roomId) {
                this.renderMessages(messages);
            }
        });

        this.socket.on('receive_message', (messageData) => {
            window.chatStorage.saveMessage(messageData).then(() => {
                if (this.selectedRoom && messageData.roomId === this.selectedRoom.id) {
                    this.handleIncomingMessage(messageData);
                }
            });
        });

        this.socket.on('update_online_users', (onlineUsers) => {
            this.sidebarManager.updateOnlineUsers(onlineUsers);
        });
    }

    setupEventListeners() {
        document.getElementById('messageForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.sendMessage();
        });
        document.getElementById('messageInput').addEventListener('input', (e) => {
            document.getElementById('charCount').textContent = e.target.value.length;
        });
        this.setupSettingsDropdown();
    }
    
    setupSettingsDropdown() {
        const settingsBtn = document.getElementById('settingsBtn');
        const dropdownMenu = document.getElementById('dropdownMenu');
        const logoutBtn = document.getElementById('logoutBtn');
        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdownMenu.classList.toggle('show');
        });
        logoutBtn.addEventListener('click', async () => {
            if (confirm('Are you sure you want to logout?')) {
                if (window.chatStorage) {
                    await window.chatStorage.clearAllData();
                }
                if(this.socket) this.socket.disconnect();
                localStorage.removeItem('currentUser');
                window.location.href = '../index.html';
            }
        });
        document.addEventListener('click', () => dropdownMenu.classList.remove('show'));
    }

    async selectRoom(room) {
        this.selectedRoom = room;
        this.updateChatHeader();
        
        const messages = await window.chatStorage.getGroupMessages(room.id);
        
        if (messages.length === 0 && this.socket) {
            this.socket.emit('request_room_history', { roomId: room.id });
        } else {
            this.renderMessages(messages);
        }
    }

    updateChatHeader() {
        if (!this.selectedRoom) return;
        document.getElementById('roomIcon').textContent = '🔒';
        document.getElementById('roomName').textContent = this.selectedRoom.name;
        document.getElementById('roomDescription').textContent = this.selectedRoom.description;
        document.getElementById('messageInput').placeholder = `Message ${this.selectedRoom.name}...`;
    }

    renderMessages(messages) {
        const messagesContainer = document.getElementById('messagesContainer');
        messagesContainer.innerHTML = '';
        messages.forEach(msg => {
            const isOwn = msg.username === this.currentUser.username;
            const messageElement = document.createElement('div');
            messageElement.className = `message ${isOwn ? 'own' : ''}`;
            const senderName = isOwn ? 'You' : msg.username;
            const avatarChar = msg.username.charAt(0).toUpperCase();
            messageElement.innerHTML = `<div class="message-avatar">${avatarChar}</div><div class="message-bubble"><div class="message-sender">${senderName}</div><div class="message-content">${msg.content}</div><div class="message-time">${new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div></div>`;
            messagesContainer.appendChild(messageElement);
        });
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    sendMessage() {
        const messageInput = document.getElementById('messageInput');
        const content = messageInput.value.trim();
        if (!content || !this.selectedRoom || !this.socket) return;
        
        const messageData = {
            // --- CRITICAL CHANGE: Use the new helper function ---
            messageId: generateUUID(),
            content: content,
            roomId: this.selectedRoom.id,
            username: this.currentUser.username,
            timestamp: new Date().toISOString()
        };
        
        window.chatStorage.saveMessage(messageData).then(() => {
            this.handleIncomingMessage(messageData); 
        });

        this.socket.emit('send_message', messageData);
        
        messageInput.value = '';
        document.getElementById('charCount').textContent = '0';
        messageInput.focus();
    }
    
    async handleIncomingMessage(messageData) {
        const messages = await window.chatStorage.getGroupMessages(messageData.roomId);
        this.renderMessages(messages);
    }
}

document.addEventListener('DOMContentLoaded', () => new ChatApp());
