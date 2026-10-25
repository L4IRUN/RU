// sync.js
// 職責：處理與 Google Drive AppData (appDataFolder) 及 Google Identity Services (GIS) 的整合，
// 落實含墓碑機制（Tombstone）之項目級智慧合併、樂觀鎖、背景輪詢與 Page Visibility 感知。

import { state } from './state.js';
import { showCloudToast, renderSidebar } from './ui.js';
import { openCloudAlert, closeSettingsModal } from './interaction.js';
import { StorageAPI, stripDangerousHtml, sanitizeUrl, notifyCrossTabChange } from './storage.js';

let pollingTimer = null;
let isCheckingUpdates = false;
let isVisibilityBound = false;
const POLLING_INTERVAL_MS = 60000;
const MAX_SYNC_RETRIES = 3;

const GOOGLE_DRIVE_SYNC_FILENAME = 'ru_sync_data.json';
const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

export const GOOGLE_CLIENT_ID = '1053583945415-682qotqfejjkb847h93mqu7fk4tkj7cu.apps.googleusercontent.com';

let gisTokenClient = null;
// GIS 的 popup_closed / popup_failed_to_open 只會走 error_callback，這裡轉交給目前等待中的請求
let onGisError = null;
let cachedDriveFileId = localStorage.getItem('google_drive_file_id') || null;

/**
 * 切換同步設定視窗狀態燈（主題正常金色 / 未連線或過期待機灰色）
 */
export function updateSyncStatusIndicator(isError = false) {
    const dot = document.getElementById('sync-modal-status-dot');
    if (dot) {
        if (isError) {
            dot.classList.remove('primary', 'red');
            dot.classList.add('gray');
        } else {
            dot.classList.remove('gray', 'red');
            dot.classList.add('primary');
        }
    }
}

/**
 * 觸發強效持久警示與紅色狀態指示燈
 */
export function handleSyncErrorAlert(message, shouldOpenSettings = false) {
    updateSyncStatusIndicator(true);
    showCloudToast(message, {
        persistent: true,
        onClick: () => {
            if (shouldOpenSettings && typeof window.openSettingsModal === 'function') {
                window.openSettingsModal();
            }
        }
    });
}

export const PENDING_SYNC_FLAG = 'has_pending_cloud_sync';

/**
 * 檢查 Google 帳號是否曾完成綁定
 */
export function isGoogleLinked() {
    return localStorage.getItem('google_auth_linked') === 'true';
}

/**
 * 檢查當前本地 Access Token 是否仍在庫且未過期（有效緩衝時間大於 60 秒）
 */
export function isTokenValid() {
    const token = localStorage.getItem('google_access_token');
    const expiresAt = parseInt(localStorage.getItem('google_token_expires_at') || '0', 10);
    return Boolean(token && (expiresAt - Date.now() > 60000));
}

/**
 * 檢查 Google 雲端是否處於可立即連線同步之有效狀態（已綁定且 Token 有效）
 */
export function isGoogleConnected() {
    return Boolean(isGoogleLinked() && isTokenValid());
}

/**
 * 初始化 Google Identity Services Token Client
 */
export async function initGisTokenClient(timeoutMs = 10000) {
    if (gisTokenClient) {
        return gisTokenClient;
    }

    if (!GOOGLE_CLIENT_ID) {
        return null;
    }

    const startTime = Date.now();
    while (typeof window.google === 'undefined' || !window.google.accounts || !window.google.accounts.oauth2) {
        if (Date.now() - startTime > timeoutMs) {
            console.warn('等待 Google Identity Services (GIS) 腳本載入逾時');
            return null;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
    }

    try {
        gisTokenClient = window.google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID,
            scope: GOOGLE_DRIVE_SCOPE,
            callback: () => {},
            error_callback: (err) => {
                if (typeof onGisError === 'function') onGisError(err);
            }
        });
        return gisTokenClient;
    } catch (err) {
        console.error('初始化 Google Identity Services 失敗:', err);
        return null;
    }
}

/**
 * 取得有效的 Google Access Token。支援過期前靜默刷新與失敗重新授權提示
 */
let tokenRefreshPromise = null;

export async function getValidAccessToken(forceInteractive = false) {
    if (!GOOGLE_CLIENT_ID) {
        return null;
    }

    if (!forceInteractive && !isGoogleLinked()) {
        return null;
    }

    const currentToken = localStorage.getItem('google_access_token');
    const expiresAt = parseInt(localStorage.getItem('google_token_expires_at') || '0', 10);
    const now = Date.now();

    if (!forceInteractive && currentToken && (expiresAt - now > 60000)) {
        return currentToken;
    }

    if (tokenRefreshPromise) {
        if (!forceInteractive) {
            return tokenRefreshPromise;
        }
        try {
            await tokenRefreshPromise;
        } catch (e) {
            // 前序背景請求異常略過，由後續互動流程接管
        }
    }

    if (!gisTokenClient) {
        await initGisTokenClient();
    }

    if (!gisTokenClient) {
        return null;
    }

    tokenRefreshPromise = new Promise((resolve, reject) => {
        let hasSettled = false;
        let timeoutId = null;

        const myGisErrorHandler = (err) => {
            const type = (err && err.type) || 'unknown';
            // 背景靜默續期：彈窗被擋或被關閉屬於「需要使用者互動」，不當成錯誤
            if (!forceInteractive && (type === 'popup_failed_to_open' || type === 'popup_closed')) {
                finish(resolve, null);
            } else {
                finish(reject, new Error(type));
            }
        };

        const finish = (settleFn, value) => {
            if (hasSettled) return;
            hasSettled = true;
            clearTimeout(timeoutId);
            if (onGisError === myGisErrorHandler) onGisError = null;
            settleFn(value);
        };

        // 互動式登入需要時間選帳號與授權，逾時放寬；靜默續期維持短逾時
        timeoutId = setTimeout(() => {
            finish(reject, new Error('GIS_REQUEST_TIMEOUT'));
        }, forceInteractive ? 120000 : 20000);

        onGisError = myGisErrorHandler;

        gisTokenClient.callback = (resp) => {
            if (resp && resp.access_token) {
                // 即使請求已逾時被判定失敗，只要 Google 之後真的回了 token 仍然存起來，不要浪費授權
                const expiresInSec = Number(resp.expires_in) || 3599;
                const newExpiresAt = Date.now() + (expiresInSec * 1000);
                localStorage.setItem('google_access_token', resp.access_token);
                localStorage.setItem('google_token_expires_at', newExpiresAt.toString());
                localStorage.setItem('google_auth_linked', 'true');
                updateSyncStatusIndicator(false);
                finish(resolve, resp.access_token);
                return;
            }

            const err = resp?.error || 'token_fetch_failed';
            // Safari ITP 或阻擋第三方 Cookie 環境下 prompt: '' 固定返回 interaction_required
            if (!forceInteractive && (err === 'interaction_required' || err === 'popup_closed_by_user')) {
                console.info('背景靜默續期受瀏覽器隱私沙盒（ITP）限制，維持本地排程並等待下次主動互動');
                finish(resolve, null);
            } else {
                finish(reject, new Error(err));
            }
        };

        try {
            if (forceInteractive) {
                gisTokenClient.requestAccessToken({ prompt: 'select_account' });
            } else {
                gisTokenClient.requestAccessToken({ prompt: '' });
            }
        } catch (e) {
            finish(reject, e);
        }
    }).finally(() => {
        tokenRefreshPromise = null;
    });

    return tokenRefreshPromise;
}

/**
 * 取得目前 Google 帳號的穩定識別碼（用來偵測「換了不同帳號」）。取不到時回傳 null，視為無法判斷。
 */
async function fetchGoogleAccountId(token) {
    try {
        const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`, {
            cache: 'no-store'
        });
        if (!res.ok) return null;
        const data = await res.json();
        return (data && data.sub) || null;
    } catch (e) {
        return null;
    }
}

/**
 * 清空所有本機資料與同步狀態（登出、換帳號時共用）
 */
async function wipeLocalData() {
    localStorage.removeItem('google_drive_file_id');
    localStorage.removeItem('google_drive_last_modified_time');
    localStorage.removeItem('sync_version');
    localStorage.removeItem('last_sync_time');
    localStorage.removeItem(PENDING_SYNC_FLAG);
    cachedDriveFileId = null;

    localStorage.removeItem('my_category_order');
    localStorage.removeItem('my_category_order_updatedAt');
    localStorage.removeItem('my_subcategory_order');
    localStorage.removeItem('my_subcategory_order_updatedAt');

    // 舊版遷移殘留：一併清除，避免登出後重新整理又把舊資料讀回來
    localStorage.removeItem('my_bookmarks');
    localStorage.removeItem('my_reminders');
    localStorage.removeItem('my_quotes');

    state.bookmarks = {};
    state.reminders = {};
    state.deletedRecords = { bookmarks: {}, reminders: {} };
    state.syncVersion = 0;
    state.previousCategory = null;
    state.currentEditingBookmarkId = null;
    state.currentEditingReminderId = null;
    state.pendingSyncItems = null;
    state.hasPendingSyncRender = false;
    state.currentCategory = '未分類';

    await StorageAPI.replaceMulti({
        bookmarks: {},
        reminders: {},
        deleted_bookmarks: {},
        deleted_reminders: {},
        quotes: {},
        deleted_quotes: {}
    });

    renderSidebar();
    if (typeof window.selectRemindersView === 'function') {
        window.selectRemindersView();
    }
}

/**
 * 觸發 Google 登入與授權，並落實雙向回寫補傳機制
 */
export async function requestGoogleAuth() {
    try {
        cachedDriveFileId = null;
        localStorage.removeItem('google_drive_file_id');
        const token = await getValidAccessToken(true);
        if (token) {
            localStorage.setItem('google_auth_linked', 'true');
            updateSyncStatusIndicator(false);

            // 偵測是否換了不同的 Google 帳號，避免舊帳號資料被混入新帳號
            const accountId = await fetchGoogleAccountId(token);
            const previousAccountId = localStorage.getItem('google_account_id');
            if (accountId && previousAccountId && accountId !== previousAccountId) {
                const shouldWipe = window.confirm(
                    '偵測到您登入了不同的 Google 帳號。\n\n' +
                    '【確定】清空本機資料，改用新帳號的雲端資料（舊帳號資料不會被帶入新帳號）。\n' +
                    '【取消】保留本機資料，並合併上傳到新帳號。'
                );
                if (shouldWipe) {
                    await wipeLocalData();
                }
            }
            if (accountId) localStorage.setItem('google_account_id', accountId);

            showCloudToast('Google 帳號連線成功');
            await downloadFromDrive(true);
            await uploadToDrive(true);
            // PENDING_SYNC_FLAG 只在上傳「真正成功」時由 executeDriveUpload 清除，這裡不可無條件移除
            startCloudPolling();
            return true;
        }
    } catch (e) {
        console.error('Google 帳號授權失敗:', e);
        handleSyncErrorAlert('Google 授權失敗或已取消', true);
    }
    return false;
}

/**
 * 解除 Google 授權並登出
 */
export async function signOutGoogle() {
    // 保護尚未同步的修改：登出會清空本機資料，若還有待補傳內容先嘗試補傳，仍失敗則讓使用者確認
    if (localStorage.getItem(PENDING_SYNC_FLAG) === 'true') {
        if (isTokenValid()) {
            try { await uploadToDrive(true); } catch (e) { /* 失敗時由下方確認處理 */ }
        }
        if (localStorage.getItem(PENDING_SYNC_FLAG) === 'true') {
            const proceed = window.confirm(
                '有尚未同步到雲端的修改，登出會清空本機資料並永久遺失這些修改。\n\n' +
                '建議先到設定中「匯出」備份。確定仍要登出嗎？'
            );
            if (!proceed) return false;
        }
    }

    const token = localStorage.getItem('google_access_token');
    if (token && window.google?.accounts?.oauth2?.revoke) {
        try {
            window.google.accounts.oauth2.revoke(token, () => {});
        } catch (e) {
            console.warn('Revoke token error:', e);
        }
    }

    localStorage.removeItem('google_access_token');
    localStorage.removeItem('google_token_expires_at');
    localStorage.removeItem('google_auth_linked');
    localStorage.removeItem('google_account_id');

    stopCloudPolling();

    try {
        await wipeLocalData();
    } catch (storageErr) {
        console.error('登出清理本地資料失敗:', storageErr);
    }

    updateSyncStatusIndicator(true);
    showCloudToast('已登出 Google 帳號');
    return true;
}

/**
 * 存量資料防禦：清洗物件中殘留的 Base64 圖片字串
 */
function cleanBase64FromString(str) {
    if (typeof str !== 'string') return str;
    return str
        .replace(/<img\b[^>]*>/gi, '')
        .replace(/data:image\/[^;]+;base64,[^\s"']+/gi, '');
}

/**
 * 清洗整份資料集（雲端下載、匯入、上傳前都會用到）。
 * 嚴格過濾 XSS 標籤、危險偽協定 URL 並清洗 Base64 殘留。
 */
export function sanitizeDatasetPayload(data) {
    if (!data || typeof data !== 'object') return data;

    const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

    if (data.bookmarks && typeof data.bookmarks === 'object') {
        Object.keys(data.bookmarks).forEach(k => {
            const b = data.bookmarks[k];
            if (!isPlainObject(b)) { delete data.bookmarks[k]; return; }
            if (b.url) b.url = sanitizeUrl(b.url);
            if (b.content) b.content = stripDangerousHtml(cleanBase64FromString(b.content));
            if (b.description) b.description = stripDangerousHtml(cleanBase64FromString(b.description));
        });
    }
    const reminderKey = data.reminders ? 'reminders' : (data.quotes ? 'quotes' : null);
    if (reminderKey && typeof data[reminderKey] === 'object') {
        Object.keys(data[reminderKey]).forEach(k => {
            const r = data[reminderKey][k];
            if (!isPlainObject(r)) { delete data[reminderKey][k]; return; }
            if (r.title) r.title = cleanBase64FromString(r.title);
            if (r.content) r.content = stripDangerousHtml(cleanBase64FromString(r.content));
        });
    }
    return data;
}

/**
 * 取得項目的最新修改時間毫秒數（相容舊版 timestamp 欄位）
 */
function getItemTimestamp(item) {
    if (!item) return 0;
    if (typeof item.updatedAt === 'number' && !Number.isNaN(item.updatedAt)) {
        return item.updatedAt;
    }
    if (item.timestamp && typeof item.timestamp === 'string') {
        const cleaned = item.timestamp.replace(/\(.*?\)/g, '').trim().replace(/\//g, '-');
        const parsed = Date.parse(cleaned);
        if (!Number.isNaN(parsed)) return parsed;
    }
    return 0;
}

/**
 * 針對具有唯一鍵值的資料集進行項目級別時間戳記與刪除墓碑比對合併
 */
function mergeItemCollections(localCollection = {}, remoteCollection = {}, localDeletes = {}, remoteDeletes = {}) {
    const mergedItems = {};
    const mergedDeletes = {};
    const CLOCK_SKEW_TOLERANCE_MS = 5000;
    const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 墓碑保留 30 天，過期自動修剪
    const now = Date.now();

    const safeLocal = localCollection || {};
    const safeRemote = remoteCollection || {};
    const safeLocalDel = localDeletes || {};
    const safeRemoteDel = remoteDeletes || {};

    const allDelKeys = new Set([...Object.keys(safeLocalDel), ...Object.keys(safeRemoteDel)]);
    for (const key of allDelKeys) {
        const timeLocal = typeof safeLocalDel[key] === 'number' ? safeLocalDel[key] : (safeLocalDel[key]?.deletedAt || 0);
        const timeRemote = typeof safeRemoteDel[key] === 'number' ? safeRemoteDel[key] : (safeRemoteDel[key]?.deletedAt || 0);
        const maxDelTime = Math.max(timeLocal, timeRemote);
        if (maxDelTime > 0 && (now - maxDelTime) < TOMBSTONE_TTL_MS) {
            mergedDeletes[key] = maxDelTime;
        }
    }

    const allKeys = new Set([...Object.keys(safeLocal), ...Object.keys(safeRemote)]);

    for (const key of allKeys) {
        const localItem = safeLocal[key];
        const remoteItem = safeRemote[key];

        const localTime = getItemTimestamp(localItem);
        const remoteTime = getItemTimestamp(remoteItem);

        let bestItem = null;
        let bestTime = 0;

        if (localItem && !remoteItem) {
            bestItem = localItem;
            bestTime = localTime;
        } else if (!localItem && remoteItem) {
            bestItem = remoteItem;
            bestTime = remoteTime;
        } else if (localItem && remoteItem) {
            bestItem = localTime >= remoteTime ? localItem : remoteItem;
            bestTime = Math.max(localTime, remoteTime);
        }

        const deleteTime = mergedDeletes[key] || 0;

        if (deleteTime > 0 && (deleteTime + CLOCK_SKEW_TOLERANCE_MS) >= bestTime) {
            continue;
        }

        if (bestItem) {
            mergedItems[key] = bestItem;
            if (mergedDeletes[key]) {
                delete mergedDeletes[key];
            }
        }
    }

    return { items: mergedItems, deletes: mergedDeletes };
}

/**
 * 解析各來源的分類順序與時間戳記
 */
function parseCategoryOrderPayload(orderRaw, updatedAtRaw) {
    let order = [];
    let updatedAt = 0;

    if (orderRaw && typeof orderRaw === 'object' && !Array.isArray(orderRaw)) {
        order = Array.isArray(orderRaw.order) ? orderRaw.order : [];
        updatedAt = Number(orderRaw.updatedAt) || 0;
    } else {
        if (Array.isArray(orderRaw)) {
            order = orderRaw;
        } else if (typeof orderRaw === 'string') {
            try {
                const parsed = JSON.parse(orderRaw);
                if (Array.isArray(parsed)) {
                    order = parsed;
                } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.order)) {
                    order = parsed.order;
                    if (!updatedAtRaw && parsed.updatedAt) updatedAt = Number(parsed.updatedAt) || 0;
                }
            } catch (e) {
                order = [];
            }
        }
        if (!updatedAt && updatedAtRaw) {
            updatedAt = Number(updatedAtRaw) || 0;
        }
    }

    const cleanOrder = (Array.isArray(order) ? order : []).filter(c => typeof c === 'string' && c.trim() !== '' && c.trim() !== '未分類');
    return { order: cleanOrder, updatedAt };
}

/**
 * 合併分類順序
 */
function mergeCategoryOrders(localOrderRaw, localUpdatedAtRaw, remoteOrderRaw, remoteUpdatedAtRaw, validBookmarks = {}) {
    const local = parseCategoryOrderPayload(localOrderRaw, localUpdatedAtRaw);
    const remote = parseCategoryOrderPayload(remoteOrderRaw, remoteUpdatedAtRaw);

    const validCategories = new Set();
    Object.values(validBookmarks || {}).forEach(bm => {
        if (bm && bm.category && typeof bm.category === 'string') {
            const cat = bm.category.trim();
            if (cat !== '' && cat !== '未分類' && cat !== '新增分類' && cat !== '新增內容' && cat !== '新增資料' && cat !== '新增網址') {
                validCategories.add(cat);
            }
        }
    });

    const isRemoteNewer = remote.updatedAt > local.updatedAt;
    const baseOrder = isRemoteNewer ? remote.order : local.order;
    const secondaryOrder = isRemoteNewer ? local.order : remote.order;
    const latestTimestamp = Math.max(local.updatedAt, remote.updatedAt, 0);

    const merged = [];
    const seen = new Set();

    for (const cat of baseOrder) {
        if (validCategories.has(cat) && !seen.has(cat)) {
            merged.push(cat);
            seen.add(cat);
        }
    }

    for (const cat of secondaryOrder) {
        if (validCategories.has(cat) && !seen.has(cat)) {
            merged.push(cat);
            seen.add(cat);
        }
    }

    const remainingCats = Array.from(validCategories).filter(c => !seen.has(c)).sort((a, b) => a.localeCompare(b));
    for (const cat of remainingCats) {
        merged.push(cat);
    }

    return {
        order: JSON.stringify(merged),
        updatedAt: latestTimestamp
    };
}

/**
 * 解析子分類排序字典
 */
function parseSubcategoryOrderPayload(orderRaw, updatedAtRaw) {
    let map = {};
    let updatedAt = 0;

    if (orderRaw && typeof orderRaw === 'object') {
        map = orderRaw;
    } else if (typeof orderRaw === 'string') {
        try {
            map = JSON.parse(orderRaw) || {};
        } catch (e) {
            map = {};
        }
    }

    if (updatedAtRaw) {
        updatedAt = Number(updatedAtRaw) || 0;
    }

    return { map, updatedAt };
}

/**
 * 合併子分類排序字典
 */
function mergeSubcategoryOrders(localOrderRaw, localUpdatedAtRaw, remoteOrderRaw, remoteUpdatedAtRaw) {
    const local = parseSubcategoryOrderPayload(localOrderRaw, localUpdatedAtRaw);
    const remote = parseSubcategoryOrderPayload(remoteOrderRaw, remoteUpdatedAtRaw);

    const isRemoteNewer = remote.updatedAt > local.updatedAt;
    const baseMap = isRemoteNewer ? remote.map : local.map;
    const secondaryMap = isRemoteNewer ? local.map : remote.map;
    const latestTimestamp = Math.max(local.updatedAt, remote.updatedAt, 0);

    const merged = { ...secondaryMap, ...baseMap };

    return {
        order: JSON.stringify(merged),
        updatedAt: latestTimestamp
    };
}

/**
 * 通用資料集智慧合併函式
 */
export function mergeDatasets(localData = {}, remoteData = {}) {
    const localDel = localData.deletedRecords || {};
    const remoteDel = remoteData.deletedRecords || {};

    const localReminders = localData.reminders || localData.quotes || {};
    const remoteReminders = remoteData.reminders || remoteData.quotes || {};
    const localReminderDels = localDel.reminders || localDel.quotes || {};
    const remoteReminderDels = remoteDel.reminders || remoteDel.quotes || {};

    const bookmarksResult = mergeItemCollections(localData.bookmarks, remoteData.bookmarks, localDel.bookmarks, remoteDel.bookmarks);
    const remindersResult = mergeItemCollections(localReminders, remoteReminders, localReminderDels, remoteReminderDels);

    const categoryOrderResult = mergeCategoryOrders(
        localData.category_order,
        localData.category_order_updatedAt,
        remoteData.category_order,
        remoteData.category_order_updatedAt,
        bookmarksResult.items
    );

    const subcategoryOrderResult = mergeSubcategoryOrders(
        localData.subcategory_order,
        localData.subcategory_order_updatedAt,
        remoteData.subcategory_order,
        remoteData.subcategory_order_updatedAt
    );

    const localVer = Number(localData.syncVersion) || 0;
    const remoteVer = Number(remoteData.syncVersion) || 0;
    const currentMaxVersion = Math.max(localVer, remoteVer);

    return {
        syncVersion: currentMaxVersion,
        bookmarks: bookmarksResult.items,
        reminders: remindersResult.items,
        deletedRecords: {
            bookmarks: bookmarksResult.deletes,
            reminders: remindersResult.deletes
        },
        category_order: categoryOrderResult.order,
        category_order_updatedAt: categoryOrderResult.updatedAt,
        subcategory_order: subcategoryOrderResult.order,
        subcategory_order_updatedAt: subcategoryOrderResult.updatedAt
    };
}

/**
 * 將合併後的最新資料寫入記憶體 state、IndexedDB 與 localStorage 並重繪視圖
 * 嚴格防禦：以當前記憶體最新實例（state）與 localStorage 時間戳記進行實時比對，杜絕舊快照覆蓋
 */
async function applyMergedDataAndRender(mergedData) {
    if (!mergedData || typeof mergedData !== 'object') return;

    if (mergedData.syncVersion !== undefined) {
        const ver = Number(mergedData.syncVersion) || 0;
        state.syncVersion = Math.max(state.syncVersion || 0, ver);
        localStorage.setItem('sync_version', state.syncVersion.toString());
    }

    const editorModal = document.getElementById('editor-modal');
    const fullEditorModal = document.getElementById('full-editor-modal');
    const isEditing = Boolean(
        (editorModal && editorModal.classList.contains('active')) ||
        (fullEditorModal && fullEditorModal.classList.contains('active'))
    );

    let activeType = null;
    let activeId = null;

    if (isEditing) {
        activeType = state.currentUnifiedType === 'note' ? 'bookmark' : state.currentUnifiedType;
        if (activeType === 'bookmark') {
            activeId = state.currentEditingBookmarkId || null;
        } else if (activeType === 'reminder') {
            activeId = state.currentEditingReminderId || null;
        }
    }

    // 動態即時讀取當前最新的記憶體狀態（保護非同步期間發生的新增與刪除）
    const protectedLocalBookmarks = { ...(state.bookmarks || {}) };
    const protectedLocalReminders = { ...(state.reminders || {}) };
    const protectedLocalDeletes = {
        bookmarks: { ...(state.deletedRecords?.bookmarks || {}) },
        reminders: { ...(state.deletedRecords?.reminders || {}) }
    };

    const reconciledBookmarks = mergeItemCollections(
        protectedLocalBookmarks,
        mergedData.bookmarks || {},
        protectedLocalDeletes.bookmarks,
        mergedData.deletedRecords?.bookmarks || {}
    );

    const reconciledReminders = mergeItemCollections(
        protectedLocalReminders,
        mergedData.reminders || mergedData.quotes || {},
        protectedLocalDeletes.reminders,
        mergedData.deletedRecords?.reminders || mergedData.deletedRecords?.quotes || {}
    );

    const nextBookmarks = reconciledBookmarks.items;
    const nextReminders = reconciledReminders.items;
    const nextDeleted = {
        bookmarks: reconciledBookmarks.deletes,
        reminders: reconciledReminders.deletes
    };

    // 嚴格墓碑硬防禦：若該項目在本地已被標記刪除，且墓碑時間戳記大於等於傳入項目之時間，絕不允許復活
    for (const id of Object.keys(protectedLocalDeletes.bookmarks)) {
        const delTime = typeof protectedLocalDeletes.bookmarks[id] === 'number' ? protectedLocalDeletes.bookmarks[id] : (protectedLocalDeletes.bookmarks[id]?.deletedAt || 0);
        if (delTime > 0 && nextBookmarks[id]) {
            const itemTime = getItemTimestamp(nextBookmarks[id]);
            if ((delTime + 5000) >= itemTime) {
                delete nextBookmarks[id];
                nextDeleted.bookmarks[id] = Math.max(nextDeleted.bookmarks[id] || 0, delTime);
            }
        }
    }

    for (const id of Object.keys(protectedLocalDeletes.reminders)) {
        const delTime = typeof protectedLocalDeletes.reminders[id] === 'number' ? protectedLocalDeletes.reminders[id] : (protectedLocalDeletes.reminders[id]?.deletedAt || 0);
        if (delTime > 0 && nextReminders[id]) {
            const itemTime = getItemTimestamp(nextReminders[id]);
            if ((delTime + 5000) >= itemTime) {
                delete nextReminders[id];
                nextDeleted.reminders[id] = Math.max(nextDeleted.reminders[id] || 0, delTime);
            }
        }
    }

    if (isEditing && activeId) {
        const baselineTime = state.editingBaselineUpdatedAt || 0;

        if (activeType === 'bookmark') {
            const remoteBookmark = (mergedData.bookmarks || {})[activeId];
            const deleteTime = typeof nextDeleted.bookmarks[activeId] === 'number' ? nextDeleted.bookmarks[activeId] : (nextDeleted.bookmarks[activeId]?.deletedAt || 0);
            const isDeletedRemote = Boolean(deleteTime > baselineTime && (!remoteBookmark || deleteTime >= (remoteBookmark.updatedAt || 0)));
            const remoteTime = remoteBookmark ? getItemTimestamp(remoteBookmark) : 0;

            if (isDeletedRemote || remoteTime > baselineTime) {
                if (!state.pendingSyncItems) state.pendingSyncItems = {};
                state.pendingSyncItems.bookmark = {
                    id: activeId,
                    data: isDeletedRemote ? null : remoteBookmark,
                    isDeleted: isDeletedRemote
                };
                state.hasEditConflict = true;
                showCloudToast('當前編輯的資料雲端已有新版本');
            }

            if (state.bookmarks[activeId]) {
                nextBookmarks[activeId] = state.bookmarks[activeId];
            }
        } else if (activeType === 'reminder') {
            const remoteReminder = (mergedData.reminders || mergedData.quotes || {})[activeId];
            const deleteTime = typeof nextDeleted.reminders[activeId] === 'number' ? nextDeleted.reminders[activeId] : (nextDeleted.reminders[activeId]?.deletedAt || 0);
            const isDeletedRemote = Boolean(deleteTime > baselineTime && (!remoteReminder || deleteTime >= (remoteReminder.updatedAt || 0)));
            const remoteTime = remoteReminder ? getItemTimestamp(remoteReminder) : 0;

            if (isDeletedRemote || remoteTime > baselineTime) {
                if (!state.pendingSyncItems) state.pendingSyncItems = {};
                state.pendingSyncItems.reminder = {
                    id: activeId,
                    data: isDeletedRemote ? null : remoteReminder,
                    isDeleted: isDeletedRemote
                };
                state.hasEditConflict = true;
                showCloudToast('當前編輯的提醒雲端已有新版本');
            }

            if (state.reminders[activeId]) {
                nextReminders[activeId] = state.reminders[activeId];
            }
        }
    }

    state.bookmarks = nextBookmarks;
    state.reminders = nextReminders;
    state.deletedRecords = nextDeleted;

    // 順序競態防禦：只有當傳入的順序時間戳記「嚴格大於」當前本地儲存的時間戳記時，才允許改寫
    const currentCatUpdatedAt = parseInt(localStorage.getItem('my_category_order_updatedAt') || '0', 10);
    const remoteCatUpdatedAt = parseInt(mergedData.category_order_updatedAt || '0', 10);

    if (remoteCatUpdatedAt > currentCatUpdatedAt && mergedData.category_order) {
        localStorage.setItem('my_category_order', typeof mergedData.category_order === 'string' ? mergedData.category_order : JSON.stringify(mergedData.category_order));
        localStorage.setItem('my_category_order_updatedAt', remoteCatUpdatedAt.toString());
    }

    const currentSubUpdatedAt = parseInt(localStorage.getItem('my_subcategory_order_updatedAt') || '0', 10);
    const remoteSubUpdatedAt = parseInt(mergedData.subcategory_order_updatedAt || '0', 10);

    if (remoteSubUpdatedAt > currentSubUpdatedAt && mergedData.subcategory_order) {
        localStorage.setItem('my_subcategory_order', typeof mergedData.subcategory_order === 'string' ? mergedData.subcategory_order : JSON.stringify(mergedData.subcategory_order));
        localStorage.setItem('my_subcategory_order_updatedAt', remoteSubUpdatedAt.toString());
    }

    // 四張表在單一交易內批次寫入，確保與記憶體狀態完全原子一致
    await StorageAPI.replaceMulti({
        bookmarks: state.bookmarks,
        reminders: state.reminders,
        deleted_bookmarks: state.deletedRecords.bookmarks || {},
        deleted_reminders: state.deletedRecords.reminders || {}
    });

    notifyCrossTabChange({ syncVersion: state.syncVersion });

    if (isEditing) {
        state.hasPendingSyncRender = true;
        return;
    }

    state.hasPendingSyncRender = false;
    renderSidebar();
}

/**
 * 查詢 Google Drive appDataFolder 內的備份檔案 ID
 */
async function locateDriveAppDataFileId(token, forceRefresh = false) {
    if (!forceRefresh && cachedDriveFileId) {
        return cachedDriveFileId;
    }

    const query = encodeURIComponent(`name='${GOOGLE_DRIVE_SYNC_FILENAME}' and trashed=false`);
    const url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${query}&orderBy=modifiedTime desc&fields=files(id,name,modifiedTime)`;

    const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` },
        cache: 'no-store'
    });

    if (res.status === 401) {
        throw new Error('UNAUTHORIZED');
    }

    if (!res.ok) {
        throw new Error(`LOOKUP_FAILED_${res.status}`);
    }

    const data = await res.json();
    if (data.files && data.files.length > 0) {
        const fileId = data.files[0].id;
        cachedDriveFileId = fileId;
        localStorage.setItem('google_drive_file_id', fileId);

        if (data.files.length > 1) {
            const staleFiles = data.files.slice(1);
            Promise.allSettled(
                staleFiles.map(file =>
                    fetch(`https://www.googleapis.com/drive/v3/files/${file.id}`, {
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${token}` }
                    })
                )
            ).catch(err => console.warn('清理冗餘雲端檔案時發生異常:', err));
        }

        return fileId;
    }

    cachedDriveFileId = null;
    localStorage.removeItem('google_drive_file_id');
    return null;
}

/**
 * 上傳後回讀雲端檔案做驗證。任何失敗都回傳 null（視為無法驗證，不阻擋成功流程）。
 */
async function readRemoteForVerification(token, fileId) {
    if (!fileId) return null;
    try {
        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&t=${Date.now()}`, {
            headers: { 'Authorization': `Bearer ${token}` },
            cache: 'no-store'
        });
        if (!res.ok) return null;
        const data = await res.json();
        return (data && typeof data === 'object') ? data : null;
    } catch (e) {
        return null;
    }
}

// 全域同步互斥隊列狀態
let isSyncRunning = false;
let hasPendingUpload = false;
let pendingUploadIsAuto = true;
let pendingDownloadResolvers = [];

function scheduleNextSyncTask() {
    if (isSyncRunning) return;

    if (hasPendingUpload) {
        hasPendingUpload = false;
        const isAuto = pendingUploadIsAuto;
        pendingUploadIsAuto = true;
        uploadToDrive(isAuto);
        return;
    }

    if (pendingDownloadResolvers.length > 0) {
        const nextDownload = pendingDownloadResolvers.shift();
        downloadFromDrive(nextDownload.isAuto).then(nextDownload.resolve);
    }
}

/**
 * 寫入與上傳資料至 Google Drive AppData（支援全域互斥）
 */
export async function uploadToDrive(isAuto = false) {
    if (!GOOGLE_CLIENT_ID) {
        if (!isAuto) openCloudAlert();
        return false;
    }

    if (!isGoogleLinked()) {
        if (!isAuto) openCloudAlert();
        return false;
    }

    if (isSyncRunning) {
        hasPendingUpload = true;
        if (!isAuto) pendingUploadIsAuto = false;
        return true;
    }

    isSyncRunning = true;
    try {
        await executeDriveUpload(isAuto);
    } finally {
        isSyncRunning = false;
        scheduleNextSyncTask();
    }
    return true;
}

/**
 * 實際執行 Google Drive 檔案上傳與樂觀鎖比對
 */
async function executeDriveUpload(isAuto) {
    let token = null;
    try {
        token = await getValidAccessToken(false);
    } catch (e) {
        updateSyncStatusIndicator(true);
        if (!isAuto) {
            handleSyncErrorAlert('Google 授權已失效，請點擊重新登入', true);
        } else {
            localStorage.setItem(PENDING_SYNC_FLAG, 'true');
        }
        return;
    }

    if (!token) {
        updateSyncStatusIndicator(true);
        if (!isAuto) {
            if (isGoogleLinked()) {
                try {
                    token = await getValidAccessToken(true);
                } catch (err) {
                    handleSyncErrorAlert('Google 授權已過期，請重新登入', true);
                    return;
                }
            } else {
                openCloudAlert();
                return;
            }
        } else {
            localStorage.setItem(PENDING_SYNC_FLAG, 'true');
            return;
        }
    }

    if (!token) {
        return;
    }

    for (let attempt = 0; attempt < MAX_SYNC_RETRIES; attempt++) {
        const expectedBaseVersion = Number(state.syncVersion) || Number(localStorage.getItem('sync_version')) || 0;

        let fileId = null;
        try {
            fileId = await locateDriveAppDataFileId(token);
        } catch (e) {
            if (e.message === 'UNAUTHORIZED') {
                updateSyncStatusIndicator(true);
                if (isAuto) {
                    localStorage.setItem(PENDING_SYNC_FLAG, 'true');
                    return;
                }
                try {
                    token = await getValidAccessToken(true);
                    fileId = await locateDriveAppDataFileId(token, true);
                } catch (retryErr) {
                    handleSyncErrorAlert('Google 授權已過期，請重新登入', true);
                    return;
                }
            } else {
                updateSyncStatusIndicator(true);
                if (!isAuto) {
                    handleSyncErrorAlert('雲端目錄檢索失敗');
                } else {
                    localStorage.setItem(PENDING_SYNC_FLAG, 'true');
                }
                return;
            }
        }

        let remoteData = {
            syncVersion: 0,
            bookmarks: {},
            reminders: {},
            deletedRecords: { bookmarks: {}, reminders: {} },
            category_order: '[]',
            category_order_updatedAt: 0,
            subcategory_order: '{}',
            subcategory_order_updatedAt: 0
        };

        if (fileId) {
            try {
                const readRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&t=${Date.now()}`, {
                    headers: { 'Authorization': `Bearer ${token}` },
                    cache: 'no-store'
                });

                if (readRes.status === 401) {
                    updateSyncStatusIndicator(true);
                    if (isAuto) {
                        localStorage.setItem(PENDING_SYNC_FLAG, 'true');
                        return;
                    }
                    token = await getValidAccessToken(true);
                    continue;
                } else if (readRes.status === 404) {
                    cachedDriveFileId = null;
                    localStorage.removeItem('google_drive_file_id');
                    fileId = null;
                } else if (readRes.ok) {
                    const parsed = await readRes.json();
                    if (parsed && typeof parsed === 'object') {
                        remoteData = sanitizeDatasetPayload(parsed);
                    }
                }
            } catch (err) {
                console.warn('雲端遠端預檢讀取異常，繼續使用現有資料進行備份', err);
            }
        }

        const remoteVersion = Number(remoteData.syncVersion) || 0;

        if (fileId && remoteVersion > expectedBaseVersion) {
            console.warn(`[Drive 同步版本衝突] 遠端版本 (${remoteVersion}) 大於本地預期基準 (${expectedBaseVersion})。正在自動拉取合併 (嘗試: ${attempt + 1}/${MAX_SYNC_RETRIES})`);

            const currentLocalData = {
                syncVersion: expectedBaseVersion,
                bookmarks: state.bookmarks || {},
                reminders: state.reminders || {},
                deletedRecords: state.deletedRecords || { bookmarks: {}, reminders: {} },
                category_order: localStorage.getItem('my_category_order') || '[]',
                category_order_updatedAt: parseInt(localStorage.getItem('my_category_order_updatedAt') || '0', 10),
                subcategory_order: localStorage.getItem('my_subcategory_order') || '{}',
                subcategory_order_updatedAt: parseInt(localStorage.getItem('my_subcategory_order_updatedAt') || '0', 10)
            };

            const autoMerged = mergeDatasets(currentLocalData, remoteData);
            await applyMergedDataAndRender(autoMerged);

            if (attempt < MAX_SYNC_RETRIES - 1) {
                await new Promise(r => setTimeout(r, 200 + Math.random() * 300));
                continue;
            } else {
                updateSyncStatusIndicator(true);
                if (!isAuto) {
                    handleSyncErrorAlert('雲端並行寫入重試逾限，已自動保留最新合併資料');
                } else {
                    localStorage.setItem(PENDING_SYNC_FLAG, 'true');
                }
                return;
            }
        }

        const localData = {
            syncVersion: expectedBaseVersion,
            bookmarks: state.bookmarks || {},
            reminders: state.reminders || {},
            deletedRecords: state.deletedRecords || { bookmarks: {}, reminders: {} },
            category_order: localStorage.getItem('my_category_order') || '[]',
            category_order_updatedAt: parseInt(localStorage.getItem('my_category_order_updatedAt') || '0', 10),
            subcategory_order: localStorage.getItem('my_subcategory_order') || '{}',
            subcategory_order_updatedAt: parseInt(localStorage.getItem('my_subcategory_order_updatedAt') || '0', 10)
        };

        const finalMergedData = mergeDatasets(localData, remoteData);
        const nextVersion = Math.max(expectedBaseVersion, remoteVersion) + 1;
        finalMergedData.syncVersion = nextVersion;
        // 每次上傳的唯一識別，用來在寫入後確認「雲端檔案確實是我這次寫的」（偵測同時寫入造成的整檔覆蓋）
        const syncNonce = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
        finalMergedData.syncNonce = syncNonce;

        const sanitizedData = sanitizeDatasetPayload(finalMergedData);
        const jsonContentString = JSON.stringify(sanitizedData, null, 2);

        try {
            let uploadRes = null;

            if (!fileId) {
                const boundary = 'foo_bar_baz_ru_boundary';
                const metadata = {
                    name: GOOGLE_DRIVE_SYNC_FILENAME,
                    parents: ['appDataFolder']
                };

                const multipartBody =
                    `--${boundary}\r\n` +
                    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
                    `${JSON.stringify(metadata)}\r\n` +
                    `--${boundary}\r\n` +
                    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
                    `${jsonContentString}\r\n` +
                    `--${boundary}--`;

                uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': `multipart/related; boundary=${boundary}`
                    },
                    body: multipartBody
                });
            } else {
                uploadRes = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=id,modifiedTime`, {
                    method: 'PATCH',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json; charset=UTF-8'
                    },
                    body: jsonContentString
                });
            }

            if (uploadRes.status === 401) {
                updateSyncStatusIndicator(true);
                if (isAuto) {
                    localStorage.setItem(PENDING_SYNC_FLAG, 'true');
                    return;
                }
                token = await getValidAccessToken(true);
                continue;
            }

            if (uploadRes.status === 404) {
                cachedDriveFileId = null;
                localStorage.removeItem('google_drive_file_id');
                continue;
            }

            if (uploadRes.ok) {
                const responseData = await uploadRes.json();
                if (responseData && responseData.id) {
                    cachedDriveFileId = responseData.id;
                    localStorage.setItem('google_drive_file_id', responseData.id);
                }
                if (responseData && responseData.modifiedTime) {
                    localStorage.setItem('google_drive_last_modified_time', responseData.modifiedTime);
                }

                // 寫入後回讀驗證：僅在回讀版本「大於等於」本次版本且 Nonce 不符時確認為並行覆蓋
                // 若回讀版本小於本次版本，純屬 Drive API 節點讀取快取延遲，不觸發重複合併
                const verifyFileId = (responseData && responseData.id) || fileId;
                const readBack = await readRemoteForVerification(token, verifyFileId);
                if (readBack && readBack.syncNonce !== syncNonce && Number(readBack.syncVersion) >= nextVersion) {
                    console.warn('[Drive 同步] 回讀驗證發現雲端已被更新版本覆蓋，正在拉取合併');
                    const currentLiveBeforeReMerge = {
                        syncVersion: nextVersion,
                        bookmarks: state.bookmarks || {},
                        reminders: state.reminders || {},
                        deletedRecords: state.deletedRecords || { bookmarks: {}, reminders: {} },
                        category_order: localStorage.getItem('my_category_order') || '[]',
                        category_order_updatedAt: parseInt(localStorage.getItem('my_category_order_updatedAt') || '0', 10),
                        subcategory_order: localStorage.getItem('my_subcategory_order') || '{}',
                        subcategory_order_updatedAt: parseInt(localStorage.getItem('my_subcategory_order_updatedAt') || '0', 10)
                    };
                    const reMerged = mergeDatasets(currentLiveBeforeReMerge, sanitizeDatasetPayload(readBack));
                    await applyMergedDataAndRender(reMerged);
                    if (attempt < MAX_SYNC_RETRIES - 1) {
                        continue;
                    }
                    localStorage.setItem(PENDING_SYNC_FLAG, 'true');
                    updateSyncStatusIndicator(true);
                    return;
                }

                // 動態取得當前最新的記憶體與墓碑，防止發起請求到成功回傳期間發生的異動被舊快照反向抹除
                const liveReconciledData = {
                    syncVersion: nextVersion,
                    bookmarks: state.bookmarks || {},
                    reminders: state.reminders || {},
                    deletedRecords: state.deletedRecords || { bookmarks: {}, reminders: {} },
                    category_order: localStorage.getItem('my_category_order') || '[]',
                    category_order_updatedAt: parseInt(localStorage.getItem('my_category_order_updatedAt') || '0', 10),
                    subcategory_order: localStorage.getItem('my_subcategory_order') || '{}',
                    subcategory_order_updatedAt: parseInt(localStorage.getItem('my_subcategory_order_updatedAt') || '0', 10)
                };

                await applyMergedDataAndRender(liveReconciledData);
                localStorage.setItem('last_sync_time', Date.now().toString());
                localStorage.removeItem(PENDING_SYNC_FLAG);

                updateSyncStatusIndicator(false);

                if (!isAuto) {
                    showCloudToast('備份成功');
                    closeSettingsModal();
                }
                return;
            } else {
                updateSyncStatusIndicator(true);
                if (!isAuto) {
                    handleSyncErrorAlert(`上傳失敗 (${uploadRes.status})，備份尚未完成`);
                } else {
                    localStorage.setItem(PENDING_SYNC_FLAG, 'true');
                }
                return;
            }
        } catch (error) {
            updateSyncStatusIndicator(true);
            if (!isAuto) {
                handleSyncErrorAlert('網路連線中斷，雲端備份暫停');
            } else {
                localStorage.setItem(PENDING_SYNC_FLAG, 'true');
            }
            return;
        }
    }
}

/**
 * 從 Google Drive 下載資料並執行合併（加入互斥排程）
 */
export async function downloadFromDrive(isAuto = false) {
    if (!GOOGLE_CLIENT_ID) {
        if (!isAuto) openCloudAlert();
        return false;
    }

    if (!isGoogleLinked()) {
        if (!isAuto) openCloudAlert();
        return false;
    }

    if (isSyncRunning) {
        return new Promise((resolve) => {
            pendingDownloadResolvers.push({ isAuto, resolve });
        });
    }

    isSyncRunning = true;
    let result = false;
    try {
        result = await executeDriveDownload(isAuto);
    } finally {
        isSyncRunning = false;
        scheduleNextSyncTask();
    }
    return result;
}

async function executeDriveDownload(isAuto) {
    let token = null;
    try {
        token = await getValidAccessToken(false);
    } catch (e) {
        updateSyncStatusIndicator(true);
        if (!isAuto) {
            handleSyncErrorAlert('Google 授權已過期，請重新登入', true);
        }
        return false;
    }

    if (!token) {
        updateSyncStatusIndicator(true);
        if (!isAuto) {
            try {
                token = await getValidAccessToken(true);
            } catch (err) {
                handleSyncErrorAlert('Google 授權已過期，請重新登入', true);
                return false;
            }
        }
        if (!token) {
            return false;
        }
    }

    if (!isAuto) showCloudToast('正在同步');
    const startTime = Date.now();

    try {
        let fileId = null;
        try {
            fileId = await locateDriveAppDataFileId(token);
        } catch (e) {
            if (e.message === 'UNAUTHORIZED') {
                updateSyncStatusIndicator(true);
                if (isAuto) {
                    return false;
                }
                token = await getValidAccessToken(true);
                fileId = await locateDriveAppDataFileId(token, true);
            } else {
                throw e;
            }
        }

        if (!fileId) {
            updateSyncStatusIndicator(false);
            await executeDriveUpload(true);
            if (!isAuto) {
                const elapsed = Date.now() - startTime;
                if (elapsed < 1200) {
                    await new Promise(r => setTimeout(r, 1200 - elapsed));
                }
                showCloudToast('連接成功');
                closeSettingsModal();
            }
            return true;
        }

        let readRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&t=${Date.now()}`, {
            headers: { 'Authorization': `Bearer ${token}` },
            cache: 'no-store'
        });

        if (readRes.status === 404) {
            cachedDriveFileId = null;
            localStorage.removeItem('google_drive_file_id');
            fileId = await locateDriveAppDataFileId(token, true);
            if (fileId) {
                readRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&t=${Date.now()}`, {
                    headers: { 'Authorization': `Bearer ${token}` },
                    cache: 'no-store'
                });
            } else {
                await executeDriveUpload(true);
                if (!isAuto) {
                    showCloudToast('連接成功');
                    closeSettingsModal();
                }
                return true;
            }
        }

        if (!readRes.ok) {
            updateSyncStatusIndicator(true);
            if (readRes.status === 401) {
                if (!isAuto) {
                    handleSyncErrorAlert('Google 授權已過期，請重新登入', true);
                }
                return false;
            }
            if (!isAuto) {
                handleSyncErrorAlert(`雲端讀取失敗 (${readRes.status})`);
            }
            return false;
        }

        const remoteData = sanitizeDatasetPayload(await readRes.json());
        if (!remoteData || typeof remoteData !== 'object') {
            updateSyncStatusIndicator(true);
            if (!isAuto) {
                handleSyncErrorAlert('雲端檔案解析失敗');
            }
            return false;
        }

        try {
            const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=modifiedTime&t=${Date.now()}`, {
                headers: { 'Authorization': `Bearer ${token}` },
                cache: 'no-store'
            });
            if (metaRes.ok) {
                const meta = await metaRes.json();
                if (meta && meta.modifiedTime) {
                    localStorage.setItem('google_drive_last_modified_time', meta.modifiedTime);
                }
            }
        } catch (metaErr) {
            console.warn('同步後取得遠端修改時間標記失敗:', metaErr);
        }

        const localData = {
            syncVersion: state.syncVersion || parseInt(localStorage.getItem('sync_version') || '0', 10),
            bookmarks: state.bookmarks || {},
            reminders: state.reminders || {},
            deletedRecords: state.deletedRecords || { bookmarks: {}, reminders: {} },
            category_order: localStorage.getItem('my_category_order') || '[]',
            category_order_updatedAt: parseInt(localStorage.getItem('my_category_order_updatedAt') || '0', 10),
            subcategory_order: localStorage.getItem('my_subcategory_order') || '{}',
            subcategory_order_updatedAt: parseInt(localStorage.getItem('my_subcategory_order_updatedAt') || '0', 10)
        };

        const finalMergedData = mergeDatasets(localData, remoteData);
        const alignedVersion = Math.max(Number(remoteData.syncVersion) || 0, Number(localData.syncVersion) || 0);
        finalMergedData.syncVersion = alignedVersion;
        await applyMergedDataAndRender(finalMergedData);

        localStorage.setItem('last_sync_time', Date.now().toString());
        updateSyncStatusIndicator(false);

        if (localStorage.getItem(PENDING_SYNC_FLAG) === 'true') {
            await executeDriveUpload(true);
        }

        if (!localStorage.getItem('google_account_id')) {
            fetchGoogleAccountId(token).then(id => { if (id) localStorage.setItem('google_account_id', id); });
        }

        if (!isAuto) {
            const elapsed = Date.now() - startTime;
            if (elapsed < 1200) {
                await new Promise(r => setTimeout(r, 1200 - elapsed));
            }
            showCloudToast('連接成功');
            closeSettingsModal();
        }
        return true;
    } catch (error) {
        console.error('Drive 同步失敗:', error);
        updateSyncStatusIndicator(true);
        if (!isAuto) {
            handleSyncErrorAlert('網路連線失敗，無法取得雲端更新');
        }
        return false;
    }
}

/**
 * 輕量級檢查雲端更新（比對 modifiedTime 元資料）
 */
export async function checkForRemoteUpdates() {
    if (isCheckingUpdates) return;
    if (!GOOGLE_CLIENT_ID || !isGoogleConnected() || !isTokenValid()) return;

    let token = null;
    try {
        token = await getValidAccessToken(false);
    } catch (e) {
        updateSyncStatusIndicator(true);
        return;
    }
    if (!token) {
        updateSyncStatusIndicator(true);
        return;
    }

    isCheckingUpdates = true;
    try {
        const fileId = await locateDriveAppDataFileId(token);
        if (!fileId) return;

        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=modifiedTime&t=${Date.now()}`, {
            headers: { 'Authorization': `Bearer ${token}` },
            cache: 'no-store'
        });

        if (res.status === 401) {
            updateSyncStatusIndicator(true);
            return;
        }

        if (res.status === 404) {
            cachedDriveFileId = null;
            localStorage.removeItem('google_drive_file_id');
            return;
        }

        if (!res.ok) {
            updateSyncStatusIndicator(true);
            return;
        }

        const data = await res.json();
        if (!data || !data.modifiedTime) return;

        const lastKnownModifiedTime = localStorage.getItem('google_drive_last_modified_time');

        if (lastKnownModifiedTime) {
            if (data.modifiedTime !== lastKnownModifiedTime) {
                showCloudToast('發現雲端新版本，點擊同步', {
                    persistent: true,
                    onClick: async () => {
                        showCloudToast('正在同步');
                        const success = await downloadFromDrive(false);
                        if (success) {
                            showCloudToast('連接成功');
                        }
                    }
                });
            }
        } else {
            localStorage.setItem('google_drive_last_modified_time', data.modifiedTime);
        }
    } catch (error) {
        console.warn('檢查遠端更新時發生異常:', error);
    } finally {
        isCheckingUpdates = false;
    }
}

export function startCloudPolling() {
    stopCloudPolling();
    if (!GOOGLE_CLIENT_ID || !isGoogleConnected() || !isTokenValid()) return;

    bindVisibilityEvents();

    pollingTimer = setInterval(() => {
        if (!document.hidden && isGoogleConnected() && isTokenValid()) {
            checkForRemoteUpdates();
        } else if (!isTokenValid()) {
            stopCloudPolling();
            updateSyncStatusIndicator(true);
        }
    }, POLLING_INTERVAL_MS);
}

export function stopCloudPolling() {
    if (pollingTimer) {
        clearInterval(pollingTimer);
        pollingTimer = null;
    }
}

/**
 * 在 App 啟動時就綁定（不必等輪詢成功啟動），確保離線補傳、回到前景檢查、Token 過期後的續期都有作用
 */
export function initSyncLifecycle() {
    bindVisibilityEvents();
}

async function resumeSyncIfPossible() {
    if (!isGoogleLinked()) return;

    if (isTokenValid()) {
        try {
            // 先完成待補傳上傳（會更新本地記錄的遠端修改時間），再檢查遠端更新，避免兩者並行造成時間戳記錯亂
            if (localStorage.getItem(PENDING_SYNC_FLAG) === 'true') {
                await uploadToDrive(true);
            }
            await checkForRemoteUpdates();
        } catch (e) {
            console.warn('回到前景時的同步檢查失敗:', e);
        }
        startCloudPolling();
    } else {
        updateSyncStatusIndicator(true);
    }
}

function bindVisibilityEvents() {
    if (isVisibilityBound) return;
    isVisibilityBound = true;

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopCloudPolling();
        } else {
            resumeSyncIfPossible();
        }
    });

    window.addEventListener('online', () => {
        console.info('偵測到網路連線恢復，執行自動補傳與檢查');
        resumeSyncIfPossible();
    });
}
