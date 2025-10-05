// Database configuration and operations for client-side caching
const DB_NAME = 'SecureChatClientCache';
const DB_VERSION = 1;

let db; // Global reference to the database connection

// Initialize IndexedDB
async function initDB() {
    if (db) return db;

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = (event) => reject(`Database error: ${event.target.errorCode}`);
        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };
        request.onupgradeneeded = (event) => {
            const dbInstance = event.target.result;
            if (dbInstance.objectStoreNames.contains('messages')) {
                dbInstance.deleteObjectStore('messages');
            }
            // Use 'messageId' as the unique keyPath to prevent duplicates
            const messagesStore = dbInstance.createObjectStore('messages', { keyPath: 'messageId' });
            messagesStore.createIndex('roomId', 'roomId', { unique: false });
            messagesStore.createIndex('timestamp', 'timestamp', { unique: false });
        };
    });
}

// Generic helper for database operations
async function dbOperation(storeName, mode, callback) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        callback(store, resolve, reject);
        transaction.onerror = (event) => reject(event.target.error);
    });
}

// Public API for the local message cache
window.chatStorage = {
    async saveMessage(messageData) {
        // This will now automatically ignore duplicates because the 'messageId' is the key.
        return dbOperation('messages', 'readwrite', (store, resolve, reject) => {
            // Use 'put' instead of 'add' to be safe. It adds or updates.
            const request = store.put(messageData);
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject('Failed to save message: ' + e.target.error);
        });
    },
    async getGroupMessages(groupId) {
        return new Promise(async (resolve, reject) => {
            await dbOperation('messages', 'readonly', (store) => {
                const index = store.index('roomId');
                const request = index.getAll(IDBKeyRange.only(groupId));
                request.onsuccess = () => resolve(request.result.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)));
                request.onerror = (e) => reject(e);
            });
        });
    },
    async clearAllData() {
        return dbOperation('messages', 'readwrite', (store, resolve) => {
            const request = store.clear();
            request.onsuccess = () => resolve();
        });
    }
};

// Initialize the database when the script loads
document.addEventListener('DOMContentLoaded', initDB);