// storage.js
// 職責：處理 IndexedDB 的本地端資料庫讀寫與版本遷移（含刪除墓碑追蹤表）

export function safeJSONParse(str, fallback = null) {
    if (typeof str !== 'string') return fallback;
    try {
        const result = JSON.parse(str);
        if (result === null || result === undefined) return fallback;
        if (Array.isArray(fallback) && !Array.isArray(result)) return fallback;
        if (fallback !== null && typeof fallback === 'object' && !Array.isArray(fallback)) {
            if (typeof result !== 'object' || Array.isArray(result)) return fallback;
        }
        return result;
    } catch (e) {
        return fallback;
    }
}

export function generateUUID() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
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

const DANGEROUS_TAGS = new Set([
    'SCRIPT', 'STYLE', 'IFRAME', 'FRAME', 'FRAMESET', 'OBJECT', 'EMBED', 'APPLET',
    'BASE', 'META', 'LINK', 'FORM', 'SVG', 'MATH', 'NOSCRIPT', 'TEMPLATE'
]);

const ALLOWED_TAGS = new Set([
    'DIV', 'P', 'SPAN', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'DEL', 'STRIKE',
    'CODE', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'IMG', 'A'
]);

const SAFE_COLOR_PATTERN = /^(?:#[0-9a-fA-F]{3,8}|rgba?\(\s*\d+%?(?:\s*,\s*\d+%?){2}(?:\s*,\s*[\d.]+%?)?\s*\)|hsla?\(\s*\d+(?:deg|rad|turn)?(?:\s*,\s*[\d.]+%?){2}(?:\s*,\s*[\d.]+%?)?\s*\)|[a-zA-Z]+)$/;

function cleanElementAttributes(el) {
    const tag = el.tagName.toUpperCase();
    const attrs = Array.from(el.attributes);

    let validSrc = null;
    let validHref = null;
    let validAlt = null;
    let validTitle = null;

    if (tag === 'IMG') {
        const rawSrc = (el.getAttribute('src') || '').trim();
        if (/^https:\/\/[^\s"']+/i.test(rawSrc)) {
            validSrc = rawSrc;
        } else {
            el.remove();
            return false;
        }
        if (el.hasAttribute('alt')) {
            validAlt = el.getAttribute('alt');
        }
        if (el.hasAttribute('title')) {
            validTitle = el.getAttribute('title');
        }
    } else if (tag === 'A') {
        const rawHref = (el.getAttribute('href') || '').trim();
        if (/^https?:\/\/[^\s"']+/i.test(rawHref)) {
            validHref = rawHref;
        }
        if (el.hasAttribute('title')) {
            validTitle = el.getAttribute('title');
        }
    }

    let validColor = null;
    if (el.style && el.style.color) {
        const colorVal = el.style.color.trim();
        if (SAFE_COLOR_PATTERN.test(colorVal)) {
            validColor = colorVal;
        }
    }

    for (let i = attrs.length - 1; i >= 0; i--) {
        el.removeAttribute(attrs[i].name);
    }

    if (tag === 'IMG' && validSrc) {
        el.setAttribute('src', validSrc);
        if (validAlt !== null) el.setAttribute('alt', validAlt);
        if (validTitle !== null) el.setAttribute('title', validTitle);
    } else if (tag === 'A') {
        if (validHref) {
            el.setAttribute('href', validHref);
            el.setAttribute('target', '_blank');
            el.setAttribute('rel', 'noopener noreferrer');
        }
        if (validTitle !== null) el.setAttribute('title', validTitle);
    }

    if (validColor) {
        el.setAttribute('style', `color: ${validColor};`);
    }

    return true;
}

function cleanDomNode(node) {
    if (node.nodeType === Node.TEXT_NODE) return;
    if (node.nodeType !== Node.ELEMENT_NODE) {
        node.remove();
        return;
    }

    const tag = node.tagName.toUpperCase();
    if (DANGEROUS_TAGS.has(tag)) {
        node.remove();
        return;
    }

    const children = Array.from(node.childNodes);
    for (let i = 0; i < children.length; i++) {
        cleanDomNode(children[i]);
    }

    if (!ALLOWED_TAGS.has(tag)) {
        node.replaceWith(...node.childNodes);
        return;
    }

    cleanElementAttributes(node);
}

export function stripDangerousHtml(str) {
    if (typeof str !== 'string' || str.indexOf('<') === -1) return str;
    if (typeof DOMParser === 'undefined') return str;

    try {
        const doc = new DOMParser().parseFromString(str, 'text/html');
        const rootNodes = Array.from(doc.body.childNodes);
        for (let i = 0; i < rootNodes.length; i++) {
            cleanDomNode(rootNodes[i]);
        }
        return doc.body.innerHTML;
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

let crossTabDebounceTimer = null;
let isCrossTabSyncing = false;
let hasPendingCrossTabRerun = false;
let pendingCrossTabData = null;

export function initCrossTabSync(onSyncCallback) {
    if (typeof onSyncCallback !== 'function') return;

    const dispatchDebouncedSync = (data) => {
        pendingCrossTabData = data;
        clearTimeout(crossTabDebounceTimer);
        crossTabDebounceTimer = setTimeout(async () => {
            if (isCrossTabSyncing) {
                hasPendingCrossTabRerun = true;
                return;
            }

            isCrossTabSyncing = true;
            try {
                do {
                    hasPendingCrossTabRerun = false;
                    const dataToProcess = pendingCrossTabData;
                    await Promise.resolve(onSyncCallback(dataToProcess));
                } while (hasPendingCrossTabRerun);
            } catch (err) {
                console.error('跨分頁同步執行異常:', err);
            } finally {
                isCrossTabSyncing = false;
                pendingCrossTabData = null;
            }
        }, 50);
    };

    if (crossTabChannel) {
        crossTabChannel.onmessage = (event) => {
            if (event && event.data && event.data.type === 'DATA_CHANGED') {
                dispatchDebouncedSync(event.data);
            }
        };
    }

    window.addEventListener('storage', (event) => {
        if (event.key === 'ru_cross_tab_trigger' && event.newValue) {
            try {
                const data = JSON.parse(event.newValue);
                if (data && data.type === 'DATA_CHANGED') {
                    dispatchDebouncedSync(data);
                }
            } catch (e) { /* ignore */ }
        }
    });
}

export const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

export function isQuotaExceededError(err) {
    if (!err) return false;
    return (
        err.name === 'QuotaExceededError' ||
        err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
        err.code === 22 ||
        err.code === 1014 ||
        (typeof Dexie !== 'undefined' && Dexie.QuotaExceededError && err instanceof Dexie.QuotaExceededError) ||
        (typeof err.message === 'string' && /quota/i.test(err.message))
    );
}

export function sanitizeTombstoneRecordMap(rawMap = {}, now = Date.now()) {
    if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) return {};
    const maxAllowedTimestamp = now + CLOCK_SKEW_TOLERANCE_MS;
    const sanitized = {};
    for (const [id, val] of Object.entries(rawMap)) {
        if (typeof id !== 'string' || !id.trim()) continue;
        let t = 0;
        if (typeof val === 'number') {
            t = val;
        } else if (val && typeof val.deletedAt === 'number') {
            t = val.deletedAt;
        } else if (typeof val === 'string') {
            const parsed = Number(val);
            if (!Number.isNaN(parsed)) t = parsed;
        }
        if (!Number.isFinite(t) || t <= 0) continue;
        if (t > maxAllowedTimestamp) t = now;
        if ((now - t) < TOMBSTONE_TTL_MS) {
            sanitized[id.trim()] = t;
        }
    }
    return sanitized;
}

const db = new Dexie("RUDatabase");

let isReconnecting = false;
let reconnectPromise = null;

db.on('close', () => {
    console.warn('[IndexedDB] 資料庫連線已關閉，將於下次操作時自動重新建立連線。');
});

db.on('versionchange', () => {
    console.warn('[IndexedDB] 偵測到架構版本變更，已安全關閉當前連線以防衝突。');
    db.close();
});

export async function ensureDbOpen() {
    if (db.isOpen()) return db;
    if (isReconnecting && reconnectPromise) return reconnectPromise;

    isReconnecting = true;
    reconnectPromise = (async () => {
        try {
            await db.open();
            return db;
        } catch (err) {
            console.error('[IndexedDB] 連線開啟失敗:', err);
            throw err;
        } finally {
            isReconnecting = false;
            reconnectPromise = null;
        }
    })();

    return reconnectPromise;
}

export async function executeWithDbRetry(operationFn, maxRetries = 2) {
    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            await ensureDbOpen();
            return await operationFn(db);
        } catch (err) {
            lastError = err;
            if (isQuotaExceededError(err)) {
                throw err;
            }
            const isClosedOrInvalid =
                !db.isOpen() ||
                err.name === 'DatabaseClosedError' ||
                err.name === 'InvalidStateError' ||
                (err.inner && (err.inner.name === 'DatabaseClosedError' || err.inner.name === 'InvalidStateError'));

            if (isClosedOrInvalid && attempt < maxRetries) {
                console.warn(`[IndexedDB] 連線異常，正在進行第 ${attempt + 1} 次重試修復...`);
                try {
                    db.close();
                } catch (closeErr) {}
                await new Promise(res => setTimeout(res, 100 * Math.pow(2, attempt)));
                continue;
            }
            throw err;
        }
    }
    throw lastError;
}

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

// 版本 5：新增個人頭像與使用者名稱資料表
db.version(5).stores({
    bookmarks: 'id',
    reminders: 'id',
    deleted_bookmarks: 'id',
    deleted_reminders: 'id',
    profile: 'id'
});

// ==========================================
// 儲存錯誤通報（讓 UI 能告知使用者「變更可能沒有被保存」）
// ==========================================
let storageErrorHandler = null;
let lastStorageErrorReportAt = 0;

export function setStorageErrorHandler(fn) {
    storageErrorHandler = typeof fn === 'function' ? fn : null;
}

export function reportStorageError(message, error, forceImmediate = false) {
    console.error(message, error);
    const now = Date.now();
    const isQuota = isQuotaExceededError(error);
    const finalMessage = isQuota
        ? '本機儲存空間配額不足，請釋出裝置空間'
        : (message || '本機儲存失敗，最近的變更可能未被保存');

    if (storageErrorHandler && (forceImmediate || isQuota || (now - lastStorageErrorReportAt > 10000))) {
        lastStorageErrorReportAt = now;
        try {
            storageErrorHandler(finalMessage);
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
            if (already) return true;
            return await navigator.storage.persist();
        }
    } catch (e) {
        console.warn('要求持久儲存失敗:', e);
    }
    return false;
}

/**
 * 檢查當前儲存空間配額與使用量，高於警戒水位 (85%) 時預警
 */
export async function checkStorageQuota() {
    try {
        if (navigator.storage && navigator.storage.estimate) {
            const estimate = await navigator.storage.estimate();
            const usage = estimate.usage || 0;
            const quota = estimate.quota || 0;
            const ratio = quota > 0 ? (usage / quota) : 0;
            if (ratio > 0.85) {
                reportStorageError('本機儲存空間已接近上限，請留意空間配額', null, true);
            }
            return { usage, quota, ratio };
        }
    } catch (e) {
        console.warn('檢查儲存配額失敗:', e);
    }
    return null;
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
        return executeWithDbRetry(async (database) => {
            try {
                if (!database[storeName]) {
                    throw new Error(`資料表 ${storeName} 未在 IndexedDB 中定義`);
                }
                const items = await database[storeName].toArray();
                if (items.length > 0) {
                    const obj = {};
                    const isTombstoneStore = storeName === 'deleted_bookmarks' || storeName === 'deleted_reminders';
                    const now = Date.now();
                    const staleIds = [];

                    items.forEach(item => {
                        if (!item || typeof item.id !== 'string') return;
                        if (isTombstoneStore) {
                            let t = 0;
                            if (typeof item.data === 'number') {
                                t = item.data;
                            } else if (item.data && typeof item.data.deletedAt === 'number') {
                                t = item.data.deletedAt;
                            } else if (typeof item.data === 'string') {
                                const parsed = Number(item.data);
                                if (!Number.isNaN(parsed)) t = parsed;
                            }
                            if (!Number.isFinite(t) || t <= 0 || (now - t) >= TOMBSTONE_TTL_MS) {
                                staleIds.push(item.id);
                                return;
                            }
                            if (t > now + CLOCK_SKEW_TOLERANCE_MS) t = now;
                            obj[item.id] = t;
                        } else {
                            obj[item.id] = item.data;
                        }
                    });

                    if (staleIds.length > 0) {
                        database[storeName].bulkDelete(staleIds).catch(err => {
                            console.warn(`[IndexedDB] 清理過期或非法墓碑紀錄失敗 (${storeName}):`, err);
                        });
                    }

                    if (legacyKey) markLegacyMigrated(legacyKey);
                    return obj;
                }

                if (legacyKey && !isLegacyMigrated(legacyKey)) {
                    const legacyData = localStorage.getItem(legacyKey);
                    if (legacyData) {
                        const parsedData = JSON.parse(legacyData);
                        if (parsedData && typeof parsedData === 'object' && !Array.isArray(parsedData)) {
                            const newItems = Object.keys(parsedData).map(id => ({ id: id, data: parsedData[id] }));
                            if (newItems.length > 0) {
                                await database[storeName].bulkPut(newItems);
                                console.info(`[系統訊息] 已成功將 ${legacyKey} 的舊資料轉移至 IndexedDB。`);
                            }
                            markLegacyMigrated(legacyKey);
                            return parsedData;
                        }
                    }
                    markLegacyMigrated(legacyKey);
                }

                return {};
            } catch (e) {
                reportStorageError(`讀取 ${storeName} 失敗:`, e);
                throw e;
            }
        });
    },

    saveItem: async (storeName, id, data) => {
        try {
            return await executeWithDbRetry(async (database) => {
                if (!database[storeName]) return false;
                await database[storeName].put({ id: id, data: data });
                return true;
            });
        } catch (e) {
            reportStorageError(`儲存 ${storeName} 失敗:`, e);
            return false;
        }
    },

    saveItems: async (storeName, itemsMap = {}) => {
        try {
            return await executeWithDbRetry(async (database) => {
                if (!database[storeName]) return false;
                const items = Object.keys(itemsMap).map(id => ({ id: id, data: itemsMap[id] }));
                if (items.length === 0) return true;
                await database[storeName].bulkPut(items);
                return true;
            });
        } catch (e) {
            reportStorageError(`批次儲存 ${storeName} 失敗:`, e);
            return false;
        }
    },

    deleteItem: async (storeName, id) => {
        try {
            return await executeWithDbRetry(async (database) => {
                if (!database[storeName]) return false;
                await database[storeName].delete(id);
                return true;
            });
        } catch (e) {
            reportStorageError(`刪除 ${storeName} 失敗:`, e);
            return false;
        }
    },

    batchDeleteWithTombstone: async (dataStoreName, tombstoneStoreName, ids = [], timestamp = Date.now()) => {
        try {
            if (!Array.isArray(ids) || ids.length === 0) return true;
            const now = Date.now();
            const safeTimestamp = (typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0 && timestamp <= now + CLOCK_SKEW_TOLERANCE_MS)
                ? timestamp
                : now;

            return await executeWithDbRetry(async (database) => {
                const stores = [database[dataStoreName], database[tombstoneStoreName]].filter(Boolean);
                if (stores.length === 0) return true;

                await database.transaction('rw', stores, async () => {
                    if (database[dataStoreName]) {
                        await database[dataStoreName].bulkDelete(ids);
                    }
                    if (database[tombstoneStoreName]) {
                        const tombstoneItems = ids.map(id => ({ id: id, data: safeTimestamp }));
                        await database[tombstoneStoreName].bulkPut(tombstoneItems);
                    }
                });
                return true;
            });
        } catch (e) {
            reportStorageError(`批次刪除 ${dataStoreName} 失敗:`, e);
            return false;
        }
    },

    /**
     * 在「單一交易」內覆寫多張資料表（全部成功或全部回滾），
     * 清空、寫入與筆數校驗在同一交易內完成，若校驗失敗立即拋錯觸發交易自動回滾。
     * 例：replaceMulti({ bookmarks: {...}, reminders: {...}, deleted_bookmarks: {...} })
     */
    replaceMulti: async (storeMap = {}) => {
        try {
            const rawNames = Object.keys(storeMap);
            if (rawNames.length === 0) return true;

            const now = Date.now();
            const sanitizedStoreMap = {};
            const expectedCounts = {};

            rawNames.forEach(name => {
                if (name === 'deleted_bookmarks' || name === 'deleted_reminders') {
                    sanitizedStoreMap[name] = sanitizeTombstoneRecordMap(storeMap[name], now);
                } else {
                    sanitizedStoreMap[name] = storeMap[name] || {};
                }
                expectedCounts[name] = Object.keys(sanitizedStoreMap[name]).length;
            });

            return await executeWithDbRetry(async (database) => {
                const names = Object.keys(sanitizedStoreMap).filter(name => database[name]);
                if (names.length === 0) return true;

                await database.transaction('rw', names.map(name => database[name]), async () => {
                    for (const name of names) {
                        const dataObj = sanitizedStoreMap[name] || {};
                        await database[name].clear();
                        const items = Object.keys(dataObj).map(id => ({ id: id, data: dataObj[id] }));
                        if (items.length > 0) {
                            await database[name].bulkPut(items);
                        }
                    }

                    for (const name of names) {
                        const actualCount = await database[name].count();
                        const expectedCount = expectedCounts[name];
                        if (actualCount !== expectedCount) {
                            throw new Error(`[IndexedDB 一致性校驗失敗] ${name} 預期筆數 ${expectedCount}，實際寫入 ${actualCount}`);
                        }
                    }
                });

                return true;
            });
        } catch (e) {
            reportStorageError('批次覆寫資料表失敗:', e);
            return false;
        }
    },

    replaceAll: async (storeName, dataObj = {}) => {
        return StorageAPI.replaceMulti({ [storeName]: dataObj });
    },

    loadProfile: async () => {
        const allProfiles = await StorageAPI.loadAll('profile');
        const raw = (allProfiles && typeof allProfiles.current === 'object' && allProfiles.current !== null)
            ? allProfiles.current
            : {};
        return {
            avatarData: typeof raw.avatarData === 'string' ? raw.avatarData : '',
            avatarUpdatedAt: Number.isFinite(Number(raw.avatarUpdatedAt)) ? Number(raw.avatarUpdatedAt) : 0,
            username: typeof raw.username === 'string' ? raw.username : '',
            usernameUpdatedAt: Number.isFinite(Number(raw.usernameUpdatedAt)) ? Number(raw.usernameUpdatedAt) : 0
        };
    },

    saveProfile: async (profileData = {}) => {
        const payload = {
            avatarData: typeof profileData.avatarData === 'string' ? profileData.avatarData : '',
            avatarUpdatedAt: Number.isFinite(Number(profileData.avatarUpdatedAt)) ? Number(profileData.avatarUpdatedAt) : 0,
            username: typeof profileData.username === 'string' ? profileData.username : '',
            usernameUpdatedAt: Number.isFinite(Number(profileData.usernameUpdatedAt)) ? Number(profileData.usernameUpdatedAt) : 0
        };
        return StorageAPI.saveItem('profile', 'current', payload);
    }
};
