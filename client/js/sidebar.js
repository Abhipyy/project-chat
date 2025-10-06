// Sidebar functionality for channels and users
class SidebarManager {
    constructor(chatApp) {
        this.chatApp = chatApp; // Reference to the main chat app to access the socket
        this.rooms = [];
        this.users = [];
        this.selectedRoomId = null;
        
        // This is a callback function that the ChatApp will set.
        // It's used to tell the ChatApp that a new room has been selected.
        this.onRoomSelected = () => {};

        this.init();
    }

    init() {
        // We no longer load data here. We only set up event listeners for the UI.
        this.setupModalEventListeners();
    }
    
    // --- NEW: This method is called by ChatApp when initial data arrives from the server ---
    populate(groups, users) {
        this.rooms = groups;
        this.users = users;
        this.renderChannels();
        this.renderUsers();
    }

    // --- NEW: This method is called by ChatApp when the online user list is updated ---
    updateOnlineUsers(onlineUsers) {
        this.users = onlineUsers;
        this.renderUsers();
        // Note: We might want to update the member count in channels here as well in a future version.
    }

    setupModalEventListeners() {
        const modal = document.getElementById('createGroupModal');
        const closeButtons = document.querySelectorAll('.close-modal');
        const createGroupForm = document.getElementById('createGroupForm');

        closeButtons.forEach(button => {
            button.addEventListener('click', () => this.hideCreateGroupModal());
        });

        createGroupForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleCreateGroup();
        });

        window.addEventListener('click', (e) => {
            if (e.target === modal) this.hideCreateGroupModal();
        });
    }

    renderChannels() {
        const channelsList = document.getElementById('channelsList');
        channelsList.innerHTML = '';
        const createGroupItem = document.createElement('div');
        createGroupItem.className = 'channel-item create-group';
        createGroupItem.innerHTML = `<span class="channel-icon">➕</span><div class="channel-details"><div class="channel-name">Create New Group</div></div>`;
        createGroupItem.addEventListener('click', () => this.showCreateGroupModal());
        channelsList.appendChild(createGroupItem);

        this.rooms.forEach(room => {
            const channelItem = document.createElement('div');
            channelItem.className = 'channel-item';
            channelItem.dataset.roomId = room.id;
            if (this.selectedRoomId === room.id) channelItem.classList.add('active');
            const deleteButton = room.id !== 'general' ? `<button class="delete-channel-btn" title="Delete Group">×</button>` : '';
            channelItem.innerHTML = `<span class="channel-icon">🔒</span><div class="channel-details"><div class="channel-name">${room.name}</div></div><div class="notification-badge hidden"></div> ${deleteButton}`;
            
            channelItem.addEventListener('click', (e) => {
                if (!e.target.classList.contains('delete-channel-btn')) {
                    this.selectRoomElement(room.id);
                    this.onRoomSelected(room);
                }
            });
            
            const deleteBtn = channelItem.querySelector('.delete-channel-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.deleteChannel(room.id);
                });
            }
            channelsList.appendChild(channelItem);
        });
    }

    renderUsers() {
        const usersList = document.getElementById('usersList');
        const onlineCount = document.getElementById('onlineCount');
        usersList.innerHTML = '';
        onlineCount.textContent = this.users.length;

        this.users.forEach(user => {
            // Don't show the current user in the online list
            if (user.username === this.chatApp.currentUser.username) {
                onlineCount.textContent = this.users.length -1;
                return;
            };

            const userItem = document.createElement('div');
            userItem.className = 'user-item';
            const avatarChar = user.username.charAt(0).toUpperCase();

            userItem.innerHTML = `
            <div class="user-item-avatar online">
                <span>${avatarChar}</span>
            </div>
            <div class="user-item-info">
                <div class="user-item-name">${user.username}</div>
            </div>
        `;
            userItem.addEventListener('click', () => {
                // This is a placeholder for now. The main ChatApp will handle the logic.
                // We'll use a custom event to notify the main app.
                const event = new CustomEvent('startDM', { detail: { user: user } });
                document.dispatchEvent(event);
            });
            usersList.appendChild(userItem);
        });
    }

    // --- MODIFIED: Sends create request to the server ---
    handleCreateGroup() {
        const groupName = document.getElementById('groupName').value.trim();
        const groupDescription = document.getElementById('groupDescription').value.trim();
        const selectedMembers = Array.from(document.querySelectorAll('#memberSelectionList input:checked')).map(cb => cb.value);

        if (!groupName) return alert('Please enter a group name');
        
        this.chatApp.socket.emit('create_group', { 
            name: groupName, 
            description: groupDescription,
            members: selectedMembers 
        });
        
        this.hideCreateGroupModal();
    }

    // --- MODIFIED: Sends delete request to the server ---
    deleteChannel(roomId) {
        const room = this.getRoomById(roomId);
        if (room && confirm(`Are you sure you want to delete the group "${room.name}"? This cannot be undone.`)) {
            this.chatApp.socket.emit('delete_group', { roomId: roomId });
        }
    }
    
    showCreateGroupModal() {
        const memberList = document.getElementById('memberSelectionList');
        memberList.innerHTML = '';
        this.chatApp.onlineUsers.forEach(username => {
            if (username === this.chatApp.currentUser.username) return;
            const item = document.createElement('div');
            item.className = 'member-selection-item';
            item.innerHTML = `<input type="checkbox" id="user-${username}" name="members" value="${username}"><label for="user-${username}">${username}</label>`;
            memberList.appendChild(item);
        });
        document.getElementById('createGroupModal').style.display = 'flex';
        document.getElementById('groupName').focus();
    }

    hideCreateGroupModal() {
        document.getElementById('createGroupModal').style.display = 'none';
        document.getElementById('createGroupForm').reset();
    }
    
    selectRoomElement(roomId) {
        this.selectedRoomId = roomId;
        document.querySelectorAll('.channel-item').forEach(el => {
            el.classList.remove('active');
            if (el.dataset.roomId === roomId) el.classList.add('active');
        });
    }

    getRoomById(roomId) {
        return this.rooms.find(r => r.id === roomId);
    }
}