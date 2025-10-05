// --- Imports ---
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const bcrypt = require('bcrypt');
const crypto = require('crypto'); // Used for generating unique IDs

// --- Basic Setup ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const SALT_ROUNDS = 10;
let db;
const onlineUsers = new Map(); // Stores { socket.id -> { username } }

// --- Middleware & DB Init ---
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'client')));
async function initDb() {
    db = await open({ filename: './database.db', driver: sqlite3.Database });
    console.log('✅ Connected to SQLite database.');
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT);
        CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, messageId TEXT UNIQUE NOT NULL, roomId TEXT NOT NULL, username TEXT NOT NULL, content TEXT NOT NULL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);
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

// --- Helper function to broadcast online users (No changes here) ---
function broadcastOnlineUsers() {
    const allUsernames = Array.from(onlineUsers.values()).map(user => user.username);
    const uniqueUsernames = [...new Set(allUsernames)];
    const userListPayload = uniqueUsernames.map(username => ({ username }));
    io.emit('update_online_users', userListPayload);
}

// --- Real-Time Socket.IO Logic ---
io.on('connection', (socket) => {
    socket.on('user_joined', async ({ username }) => {
        console.log(`✅ User connected: ${username} (Socket ID: ${socket.id})`);
        onlineUsers.set(socket.id, { username });
        broadcastOnlineUsers();

        socket.emit('update_online_users', Array.from(onlineUsers.values()).map(user => ({ username: user.username })));

        const groups = await db.all('SELECT * FROM groups');
        const users = await db.all('SELECT id, username FROM users');
        socket.emit('initial_data', { groups, users });
    });

    socket.on('request_room_history', async ({ roomId }) => {
        const messages = await db.all('SELECT * FROM messages WHERE roomId = ? ORDER BY timestamp ASC', [roomId]);
        socket.emit('room_history', { roomId, messages });
    });

    // --- LOGIC CHANGE ---
    socket.on('send_message', async (messageData) => {
    const user = onlineUsers.get(socket.id);
    if (!user || user.username !== messageData.username) return;

    try {
        await db.run('INSERT INTO messages (messageId, roomId, username, content, timestamp) VALUES (?, ?, ?, ?, ?)', [messageData.messageId, messageData.roomId, messageData.username, messageData.content, messageData.timestamp]);
        
        // ✅ ADD THE SENDER'S SOCKET ID TO THE PAYLOAD
        const broadcastData = {
            ...messageData,
            senderSocketId: socket.id 
        };

        // Broadcast the data with the sender's ID
        socket.broadcast.emit('receive_message', broadcastData);
        
        console.log(`💬 [${broadcastData.roomId}] ${user.username}: ${broadcastData.content}`);

    } catch (error) {
        console.error("DATABASE ERROR on send_message:", error);
    }
});
    
    // (No changes to the rest of the file)
    socket.on('create_group', async ({ name, description }) => {
        const user = onlineUsers.get(socket.id);
        if (!user) return;
        const newGroupId = `group_${Date.now()}`;
        await db.run('INSERT INTO groups (id, name, description) VALUES (?, ?, ?)', [newGroupId, name, description || '']);
        const groups = await db.all('SELECT * FROM groups');
        io.emit('initial_data', { groups, users: await db.all('SELECT id, username FROM users') });
    });
    socket.on('delete_group', async ({ roomId }) => {
        const user = onlineUsers.get(socket.id);
        if (!user || roomId === 'general') return;
        await db.run('DELETE FROM messages WHERE roomId = ?', [roomId]);
        await db.run('DELETE FROM groups WHERE id = ?', [roomId]);
        const groups = await db.all('SELECT * FROM groups');
        io.emit('initial_data', { groups, users: await db.all('SELECT id, username FROM users') });
    });
    socket.on('user_logged_out', () => {
        const user = onlineUsers.get(socket.id);
        if (user) {
            console.log(`🚪 User logged out: ${user.username} (Socket ID: ${socket.id})`);
            onlineUsers.delete(socket.id);
            broadcastOnlineUsers(); // Update the online list for everyone
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
});

// --- Server Start ---
async function startServer() {
    await initDb();
    server.listen(3000, '0.0.0.0', () => console.log('🚀 Server is live on port 3000'));
}
startServer();