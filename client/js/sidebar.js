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
        this.setupEventListeners();
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

    setupEventListeners() {
        // Group creation modal logic (this is pure UI and doesn't need to change much)
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

        // "Create New Group" button
        const createGroupItem = document.createElement('div');
        createGroupItem.className = 'channel-item create-group';
        createGroupItem.innerHTML = `
            <span class="channel-icon">➕</span>
            <div class="channel-details">
                <div class="channel-name">Create New Group</div>
            </div>
        `;
        createGroupItem.addEventListener('click', () => this.showCreateGroupModal());
        channelsList.appendChild(createGroupItem);

        // Render channels received from the server
        this.rooms.forEach(room => {
            const channelItem = document.createElement('div');
            channelItem.className = 'channel-item';
            channelItem.dataset.roomId = room.id; // Use data attributes for IDs
            if (this.selectedRoomId === room.id) {
                channelItem.classList.add('active');
            }
            
            const deleteButton = room.id !== 'general' 
                ? `<button class="delete-channel-btn" title="Delete Group">×</button>` 
                : '';
            
            channelItem.innerHTML = `
                <span class="channel-icon">🔒</span>
                <div class="channel-details">
                    <div class="channel-name">${room.name}</div>
                </div>
                ${deleteButton}
            `;
            
            // Event listener for selecting the room
            channelItem.addEventListener('click', (e) => {
                if (!e.target.classList.contains('delete-channel-btn')) {
                    this.selectRoomElement(room.id);
                    this.onRoomSelected(room);
                }
            });
            
            // Event listener for the delete button
            const deleteBtn = channelItem.querySelector('.delete-channel-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation(); // Prevent room selection
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
                <div class="user-item-avatar">
                    <span>${avatarChar}</span>
                    <div class="online-indicator"></div>
                </div>
                <div class="user-item-info">
                    <div class="user-item-name">${user.username}</div>
                </div>
            `;
            usersList.appendChild(userItem);
        });
    }

    // --- MODIFIED: Sends create request to the server ---
    handleCreateGroup() {
        const groupName = document.getElementById('groupName').value.trim();
        const groupDescription = document.getElementById('groupDescription').value.trim();
        
        if (!groupName) {
            alert('Please enter a group name');
            return;
        }

        // Emit an event to the server to create the group
        this.chatApp.socket.emit('create_group', { 
            name: groupName, 
            description: groupDescription 
        });
        
        this.hideCreateGroupModal();
    }

    // --- MODIFIED: Sends delete request to the server ---
    deleteChannel(roomId) {
        const room = this.getRoomById(roomId);
        if (room && confirm(`Are you sure you want to delete the group "${room.name}"? This cannot be undone.`)) {
            // Emit an event to the server to delete the group
            this.chatApp.socket.emit('delete_group', { roomId: roomId });
        }
    }
    
    // UI Helper to show/hide the modal
    showCreateGroupModal() {
        document.getElementById('createGroupModal').style.display = 'flex';
        document.getElementById('groupName').focus();
    }

    hideCreateGroupModal() {
        document.getElementById('createGroupModal').style.display = 'none';
        document.getElementById('createGroupForm').reset();
    }
    
    // UI Helper to visually select a room
    selectRoomElement(roomId) {
        this.selectedRoomId = roomId;
        document.querySelectorAll('.channel-item').forEach(el => {
            el.classList.remove('active');
            if (el.dataset.roomId === roomId) {
                el.classList.add('active');
            }
        });
    }

    // Helper to find a room by its ID
    getRoomById(roomId) {
        return this.rooms.find(r => r.id === roomId);
    }
}