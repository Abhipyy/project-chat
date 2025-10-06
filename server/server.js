// --- Imports ---
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const bcrypt = require('bcrypt');
const crypto = require('crypto'); // Used for generating unique IDs
const os = require('os');

// --- Basic Setup ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const SALT_ROUNDS = 10;
let db;
const onlineUsers = new Map(); // Stores { socket.id -> { username } }

app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
});

// --- Middleware & DB Init ---
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'client')));
// In server.js

async function initDb() {
    const dbPath = path.join(__dirname, 'database.db');
    db = await open({ filename: dbPath, driver: sqlite3.Database });
    console.log('✅ Connected to SQLite database at:', dbPath);
    
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT, 
            username TEXT UNIQUE NOT NULL, 
            password TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS groups (
            id TEXT PRIMARY KEY, 
            name TEXT NOT NULL, 
            description TEXT
        );
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT, 
            messageId TEXT UNIQUE NOT NULL, 
            roomId TEXT NOT NULL, 
            username TEXT NOT NULL, 
            content TEXT NOT NULL, 
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS direct_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT, 
            messageId TEXT UNIQUE NOT NULL, 
            sender TEXT NOT NULL, 
            receiver TEXT NOT NULL, 
            content TEXT NOT NULL, 
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- ✅ This is the single, corrected table definition
        CREATE TABLE IF NOT EXISTS group_members (
            groupId TEXT NOT NULL,
            username TEXT NOT NULL,
            last_read_timestamp DATETIME,
            PRIMARY KEY (groupId, username),
            FOREIGN KEY (groupId) REFERENCES groups(id) ON DELETE CASCADE,
            FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
        );
    `);
    
    await db.run(`INSERT INTO groups (id, name, description) VALUES ('general', 'Secure General', 'Main encrypted channel') ON CONFLICT(id) DO NOTHING`);
    console.log('🏛️ Database tables are ready.');
}

// --- Auth Routes (No changes here) ---
app.post('/signup', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: "Username and password are required." });
    try {
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        await db.run('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashedPassword]);
        
        // ✅ NEW: Automatically add the new user to the 'general' group
        await db.run('INSERT INTO group_members (groupId, username) VALUES (?, ?)', ['general', username]);

        res.status(201).json({ message: "Account created successfully! Please log in." });
    } catch (error) {
        res.status(error.code === 'SQLITE_CONSTRAINT' ? 409 : 500).json({ message: "Username already exists or server error." });
    }
});
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: "Username and password are required." });
    try {
        const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);
        const match = user ? await bcrypt.compare(password, user.password) : false;
        if (match) {
            res.status(200).json({ message: "Login successful!", user: { username: user.username } });
        } else {
            res.status(401).json({ message: "Invalid username or password." });
        }
    } catch (error) {
        res.status(500).json({ message: "Server error during login." });
    }
});

// --- Helper functions ---
function broadcastOnlineUsers() {
    const allUsernames = Array.from(onlineUsers.values()).map(user => user.username);
    const uniqueUsernames = [...new Set(allUsernames)];
    const userListPayload = uniqueUsernames.map(username => ({ username }));
    io.emit('update_online_users', userListPayload);
}

// ✅ NEW HELPER to find a user's socket by their username
function findSocketByUsername(username) {
    for (const [id, socketData] of onlineUsers.entries()) {
        if (socketData.username === username) {
            return io.sockets.sockets.get(id);
        }
    }
    return null;
}


// --- Real-Time Socket.IO Logic ---
io.on('connection', (socket) => {
    socket.on('user_joined', async ({ username }) => {
        console.log(`✅ User connected: ${username} (Socket ID: ${socket.id})`);
        onlineUsers.set(socket.id, { username });
        broadcastOnlineUsers();

        // ✅ THIS IS THE CORRECTED QUERY
        // It now correctly fetches the last_read_timestamp for each group
        const userGroups = await db.all(`
            SELECT g.id, g.name, g.description, gm.last_read_timestamp 
            FROM groups g
            JOIN group_members gm ON g.id = gm.groupId
            WHERE gm.username = ?
        `, [username]);

        // This loop calculates the unread messages for each group
        for (const group of userGroups) {
            const result = await db.get(
                `SELECT COUNT(messageId) AS unreadCount 
                FROM messages 
                WHERE roomId = ? AND timestamp > ?`,
                [group.id, group.last_read_timestamp || 0]
            );
            group.unreadCount = result.unreadCount;
        }

        const dmPartners = await db.all(`
            SELECT DISTINCT receiver AS username FROM direct_messages WHERE sender = ?
            UNION
            SELECT DISTINCT sender AS username FROM direct_messages WHERE receiver = ?
        `, [username, username]);

        socket.emit('initial_data', { groups: userGroups, directMessagePartners: dmPartners });
    });

    socket.on('mark_channel_as_read', async ({ roomId }) => {
        const user = onlineUsers.get(socket.id);
        if (!user) return;
        
        // Update the last_read_timestamp to the current time for that user and group
        await db.run(
            `UPDATE group_members SET last_read_timestamp = CURRENT_TIMESTAMP 
            WHERE groupId = ? AND username = ?`,
            [roomId, user.username]
        );
    });

    socket.on('request_room_history', async ({ roomId }) => {
        const messages = await db.all('SELECT * FROM messages WHERE roomId = ? ORDER BY timestamp ASC', [roomId]);
        socket.emit('room_history', { roomId, messages });
    });

    socket.on('send_message', async (messageData) => {
        const user = onlineUsers.get(socket.id);
        if (!user || user.username !== messageData.username) return;

        try {
            // ✅ MODIFIED: The security check is now skipped if the room is 'general'
            if (messageData.roomId !== 'general') {
                const memberCheck = await db.get('SELECT * FROM group_members WHERE groupId = ? AND username = ?', [messageData.roomId, user.username]);
                if (!memberCheck) {
                    console.warn(`SECURITY: User ${user.username} tried to send message to group ${messageData.roomId} but is not a member.`);
                    return;
                }
            }

            // --- The rest of the function remains the same ---
            
            await db.run('INSERT INTO messages (messageId, roomId, username, content, timestamp) VALUES (?, ?, ?, ?, ?)', [messageData.messageId, messageData.roomId, messageData.username, messageData.content, messageData.timestamp]);
            
            const broadcastData = { ...messageData, senderSocketId: socket.id };

            const members = await db.all('SELECT username FROM group_members WHERE groupId = ?', [messageData.roomId]);
            
            // Add all online users to the broadcast list if the room is 'general'
            if (messageData.roomId === 'general') {
                const allOnlineUsernames = Array.from(onlineUsers.values()).map(u => u.username);
                // Combine and remove duplicates
                const broadcastUsernames = [...new Set([...members.map(m => m.username), ...allOnlineUsernames])];
                
                broadcastUsernames.forEach(username => {
                    const memberSocket = findSocketByUsername(username);
                    if (memberSocket && memberSocket.id !== socket.id) {
                        memberSocket.emit('receive_message', broadcastData);
                    }
                });
            } else {
                // Original logic for private groups
                members.forEach(member => {
                    const memberSocket = findSocketByUsername(member.username);
                    if (memberSocket && memberSocket.id !== socket.id) {
                        memberSocket.emit('receive_message', broadcastData);
                    }
                });
            }
            
            console.log(`💬 [${broadcastData.roomId}] ${user.username}: ${broadcastData.content}`);
        } catch (error) {
            console.error("DATABASE ERROR on send_message:", error);
        }
    });
    
    // ✅ --- NEW DIRECT MESSAGE EVENTS ---

    // Event to fetch DM history
    socket.on('request_dm_history', async ({ targetUser }) => {
        const currentUser = onlineUsers.get(socket.id)?.username;
        if (!currentUser) return;

        const messages = await db.all(
            `SELECT * FROM direct_messages 
             WHERE (sender = ? AND receiver = ?) OR (sender = ? AND receiver = ?) 
             ORDER BY timestamp ASC`,
            [currentUser, targetUser, targetUser, currentUser]
        );
        socket.emit('dm_history', { withUser: targetUser, messages });
    });

    // Event to handle sending a DM
    socket.on('send_dm', async (messageData) => {
        const senderUsername = onlineUsers.get(socket.id)?.username;
        if (!senderUsername || senderUsername !== messageData.sender) return;

        // Save message to DB
        await db.run(
            'INSERT INTO direct_messages (messageId, sender, receiver, content, timestamp) VALUES (?, ?, ?, ?, ?)',
            [messageData.messageId, messageData.sender, messageData.receiver, messageData.content, messageData.timestamp]
        );

        // Find the receiver's socket to send the message in real-time
        const receiverSocket = findSocketByUsername(messageData.receiver);
        if (receiverSocket) {
            receiverSocket.emit('receive_dm', messageData);
        }
        console.log(`💬 [DM] ${messageData.sender} to ${messageData.receiver}: ${messageData.content}`);
    });

    // Event to handle deleting a DM conversation
    socket.on('delete_dm_conversation', async ({ targetUser }) => {
        const currentUser = onlineUsers.get(socket.id)?.username;
        if (!currentUser) return;

        await db.run(
            `DELETE FROM direct_messages 
             WHERE (sender = ? AND receiver = ?) OR (sender = ? AND receiver = ?)`,
            [currentUser, targetUser, targetUser, currentUser]
        );
        console.log(`🗑️ [DM] Conversation between ${currentUser} and ${targetUser} deleted.`);
        socket.emit('dm_conversation_deleted', { withUser: targetUser });
    });

    // --- END of new DM events ---

    socket.on('create_group', async ({ name, description, members }) => {
      const creator = onlineUsers.get(socket.id)?.username;
      if (!creator || !members || members.length === 0) return;

      const newGroupId = `group_${crypto.randomUUID()}`;
      await db.run('INSERT INTO groups (id, name, description) VALUES (?, ?, ?)', [newGroupId, name, description || '']);
      
      const allMembers = [...new Set([...members, creator])];
      const insertPromises = allMembers.map(username => {
          return db.run('INSERT INTO group_members (groupId, username) VALUES (?, ?)', [newGroupId, username]);
      });
      await Promise.all(insertPromises);

      // ✅ FIX: Notify ONLY the members of the new group to update their sidebars
      const memberSockets = allMembers.map(findSocketByUsername).filter(Boolean);
      memberSockets.forEach(memberSocket => {
          memberSocket.emit('force_sidebar_update');
      });
      console.log(`Group "${name}" created by ${creator} with members: ${allMembers.join(', ')}`);
  });
    socket.on('delete_group', async ({ roomId }) => {
    const user = onlineUsers.get(socket.id);
    if (!user || roomId === 'general') return;

    // ✅ NEW: Find all members of the group before deleting it
    const members = await db.all('SELECT username FROM group_members WHERE groupId = ?', [roomId]);

    // Delete the group and its related data
    await db.run('DELETE FROM messages WHERE roomId = ?', [roomId]);
    await db.run('DELETE FROM group_members WHERE groupId = ?', [roomId]); // Also delete from the new members table
    await db.run('DELETE FROM groups WHERE id = ?', [roomId]);

    console.log(`Group ${roomId} deleted by ${user.username}.`);

    // ✅ NEW: Notify ONLY the members to update their sidebars
    const memberSockets = members.map(m => findSocketByUsername(m.username)).filter(Boolean);
    memberSockets.forEach(memberSocket => {
        memberSocket.emit('force_sidebar_update');
    });
});
    socket.on('user_logged_out', () => {
        const user = onlineUsers.get(socket.id);
        if (user) {
            console.log(`🚪 User logged out: ${user.username} (Socket ID: ${socket.id})`);
            onlineUsers.delete(socket.id);
            broadcastOnlineUsers();
        }
    });

    socket.on('disconnect', () => {
        const user = onlineUsers.get(socket.id);
        if (user) {
            console.log(`❌ User disconnected: ${user.username} (Socket ID: ${socket.id})`);
            onlineUsers.delete(socket.id);
            broadcastOnlineUsers();
        }
    });
    socket.on('clear_chat_history', async ({ roomId, isDM, targetUser }) => {
      const user = onlineUsers.get(socket.id);
      if (!user) return;

      try {
          if (isDM) {
              await db.run(
                  `DELETE FROM direct_messages 
                  WHERE (sender = ? AND receiver = ?) OR (sender = ? AND receiver = ?)`,
                  [user.username, targetUser, targetUser, user.username]
              );
              console.log(`🗑️ DM history between ${user.username} and ${targetUser} cleared.`);
              
              // ✅ FIX: Broadcast to EVERYONE that a DM was cleared
              io.emit('dm_history_cleared', { user1: user.username, user2: targetUser });

          } else {
              await db.run('DELETE FROM messages WHERE roomId = ?', [roomId]);
              console.log(`🗑️ Chat history for room ${roomId} cleared by ${user.username}.`);
              io.emit('chat_history_cleared', { roomId });
          }

      } catch (error) {
          console.error(`Failed to clear chat history:`, error);
        }
  });
});

// --- Server Start ---
async function startServer() {
    await initDb();
    const port = 3000; // Define the port

    server.listen(port, '0.0.0.0', () => {
        console.log(`🚀 Server is live!`);

        // ✅ 2. Add this logic to find and display the network address
        const networkInterfaces = os.networkInterfaces();
        console.log('Access it from other devices on the same network:');
        
        Object.keys(networkInterfaces).forEach(ifaceName => {
            networkInterfaces[ifaceName].forEach(iface => {
                // Skip over internal (i.e. 127.0.0.1) and non-ipv4 addresses
                if (iface.family === 'IPv4' && !iface.internal) {
                    console.log(`   -> http://${iface.address}:${port}`);
                }
            });
        });
        console.log(`   -> http://localhost:${port}`); // Also show localhost
    });
}
startServer();