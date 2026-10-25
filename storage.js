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

export function sanitizeUrl(url) {
    if (typeof url !== 'string') return '';
    const trimmed = url.trim();
    if (!trimmed) return '';
    // 嚴格僅允許 http 與 https 協定，全面阻斷 javascript:, vbscript:, data: 等偽協定
    if (/^https?:\/\//i.test(trimmed)) {
        return trimmed;
    }
    return '';
}

export function stripDangerousHtml(str) {
    if (typeof str !== 'string' || str.indexOf('<') === -1) return str;
    if (typeof DOMParser === 'undefined') return str;

    try {
        const doc = new DOMParser().parseFromString(str, 'text/html');
        let changed = false;

        // 徹底移除所有可能執行腳本的標籤，包含 form、svg、math 等進階向量標籤
        doc.querySelectorAll('script,iframe,frame,frameset,object,embed,applet,base,meta,link,form,svg,math').forEach(el => {
            el.remove();
            changed = true;
        });

        const urlAttrs = ['href', 'src', 'xlink:href', 'action', 'formaction', 'data'];
        doc.querySelectorAll('*').forEach(el => {
            Array.from(el.attributes).forEach(attr => {
                const name = attr.name.toLowerCase();
                const value = (attr.value || '').replace(/[\s\u0000-\u001f]+/g, '').toLowerCase();
                // 攔截所有以 on 開頭之事件處理屬性（包括 SVG 專屬動畫事件如 onbegin, onend, onrepeat 等）
                if (name.startsWith('on') || name === 'srcdoc') {
                    el.removeAttribute(attr.name);
                    changed = true;
                } else if (urlAttrs.includes(name) && /^(javascript|vbscript|data:text\/html|data:image\/svg\+xml)/.test(value)) {
                    el.removeAttribute(attr.name);
                    changed = true;
                }
            });
        });

        return changed ? doc.body.innerHTML : str;
    } catch (e) {
        return str;
    }
}

// ==========================================
// 多分頁 / 多視窗廣播同步 (Cross-Tab Synchronization)
// ==========================================
let crossTabChannel = null;

try {
    if (typeof BroadcastChannel !== 'undefined') {
        crossTabChannel = new BroadcastChannel('ru_sync_channel');
    }
} catch (e) {
    crossTabChannel = null;
}

export function notifyCrossTabChange(payload = {}) {
    const message = {
        type: 'DATA_CHANGED',
        timestamp: Date.now(),
        ...payload
    };
    if (crossTabChannel) {
        try {
            crossTabChannel.postMessage(message);
        } catch (e) { /* ignore */ }
    }
    try {
        localStorage.setItem('ru_cross_tab_trigger', JSON.stringify(message));
    } catch (e) { /* ignore */ }
}

export function initCrossTabSync(onSyncCallback) {
    if (typeof onSyncCallback !== 'function') return;

    if (crossTabChannel) {
        crossTabChannel.onmessage = (event) => {
            if (event && event.data && event.data.type === 'DATA_CHANGED') {
                onSyncCallback(event.data);
            }
        };
    } else {
        // 僅在不支援 BroadcastChannel 的舊環境下，才降級監聽 storage 事件，避免雙重觸發
        window.addEventListener('storage', (event) => {
            if (event.key === 'ru_cross_tab_trigger' && event.newValue) {
                try {
                    const data = JSON.parse(event.newValue);
                    if (data && data.type === 'DATA_CHANGED') {
                        onSyncCallback(data);
                    }
                } catch (e) { /* ignore */ }
            }
        });
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

db.version(3).stores({
    notes: 'id',
    bookmarks: 'id',
    reminders: 'id',
    deleted_notes: 'id',
    deleted_bookmarks: 'id',
    deleted_reminders: 'id'
}).upgrade(async tx => {
    try {
        const oldQuotes = await tx.table('quotes').toArray();
        if (oldQuotes && oldQuotes.length > 0) {
            const today = new Date().toISOString().slice(0, 10);
            const upgraded = oldQuotes.map(item => ({
                id: item.id,
                data: {
                    content: item.data?.text || item.data?.content || '',
                    date: item.data?.date || today,
                    isDone: !!item.data?.isDone,
                    timestamp: item.data?.timestamp || '',
                    updatedAt: item.data?.updatedAt || Date.now(),
                    order: item.data?.order || 0
                }
            }));
            await tx.table('reminders').bulkPut(upgraded);
        }
    } catch (e) {
        console.warn('升級轉移舊語錄資料庫至提醒事項時跳過:', e);
    }
});

// 版本 4：移除筆記功能，刪除舊版筆記資料表（版本 1～3 的宣告需保留，Dexie 才能完成逐版升級）
db.version(4).stores({
    bookmarks: 'id',
    reminders: 'id',
    deleted_bookmarks: 'id',
    deleted_reminders: 'id',
    notes: null,
    deleted_notes: null
});

// ==========================================
// 儲存錯誤通報（讓 UI 能告知使用者「變更可能沒有被保存」）
// ==========================================
let storageErrorHandler = null;
let lastStorageErrorReportAt = 0;

export function setStorageErrorHandler(fn) {
    storageErrorHandler = typeof fn === 'function' ? fn : null;
}

function reportStorageError(message, error) {
    console.error(message, error);
    const now = Date.now();
    // 10 秒內只通報一次，避免連續失敗時洗版
    if (storageErrorHandler && now - lastStorageErrorReportAt > 10000) {
        lastStorageErrorReportAt = now;
        try {
            storageErrorHandler('本機儲存失敗，最近的變更可能未被保存');
        } catch (e) { /* 通報本身失敗不處理 */ }
    }
}

/**
 * 請求瀏覽器將本站儲存設為「持久」，降低 iOS Safari / 容量不足時被系統自動清除的機率
 */
export async function requestPersistentStorage() {
    try {
        if (navigator.storage && navigator.storage.persist) {
            const already = navigator.storage.persisted ? await navigator.storage.persisted() : false;
            if (!already) await navigator.storage.persist();
        }
    } catch (e) {
        console.warn('要求持久儲存失敗:', e);
    }
}

// 舊資料（localStorage）遷移旗標：遷移完成後不再讀取舊 key，避免「刪光的資料」被復活
const LEGACY_MIGRATED_PREFIX = 'legacy_migrated:';

function markLegacyMigrated(legacyKey) {
    try {
        localStorage.setItem(LEGACY_MIGRATED_PREFIX + legacyKey, '1');
        localStorage.removeItem(legacyKey);
    } catch (e) { /* ignore */ }
}

function isLegacyMigrated(legacyKey) {
    return localStorage.getItem(LEGACY_MIGRATED_PREFIX + legacyKey) === '1';
}

export const StorageAPI = {
    loadAll: async (storeName, legacyKey) => {
        try {
            if (db[storeName]) {
                const items = await db[storeName].toArray();
                if (items.length > 0) {
                    const obj = {};
                    items.forEach(item => { obj[item.id] = item.data; });
                    // IndexedDB 已有資料即為權威來源，舊 key 不再需要
                    if (legacyKey) markLegacyMigrated(legacyKey);
                    return obj;
                }
            }

            // 只有「尚未遷移過」才會讀取舊版 localStorage 資料
            if (legacyKey && !isLegacyMigrated(legacyKey)) {
                const legacyData = localStorage.getItem(legacyKey);
                if (legacyData) {
                    const parsedData = JSON.parse(legacyData);
                    if (parsedData && typeof parsedData === 'object') {
                        const newItems = Object.keys(parsedData).map(id => ({ id: id, data: parsedData[id] }));
                        if (db[storeName] && newItems.length > 0) {
                            await db[storeName].bulkPut(newItems);
                            console.info(`[系統訊息] 已成功將 ${legacyKey} 的舊資料轉移至 IndexedDB。`);
                        }
                        // 寫入成功（上方若拋錯不會走到這裡）才標記完成並移除舊 key
                        markLegacyMigrated(legacyKey);
                        return parsedData;
                    }
                }
                markLegacyMigrated(legacyKey);
            }

            return {};
        } catch (e) {
            reportStorageError(`讀取 ${storeName} 失敗:`, e);
            return {};
        }
    },

    saveItem: async (storeName, id, data) => {
        try {
            if (!db[storeName]) return false;
            await db[storeName].put({ id: id, data: data });
            return true;
        } catch (e) {
            reportStorageError(`儲存 ${storeName} 失敗:`, e);
            return false;
        }
    },

    deleteItem: async (storeName, id) => {
        try {
            if (!db[storeName]) return false;
            await db[storeName].delete(id);
            return true;
        } catch (e) {
            reportStorageError(`刪除 ${storeName} 失敗:`, e);
            return false;
        }
    },

    batchDeleteWithTombstone: async (dataStoreName, tombstoneStoreName, ids = [], timestamp = Date.now()) => {
        try {
            const stores = [db[dataStoreName], db[tombstoneStoreName]].filter(Boolean);
            if (stores.length === 0 || ids.length === 0) return true;
            await db.transaction('rw', stores, async () => {
                if (db[dataStoreName]) {
                    await db[dataStoreName].bulkDelete(ids);
                }
                if (db[tombstoneStoreName]) {
                    const tombstoneItems = ids.map(id => ({ id: id, data: timestamp }));
                    await db[tombstoneStoreName].bulkPut(tombstoneItems);
                }
            });
            return true;
        } catch (e) {
            reportStorageError(`批次刪除 ${dataStoreName} 失敗:`, e);
            return false;
        }
    },

    /**
     * 在「單一交易」內覆寫多張資料表（全部成功或全部不變），
     * 避免 clear() 之後尚未 bulkPut 就中斷而造成資料表被清空。
     * 例：replaceMulti({ bookmarks: {...}, reminders: {...}, deleted_bookmarks: {...} })
     */
    replaceMulti: async (storeMap = {}) => {
        try {
            const names = Object.keys(storeMap).filter(name => db[name]);
            if (names.length === 0) return true;

            await db.transaction('rw', names.map(name => db[name]), async () => {
                for (const name of names) {
                    const dataObj = storeMap[name] || {};
                    await db[name].clear();
                    const items = Object.keys(dataObj).map(id => ({ id: id, data: dataObj[id] }));
                    if (items.length > 0) {
                        await db[name].bulkPut(items);
                    }
                }
            });
            return true;
        } catch (e) {
            reportStorageError('批次覆寫資料表失敗:', e);
            return false;
        }
    },

    replaceAll: async (storeName, dataObj = {}) => {
        return StorageAPI.replaceMulti({ [storeName]: dataObj });
    }
};
