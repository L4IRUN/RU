// storage.js
// 職責：處理 IndexedDB 的本地端資料庫讀寫與版本遷移（含刪除墓碑追蹤表）

export function safeJSONParse(str, fallback = null) {
    if (typeof str !== 'string') return fallback;
    try {
        const result = JSON.parse(str);
        if (result === null || result === undefined) return fallback;
        if (Array.isArray(fallback) && !Array.isArray(result)) return fallback;
        return result;
    } catch (e) {
        return fallback;
    }
}

const db = new Dexie("RUDatabase");

db.version(1).stores({
    notes: 'id',
    bookmarks: 'id',
    quotes: 'id'
});

db.version(2).stores({
    notes: 'id',
    bookmarks: 'id',
    quotes: 'id',
    deleted_notes: 'id',
    deleted_bookmarks: 'id',
    deleted_quotes: 'id'
});

export const StorageAPI = {
    loadAll: async (storeName, legacyKey) => {
        try {
            if (!db[storeName]) return {};
            const items = await db[storeName].toArray();
            let obj = {};
            
            if (items.length > 0) {
                items.forEach(item => { obj[item.id] = item.data; });
                return obj;
            }

            if (legacyKey) {
                const legacyData = localStorage.getItem(legacyKey);
                if (legacyData) {
                    const parsedData = JSON.parse(legacyData);
                    const newItems = Object.keys(parsedData).map(id => ({ id: id, data: parsedData[id] }));
                    
                    if (newItems.length > 0) {
                        await db[storeName].bulkPut(newItems);
                        console.info(`[系統訊息] 已成功將 ${legacyKey} 的舊資料轉移至 IndexedDB。`);
                    }
                    return parsedData;
                }
            }
            
            return {};
        } catch (e) {
            console.error(`讀取 ${storeName} 失敗:`, e);
            return {};
        }
    },

    saveItem: async (storeName, id, data) => {
        try {
            if (!db[storeName]) return;
            await db[storeName].put({ id: id, data: data });
        } catch (e) {
            console.error(`儲存 ${storeName} 失敗:`, e);
        }
    },

    deleteItem: async (storeName, id) => {
        try {
            if (!db[storeName]) return;
            await db[storeName].delete(id);
        } catch (e) {
            console.error(`刪除 ${storeName} 失敗:`, e);
        }
    },

    replaceAll: async (storeName, dataObj = {}) => {
        try {
            if (!db[storeName]) return;
            await db[storeName].clear();
            const items = Object.keys(dataObj).map(id => ({ id: id, data: dataObj[id] }));
            if (items.length > 0) {
                await db[storeName].bulkPut(items);
            }
        } catch (e) {
            console.error(`覆寫 ${storeName} 失敗:`, e);
        }
    }
};