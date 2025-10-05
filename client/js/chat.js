// In client/js/chat.js

function generateUUID() {
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
}

class ChatApp {
    constructor() {
        this.currentUser = null;
        this.selectedRoom = null;
        this.currentView = 'group';
        this.socket = null;
        this.sidebarManager = null;
        this.unreadMessages = new Map();
        this.activeDMs = new Map();
        this.onlineUsers = new Set();
        this.init();
    }

    async init() {
        await this.loadCurrentUser();
        if (!this.currentUser) return;
        this.initializeSidebar();
        this.setupEventListeners();
        this.setupUserListToggle();
        this.connectToSocket();
        document.addEventListener('startDM', (e) => this.startDM(e.detail.user));
    }

    async loadCurrentUser() {
        const userData = localStorage.getItem('currentUser');
        if (userData) {
            this.currentUser = JSON.parse(userData);
            document.getElementById('currentUserName').textContent = this.currentUser.username;
            document.getElementById('currentUserAvatar').textContent = this.currentUser.username.charAt(0).toUpperCase();
        } else {
            window.location.href = '../index.html';
        }
    }

    initializeSidebar() {
        this.sidebarManager = new SidebarManager(this);
        this.sidebarManager.onRoomSelected = (room) => this.selectRoom(room, 'group');
    }

    connectToSocket() {
        this.socket = io();
        this.socket.emit('user_joined', { username: this.currentUser.username });

        this.socket.on('initial_data', (data) => {
            this.sidebarManager.populate(data.groups, data.users);
            if (data.directMessagePartners) {
                data.directMessagePartners.forEach(partner => {
                    if (!this.activeDMs.has(partner.username)) {
                        this.activeDMs.set(partner.username, partner);
                    }
                });
                this.renderDMList();
            }
            const firstRoom = this.sidebarManager.getRoomById('general');
            if (firstRoom && !this.selectedRoom) {
                this.sidebarManager.selectRoomElement(firstRoom.id);
                this.selectRoom(firstRoom, 'group');
            }
        });
        
        this.socket.on('room_history', async ({ roomId, messages }) => {
            for (const msg of messages) await window.chatStorage.saveMessage(msg, false);
            if (this.currentView === 'group' && this.selectedRoom?.id === roomId) this.renderMessages(messages, 'group');
        });

        this.socket.on('receive_message', (messageData) => {
            if ((this.currentView !== 'group' || this.selectedRoom?.id !== messageData.roomId) && messageData.senderSocketId !== this.socket.id) {
                const count = this.unreadMessages.get(messageData.roomId) || 0;
                this.unreadMessages.set(messageData.roomId, count + 1);
                this.updateNotificationBadge(messageData.roomId, true);
            }
            window.chatStorage.saveMessage(messageData, false).then(() => {
                if (this.currentView === 'group' && this.selectedRoom?.id === messageData.roomId) this.appendMessage(messageData, 'group');
            });
        });

        this.socket.on('update_online_users', (onlineUsersList) => {
            this.onlineUsers = new Set(onlineUsersList.map(u => u.username));
            this.sidebarManager.updateOnlineUsers(onlineUsersList);
            this.renderDMList();
            this.updateChatHeader();
        });

        this.socket.on('receive_dm', (messageData) => {
            this.startDM({ username: messageData.sender }, false);
            const dmRoomId = this.getDMRoomId(messageData.sender);
            if (this.currentView !== 'dm' || this.selectedRoom?.username !== messageData.sender) {
                const count = this.unreadMessages.get(dmRoomId) || 0;
                this.unreadMessages.set(dmRoomId, count + 1);
                this.updateDMNotificationBadge(messageData.sender, true);
            }
            window.chatStorage.saveMessage(messageData, true).then(() => {
                if (this.currentView === 'dm' && this.selectedRoom?.username === messageData.sender) this.appendMessage(messageData, 'dm');
            });
        });

        this.socket.on('dm_history', async ({ withUser, messages }) => {
            for (const msg of messages) await window.chatStorage.saveMessage(msg, true);
            if (this.currentView === 'dm' && this.selectedRoom?.username === withUser) this.renderMessages(messages, 'dm');
        });

        this.socket.on('dm_conversation_deleted', ({ withUser }) => {
            this.activeDMs.delete(withUser);
            this.renderDMList();
            if (this.currentView === 'dm' && this.selectedRoom?.username === withUser) {
                this.selectRoom(this.sidebarManager.getRoomById('general'), 'group');
            }
        });
    }

    startDM(user, shouldSelect = true) {
        if (user.username === this.currentUser.username) return;
        if (!this.activeDMs.has(user.username)) {
            this.activeDMs.set(user.username, user);
            this.renderDMList();
        }
        if (shouldSelect) this.selectRoom(user, 'dm');
    }

    renderDMList() {
        const dmList = document.getElementById('dmList');
        dmList.innerHTML = '';
        this.activeDMs.forEach(user => {
            const isOnline = this.onlineUsers.has(user.username);
            const userItem = document.createElement('div');
            userItem.className = 'user-item';
            if (this.currentView === 'dm' && this.selectedRoom?.username === user.username) userItem.classList.add('active');
            
            const avatarChar = user.username.charAt(0).toUpperCase();

            // ✅ FIX: Corrected typo from "class." to "class="
            userItem.innerHTML = `
            <div class="user-item-avatar ${isOnline ? 'online' : 'offline'}">
                <span>${avatarChar}</span>
            </div>
            <div class="user-item-info">
                <div class="user-item-name">${user.username}</div>
            </div>
            <div class="notification-badge hidden"></div>
            <button class="delete-dm-btn" data-username="${user.username}">×</button>
        `;
            
            userItem.addEventListener('click', e => {
                if (!e.target.classList.contains('delete-dm-btn')) this.selectRoom(user, 'dm');
            });
            userItem.querySelector('.delete-dm-btn').addEventListener('click', e => {
                e.stopPropagation();
                if (confirm(`Delete chat history with ${user.username}? This cannot be undone.`)) {
                    this.socket.emit('delete_dm_conversation', { targetUser: user.username });
                }
            });
            dmList.appendChild(userItem);
        });
    }

    setupEventListeners() {
        document.getElementById('messageForm').addEventListener('submit', e => {
            e.preventDefault(); this.sendMessage();
        });
        document.getElementById('messageInput').addEventListener('input', e => {
            document.getElementById('charCount').textContent = e.target.value.length;
        });
        // ✅ FIX: Added this function call back
        this.setupSettingsDropdown();
    }
    
    // ✅ FIX: Added this entire function back in
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
                if (this.socket) this.socket.emit('user_logged_out');
                await window.chatStorage.clearAllData();
                if (this.socket) this.socket.disconnect();
                localStorage.removeItem('currentUser');
                window.location.href = '../index.html';
            }
        });
        document.addEventListener('click', () => dropdownMenu.classList.remove('show'));
    }

    async selectRoom(room, type = 'group') {
        this.currentView = type;
        this.selectedRoom = room;

        document.querySelectorAll('.channel-item, .dm-list .user-item').forEach(el => el.classList.remove('active'));
        if (type === 'group') {
            document.querySelector(`.channel-item[data-room-id="${room.id}"]`)?.classList.add('active');
            this.unreadMessages.delete(room.id);
            this.updateNotificationBadge(room.id, false);
        } else {
            this.renderDMList();
            const dmRoomId = this.getDMRoomId(room.username);
            this.unreadMessages.delete(dmRoomId);
            this.updateDMNotificationBadge(room.username, false);
        }
        
        this.updateChatHeader();
        
        const messagesContainer = document.getElementById('messagesContainer');
        messagesContainer.innerHTML = '<div class="spinner"></div>';
        
        if (type === 'group') {
            const messages = await window.chatStorage.getGroupMessages(room.id);
            this.renderMessages(messages, 'group');
            if (messages.length === 0) this.socket.emit('request_room_history', { roomId: room.id });
        } else {
            const messages = await window.chatStorage.getDMMessages(this.currentUser.username, room.username);
            this.renderMessages(messages, 'dm');
            this.socket.emit('request_dm_history', { targetUser: room.username });
        }
    }

    updateNotificationBadge(roomId, show) {
        const channelElement = document.querySelector(`.channel-item[data-room-id="${roomId}"]`);
        if (!channelElement) return;
        const badge = channelElement.querySelector('.notification-badge');
        if (badge) {
            if (show) {
                const count = this.unreadMessages.get(roomId);
                badge.textContent = count > 9 ? '9+' : count;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }
    }

    updateDMNotificationBadge(username, show) {
        const dmItem = document.querySelector(`.dm-list .delete-dm-btn[data-username="${username}"]`)?.closest('.user-item');
        if (!dmItem) return;
        const badge = dmItem.querySelector('.notification-badge');
        if (badge) {
            if (show) {
                const dmRoomId = this.getDMRoomId(username);
                const count = this.unreadMessages.get(dmRoomId);
                badge.textContent = count > 9 ? '9+' : count;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }
    }

    updateChatHeader() {
        if (!this.selectedRoom) return;
        if (this.currentView === 'group') {
            document.getElementById('roomIcon').innerHTML = '🔒';
            document.getElementById('roomName').textContent = this.selectedRoom.name;
            document.getElementById('roomDescription').textContent = this.selectedRoom.description || 'Group channel';
            document.getElementById('messageInput').placeholder = `Message ${this.selectedRoom.name}...`;
        } else {
            const isOnline = this.onlineUsers.has(this.selectedRoom.username);
            document.getElementById('roomIcon').innerHTML = `<div class="user-item-avatar"><span>${this.selectedRoom.username.charAt(0).toUpperCase()}</span></div>`;
            document.getElementById('roomName').textContent = this.selectedRoom.username;
            document.getElementById('roomDescription').textContent = isOnline ? 'Online' : 'Offline';
            document.getElementById('messageInput').placeholder = `Message @${this.selectedRoom.username}...`;
        }
    }

    renderMessages(messages, type) {
        const messagesContainer = document.getElementById('messagesContainer');
        messagesContainer.innerHTML = '';
        messages.forEach(msg => this.appendMessage(msg, type, false));
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    appendMessage(msg, type, scroll = true) {
        const messagesContainer = document.getElementById('messagesContainer');
        const isOwn = (type === 'group' && msg.username === this.currentUser.username) || (type === 'dm' && msg.sender === this.currentUser.username);
        const messageElement = document.createElement('div');
        messageElement.className = `message ${isOwn ? 'own' : ''}`;
        
        const senderName = type === 'group' ? msg.username : msg.sender;
        const avatarChar = senderName.charAt(0).toUpperCase();
        
        if (isOwn) {
            messageElement.innerHTML = `<div class="message-bubble"><div class="message-content">${msg.content}</div><div class="message-time">${new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div></div>`;
        } else {
            messageElement.innerHTML = `<div class="message-avatar">${avatarChar}</div><div class="message-bubble"><div class="message-sender">${senderName}</div><div class="message-content">${msg.content}</div><div class="message-time">${new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div></div>`;
        }
        
        messagesContainer.appendChild(messageElement);
        if (scroll) messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // ✅ FIX: Corrected logic to properly save and display messages
    sendMessage() {
        const messageInput = document.getElementById('messageInput');
        const content = messageInput.value.trim();
        if (!content || !this.selectedRoom || !this.socket) return;
        
        const messageData = {
            messageId: generateUUID(),
            content: content,
            timestamp: new Date().toISOString()
        };

        if (this.currentView === 'group') {
            messageData.roomId = this.selectedRoom.id;
            messageData.username = this.currentUser.username;
            this.socket.emit('send_message', messageData);
            window.chatStorage.saveMessage(messageData, false);
        } else {
            messageData.sender = this.currentUser.username;
            messageData.receiver = this.selectedRoom.username;
            this.socket.emit('send_dm', messageData);
            window.chatStorage.saveMessage(messageData, true);
        }
        
        // This correctly adds the new message to the screen
        this.appendMessage(messageData, this.currentView);
        
        messageInput.value = '';
        document.getElementById('charCount').textContent = '0';
        messageInput.focus();
    }
    
    setupUserListToggle() {
        const header = document.querySelector('.sidebar-section-header');
        const btn = document.getElementById('toggleUsersBtn');
        const container = document.getElementById('usersListContainer');
        header.addEventListener('click', () => {
            btn.classList.toggle('open');
            container.classList.toggle('collapsed');
        });
    }

    getDMRoomId(otherUsername) {
        return [this.currentUser.username, otherUsername].sort().join('-');
    }
}

document.addEventListener('DOMContentLoaded', () => new ChatApp());