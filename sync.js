// sync.js
// 職責：處理與 Google Drive AppData (appDataFolder) 及 Google Identity Services (GIS) 的整合，
// 落實含墓碑機制（Tombstone）之項目級智慧合併、樂觀鎖、背景輪詢與 Page Visibility 感知。

import { state } from './state.js';
import * as UI from './ui.js';
import { showCloudToast, renderSidebar, isTransitionCategory } from './ui.js';
import { openCloudAlert, closeSettingsModal } from './interaction.js';
import { StorageAPI, stripDangerousHtml, sanitizeUrl, notifyCrossTabChange, safeJSONParse } from './storage.js';

let pollingTimer = null;
let isCheckingUpdates = false;
let autoApplyBackoffUntil = 0;
let lastActivityAt = Date.now();
let isActivityBound = false;
let pollingGeneration = 0;
let isVisibilityBound = false;
let silentRefreshCooldownUntil = 0;
let isResumingSync = false;
let resumeSyncDebounceTimer = null;
let isInteractiveAuthInProgress = false;
let localMutationSeq = 0;
let maxObservedTimestamp = parseInt(localStorage.getItem('sync_max_observed_ts') || '0', 10) || 0;

// ===== 同步參數（之後要調整只改這裡）=====
export const SYNC_CONFIG = {
    // true：偵測到雲端新版本時自動合併；false：恢復為「點擊同步」提示
    AUTO_APPLY_REMOTE: true,
    // 輪詢間隔：依最近一次使用者操作的時間自動切換
    POLL_ACTIVE_MS: 12000,        // 最近有操作
    POLL_IDLE_MS: 30000,          // 閒置一段時間
    POLL_DEEP_IDLE_MS: 60000,     // 長時間閒置
    ACTIVE_WINDOW_MS: 2 * 60 * 1000,
    IDLE_WINDOW_MS: 10 * 60 * 1000,
    // 自動合併失敗後，暫停自動套用的時間（避免每輪都重複失敗下載）
    AUTO_APPLY_BACKOFF_MS: 60000,
    SILENT_REFRESH_COOLDOWN_MS: 5 * 60 * 1000,
    TOMBSTONE_TTL_MS: 30 * 24 * 60 * 60 * 1000,
    CLOCK_SKEW_TOLERANCE_MS: 24 * 60 * 60 * 1000
};
const MAX_SYNC_RETRIES = 3;

function syncMaxObservedFromStorage() {
    try {
        const stored = parseInt(localStorage.getItem('sync_max_observed_ts') || '0', 10) || 0;
        if (stored > maxObservedTimestamp) {
            maxObservedTimestamp = stored;
        }
    } catch (e) {}
}

export function recordObservedTimestamp(ts) {
    syncMaxObservedFromStorage();
    const num = Number(ts);
    if (!Number.isFinite(num) || num <= 0) return;
    const maxAllowed = Date.now() + SYNC_CONFIG.CLOCK_SKEW_TOLERANCE_MS;
    const clamped = Math.min(num, maxAllowed);
    if (clamped > maxObservedTimestamp) {
        maxObservedTimestamp = clamped;
        try {
            localStorage.setItem('sync_max_observed_ts', String(maxObservedTimestamp));
        } catch (e) {}
    }
}

export function getMonotonicTimestamp(minFloor = 0) {
    syncMaxObservedFromStorage();
    const now = Date.now();
    const floor = Number.isFinite(Number(minFloor)) ? Number(minFloor) : 0;
    const maxAllowed = now + SYNC_CONFIG.CLOCK_SKEW_TOLERANCE_MS;
    const next = Math.min(maxAllowed, Math.max(now, maxObservedTimestamp + 1, floor + 1));
    if (next > maxObservedTimestamp) {
        maxObservedTimestamp = next;
        try {
            localStorage.setItem('sync_max_observed_ts', String(maxObservedTimestamp));
        } catch (e) {}
    }
    return next;
}

export function markLocalDataDirty() {
    localMutationSeq++;
    localStorage.setItem(PENDING_SYNC_FLAG, 'true');
}

const GOOGLE_DRIVE_SYNC_FILENAME = 'ru_sync_data.json';
const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

export const GOOGLE_CLIENT_ID = '1053583945415-682qotqfejjkb847h93mqu7fk4tkj7cu.apps.googleusercontent.com';

let gisTokenClient = null;
// GIS 的 popup_closed / popup_failed_to_open 只會走 error_callback，這裡轉交給目前等待中的請求
let onGisError = null;
let cachedDriveFileId = localStorage.getItem('google_drive_file_id') || null;
let currentRemoteETag = localStorage.getItem('google_drive_file_etag') || null;
let lastFileAuditTime = 0;
const FILE_AUDIT_INTERVAL_MS = 60000;

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
let lastReauthToastTime = 0;

export function notifyReauthRequired() {
    updateSyncStatusIndicator(true);
    const now = Date.now();
    if (now - lastReauthToastTime > 60000) {
        lastReauthToastTime = now;
        showCloudToast('Google 雲端授權已過期，點此重新驗證', {
            persistent: true,
            onClick: () => {
                if (typeof window.handleGoogleAuthClick === 'function') {
                    window.handleGoogleAuthClick();
                }
            }
        });
    }
}

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

    if (!forceInteractive && tokenRefreshPromise) {
        return tokenRefreshPromise;
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
        let popupCloseTimer = null;

        const myGisErrorHandler = (err) => {
            const type = (err && err.type) || 'unknown';
            if (!forceInteractive && (type === 'popup_failed_to_open' || type === 'popup_closed')) {
                finish(resolve, null);
            } else if (forceInteractive && type === 'popup_closed') {
                popupCloseTimer = setTimeout(() => {
                    finish(reject, new Error('popup_closed'));
                }, 1200);
            } else {
                finish(reject, new Error(type));
            }
        };

        const finish = (settleFn, value) => {
            if (hasSettled) return;
            hasSettled = true;
            clearTimeout(timeoutId);
            if (popupCloseTimer) clearTimeout(popupCloseTimer);
            if (onGisError === myGisErrorHandler) onGisError = null;
            settleFn(value);
        };

        timeoutId = setTimeout(() => {
            if (!forceInteractive) {
                finish(resolve, null);
            } else {
                finish(reject, new Error('GIS_REQUEST_TIMEOUT'));
            }
        }, forceInteractive ? 120000 : 20000);

        onGisError = myGisErrorHandler;

        gisTokenClient.callback = (resp) => {
            if (popupCloseTimer) clearTimeout(popupCloseTimer);
            if (resp && resp.access_token) {
                const expiresInSec = Number(resp.expires_in) || 3599;
                const newExpiresAt = Date.now() + (expiresInSec * 1000);
                localStorage.setItem('google_access_token', resp.access_token);
                localStorage.setItem('google_token_expires_at', newExpiresAt.toString());
                localStorage.setItem('google_auth_linked', 'true');
                lastReauthToastTime = 0;
                updateSyncStatusIndicator(false);
                finish(resolve, resp.access_token);
                return;
            }

            const err = resp?.error || 'token_fetch_failed';
            if (!forceInteractive && (err === 'interaction_required' || err === 'popup_closed_by_user')) {
                silentRefreshCooldownUntil = Date.now() + SYNC_CONFIG.SILENT_REFRESH_COOLDOWN_MS;
                finish(resolve, null);
            } else {
                if (!forceInteractive) {
                    silentRefreshCooldownUntil = Date.now() + SYNC_CONFIG.SILENT_REFRESH_COOLDOWN_MS;
                }
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
        const res = await fetch('https://oauth2.googleapis.com/tokeninfo', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({ access_token: token }),
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
    localStorage.removeItem('google_drive_file_etag');
    localStorage.removeItem('google_drive_last_modified_time');
    localStorage.removeItem('sync_version');
    localStorage.removeItem('last_sync_time');
    localStorage.removeItem('sync_max_observed_ts');
    localStorage.removeItem(PENDING_SYNC_FLAG);
    cachedDriveFileId = null;
    currentRemoteETag = null;
    lastFileAuditTime = 0;
    maxObservedTimestamp = 0;

    localStorage.removeItem('my_category_order');
    localStorage.removeItem('my_category_order_updatedAt');
    localStorage.removeItem('my_subcategory_order');
    localStorage.removeItem('my_subcategory_order_updatedAt');
    localStorage.removeItem('my_subcategory_order_timestamps');
    localStorage.removeItem('my_empty_categories');
    localStorage.removeItem('my_empty_categories_updatedAt');
    localStorage.removeItem('my_empty_categories_timestamps');
    localStorage.removeItem('my_deleted_categories');
    localStorage.removeItem('my_category_renames');

    // 舊版遷移殘留：一併清除，避免登出後重新整理又把舊資料讀回來
    localStorage.removeItem('my_bookmarks');
    localStorage.removeItem('my_reminders');

    state.bookmarks = {};
    state.reminders = {};
    state.deletedRecords = { bookmarks: {}, reminders: {} };
    state.userProfile = {
        avatarData: '',
        avatarUpdatedAt: 0,
        username: '',
        usernameUpdatedAt: 0
    };
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
        deleted_reminders: {}
    });
    await StorageAPI.deleteItem('profile', 'current');

    renderSidebar();
    if (typeof UI.renderUserProfileUI === 'function') {
        UI.renderUserProfileUI();
    }
    if (typeof window.selectRemindersView === 'function') {
        window.selectRemindersView();
    }
}

/**
 * 觸發 Google 登入與授權，並落實雙向回寫補傳機制
 */
export async function requestGoogleAuth() {
    if (isInteractiveAuthInProgress) return false;
    isInteractiveAuthInProgress = true;
    let token = null;

    try {
        cachedDriveFileId = null;
        localStorage.removeItem('google_drive_file_id');
        token = await getValidAccessToken(true);
    } catch (e) {
        console.error('Google 帳號授權失敗:', e);
        handleSyncErrorAlert('Google 授權失敗或已取消', true);
        isInteractiveAuthInProgress = false;
        return false;
    }

    if (!token) {
        isInteractiveAuthInProgress = false;
        return false;
    }

    try {
        localStorage.setItem('google_auth_linked', 'true');
        updateSyncStatusIndicator(false);

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

        try {
            await downloadFromDrive(true);
            if (localStorage.getItem(PENDING_SYNC_FLAG) === 'true') {
                await uploadToDrive(true);
            }
        } catch (syncErr) {
            console.error('登入後初次同步失敗:', syncErr);
            showCloudToast('已連線帳號，正在背景同步資料');
        }

        renderSidebar();
        startCloudPolling();
        return true;
    } catch (e) {
        console.error('Google 登入後處理異常:', e);
        handleSyncErrorAlert('登入設定異常，請重試');
    } finally {
        isInteractiveAuthInProgress = false;
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
 * 存量資料防禦：清洗物件中殘留的 Base64 圖片字串，保留合法外鏈圖片標籤
 */
function cleanBase64FromString(str) {
    if (typeof str !== 'string') return str;
    return str
        .replace(/<img\b[^>]*?\bsrc\s*=\s*["']?\s*data:image\/[^"'>\s]+["']?[^>]*>/gi, '')
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
    if (data.reminders && typeof data.reminders === 'object') {
        Object.keys(data.reminders).forEach(k => {
            const r = data.reminders[k];
            if (!isPlainObject(r)) { delete data.reminders[k]; return; }
            if (r.title) r.title = cleanBase64FromString(r.title);
            if (r.content) r.content = stripDangerousHtml(cleanBase64FromString(r.content));
        });
    }

    const rawProfile = isPlainObject(data.userProfile) ? data.userProfile : {};
    const now = Date.now();
    const maxAllowedTimestamp = now + SYNC_CONFIG.CLOCK_SKEW_TOLERANCE_MS;
    const allowedAvatarPattern = /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/;

    let cleanAvatarData = '';
    if (typeof rawProfile.avatarData === 'string' && rawProfile.avatarData.length > 0 && rawProfile.avatarData.length <= 150000) {
        if (allowedAvatarPattern.test(rawProfile.avatarData)) {
            cleanAvatarData = rawProfile.avatarData;
        }
    }

    let cleanUsername = '';
    if (typeof rawProfile.username === 'string') {
        cleanUsername = stripDangerousHtml(rawProfile.username)
            .replace(/<[^>]*>/g, '')
            .trim()
            .slice(0, 50);
    }

    const sanitizeProfileTimestamp = (val) => {
        const ts = Number(val);
        if (!Number.isFinite(ts) || ts <= 0) return 0;
        return ts > maxAllowedTimestamp ? now : ts;
    };

    data.userProfile = {
        avatarData: cleanAvatarData,
        avatarUpdatedAt: sanitizeProfileTimestamp(rawProfile.avatarUpdatedAt),
        username: cleanUsername,
        usernameUpdatedAt: sanitizeProfileTimestamp(rawProfile.usernameUpdatedAt)
    };

    return data;
}

/**
 * 取得項目的最新修改時間毫秒數（相容舊版 timestamp 欄位），僅對異常遙遠未來值夾限至容忍上限
 */
function getItemTimestamp(item) {
    if (!item) return 0;
    let time = 0;
    if (typeof item.updatedAt === 'number' && !Number.isNaN(item.updatedAt)) {
        time = item.updatedAt;
    } else if (item.timestamp && typeof item.timestamp === 'string') {
        const cleaned = item.timestamp.replace(/\(.*?\)/g, '').trim().replace(/\//g, '-');
        const parsed = Date.parse(cleaned);
        if (!Number.isNaN(parsed)) time = parsed;
    }
    if (time <= 0) return 0;
    const maxAllowed = Date.now() + SYNC_CONFIG.CLOCK_SKEW_TOLERANCE_MS;
    if (time > maxAllowed) {
        if (typeof item.updatedAt === 'number') {
            item.updatedAt = maxAllowed;
        }
        recordObservedTimestamp(maxAllowed);
        return maxAllowed;
    }
    recordObservedTimestamp(time);
    return time;
}

/**
 * 針對具有唯一鍵值的資料集進行項目級別時間戳記與刪除墓碑比對合併（含時間戳與墓碑夾限校驗）
 */
function mergeItemCollections(localCollection = {}, remoteCollection = {}, localDeletes = {}, remoteDeletes = {}) {
    const mergedItems = {};
    const mergedDeletes = {};
    const TOMBSTONE_TTL_MS = SYNC_CONFIG.TOMBSTONE_TTL_MS;
    const now = Date.now();
    const maxAllowedTimestamp = now + SYNC_CONFIG.CLOCK_SKEW_TOLERANCE_MS;

    const safeLocal = localCollection || {};
    const safeRemote = remoteCollection || {};
    const safeLocalDel = localDeletes || {};
    const safeRemoteDel = remoteDeletes || {};

    const sanitizeTombstoneTime = (val) => {
        let t = 0;
        if (typeof val === 'number') {
            t = val;
        } else if (val && typeof val.deletedAt === 'number') {
            t = val.deletedAt;
        } else if (typeof val === 'string') {
            const parsed = Number(val);
            if (!Number.isNaN(parsed)) t = parsed;
        }
        if (!Number.isFinite(t) || t <= 0) return 0;
        return t > maxAllowedTimestamp ? now : t;
    };

    const allDelKeys = new Set([...Object.keys(safeLocalDel), ...Object.keys(safeRemoteDel)]);
    for (const key of allDelKeys) {
        const timeLocal = sanitizeTombstoneTime(safeLocalDel[key]);
        const timeRemote = sanitizeTombstoneTime(safeRemoteDel[key]);
        const maxDelTime = Math.max(timeLocal, timeRemote);
        if (maxDelTime > 0 && (now - maxDelTime) < TOMBSTONE_TTL_MS) {
            mergedDeletes[key] = maxDelTime;
            recordObservedTimestamp(maxDelTime);
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

        if (deleteTime > 0 && deleteTime >= bestTime) {
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
function mergeCategoryOrders(localOrderRaw, localUpdatedAtRaw, remoteOrderRaw, remoteUpdatedAtRaw, validBookmarks = {}, emptyCategories = []) {
    const local = parseCategoryOrderPayload(localOrderRaw, localUpdatedAtRaw);
    const remote = parseCategoryOrderPayload(remoteOrderRaw, remoteUpdatedAtRaw);

    const validCategories = new Set();
    Object.values(validBookmarks || {}).forEach(bm => {
        if (bm && bm.category && typeof bm.category === 'string') {
            const cat = bm.category.trim();
            if (cat !== '' && cat !== '未分類' && cat !== '新增分類' && cat !== '新增內容' && cat !== '新增網址') {
                validCategories.add(cat);
            }
        }
    });

    if (Array.isArray(emptyCategories)) {
        emptyCategories.forEach(cat => {
            if (typeof cat === 'string') {
                const trimmed = cat.trim();
                if (trimmed !== '' && trimmed !== '未分類' && trimmed !== '新增分類' && trimmed !== '新增內容' && trimmed !== '新增網址') {
                    validCategories.add(trimmed);
                }
            }
        });
    }

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
 * 解析空分類清單
 */
function parseEmptyCategoriesPayload(raw, updatedAtRaw) {
    let list = [];
    let updatedAt = 0;

    if (Array.isArray(raw)) {
        list = raw;
    } else if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                list = parsed;
            } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.categories)) {
                list = parsed.categories;
                if (!updatedAtRaw && parsed.updatedAt) updatedAt = Number(parsed.updatedAt) || 0;
            }
        } catch (e) {
            list = [];
        }
    }

    if (!updatedAt && updatedAtRaw) {
        updatedAt = Number(updatedAtRaw) || 0;
    }

    const clean = (Array.isArray(list) ? list : []).filter(c => typeof c === 'string' && c.trim() !== '' && c.trim() !== '未分類');
    return { list: clean, updatedAt };
}

/**
 * 合併空分類清單（採用聯集 Union 機制、個別分類存在時間戳與分類刪除墓碑過濾，杜絕跨裝置整批抹除與誤復活）
 */
function mergeEmptyCategories(
    localRaw,
    localUpdatedAtRaw,
    remoteRaw,
    remoteUpdatedAtRaw,
    localDeleted = {},
    remoteDeleted = {},
    localTimestampsRaw = {},
    remoteTimestampsRaw = {}
) {
    const local = parseEmptyCategoriesPayload(localRaw, localUpdatedAtRaw);
    const remote = parseEmptyCategoriesPayload(remoteRaw, remoteUpdatedAtRaw);

    const parseTimestampsMap = (raw) => {
        if (!raw) return {};
        if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
        if (typeof raw === 'string') {
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
            } catch (e) {
                return {};
            }
        }
        return {};
    };

    const localTimestamps = parseTimestampsMap(localTimestampsRaw);
    const remoteTimestamps = parseTimestampsMap(remoteTimestampsRaw);

    const now = Date.now();
    const maxAllowedTimestamp = now + SYNC_CONFIG.CLOCK_SKEW_TOLERANCE_MS;
    const TOMBSTONE_TTL_MS = SYNC_CONFIG.TOMBSTONE_TTL_MS;

    const mergedDeletes = {};
    const allDelCats = new Set([...Object.keys(localDeleted || {}), ...Object.keys(remoteDeleted || {})]);
    for (const cat of allDelCats) {
        let tLocal = 0;
        if (typeof localDeleted?.[cat] === 'number') tLocal = localDeleted[cat];
        else if (localDeleted?.[cat]?.deletedAt) tLocal = localDeleted[cat].deletedAt;

        let tRemote = 0;
        if (typeof remoteDeleted?.[cat] === 'number') tRemote = remoteDeleted[cat];
        else if (remoteDeleted?.[cat]?.deletedAt) tRemote = remoteDeleted[cat].deletedAt;

        const maxDel = Math.max(tLocal, tRemote);
        if (maxDel > 0 && maxDel <= maxAllowedTimestamp && (now - maxDel) < TOMBSTONE_TTL_MS) {
            mergedDeletes[cat] = maxDel;
            recordObservedTimestamp(maxDel);
        }
    }

    const unionSet = new Set([...local.list, ...remote.list]);
    const mergedList = [];
    const mergedTimestamps = {};

    for (const cat of unionSet) {
        const localHad = local.list.includes(cat);
        const remoteHad = remote.list.includes(cat);
        const localCatTs = localHad ? Math.min(maxAllowedTimestamp, Number(localTimestamps[cat]) || local.updatedAt || 0) : 0;
        const remoteCatTs = remoteHad ? Math.min(maxAllowedTimestamp, Number(remoteTimestamps[cat]) || remote.updatedAt || 0) : 0;
        const latestPresenceUpdate = Math.max(localCatTs, remoteCatTs, 0);

        if (latestPresenceUpdate > 0) {
            recordObservedTimestamp(latestPresenceUpdate);
        }

        const delTime = mergedDeletes[cat] || 0;
        if (delTime > 0 && delTime >= latestPresenceUpdate) {
            continue;
        }

        if (delTime > 0 && latestPresenceUpdate > delTime) {
            delete mergedDeletes[cat];
        }

        mergedList.push(cat);
        mergedTimestamps[cat] = latestPresenceUpdate;
    }

    const latestTimestamp = Math.max(local.updatedAt, remote.updatedAt, ...Object.values(mergedTimestamps), 0);

    return {
        categories: JSON.stringify(mergedList),
        rawList: mergedList,
        updatedAt: latestTimestamp,
        timestamps: mergedTimestamps,
        deletedCategories: mergedDeletes
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
function mergeSubcategoryOrders(localOrderRaw, localUpdatedAtRaw, remoteOrderRaw, remoteUpdatedAtRaw, validBookmarks = {}, emptyCategories = [], localTimestampsRaw = {}, remoteTimestampsRaw = {}) {
    const local = parseSubcategoryOrderPayload(localOrderRaw, localUpdatedAtRaw);
    const remote = parseSubcategoryOrderPayload(remoteOrderRaw, remoteUpdatedAtRaw);

    const parseTimestamps = (raw) => {
        if (!raw) return {};
        if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
        if (typeof raw === 'string') {
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
            } catch (e) {
                return {};
            }
        }
        return {};
    };

    const localTimestamps = parseTimestamps(localTimestampsRaw);
    const remoteTimestamps = parseTimestamps(remoteTimestampsRaw);

    const isRemoteNewerGlobal = remote.updatedAt > local.updatedAt;
    const latestTimestamp = Math.max(local.updatedAt, remote.updatedAt, 0);

    const validCategories = new Set();
    const validSubcategoriesByCat = new Map();

    Object.values(validBookmarks || {}).forEach(bm => {
        if (bm && bm.category && typeof bm.category === 'string') {
            const cat = bm.category.trim();
            if (cat !== '' && cat !== '未分類' && !isTransitionCategory(cat)) {
                validCategories.add(cat);
                if (!validSubcategoriesByCat.has(cat)) {
                    validSubcategoriesByCat.set(cat, new Set());
                }
                if (bm.subCategory && typeof bm.subCategory === 'string') {
                    const sub = bm.subCategory.trim();
                    if (sub !== '' && sub !== '未分類') {
                        validSubcategoriesByCat.get(cat).add(sub);
                    }
                }
            }
        }
    });

    if (Array.isArray(emptyCategories)) {
        emptyCategories.forEach(cat => {
            if (typeof cat === 'string') {
                const trimmed = cat.trim();
                if (trimmed !== '' && trimmed !== '未分類' && !isTransitionCategory(trimmed)) {
                    validCategories.add(trimmed);
                    if (!validSubcategoriesByCat.has(trimmed)) {
                        validSubcategoriesByCat.set(trimmed, new Set());
                    }
                }
            }
        });
    }

    const merged = {};
    const mergedTimestamps = {};

    for (const cat of validCategories) {
        const validSubs = validSubcategoriesByCat.get(cat) || new Set();

        const hasLocalSpecific = typeof localTimestamps[cat] !== 'undefined';
        const hasRemoteSpecific = typeof remoteTimestamps[cat] !== 'undefined';

        let catTimeLocal = 0;
        let catTimeRemote = 0;

        if (hasLocalSpecific || hasRemoteSpecific) {
            catTimeLocal = Number(localTimestamps[cat]) || 0;
            catTimeRemote = Number(remoteTimestamps[cat]) || 0;
        } else {
            catTimeLocal = local.updatedAt || 0;
            catTimeRemote = remote.updatedAt || 0;
        }

        let isCatRemoteNewer = false;
        if (catTimeRemote !== catTimeLocal) {
            isCatRemoteNewer = catTimeRemote > catTimeLocal;
        } else {
            isCatRemoteNewer = isRemoteNewerGlobal;
        }

        const baseOrder = isCatRemoteNewer
            ? (Array.isArray(remote.map[cat]) ? remote.map[cat] : [])
            : (Array.isArray(local.map[cat]) ? local.map[cat] : []);

        const secondaryOrder = isCatRemoteNewer
            ? (Array.isArray(local.map[cat]) ? local.map[cat] : [])
            : (Array.isArray(remote.map[cat]) ? remote.map[cat] : []);

        const subList = [];
        const seenSubs = new Set();

        for (const sub of baseOrder) {
            if (typeof sub === 'string') {
                const trimmedSub = sub.trim();
                if (trimmedSub && validSubs.has(trimmedSub) && !seenSubs.has(trimmedSub)) {
                    subList.push(trimmedSub);
                    seenSubs.add(trimmedSub);
                }
            }
        }

        for (const sub of secondaryOrder) {
            if (typeof sub === 'string') {
                const trimmedSub = sub.trim();
                if (trimmedSub && validSubs.has(trimmedSub) && !seenSubs.has(trimmedSub)) {
                    subList.push(trimmedSub);
                    seenSubs.add(trimmedSub);
                }
            }
        }

        const remainingSubs = Array.from(validSubs).filter(s => !seenSubs.has(s)).sort((a, b) => a.localeCompare(b));
        for (const sub of remainingSubs) {
            subList.push(sub);
            seenSubs.add(sub);
        }

        if (subList.length > 0) {
            merged[cat] = subList;
        }
        mergedTimestamps[cat] = Math.max(catTimeLocal, catTimeRemote, 0);
    }

    return {
        order: JSON.stringify(merged),
        updatedAt: latestTimestamp,
        timestamps: mergedTimestamps
    };
}

/**
 * 合併分類改名表（加入 30 天 TTL 清理過期映射）
 */
function mergeCategoryRenames(localRenamesRaw = {}, remoteRenamesRaw = {}) {
    const parseRenames = (raw) => {
        if (!raw) return {};
        if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
        if (typeof raw === 'string') {
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
            } catch (e) {
                return {};
            }
        }
        return {};
    };

    const local = parseRenames(localRenamesRaw);
    const remote = parseRenames(remoteRenamesRaw);
    const now = Date.now();
    const TOMBSTONE_TTL_MS = SYNC_CONFIG.TOMBSTONE_TTL_MS;
    const merged = {};

    const allKeys = new Set([...Object.keys(local), ...Object.keys(remote)]);
    for (const key of allKeys) {
        const itemLocal = local[key];
        const itemRemote = remote[key];

        let bestItem = null;
        if (itemLocal && !itemRemote) {
            bestItem = itemLocal;
        } else if (!itemLocal && itemRemote) {
            bestItem = itemRemote;
        } else if (itemLocal && itemRemote) {
            const timeLocal = Number(itemLocal.at) || 0;
            const timeRemote = Number(itemRemote.at) || 0;
            bestItem = timeRemote > timeLocal ? itemRemote : itemLocal;
        }

        if (bestItem && bestItem.to && typeof bestItem.to === 'string') {
            const timeAt = Number(bestItem.at) || 0;
            if (timeAt > 0 && (now - timeAt) < TOMBSTONE_TTL_MS) {
                merged[key] = {
                    to: bestItem.to.trim(),
                    at: timeAt
                };
            }
        }
    }

    return merged;
}

/**
 * 合併個人頭像與使用者名稱（兩者獨立比對更新時間戳，較新者勝出）
 */
function mergeUserProfile(localProfileRaw = {}, remoteProfileRaw = {}) {
    const now = Date.now();
    const maxAllowedTimestamp = now + SYNC_CONFIG.CLOCK_SKEW_TOLERANCE_MS;

    const normalizeProfile = (raw) => {
        const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
        const clampTs = (val) => {
            const ts = Number(val);
            if (!Number.isFinite(ts) || ts <= 0) return 0;
            const clamped = ts > maxAllowedTimestamp ? now : ts;
            recordObservedTimestamp(clamped);
            return clamped;
        };
        return {
            avatarData: typeof src.avatarData === 'string' ? src.avatarData : '',
            avatarUpdatedAt: clampTs(src.avatarUpdatedAt),
            username: typeof src.username === 'string' ? src.username : '',
            usernameUpdatedAt: clampTs(src.usernameUpdatedAt)
        };
    };

    const local = normalizeProfile(localProfileRaw);
    const remote = normalizeProfile(remoteProfileRaw);

    const useRemoteAvatar = remote.avatarUpdatedAt > local.avatarUpdatedAt;
    const useRemoteUsername = remote.usernameUpdatedAt > local.usernameUpdatedAt;

    return {
        avatarData: useRemoteAvatar ? remote.avatarData : local.avatarData,
        avatarUpdatedAt: useRemoteAvatar ? remote.avatarUpdatedAt : local.avatarUpdatedAt,
        username: useRemoteUsername ? remote.username : local.username,
        usernameUpdatedAt: useRemoteUsername ? remote.usernameUpdatedAt : local.usernameUpdatedAt
    };
}

/**
 * 通用資料集智慧合併函式
 */
export function mergeDatasets(localData = {}, remoteData = {}) {
    const localDel = localData.deletedRecords || {};
    const remoteDel = remoteData.deletedRecords || {};

    const localReminders = localData.reminders || {};
    const remoteReminders = remoteData.reminders || {};
    const localReminderDels = localDel.reminders || {};
    const remoteReminderDels = remoteDel.reminders || {};

    const bookmarksResult = mergeItemCollections(localData.bookmarks, remoteData.bookmarks, localDel.bookmarks, remoteDel.bookmarks);
    const remindersResult = mergeItemCollections(localReminders, remoteReminders, localReminderDels, remoteReminderDels);
    const userProfileResult = mergeUserProfile(localData.userProfile, remoteData.userProfile);

    let localDeletedCats = {};
    try {
        localDeletedCats = localData.deleted_categories || localDel.categories || JSON.parse(localStorage.getItem('my_deleted_categories') || '{}');
    } catch (e) {
        localDeletedCats = {};
    }
    const remoteDeletedCats = remoteData.deleted_categories || remoteDel.categories || {};

    const emptyCategoriesResult = mergeEmptyCategories(
        localData.empty_categories || localData.my_empty_categories,
        localData.empty_categories_updatedAt || localData.my_empty_categories_updatedAt,
        remoteData.empty_categories || remoteData.my_empty_categories,
        remoteData.empty_categories_updatedAt || remoteData.my_empty_categories_updatedAt,
        localDeletedCats,
        remoteDeletedCats,
        localData.empty_categories_timestamps || localStorage.getItem('my_empty_categories_timestamps') || '{}',
        remoteData.empty_categories_timestamps || '{}'
    );

    const mergedDeletedCats = emptyCategoriesResult.deletedCategories || {};
    const renamesResult = mergeCategoryRenames(
        localData.category_renames || safeJSONParse(localStorage.getItem('my_category_renames'), {}),
        remoteData.category_renames || {}
    );

    if (renamesResult && Object.keys(renamesResult).length > 0) {
        for (const [oldCat, record] of Object.entries(renamesResult)) {
            const targetCat = record?.to ? record.to.trim() : '';
            const renameTime = Number(record?.at) || 0;
            const targetDelTime = targetCat ? (Number(mergedDeletedCats[targetCat]) || 0) : 0;
            if (!targetCat || (targetDelTime > 0 && targetDelTime >= renameTime)) {
                delete renamesResult[oldCat];
            }
        }

        Object.values(bookmarksResult.items).forEach(bm => {
            if (!bm || !bm.category) return;
            let currentCat = bm.category.trim();
            const visited = new Set();
            const bmTime = getItemTimestamp(bm);

            while (renamesResult[currentCat] && !visited.has(currentCat)) {
                visited.add(currentCat);
                const record = renamesResult[currentCat];
                const renameTime = Number(record?.at) || 0;
                const targetCat = record?.to && typeof record.to === 'string' ? record.to.trim() : '';
                const targetDelTime = targetCat ? (Number(mergedDeletedCats[targetCat]) || 0) : 0;
                if (renameTime > 0 && bmTime <= renameTime && targetCat && !(targetDelTime > 0 && targetDelTime >= renameTime)) {
                    currentCat = targetCat;
                } else {
                    break;
                }
            }

            if (currentCat !== bm.category) {
                bm.category = currentCat;
            }
        });
    }

    const categoryOrderResult = mergeCategoryOrders(
        localData.category_order,
        localData.category_order_updatedAt,
        remoteData.category_order,
        remoteData.category_order_updatedAt,
        bookmarksResult.items,
        emptyCategoriesResult.rawList
    );

    const subcategoryOrderResult = mergeSubcategoryOrders(
        localData.subcategory_order,
        localData.subcategory_order_updatedAt,
        remoteData.subcategory_order,
        remoteData.subcategory_order_updatedAt,
        bookmarksResult.items,
        emptyCategoriesResult.rawList,
        localData.subcategory_order_timestamps,
        remoteData.subcategory_order_timestamps
    );

    const localVer = Number(localData.syncVersion) || 0;
    const remoteVer = Number(remoteData.syncVersion) || 0;
    const currentMaxVersion = Math.max(localVer, remoteVer);

    return {
        syncVersion: currentMaxVersion,
        bookmarks: bookmarksResult.items,
        reminders: remindersResult.items,
        userProfile: userProfileResult,
        deletedRecords: {
            bookmarks: bookmarksResult.deletes,
            reminders: remindersResult.deletes,
            categories: emptyCategoriesResult.deletedCategories
        },
        deleted_categories: emptyCategoriesResult.deletedCategories,
        category_renames: renamesResult,
        category_order: categoryOrderResult.order,
        category_order_updatedAt: categoryOrderResult.updatedAt,
        subcategory_order: subcategoryOrderResult.order,
        subcategory_order_updatedAt: subcategoryOrderResult.updatedAt,
        subcategory_order_timestamps: subcategoryOrderResult.timestamps,
        empty_categories: emptyCategoriesResult.categories,
        empty_categories_updatedAt: emptyCategoriesResult.updatedAt,
        empty_categories_timestamps: emptyCategoriesResult.timestamps
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

    const sortModal = document.getElementById('sort-modal');
    const isSortModalActive = Boolean(sortModal && (sortModal.classList.contains('active') || sortModal.style.display === 'flex'));

    const categoryModal = document.getElementById('category-modal');
    const isCategoryModalActive = Boolean(categoryModal && (categoryModal.classList.contains('active') || categoryModal.style.display === 'flex'));

    const isDraggingActive = Boolean(
        state.isSortDragging ||
        state.isCalendarDateDragging ||
        document.body.classList.contains('is-dragging-item')
    );

    const shouldDeferDOMRender = Boolean(
        isEditing ||
        state.isSelectionMode ||
        isSortModalActive ||
        isCategoryModalActive ||
        isDraggingActive
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
        mergedData.reminders || {},
        protectedLocalDeletes.reminders,
        mergedData.deletedRecords?.reminders || {}
    );

    const nextBookmarks = reconciledBookmarks.items;
    const nextReminders = reconciledReminders.items;
    const nextDeleted = {
        bookmarks: reconciledBookmarks.deletes,
        reminders: reconciledReminders.deletes
    };

    // 嚴格墓碑硬防禦：若該項目在本地已被標記刪除，且墓碑時間戳記大於等於傳入項目之時間，絕不允許復活（含墓碑時間戳夾限校準）
    const nowForDeletes = Date.now();
    const maxTombstoneTimestamp = nowForDeletes + SYNC_CONFIG.CLOCK_SKEW_TOLERANCE_MS;

    for (const id of Object.keys(protectedLocalDeletes.bookmarks)) {
        let delTime = typeof protectedLocalDeletes.bookmarks[id] === 'number' ? protectedLocalDeletes.bookmarks[id] : (protectedLocalDeletes.bookmarks[id]?.deletedAt || 0);
        if (delTime > maxTombstoneTimestamp) delTime = nowForDeletes;
        if (delTime > 0 && nextBookmarks[id]) {
            const itemTime = getItemTimestamp(nextBookmarks[id]);
            if (delTime >= itemTime) {
                delete nextBookmarks[id];
                nextDeleted.bookmarks[id] = Math.max(nextDeleted.bookmarks[id] || 0, delTime);
            }
        }
    }

    for (const id of Object.keys(protectedLocalDeletes.reminders)) {
        let delTime = typeof protectedLocalDeletes.reminders[id] === 'number' ? protectedLocalDeletes.reminders[id] : (protectedLocalDeletes.reminders[id]?.deletedAt || 0);
        if (delTime > maxTombstoneTimestamp) delTime = nowForDeletes;
        if (delTime > 0 && nextReminders[id]) {
            const itemTime = getItemTimestamp(nextReminders[id]);
            if (delTime >= itemTime) {
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
                    isDeleted: isDeletedRemote,
                    deletedAt: isDeletedRemote ? deleteTime : 0
                };
                state.hasEditConflict = true;
                showCloudToast('當前編輯的資料雲端已有新版本');
            }

            if (state.bookmarks[activeId]) {
                nextBookmarks[activeId] = state.bookmarks[activeId];
            }
        } else if (activeType === 'reminder') {
            const remoteReminder = (mergedData.reminders || {})[activeId];
            const deleteTime = typeof nextDeleted.reminders[activeId] === 'number' ? nextDeleted.reminders[activeId] : (nextDeleted.reminders[activeId]?.deletedAt || 0);
            const isDeletedRemote = Boolean(deleteTime > baselineTime && (!remoteReminder || deleteTime >= (remoteReminder.updatedAt || 0)));
            const remoteTime = remoteReminder ? getItemTimestamp(remoteReminder) : 0;

            if (isDeletedRemote || remoteTime > baselineTime) {
                if (!state.pendingSyncItems) state.pendingSyncItems = {};
                state.pendingSyncItems.reminder = {
                    id: activeId,
                    data: isDeletedRemote ? null : remoteReminder,
                    isDeleted: isDeletedRemote,
                    deletedAt: isDeletedRemote ? deleteTime : 0
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

    // 順序與分類合併落地：當傳入時間戳大於等於當前本地時間戳時允許寫入
    const currentCatUpdatedAt = parseInt(localStorage.getItem('my_category_order_updatedAt') || '0', 10);
    const remoteCatUpdatedAt = parseInt(mergedData.category_order_updatedAt || '0', 10);

    if (remoteCatUpdatedAt >= currentCatUpdatedAt && mergedData.category_order) {
        localStorage.setItem('my_category_order', typeof mergedData.category_order === 'string' ? mergedData.category_order : JSON.stringify(mergedData.category_order));
        localStorage.setItem('my_category_order_updatedAt', remoteCatUpdatedAt.toString());
    }

    const currentSubUpdatedAt = parseInt(localStorage.getItem('my_subcategory_order_updatedAt') || '0', 10);
    const remoteSubUpdatedAt = parseInt(mergedData.subcategory_order_updatedAt || '0', 10);

    if (remoteSubUpdatedAt >= currentSubUpdatedAt && mergedData.subcategory_order) {
        localStorage.setItem('my_subcategory_order', typeof mergedData.subcategory_order === 'string' ? mergedData.subcategory_order : JSON.stringify(mergedData.subcategory_order));
        localStorage.setItem('my_subcategory_order_updatedAt', remoteSubUpdatedAt.toString());
    }

    if (mergedData.subcategory_order_timestamps) {
        localStorage.setItem('my_subcategory_order_timestamps', typeof mergedData.subcategory_order_timestamps === 'string' ? mergedData.subcategory_order_timestamps : JSON.stringify(mergedData.subcategory_order_timestamps));
    }

    const currentEmptyUpdatedAt = parseInt(localStorage.getItem('my_empty_categories_updatedAt') || '0', 10);
    const remoteEmptyUpdatedAt = parseInt(mergedData.empty_categories_updatedAt || '0', 10);

    if (remoteEmptyUpdatedAt >= currentEmptyUpdatedAt && mergedData.empty_categories) {
        localStorage.setItem('my_empty_categories', typeof mergedData.empty_categories === 'string' ? mergedData.empty_categories : JSON.stringify(mergedData.empty_categories));
        localStorage.setItem('my_empty_categories_updatedAt', remoteEmptyUpdatedAt.toString());
    }

    if (mergedData.empty_categories_timestamps) {
        const localEmptyTs = safeJSONParse(localStorage.getItem('my_empty_categories_timestamps'), {});
        const incomingEmptyTs = typeof mergedData.empty_categories_timestamps === 'string'
            ? safeJSONParse(mergedData.empty_categories_timestamps, {})
            : (mergedData.empty_categories_timestamps || {});
        const combinedEmptyTs = { ...localEmptyTs };
        for (const [cat, ts] of Object.entries(incomingEmptyTs)) {
            const incomingNum = Number(ts) || 0;
            const localNum = Number(combinedEmptyTs[cat]) || 0;
            if (incomingNum > localNum) {
                combinedEmptyTs[cat] = incomingNum;
            }
        }
        localStorage.setItem('my_empty_categories_timestamps', JSON.stringify(combinedEmptyTs));
    }

    if (mergedData.deleted_categories) {
        const localDeletedCats = safeJSONParse(localStorage.getItem('my_deleted_categories'), {});
        const incomingDeletedCats = typeof mergedData.deleted_categories === 'string'
            ? safeJSONParse(mergedData.deleted_categories, {})
            : (mergedData.deleted_categories || {});

        const combinedDeletedCats = { ...localDeletedCats };
        const nowMs = Date.now();
        const ttlMs = SYNC_CONFIG.TOMBSTONE_TTL_MS;

        for (const [cat, incomingTime] of Object.entries(incomingDeletedCats)) {
            const timeRemote = typeof incomingTime === 'number' ? incomingTime : (incomingTime?.deletedAt || 0);
            const timeLocal = typeof combinedDeletedCats[cat] === 'number' ? combinedDeletedCats[cat] : 0;
            const finalTime = Math.max(timeLocal, timeRemote);
            if (finalTime > 0 && (nowMs - finalTime) < ttlMs) {
                combinedDeletedCats[cat] = finalTime;
            }
        }
        localStorage.setItem('my_deleted_categories', JSON.stringify(combinedDeletedCats));
    }

    if (mergedData.category_renames) {
        const localRenames = safeJSONParse(localStorage.getItem('my_category_renames'), {});
        const mergedRenames = mergeCategoryRenames(localRenames, mergedData.category_renames);
        localStorage.setItem('my_category_renames', JSON.stringify(mergedRenames));
    }

    const nextUserProfile = mergeUserProfile(state.userProfile || {}, mergedData.userProfile || {});
    state.userProfile = nextUserProfile;

    // 四張表在單一交易內批次寫入，確保與記憶體狀態完全原子一致
    await StorageAPI.replaceMulti({
        bookmarks: state.bookmarks,
        reminders: state.reminders,
        deleted_bookmarks: state.deletedRecords.bookmarks || {},
        deleted_reminders: state.deletedRecords.reminders || {}
    });
    await StorageAPI.saveItem('profile', 'current', state.userProfile);

    if (typeof UI.renderUserProfileUI === 'function') {
        UI.renderUserProfileUI();
    }

    notifyCrossTabChange({ syncVersion: state.syncVersion });

    if (shouldDeferDOMRender) {
        state.hasPendingSyncRender = true;
        return;
    }

    state.hasPendingSyncRender = false;
    renderSidebar();
}

/**
 * 查詢 Google Drive appDataFolder 內的備份檔案 ID（若發現多個同名備份檔，先下載合併全部檔案後再清理冗餘檔案）
 */
async function locateDriveAppDataFileId(token, forceRefresh = false) {
    const now = Date.now();
    const shouldAudit = forceRefresh || !cachedDriveFileId || (now - lastFileAuditTime > FILE_AUDIT_INTERVAL_MS);

    if (!shouldAudit && cachedDriveFileId) {
        return cachedDriveFileId;
    }

    const query = encodeURIComponent(`'appDataFolder' in parents and name='${GOOGLE_DRIVE_SYNC_FILENAME}' and trashed=false`);
    const url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${query}&orderBy=modifiedTime%20desc&fields=files(id,name,modifiedTime)`;

    const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` },
        cache: 'no-store'
    });

    if (res.status === 401) {
        throw new Error('UNAUTHORIZED');
    }

    if (!res.ok) {
        const errorDetail = await res.text().catch(() => '');
        console.error('Drive API 錯誤:', errorDetail);
        throw new Error(`LOOKUP_FAILED_${res.status}`);
    }

    lastFileAuditTime = now;

    const data = await res.json();
    if (data.files && data.files.length > 0) {
        const file = data.files[0];
        const fileId = file.id;
        cachedDriveFileId = fileId;
        localStorage.setItem('google_drive_file_id', fileId);

        if (data.files.length > 1) {
            try {
                // 並行下載所有同名檔案的內容
                const fileContents = await Promise.all(
                    data.files.map(async (f) => {
                        try {
                            const fileRes = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media&t=${Date.now()}`, {
                                headers: { 'Authorization': `Bearer ${token}` },
                                cache: 'no-store'
                            });
                            if (!fileRes.ok) return null;
                            const json = await fileRes.json();
                            return sanitizeDatasetPayload(json);
                        } catch (e) {
                            return null;
                        }
                    })
                );

                // 累加合併所有檔案之資料
                let consolidatedData = null;
                for (const content of fileContents) {
                    if (content && typeof content === 'object') {
                        if (!consolidatedData) {
                            consolidatedData = content;
                        } else {
                            consolidatedData = mergeDatasets(consolidatedData, content);
                        }
                    }
                }

                if (consolidatedData) {
                    const maxVer = Math.max(
                        ...fileContents.map(c => (c && Number(c.syncVersion)) || 0),
                        Number(consolidatedData.syncVersion) || 0
                    );
                    consolidatedData.syncVersion = maxVer + 1;
                    const sanitizedConsolidated = sanitizeDatasetPayload(consolidatedData);

                    // 寫入第一份檔案 (fileId)
                    const updateRes = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=id,modifiedTime`, {
                        method: 'PATCH',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json; charset=UTF-8'
                        },
                        body: JSON.stringify(sanitizedConsolidated, null, 2)
                    });

                    if (updateRes.ok) {
                        const updatedMeta = await updateRes.json();
                        if (updatedMeta && updatedMeta.modifiedTime) {
                            localStorage.setItem('google_drive_last_modified_time', updatedMeta.modifiedTime);
                        }
                        const patchETag = updateRes.headers.get('ETag');
                        if (patchETag) {
                            currentRemoteETag = patchETag;
                            localStorage.setItem('google_drive_file_etag', patchETag);
                        }
                        // 寫入成功後，才安全刪除其餘冗餘檔案
                        const staleFiles = data.files.slice(1);
                        await Promise.allSettled(
                            staleFiles.map(f =>
                                fetch(`https://www.googleapis.com/drive/v3/files/${f.id}`, {
                                    method: 'DELETE',
                                    headers: { 'Authorization': `Bearer ${token}` }
                                })
                            )
                        );
                    }
                }
            } catch (mergeErr) {
                console.warn('合併多個同名雲端檔案時發生異常，保留檔案不予刪除:', mergeErr);
            }
        }

        return fileId;
    }

    cachedDriveFileId = null;
    currentRemoteETag = null;
    localStorage.removeItem('google_drive_file_id');
    localStorage.removeItem('google_drive_file_etag');
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
        downloadFromDrive(nextDownload.isAuto, nextDownload.triggerPendingUpload).then(nextDownload.resolve);
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
        localStorage.setItem(PENDING_SYNC_FLAG, 'true');
        if (!isAuto) {
            handleSyncErrorAlert('Google 授權已失效，請點擊重新登入', true);
        } else if (isGoogleLinked()) {
            notifyReauthRequired();
        }
        return;
    }

    if (!token) {
        updateSyncStatusIndicator(true);
        localStorage.setItem(PENDING_SYNC_FLAG, 'true');
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
            if (isGoogleLinked()) {
                notifyReauthRequired();
            }
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
                    notifyReauthRequired();
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
                localStorage.setItem(PENDING_SYNC_FLAG, 'true');
                if (!isAuto) {
                    handleSyncErrorAlert('雲端目錄檢索失敗');
                } else {
                    showCloudToast('雲端連線失敗，修改已存至本機');
                }
                return;
            }
        }

        let remoteData = {
            syncVersion: 0,
            bookmarks: {},
            reminders: {},
            userProfile: { avatarData: '', avatarUpdatedAt: 0, username: '', usernameUpdatedAt: 0 },
            deletedRecords: { bookmarks: {}, reminders: {} },
            category_order: '[]',
            category_order_updatedAt: 0,
            subcategory_order: '{}',
            subcategory_order_updatedAt: 0,
            subcategory_order_timestamps: '{}',
            empty_categories: '[]',
            empty_categories_updatedAt: 0
        };

        if (fileId) {
            try {
                const readRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&t=${Date.now()}`, {
                    headers: { 'Authorization': `Bearer ${token}` },
                    cache: 'no-store'
                });

                if (readRes.status === 401) {
                    updateSyncStatusIndicator(true);
                    localStorage.setItem(PENDING_SYNC_FLAG, 'true');
                    if (isAuto) {
                        notifyReauthRequired();
                        return;
                    }
                    token = await getValidAccessToken(true);
                    continue;
                } else if (readRes.status === 404) {
                    cachedDriveFileId = null;
                    currentRemoteETag = null;
                    localStorage.removeItem('google_drive_file_id');
                    localStorage.removeItem('google_drive_file_etag');
                    fileId = null;
                } else if (readRes.ok) {
                    const mediaETag = readRes.headers.get('ETag');
                    if (mediaETag) {
                        currentRemoteETag = mediaETag;
                        localStorage.setItem('google_drive_file_etag', mediaETag);
                    } else {
                        currentRemoteETag = null;
                        localStorage.removeItem('google_drive_file_etag');
                    }
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
                userProfile: state.userProfile || { avatarData: '', avatarUpdatedAt: 0, username: '', usernameUpdatedAt: 0 },
                deletedRecords: state.deletedRecords || { bookmarks: {}, reminders: {} },
                deleted_categories: safeJSONParse(localStorage.getItem('my_deleted_categories'), {}),
                category_renames: safeJSONParse(localStorage.getItem('my_category_renames'), {}),
                category_order: localStorage.getItem('my_category_order') || '[]',
                category_order_updatedAt: parseInt(localStorage.getItem('my_category_order_updatedAt') || '0', 10),
                subcategory_order: localStorage.getItem('my_subcategory_order') || '{}',
                subcategory_order_updatedAt: parseInt(localStorage.getItem('my_subcategory_order_updatedAt') || '0', 10),
                subcategory_order_timestamps: localStorage.getItem('my_subcategory_order_timestamps') || '{}',
                empty_categories: localStorage.getItem('my_empty_categories') || '[]',
                empty_categories_updatedAt: parseInt(localStorage.getItem('my_empty_categories_updatedAt') || '0', 10)
            };

            const autoMerged = mergeDatasets(currentLocalData, remoteData);
            await applyMergedDataAndRender(autoMerged);

            if (attempt < MAX_SYNC_RETRIES - 1) {
                await new Promise(r => setTimeout(r, 200 + Math.random() * 300));
                continue;
            } else {
                updateSyncStatusIndicator(true);
                localStorage.setItem(PENDING_SYNC_FLAG, 'true');
                if (!isAuto) {
                    handleSyncErrorAlert('雲端並行寫入重試逾限，已自動保留最新合併資料');
                } else {
                    showCloudToast('雲端衝突處理逾時，修改已保存在本機');
                }
                return;
            }
        }

        const lastSyncTimeMs = parseInt(localStorage.getItem('last_sync_time') || '0', 10);
        if (fileId && lastSyncTimeMs > 0 && (Date.now() - lastSyncTimeMs) > SYNC_CONFIG.TOMBSTONE_TTL_MS) {
            console.warn('[Drive 同步] 離線超過 30 天，啟動安全保護機制：優先以雲端為準執行合併');
            await executeDriveDownload(true, true);
            return;
        }

        const uploadStartMutationSeq = localMutationSeq;
        const localData = {
            syncVersion: expectedBaseVersion,
            bookmarks: state.bookmarks || {},
            reminders: state.reminders || {},
            userProfile: state.userProfile || { avatarData: '', avatarUpdatedAt: 0, username: '', usernameUpdatedAt: 0 },
            deletedRecords: state.deletedRecords || { bookmarks: {}, reminders: {} },
            deleted_categories: safeJSONParse(localStorage.getItem('my_deleted_categories'), {}),
            category_renames: safeJSONParse(localStorage.getItem('my_category_renames'), {}),
            category_order: localStorage.getItem('my_category_order') || '[]',
            category_order_updatedAt: parseInt(localStorage.getItem('my_category_order_updatedAt') || '0', 10),
            subcategory_order: localStorage.getItem('my_subcategory_order') || '{}',
            subcategory_order_updatedAt: parseInt(localStorage.getItem('my_subcategory_order_updatedAt') || '0', 10),
            subcategory_order_timestamps: localStorage.getItem('my_subcategory_order_timestamps') || '{}',
            empty_categories: localStorage.getItem('my_empty_categories') || '[]',
            empty_categories_updatedAt: parseInt(localStorage.getItem('my_empty_categories_updatedAt') || '0', 10),
            empty_categories_timestamps: localStorage.getItem('my_empty_categories_timestamps') || '{}'
        };

        const finalMergedData = mergeDatasets(localData, remoteData);
        const nextVersion = Math.max(expectedBaseVersion, remoteVersion) + 1;
        finalMergedData.syncVersion = nextVersion;
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
                const patchHeaders = {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json; charset=UTF-8'
                };
                if (currentRemoteETag) {
                    patchHeaders['If-Match'] = currentRemoteETag;
                }

                uploadRes = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=id,modifiedTime`, {
                    method: 'PATCH',
                    headers: patchHeaders,
                    body: jsonContentString
                });
            }

            if (uploadRes.status === 401) {
                updateSyncStatusIndicator(true);
                localStorage.setItem(PENDING_SYNC_FLAG, 'true');
                if (isAuto) {
                    notifyReauthRequired();
                    return;
                }
                token = await getValidAccessToken(true);
                continue;
            }

            if (uploadRes.status === 404) {
                cachedDriveFileId = null;
                currentRemoteETag = null;
                localStorage.removeItem('google_drive_file_id');
                localStorage.removeItem('google_drive_file_etag');
                continue;
            }

            if (uploadRes.status === 412) {
                console.warn(`[Drive 同步] 偵測到 ETag 條件衝突 (412 Precondition Failed)，雲端已被並行寫入。正在重新拉取與合併 (嘗試: ${attempt + 1}/${MAX_SYNC_RETRIES})`);
                currentRemoteETag = null;
                localStorage.removeItem('google_drive_file_etag');
                await executeDriveDownload(true, false);
                if (attempt < MAX_SYNC_RETRIES - 1) {
                    await new Promise(r => setTimeout(r, 200 + Math.random() * 300));
                    continue;
                } else {
                    updateSyncStatusIndicator(true);
                    localStorage.setItem(PENDING_SYNC_FLAG, 'true');
                    if (!isAuto) {
                        handleSyncErrorAlert('雲端並行寫入衝突，已自動保留最新合併資料');
                    } else {
                        showCloudToast('雲端寫入衝突，修改已存至本機');
                    }
                    return;
                }
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
                const uploadETag = uploadRes.headers.get('ETag');
                if (uploadETag) {
                    currentRemoteETag = uploadETag;
                    localStorage.setItem('google_drive_file_etag', uploadETag);
                }

                const verifyFileId = (responseData && responseData.id) || fileId;
                const readBack = await readRemoteForVerification(token, verifyFileId);
                if (readBack && readBack.syncNonce !== syncNonce && Number(readBack.syncVersion) >= nextVersion) {
                    console.warn('[Drive 同步] 回讀驗證發現雲端已被更新版本覆蓋，正在拉取合併');
                    const currentLiveBeforeReMerge = {
                        syncVersion: nextVersion,
                        bookmarks: state.bookmarks || {},
                        reminders: state.reminders || {},
                        userProfile: state.userProfile || { avatarData: '', avatarUpdatedAt: 0, username: '', usernameUpdatedAt: 0 },
                        deletedRecords: state.deletedRecords || { bookmarks: {}, reminders: {} },
                        deleted_categories: safeJSONParse(localStorage.getItem('my_deleted_categories'), {}),
                        category_renames: safeJSONParse(localStorage.getItem('my_category_renames'), {}),
                        category_order: localStorage.getItem('my_category_order') || '[]',
                        category_order_updatedAt: parseInt(localStorage.getItem('my_category_order_updatedAt') || '0', 10),
                        subcategory_order: localStorage.getItem('my_subcategory_order') || '{}',
                        subcategory_order_updatedAt: parseInt(localStorage.getItem('my_subcategory_order_updatedAt') || '0', 10),
                        subcategory_order_timestamps: localStorage.getItem('my_subcategory_order_timestamps') || '{}',
                        empty_categories: localStorage.getItem('my_empty_categories') || '[]',
                        empty_categories_updatedAt: parseInt(localStorage.getItem('my_empty_categories_updatedAt') || '0', 10),
                        empty_categories_timestamps: localStorage.getItem('my_empty_categories_timestamps') || '{}'
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

                const inFlightLocalData = {
                    syncVersion: nextVersion,
                    bookmarks: state.bookmarks || {},
                    reminders: state.reminders || {},
                    userProfile: state.userProfile || { avatarData: '', avatarUpdatedAt: 0, username: '', usernameUpdatedAt: 0 },
                    deletedRecords: state.deletedRecords || { bookmarks: {}, reminders: {} },
                    deleted_categories: safeJSONParse(localStorage.getItem('my_deleted_categories'), {}),
                    category_renames: safeJSONParse(localStorage.getItem('my_category_renames'), {}),
                    category_order: localStorage.getItem('my_category_order') || '[]',
                    category_order_updatedAt: parseInt(localStorage.getItem('my_category_order_updatedAt') || '0', 10),
                    subcategory_order: localStorage.getItem('my_subcategory_order') || '{}',
                    subcategory_order_updatedAt: parseInt(localStorage.getItem('my_subcategory_order_updatedAt') || '0', 10),
                    subcategory_order_timestamps: localStorage.getItem('my_subcategory_order_timestamps') || '{}',
                    empty_categories: localStorage.getItem('my_empty_categories') || '[]',
                    empty_categories_updatedAt: parseInt(localStorage.getItem('my_empty_categories_updatedAt') || '0', 10),
                    empty_categories_timestamps: localStorage.getItem('my_empty_categories_timestamps') || '{}'
                };

                const liveReconciledData = mergeDatasets(finalMergedData, inFlightLocalData);
                liveReconciledData.syncVersion = nextVersion;

                await applyMergedDataAndRender(liveReconciledData);
                localStorage.setItem('last_sync_time', Date.now().toString());

                if (localMutationSeq === uploadStartMutationSeq && !hasPendingUpload) {
                    localStorage.removeItem(PENDING_SYNC_FLAG);
                } else {
                    localStorage.setItem(PENDING_SYNC_FLAG, 'true');
                    hasPendingUpload = true;
                }

                updateSyncStatusIndicator(false);

                if (!isAuto) {
                    showCloudToast('備份成功');
                    closeSettingsModal();
                }
                return;
            } else {
                updateSyncStatusIndicator(true);
                localStorage.setItem(PENDING_SYNC_FLAG, 'true');
                if (!isAuto) {
                    handleSyncErrorAlert(`上傳失敗 (${uploadRes.status})，備份尚未完成`);
                } else {
                    showCloudToast('雲端同步失敗，已保留於本機', {
                        persistent: true,
                        onClick: () => {
                            if (typeof window.openSettingsModal === 'function') {
                                window.openSettingsModal();
                            }
                        }
                    });
                }
                return;
            }
        } catch (error) {
            updateSyncStatusIndicator(true);
            localStorage.setItem(PENDING_SYNC_FLAG, 'true');
            if (!isAuto) {
                handleSyncErrorAlert('網路連線中斷，雲端備份暫停');
            } else {
                showCloudToast('網路異常未同步，已保留於本機');
            }
            return;
        }
    }
}

/**
 * 從 Google Drive 下載資料並執行合併（加入互斥排程）
 */
export async function downloadFromDrive(isAuto = false, triggerPendingUpload = true) {
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
            pendingDownloadResolvers.push({ isAuto, triggerPendingUpload, resolve });
        });
    }

    isSyncRunning = true;
    let result = false;
    try {
        result = await executeDriveDownload(isAuto, triggerPendingUpload);
    } finally {
        isSyncRunning = false;
        scheduleNextSyncTask();
    }
    return result;
}

async function executeDriveDownload(isAuto, triggerPendingUpload = true) {
    let token = null;
    try {
        token = await getValidAccessToken(false);
    } catch (e) {
        updateSyncStatusIndicator(true);
        if (!isAuto) {
            handleSyncErrorAlert('Google 授權已過期，請重新登入', true);
        } else if (isGoogleLinked()) {
            notifyReauthRequired();
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
        } else {
            if (isGoogleLinked()) {
                notifyReauthRequired();
            }
            return false;
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
                    notifyReauthRequired();
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
            if (localStorage.getItem(PENDING_SYNC_FLAG) === 'true') {
                await executeDriveUpload(true);
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
        }

        let preReadModifiedTime = null;
        try {
            const preMetaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=modifiedTime&t=${Date.now()}`, {
                headers: { 'Authorization': `Bearer ${token}` },
                cache: 'no-store'
            });
            if (preMetaRes.ok) {
                const preMeta = await preMetaRes.json();
                if (preMeta && preMeta.modifiedTime) preReadModifiedTime = preMeta.modifiedTime;
            }
        } catch (preMetaErr) {
            console.warn('下載前取得遠端修改時間失敗，改用下載後取得:', preMetaErr);
        }

        let readRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&t=${Date.now()}`, {
            headers: { 'Authorization': `Bearer ${token}` },
            cache: 'no-store'
        });

        if (readRes.status === 404) {
            preReadModifiedTime = null;
            cachedDriveFileId = null;
            currentRemoteETag = null;
            localStorage.removeItem('google_drive_file_id');
            localStorage.removeItem('google_drive_file_etag');
            fileId = await locateDriveAppDataFileId(token, true);
            if (fileId) {
                readRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&t=${Date.now()}`, {
                    headers: { 'Authorization': `Bearer ${token}` },
                    cache: 'no-store'
                });
            } else {
                if (localStorage.getItem(PENDING_SYNC_FLAG) === 'true') {
                    await executeDriveUpload(true);
                }
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
                } else {
                    notifyReauthRequired();
                }
                return false;
            }
            if (!isAuto) {
                handleSyncErrorAlert(`雲端讀取失敗 (${readRes.status})`);
            }
            return false;
        }

        const mediaETag = readRes.headers.get('ETag');
        if (mediaETag) {
            currentRemoteETag = mediaETag;
            localStorage.setItem('google_drive_file_etag', mediaETag);
        } else {
            currentRemoteETag = null;
            localStorage.removeItem('google_drive_file_etag');
        }

        const remoteData = sanitizeDatasetPayload(await readRes.json());
        if (!remoteData || typeof remoteData !== 'object') {
            updateSyncStatusIndicator(true);
            if (!isAuto) {
                handleSyncErrorAlert('雲端檔案解析失敗');
            }
            return false;
        }

        if (preReadModifiedTime) {
            localStorage.setItem('google_drive_last_modified_time', preReadModifiedTime);
        } else {
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
        }

        const localData = {
            syncVersion: state.syncVersion || parseInt(localStorage.getItem('sync_version') || '0', 10),
            bookmarks: state.bookmarks || {},
            reminders: state.reminders || {},
            userProfile: state.userProfile || { avatarData: '', avatarUpdatedAt: 0, username: '', usernameUpdatedAt: 0 },
            deletedRecords: state.deletedRecords || { bookmarks: {}, reminders: {} },
            deleted_categories: safeJSONParse(localStorage.getItem('my_deleted_categories'), {}),
            category_renames: safeJSONParse(localStorage.getItem('my_category_renames'), {}),
            category_order: localStorage.getItem('my_category_order') || '[]',
            category_order_updatedAt: parseInt(localStorage.getItem('my_category_order_updatedAt') || '0', 10),
            subcategory_order: localStorage.getItem('my_subcategory_order') || '{}',
            subcategory_order_updatedAt: parseInt(localStorage.getItem('my_subcategory_order_updatedAt') || '0', 10),
            subcategory_order_timestamps: localStorage.getItem('my_subcategory_order_timestamps') || '{}',
            empty_categories: localStorage.getItem('my_empty_categories') || '[]',
            empty_categories_updatedAt: parseInt(localStorage.getItem('my_empty_categories_updatedAt') || '0', 10),
            empty_categories_timestamps: localStorage.getItem('my_empty_categories_timestamps') || '{}'
        };

        const finalMergedData = mergeDatasets(localData, remoteData);
        const alignedVersion = Math.max(Number(remoteData.syncVersion) || 0, Number(localData.syncVersion) || 0);
        finalMergedData.syncVersion = alignedVersion;
        await applyMergedDataAndRender(finalMergedData);

        if (hasMergedDiffFromRemote(remoteData, finalMergedData)) {
            markLocalDataDirty();
        }

        localStorage.setItem('last_sync_time', Date.now().toString());
        updateSyncStatusIndicator(false);

        if (triggerPendingUpload && localStorage.getItem(PENDING_SYNC_FLAG) === 'true') {
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

function stableCanonicalStringify(value) {
    if (value === null || value === undefined || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(item => stableCanonicalStringify(item)).join(',')}]`;
    }
    const keys = Object.keys(value).sort();
    const pairs = [];
    for (const k of keys) {
        if (value[k] === undefined) continue;
        pairs.push(`${JSON.stringify(k)}:${stableCanonicalStringify(value[k])}`);
    }
    return `{${pairs.join(',')}}`;
}

function normalizeTombstoneMapForDiff(rawMap) {
    if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) return {};
    const out = {};
    for (const [k, v] of Object.entries(rawMap)) {
        const t = typeof v === 'number' ? v : (v?.deletedAt || 0);
        if (t > 0) out[k] = t;
    }
    return out;
}

function parseJsonMapForDiff(raw) {
    if (!raw) return {};
    if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
        return safeJSONParse(raw, {});
    }
    return {};
}

function hasMergedDiffFromRemote(remoteData = {}, mergedData = {}) {
    const remoteBm = remoteData.bookmarks || {};
    const mergedBm = mergedData.bookmarks || {};
    const mergedBmKeys = Object.keys(mergedBm);
    if (mergedBmKeys.length !== Object.keys(remoteBm).length) return true;
    for (const id of mergedBmKeys) {
        if (!remoteBm[id]) return true;
        if (stableCanonicalStringify(mergedBm[id]) !== stableCanonicalStringify(remoteBm[id])) return true;
    }

    const remoteRem = remoteData.reminders || {};
    const mergedRem = mergedData.reminders || {};
    const mergedRemKeys = Object.keys(mergedRem);
    if (mergedRemKeys.length !== Object.keys(remoteRem).length) return true;
    for (const id of mergedRemKeys) {
        if (!remoteRem[id]) return true;
        if (stableCanonicalStringify(mergedRem[id]) !== stableCanonicalStringify(remoteRem[id])) return true;
    }

    const remoteDelBm = normalizeTombstoneMapForDiff(remoteData.deletedRecords?.bookmarks);
    const mergedDelBm = normalizeTombstoneMapForDiff(mergedData.deletedRecords?.bookmarks);
    if (stableCanonicalStringify(mergedDelBm) !== stableCanonicalStringify(remoteDelBm)) return true;

    const remoteDelRem = normalizeTombstoneMapForDiff(remoteData.deletedRecords?.reminders);
    const mergedDelRem = normalizeTombstoneMapForDiff(mergedData.deletedRecords?.reminders);
    if (stableCanonicalStringify(mergedDelRem) !== stableCanonicalStringify(remoteDelRem)) return true;

    const remoteProfile = remoteData.userProfile || {};
    const mergedProfile = mergedData.userProfile || {};
    if ((mergedProfile.avatarData || '') !== (remoteProfile.avatarData || '')) return true;
    if ((Number(mergedProfile.avatarUpdatedAt) || 0) !== (Number(remoteProfile.avatarUpdatedAt) || 0)) return true;
    if ((mergedProfile.username || '') !== (remoteProfile.username || '')) return true;
    if ((Number(mergedProfile.usernameUpdatedAt) || 0) !== (Number(remoteProfile.usernameUpdatedAt) || 0)) return true;

    const remoteCatOrder = parseCategoryOrderPayload(remoteData.category_order, remoteData.category_order_updatedAt);
    const mergedCatOrder = parseCategoryOrderPayload(mergedData.category_order, mergedData.category_order_updatedAt);
    if (mergedCatOrder.updatedAt !== remoteCatOrder.updatedAt) return true;
    if (stableCanonicalStringify(mergedCatOrder.order) !== stableCanonicalStringify(remoteCatOrder.order)) return true;

    const remoteSubOrder = parseSubcategoryOrderPayload(remoteData.subcategory_order, remoteData.subcategory_order_updatedAt);
    const mergedSubOrder = parseSubcategoryOrderPayload(mergedData.subcategory_order, mergedData.subcategory_order_updatedAt);
    if (mergedSubOrder.updatedAt !== remoteSubOrder.updatedAt) return true;
    if (stableCanonicalStringify(mergedSubOrder.map) !== stableCanonicalStringify(remoteSubOrder.map)) return true;

    const remoteEmpty = parseEmptyCategoriesPayload(remoteData.empty_categories || remoteData.my_empty_categories, remoteData.empty_categories_updatedAt || remoteData.my_empty_categories_updatedAt);
    const mergedEmpty = parseEmptyCategoriesPayload(mergedData.empty_categories, mergedData.empty_categories_updatedAt);
    if (mergedEmpty.updatedAt !== remoteEmpty.updatedAt) return true;
    if (stableCanonicalStringify(mergedEmpty.list) !== stableCanonicalStringify(remoteEmpty.list)) return true;

    const remoteEmptyTs = parseJsonMapForDiff(remoteData.empty_categories_timestamps);
    const mergedEmptyTs = parseJsonMapForDiff(mergedData.empty_categories_timestamps);
    if (stableCanonicalStringify(mergedEmptyTs) !== stableCanonicalStringify(remoteEmptyTs)) return true;

    const remoteDelCats = normalizeTombstoneMapForDiff(remoteData.deleted_categories || remoteData.deletedRecords?.categories);
    const mergedDelCats = normalizeTombstoneMapForDiff(mergedData.deleted_categories);
    if (stableCanonicalStringify(mergedDelCats) !== stableCanonicalStringify(remoteDelCats)) return true;

    const remoteRenames = parseJsonMapForDiff(remoteData.category_renames);
    const mergedRenames = parseJsonMapForDiff(mergedData.category_renames);
    if (stableCanonicalStringify(mergedRenames) !== stableCanonicalStringify(remoteRenames)) return true;

    return false;
}

/**
 * 輕量級檢查雲端更新（比對 modifiedTime 元資料）
 */
export async function checkForRemoteUpdates() {
    // 本機上傳/下載進行中時不檢查：避免把自己剛上傳造成的時間變動誤判為「別台裝置更新」
    if (isCheckingUpdates || isSyncRunning) return;
    if (!GOOGLE_CLIENT_ID || !isGoogleLinked()) return;

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
        if (!fileId) {
            updateSyncStatusIndicator(false);
            return;
        }

        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=modifiedTime&t=${Date.now()}`, {
            headers: { 'Authorization': `Bearer ${token}` },
            cache: 'no-store'
        });

        if (res.status === 401) {
            localStorage.removeItem('google_access_token');
            localStorage.removeItem('google_token_expires_at');
            notifyReauthRequired();
            return;
        }

        if (res.status === 404) {
            cachedDriveFileId = null;
            localStorage.removeItem('google_drive_file_id');
            updateSyncStatusIndicator(false);
            return;
        }

        if (!res.ok) {
            updateSyncStatusIndicator(true);
            return;
        }

        updateSyncStatusIndicator(false);

        const data = await res.json();
        if (!data || !data.modifiedTime) return;

        const lastKnownModifiedTime = localStorage.getItem('google_drive_last_modified_time');

        if (!lastKnownModifiedTime || data.modifiedTime !== lastKnownModifiedTime) {
            if (SYNC_CONFIG.AUTO_APPLY_REMOTE && Date.now() >= autoApplyBackoffUntil) {
                // 靜默合併；編輯視窗開啟時 applyMergedDataAndRender 會延後重繪。
                // 失敗時不會更新時間標記，所以退避後下一輪仍會重試。
                const ok = await downloadFromDrive(true);
                if (!ok) autoApplyBackoffUntil = Date.now() + SYNC_CONFIG.AUTO_APPLY_BACKOFF_MS;
            } else if (!SYNC_CONFIG.AUTO_APPLY_REMOTE) {
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
        }
    } catch (error) {
        console.warn('檢查遠端更新時發生異常:', error);
    } finally {
        isCheckingUpdates = false;
    }
}

/**
 * 記錄使用者最近一次操作時間，用來決定輪詢頻率
 */
function bindActivityEvents() {
    if (isActivityBound) return;
    isActivityBound = true;
    const mark = () => { lastActivityAt = Date.now(); };
    ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(evt => {
        window.addEventListener(evt, mark, { passive: true, capture: true });
    });
}

/**
 * 依閒置時間回傳下一次輪詢間隔（可獨立測試）
 */
export function getPollIntervalMs(now = Date.now(), lastActivity = lastActivityAt) {
    const idle = now - lastActivity;
    if (idle < SYNC_CONFIG.ACTIVE_WINDOW_MS) return SYNC_CONFIG.POLL_ACTIVE_MS;
    if (idle < SYNC_CONFIG.IDLE_WINDOW_MS) return SYNC_CONFIG.POLL_IDLE_MS;
    return SYNC_CONFIG.POLL_DEEP_IDLE_MS;
}

/**
 * Token 快過期時嘗試靜默續期；取不到（例如瀏覽器擋彈窗）回傳 false
 */
export async function ensureTokenSilently() {
    if (isTokenValid()) return true;
    if (!isGoogleLinked()) return false;
    if (Date.now() < silentRefreshCooldownUntil) return false;
    try {
        const t = await getValidAccessToken(false);
        return Boolean(t) && isTokenValid();
    } catch (e) {
        silentRefreshCooldownUntil = Date.now() + SYNC_CONFIG.SILENT_REFRESH_COOLDOWN_MS;
        return false;
    }
}

function scheduleNextPoll(generation, customDelay = null) {
    if (generation !== pollingGeneration) return;
    if (document.hidden) return;

    const delay = typeof customDelay === 'number' ? customDelay : getPollIntervalMs();
    pollingTimer = setTimeout(async () => {
        pollingTimer = null;
        if (generation !== pollingGeneration) return;
        if (document.hidden) return;

        const hasValidToken = await ensureTokenSilently();
        if (!hasValidToken) {
            if (generation === pollingGeneration && !document.hidden) {
                updateSyncStatusIndicator(true);
                scheduleNextPoll(generation, SYNC_CONFIG.POLL_DEEP_IDLE_MS);
            }
            return;
        }
        try {
            if (localStorage.getItem(PENDING_SYNC_FLAG) === 'true' && !isSyncRunning) {
                await uploadToDrive(true);
            }
            await checkForRemoteUpdates();
        } catch (e) {
            console.warn('輪詢檢查失敗:', e);
        }
        if (generation === pollingGeneration && !document.hidden) {
            scheduleNextPoll(generation);
        }
    }, delay);
}

export function startCloudPolling() {
    stopCloudPolling();
    if (!GOOGLE_CLIENT_ID || !isGoogleLinked()) return;

    bindVisibilityEvents();
    bindActivityEvents();
    scheduleNextPoll(pollingGeneration);
}

export function stopCloudPolling() {
    pollingGeneration++;
    if (pollingTimer) {
        clearTimeout(pollingTimer);
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
    if (!isGoogleLinked() || isResumingSync || isInteractiveAuthInProgress) return;
    isResumingSync = true;

    try {
        if (isTokenValid()) {
            try {
                if (localStorage.getItem(PENDING_SYNC_FLAG) === 'true') {
                    await uploadToDrive(true);
                }
                await checkForRemoteUpdates();
            } catch (e) {
                console.warn('回到前景時的同步檢查失敗:', e);
            }
            startCloudPolling();
        } else {
            const tokenReady = await ensureTokenSilently();
            if (tokenReady) {
                try {
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
                startCloudPolling();
            }
        }
    } finally {
        isResumingSync = false;
    }
}

function triggerDebouncedResumeSync() {
    clearTimeout(resumeSyncDebounceTimer);
    resumeSyncDebounceTimer = setTimeout(() => {
        if (!document.hidden) {
            resumeSyncIfPossible();
        }
    }, 200);
}

function bindVisibilityEvents() {
    if (isVisibilityBound) return;
    isVisibilityBound = true;

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopCloudPolling();
            if (typeof window.flushPendingDeleteSync === 'function') {
                window.flushPendingDeleteSync();
            } else if (localStorage.getItem(PENDING_SYNC_FLAG) === 'true' && isTokenValid()) {
                uploadToDrive(true);
            }
        } else {
            triggerDebouncedResumeSync();
        }
    });

    window.addEventListener('pagehide', () => {
        if (typeof window.flushPendingDeleteSync === 'function') {
            window.flushPendingDeleteSync();
        } else if (localStorage.getItem(PENDING_SYNC_FLAG) === 'true' && isTokenValid()) {
            uploadToDrive(true);
        }
    });

    window.addEventListener('focus', () => {
        if (!document.hidden) {
            triggerDebouncedResumeSync();
        }
    });

    window.addEventListener('online', () => {
        console.info('偵測到網路連線恢復，執行自動補傳與檢查');
        triggerDebouncedResumeSync();
    });
}
