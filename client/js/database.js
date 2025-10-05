// In client/js/database.js

const DB_NAME = 'SecureChatClientCache';
const DB_VERSION = 2; // ✅ IMPORTANT: Increment the version to trigger an update

let db;

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
            // Group messages store
            if (!dbInstance.objectStoreNames.contains('group_messages')) {
                const messagesStore = dbInstance.createObjectStore('group_messages', { keyPath: 'messageId' });
                messagesStore.createIndex('roomId', 'roomId', { unique: false });
            }
            // ✅ NEW Direct messages store
            if (!dbInstance.objectStoreNames.contains('direct_messages')) {
                const dmsStore = dbInstance.createObjectStore('direct_messages', { keyPath: 'messageId' });
                // Create an index to easily query messages between two users
                dmsStore.createIndex('participants', ['sender', 'receiver']);
            }
        };
    });
}

async function dbOperation(storeName, mode, callback) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        callback(store, resolve, reject);
        transaction.onerror = (event) => reject(event.target.error);
    });
}

window.chatStorage = {
    // ✅ MODIFIED to handle both DMs and group messages
    async saveMessage(messageData, isDM = false) {
        const storeName = isDM ? 'direct_messages' : 'group_messages';
        return dbOperation(storeName, 'readwrite', (store, resolve) => {
            const request = store.put(messageData);
            request.onsuccess = () => resolve(request.result);
        });
    },
    async getGroupMessages(groupId) {
        return dbOperation('group_messages', 'readonly', (store, resolve) => {
            const index = store.index('roomId');
            const request = index.getAll(groupId);
            request.onsuccess = () => resolve(request.result.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)));
        });
    },
    // ✅ NEW function to get DMs
    async getDMMessages(userA, userB) {
        return dbOperation('direct_messages', 'readonly', async (store, resolve) => {
            const allMessages = [];
            // Find messages from A to B
            const index = store.index('participants');
            const req1 = index.getAll([userA, userB]);
            req1.onsuccess = () => {
                allMessages.push(...req1.result);
                // Find messages from B to A
                const req2 = index.getAll([userB, userA]);
                req2.onsuccess = () => {
                    allMessages.push(...req2.result);
                    // Sort combined messages by time and resolve
                    resolve(allMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)));
                };
            };
        });
    },
    async clearDMMessages(userA, userB) {
        return dbOperation('direct_messages', 'readwrite', (store, resolve) => {
            const index = store.index('participants');
            
            const deletePromises = [];

            const deleteRequest1 = new Promise(res => {
                const req = index.openCursor(IDBKeyRange.only([userA, userB]));
                req.onsuccess = event => {
                    const cursor = event.target.result;
                    if (cursor) {
                        cursor.delete();
                        cursor.continue();
                    } else {
                        res();
                    }
                };
            });
            deletePromises.push(deleteRequest1);

            const deleteRequest2 = new Promise(res => {
                const req = index.openCursor(IDBKeyRange.only([userB, userA]));
                req.onsuccess = event => {
                    const cursor = event.target.result;
                    if (cursor) {
                        cursor.delete();
                        cursor.continue();
                    } else {
                        res();
                    }
                };
            });
            deletePromises.push(deleteRequest2);

            Promise.all(deletePromises).then(resolve);
        });
    },
    async clearGroupMessages(groupId) {
        return dbOperation('group_messages', 'readwrite', (store, resolve) => {
            const index = store.index('roomId');
            const request = index.openCursor(IDBKeyRange.only(groupId));
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                } else {
                    resolve(); // Done deleting
                }
            };
        });
    },
    async clearAllData() {
        await dbOperation('group_messages', 'readwrite', (store, resolve) => store.clear().onsuccess = resolve);
        await dbOperation('direct_messages', 'readwrite', (store, resolve) => store.clear().onsuccess = resolve);
    }
};

document.addEventListener('DOMContentLoaded', initDB);