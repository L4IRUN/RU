// sync.js
// 職責：處理與 GitHub Gist 的 API 溝通，落實含墓碑機制（Tombstone）之項目級智慧合併、背景輪詢與 Page Visibility 感知

import { state } from './state.js';
import { showCloudToast, renderSidebar } from './ui.js';
import { openCloudAlert, closeSettingsModal } from './interaction.js';
import { StorageAPI } from './storage.js';

let pollingTimer = null;
let isCheckingUpdates = false;
let isVisibilityBound = false;
const POLLING_INTERVAL_MS = 60000; // 每 1 分鐘 (60 秒)
const MAX_SYNC_RETRIES = 3; // 樂觀鎖衝突時最大自動重試次數

/**
 * 切換頂部系統狀態燈（綠色正常 / 紅色呼吸警示）
 */
export function updateSyncStatusIndicator(isError = false) {
    const dot = document.querySelector('.system-time-container .time-row .status-dot');
    if (dot) {
        if (isError) {
            dot.classList.remove('primary');
            dot.classList.add('red');
        } else {
            dot.classList.remove('red');
            dot.classList.add('primary');
        }
    }
}

/**
 * 觸發強效持久警示與紅色狀態指示燈（消除假同步盲點）
 */
export function handleSyncErrorAlert(message, shouldOpenSettings = false) {
    updateSyncStatusIndicator(true);
    showCloudToast(message, {
        persistent: true,
        onClick: () => {
            if (shouldOpenSettings && typeof window.openSyncSettingsModal === 'function') {
                window.openSyncSettingsModal();
            }
        }
    });
}

/**
 * 存量資料防禦：清洗物件中殘留的 Base64 圖片字串，防止存量資料造成 Gist 永久 413
 */
function cleanBase64FromString(str) {
    if (typeof str !== 'string') return str;
    return str
        .replace(/<img\b[^>]*>/gi, '')
        .replace(/data:image\/[^;]+;base64,[^\s"']+/gi, '');
}

function sanitizeDatasetPayload(data) {
    if (!data || typeof data !== 'object') return data;
    if (data.notes) {
        Object.keys(data.notes).forEach(k => {
            const n = data.notes[k];
            if (n.content) n.content = cleanBase64FromString(n.content);
            if (n.morning) n.morning = cleanBase64FromString(n.morning);
            if (n.afternoon) n.afternoon = cleanBase64FromString(n.afternoon);
            if (n.evening) n.evening = cleanBase64FromString(n.evening);
        });
    }
    if (data.bookmarks) {
        Object.keys(data.bookmarks).forEach(k => {
            const b = data.bookmarks[k];
            if (b.content) b.content = cleanBase64FromString(b.content);
            if (b.description) b.description = cleanBase64FromString(b.description);
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
 * 針對具有唯一鍵值的資料集（notes, bookmarks, quotes）進行項目級別時間戳記與刪除墓碑比對合併
 */
function mergeItemCollections(localCollection = {}, remoteCollection = {}, localDeletes = {}, remoteDeletes = {}) {
    const mergedItems = {};
    const mergedDeletes = {};
    const CLOCK_SKEW_TOLERANCE_MS = 5000;

    const safeLocal = localCollection || {};
    const safeRemote = remoteCollection || {};
    const safeLocalDel = localDeletes || {};
    const safeRemoteDel = remoteDeletes || {};

    // 1. 合併兩端的刪除紀錄（Tombstones），取最新的刪除時間戳記
    const allDelKeys = new Set([...Object.keys(safeLocalDel), ...Object.keys(safeRemoteDel)]);
    for (const key of allDelKeys) {
        const timeLocal = typeof safeLocalDel[key] === 'number' ? safeLocalDel[key] : (safeLocalDel[key]?.deletedAt || 0);
        const timeRemote = typeof safeRemoteDel[key] === 'number' ? safeRemoteDel[key] : (safeRemoteDel[key]?.deletedAt || 0);
        const maxDelTime = Math.max(timeLocal, timeRemote);
        if (maxDelTime > 0) {
            mergedDeletes[key] = maxDelTime;
        }
    }

    // 2. 收集所有項目 key 進行三方比對（Local vs Remote vs Tombstone）
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

        // 核心墓碑防禦：加入時鐘偏差容許值（Clock Skew Tolerance）
        // 只要刪除時間在偏差容差範圍內不早於最新更新時間（deleteTime + 容差 >= bestTime），
        // 視為有效刪除，維持墓碑紀錄並跳過卡片復原，防止跨裝置時鐘慢端誤判
        if (deleteTime > 0 && (deleteTime + CLOCK_SKEW_TOLERANCE_MS) >= bestTime) {
            continue;
        }

        // 若更新時間顯著大於刪除時間（超過時鐘容許偏差，確認為刪除後產生的實質更新），保留最新修改並解除墓碑
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
 * 解析各來源的分類順序與時間戳記（向下相容陣列、JSON 字串與包裝物件）
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
 * 依據時間戳記與有效書籤清單合併分類順序，徹底消除幽靈分類
 */
function mergeCategoryOrders(localOrderRaw, localUpdatedAtRaw, remoteOrderRaw, remoteUpdatedAtRaw, validBookmarks = {}) {
    const local = parseCategoryOrderPayload(localOrderRaw, localUpdatedAtRaw);
    const remote = parseCategoryOrderPayload(remoteOrderRaw, remoteUpdatedAtRaw);

    // 收集所有有效書籤中實際存在的分類（排除「未分類」）
    const validCategories = new Set();
    Object.values(validBookmarks || {}).forEach(bm => {
        if (bm && bm.category && typeof bm.category === 'string') {
            const cat = bm.category.trim();
            if (cat !== '' && cat !== '未分類') {
                validCategories.add(cat);
            }
        }
    });

    // 依更新時間戳記選定最新順序為基礎（遠端較新則採用遠端，反之採用本地）
    const isRemoteNewer = remote.updatedAt > local.updatedAt;
    const baseOrder = isRemoteNewer ? remote.order : local.order;
    const secondaryOrder = isRemoteNewer ? local.order : remote.order;
    const latestTimestamp = Math.max(local.updatedAt, remote.updatedAt, 0);

    const merged = [];
    const seen = new Set();

    // 1. 先置入基準端有效存在的分類（過濾掉已被刪除/改名的舊分類）
    for (const cat of baseOrder) {
        if (validCategories.has(cat) && !seen.has(cat)) {
            merged.push(cat);
            seen.add(cat);
        }
    }

    // 2. 次要端若有基準端漏掉的分類，且確實仍存在於有效書籤中，才補在後面
    for (const cat of secondaryOrder) {
        if (validCategories.has(cat) && !seen.has(cat)) {
            merged.push(cat);
            seen.add(cat);
        }
    }

    // 3. 若有新建書籤的分類尚未排入順序，依字串筆劃 append 到最後
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
 * 合併筆記排序偏好設定（依時間戳記比對最新偏好）
 */
function mergeSortOrders(localOrder, localUpdatedAt, remoteOrder, remoteUpdatedAt) {
    const tLocal = Number(localUpdatedAt) || 0;
    const tRemote = Number(remoteUpdatedAt) || 0;
    const normalize = (val) => (val === 'oldest' ? 'oldest' : 'newest');

    if (tRemote > tLocal && remoteOrder) {
        return { order: normalize(remoteOrder), updatedAt: tRemote };
    }
    return { order: normalize(localOrder || localStorage.getItem('note_sort_order')), updatedAt: Math.max(tLocal, tRemote) };
}

/**
 * 通用資料集智慧合併函式（完整支援 deletedRecords 墓碑、分類順序時間戳比對與筆記排序偏好）
 */
export function mergeDatasets(localData = {}, remoteData = {}) {
    const localDel = localData.deletedRecords || {};
    const remoteDel = remoteData.deletedRecords || {};

    const notesResult = mergeItemCollections(localData.notes, remoteData.notes, localDel.notes, remoteDel.notes);
    const bookmarksResult = mergeItemCollections(localData.bookmarks, remoteData.bookmarks, localDel.bookmarks, remoteDel.bookmarks);
    const quotesResult = mergeItemCollections(localData.quotes, remoteData.quotes, localDel.quotes, remoteDel.quotes);

    const categoryOrderResult = mergeCategoryOrders(
        localData.category_order,
        localData.category_order_updatedAt,
        remoteData.category_order,
        remoteData.category_order_updatedAt,
        bookmarksResult.items
    );

    const sortOrderResult = mergeSortOrders(
        localData.sort_order,
        localData.sort_order_updatedAt,
        remoteData.sort_order,
        remoteData.sort_order_updatedAt
    );

    const localVer = Number(localData.syncVersion) || 0;
    const remoteVer = Number(remoteData.syncVersion) || 0;
    const currentMaxVersion = Math.max(localVer, remoteVer);

    return {
        syncVersion: currentMaxVersion,
        notes: notesResult.items,
        bookmarks: bookmarksResult.items,
        quotes: quotesResult.items,
        deletedRecords: {
            notes: notesResult.deletes,
            bookmarks: bookmarksResult.deletes,
            quotes: quotesResult.deletes
        },
        category_order: categoryOrderResult.order,
        category_order_updatedAt: categoryOrderResult.updatedAt,
        sort_order: sortOrderResult.order,
        sort_order_updatedAt: sortOrderResult.updatedAt
    };
}

/**
 * 解析 Gist 回傳的檔案內容，支援大檔案 raw_url 抓取
 */
async function fetchGistFileContent(fileData) {
    if (!fileData) return null;

    if (fileData.content && !fileData.truncated) {
        try {
            return JSON.parse(fileData.content);
        } catch (e) {
            console.warn('Gist inline JSON 解析失敗，嘗試讀取 raw_url', e);
        }
    }

    if (fileData.raw_url) {
        const fileResponse = await fetch(`${fileData.raw_url}?t=${Date.now()}`, { cache: 'no-store' });
        if (fileResponse.ok) {
            return await fileResponse.json();
        }
    }

    return null;
}

/**
 * 將合併後的最新資料寫入記憶體 state、IndexedDB 與 localStorage 並重繪視圖
 */
async function applyMergedDataAndRender(mergedData) {
    if (mergedData.syncVersion !== undefined) {
        const ver = Number(mergedData.syncVersion) || 0;
        state.syncVersion = ver;
        localStorage.setItem('sync_version', ver.toString());
    }

    state.notes = mergedData.notes || {};
    state.bookmarks = mergedData.bookmarks || {};
    state.quotes = mergedData.quotes || {};
    state.deletedRecords = mergedData.deletedRecords || { notes: {}, bookmarks: {}, quotes: {} };

    if (mergedData.category_order) {
        localStorage.setItem('my_category_order', typeof mergedData.category_order === 'string' ? mergedData.category_order : JSON.stringify(mergedData.category_order));
    }
    if (mergedData.category_order_updatedAt) {
        localStorage.setItem('my_category_order_updatedAt', mergedData.category_order_updatedAt.toString());
    }

    if (mergedData.sort_order) {
        state.sortOrder = mergedData.sort_order;
        localStorage.setItem('note_sort_order', mergedData.sort_order);
        if (mergedData.sort_order_updatedAt) {
            localStorage.setItem('note_sort_order_updatedAt', mergedData.sort_order_updatedAt.toString());
        }
        if (typeof window.updateSortIcon === 'function') {
            window.updateSortIcon();
        }
    }

    await StorageAPI.replaceAll('notes', state.notes);
    await StorageAPI.replaceAll('bookmarks', state.bookmarks);
    await StorageAPI.replaceAll('quotes', state.quotes);
    await StorageAPI.replaceAll('deleted_notes', state.deletedRecords.notes || {});
    await StorageAPI.replaceAll('deleted_bookmarks', state.deletedRecords.bookmarks || {});
    await StorageAPI.replaceAll('deleted_quotes', state.deletedRecords.quotes || {});

    const editorModal = document.getElementById('editor-modal');
    const fullEditorModal = document.getElementById('full-editor-modal');
    const isEditing = Boolean(
        (editorModal && editorModal.classList.contains('active')) ||
        (fullEditorModal && fullEditorModal.classList.contains('active'))
    );

    if (isEditing) {
        state.hasPendingSyncRender = true;
        return;
    }

    state.hasPendingSyncRender = false;
    renderSidebar();
    if (state.currentView === 'notes' && typeof window.selectYear === 'function') {
        window.selectYear(state.currentYear);
    } else if (state.currentView === 'bookmarks' && typeof window.selectCategory === 'function') {
        window.selectCategory(state.currentCategory);
    } else if (state.currentView === 'quotes' && typeof window.selectQuotesView === 'function') {
        window.selectQuotesView();
    }
}

/**
 * 上傳資料至 GitHub Gist（上傳前先拉取遠端資料進行智慧合併，達成雙向一致性）
 */
export async function uploadToGist(isAuto = false) {
    const token = localStorage.getItem('github_token');
    const gistId = localStorage.getItem('gist_id');
    if (!token || !gistId) {
        if (!isAuto) openCloudAlert();
        return;
    }

    for (let attempt = 0; attempt < MAX_SYNC_RETRIES; attempt++) {
        const expectedBaseVersion = Number(state.syncVersion) || Number(localStorage.getItem('sync_version')) || 0;

        let remoteData = { 
            syncVersion: 0,
            notes: {}, 
            bookmarks: {}, 
            quotes: {}, 
            deletedRecords: { notes: {}, bookmarks: {}, quotes: {} }, 
            category_order: '[]',
            category_order_updatedAt: 0,
            sort_order: 'newest',
            sort_order_updatedAt: 0
        };

        let hasRemoteFile = false;

        try {
            const checkRes = await fetch(`https://api.github.com/gists/${gistId}?t=${Date.now()}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github.v3+json'
                },
                cache: 'no-store'
            });

            if (checkRes.ok) {
                const gistMeta = await checkRes.json();
                const fileData = gistMeta.files ? gistMeta.files['my_notes.json'] : null;
                if (fileData) {
                    hasRemoteFile = true;
                    const parsed = await fetchGistFileContent(fileData);
                    if (parsed) remoteData = parsed;
                }
            } else if (checkRes.status === 401 || checkRes.status === 403) {
                handleSyncErrorAlert('Token 已失效，請重新設定以確保雲端備份', true);
                return;
            } else if (checkRes.status === 404) {
                updateSyncStatusIndicator(true);
                showCloudToast('找不到指定的 Gist ID');
                return;
            } else {
                updateSyncStatusIndicator(true);
            }
        } catch (e) {
            console.warn('雲端遠端預檢失敗，繼續進行本地資料備份', e);
        }

        const remoteVersion = Number(remoteData.syncVersion) || 0;

        // 樂觀鎖防覆寫檢驗：遠端版本高於本地預期基準版本，判定為版本衝突 (TOCTOU 競爭條件)
        if (hasRemoteFile && remoteVersion > expectedBaseVersion) {
            console.warn(`[同步版本衝突] 遠端版本 (${remoteVersion}) 大於本地預期基準 (${expectedBaseVersion})。正在自動拉取合併並重新提交 (嘗試次數: ${attempt + 1}/${MAX_SYNC_RETRIES})`);

            const currentLocalData = {
                syncVersion: expectedBaseVersion,
                notes: state.notes || {},
                bookmarks: state.bookmarks || {},
                quotes: state.quotes || {},
                deletedRecords: state.deletedRecords || { notes: {}, bookmarks: {}, quotes: {} },
                category_order: localStorage.getItem('my_category_order') || '[]',
                category_order_updatedAt: parseInt(localStorage.getItem('my_category_order_updatedAt') || '0', 10),
                sort_order: state.sortOrder || localStorage.getItem('note_sort_order') || 'newest',
                sort_order_updatedAt: parseInt(localStorage.getItem('note_sort_order_updatedAt') || '0', 10)
            };

            const autoMerged = mergeDatasets(currentLocalData, remoteData);
            await applyMergedDataAndRender(autoMerged);

            if (attempt < MAX_SYNC_RETRIES - 1) {
                continue;
            } else {
                handleSyncErrorAlert('並行衝突重試逾限，已自動保留最新合併資料');
                return;
            }
        }

        const localData = {
            syncVersion: expectedBaseVersion,
            notes: state.notes || {},
            bookmarks: state.bookmarks || {},
            quotes: state.quotes || {},
            deletedRecords: state.deletedRecords || { notes: {}, bookmarks: {}, quotes: {} },
            category_order: localStorage.getItem('my_category_order') || '[]',
            category_order_updatedAt: parseInt(localStorage.getItem('my_category_order_updatedAt') || '0', 10),
            sort_order: state.sortOrder || localStorage.getItem('note_sort_order') || 'newest',
            sort_order_updatedAt: parseInt(localStorage.getItem('note_sort_order_updatedAt') || '0', 10)
        };

        const finalMergedData = mergeDatasets(localData, remoteData);
        const nextVersion = Math.max(expectedBaseVersion, remoteVersion) + 1;
        finalMergedData.syncVersion = nextVersion;

        const sanitizedData = sanitizeDatasetPayload(finalMergedData);

        try {
            const response = await fetch(`https://api.github.com/gists/${gistId}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    files: {
                        'my_notes.json': {
                            content: JSON.stringify(sanitizedData, null, 2)
                        }
                    }
                })
            });

            if (response.ok) {
                await applyMergedDataAndRender(finalMergedData);

                const updatedGist = await response.json().catch(() => null);
                const serverTime = updatedGist?.updated_at ? Date.parse(updatedGist.updated_at) : Date.now();
                localStorage.setItem('last_sync_time', Math.max(Date.now(), serverTime).toString());

                // 成功上傳備份，自動恢復正常綠色狀態燈
                updateSyncStatusIndicator(false);

                if (!isAuto) {
                    showCloudToast('備份成功');
                    closeSettingsModal();
                }
                return;
            } else if (response.status === 401 || response.status === 403) {
                handleSyncErrorAlert('Token 已失效，請重新設定以確保雲端備份', true);
                return;
            } else if (response.status === 413) {
                handleSyncErrorAlert('資料體積超出 GitHub Gist 限制 (413)，請清理內容');
                return;
            } else {
                handleSyncErrorAlert(`上傳失敗 (${response.status})，備份尚未完成`);
                return;
            }
        } catch (error) {
            handleSyncErrorAlert('網路連線中斷，雲端備份暫停');
            return;
        }
    }
}

/**
 * 從 GitHub Gist 下載資料並與本地資料逐筆比對合併
 */
export async function downloadFromGist(isAuto = false) {
    const token = localStorage.getItem('github_token');
    const gistId = localStorage.getItem('gist_id');
    if (!token || !gistId) {
        if (!isAuto) openCloudAlert();
        return;
    }

    if (!isAuto) showCloudToast('正在同步');
    const startTime = Date.now();

    try {
        const response = await fetch(`https://api.github.com/gists/${gistId}?t=${Date.now()}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            cache: 'no-store'
        });

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                handleSyncErrorAlert('Token 已失效，請重新設定以確保雲端備份', true);
                return;
            }
            if (response.status === 404) {
                handleSyncErrorAlert('找不到 Gist ID，請檢查設定', true);
                return;
            }
            handleSyncErrorAlert(`雲端讀取失敗 (${response.status})`);
            return;
        }

        const gist = await response.json();
        const fileData = gist.files ? gist.files['my_notes.json'] : null;
        if (!fileData) {
            handleSyncErrorAlert('雲端沒有找到 my_notes.json 備份檔');
            return;
        }

        const remoteData = await fetchGistFileContent(fileData);
        if (!remoteData) {
            handleSyncErrorAlert('雲端檔案解析失敗');
            return;
        }

        const localData = {
            syncVersion: state.syncVersion || parseInt(localStorage.getItem('sync_version') || '0', 10),
            notes: state.notes || {},
            bookmarks: state.bookmarks || {},
            quotes: state.quotes || {},
            deletedRecords: state.deletedRecords || { notes: {}, bookmarks: {}, quotes: {} },
            category_order: localStorage.getItem('my_category_order') || '[]',
            category_order_updatedAt: parseInt(localStorage.getItem('my_category_order_updatedAt') || '0', 10),
            sort_order: state.sortOrder || localStorage.getItem('note_sort_order') || 'newest',
            sort_order_updatedAt: parseInt(localStorage.getItem('note_sort_order_updatedAt') || '0', 10)
        };

        const finalMergedData = mergeDatasets(localData, remoteData);
        const alignedVersion = Math.max(Number(remoteData.syncVersion) || 0, Number(localData.syncVersion) || 0);
        finalMergedData.syncVersion = alignedVersion;
        await applyMergedDataAndRender(finalMergedData);

        const serverTime = gist?.updated_at ? Date.parse(gist.updated_at) : Date.now();
        localStorage.setItem('last_sync_time', Math.max(Date.now(), serverTime).toString());

        // 下載並合併成功，恢復正常綠色指示燈
        updateSyncStatusIndicator(false);

        if (!isAuto) {
            const elapsed = Date.now() - startTime;
            if (elapsed < 1500) {
                await new Promise(resolve => setTimeout(resolve, 1500 - elapsed));
            }
        }

        showCloudToast('同步成功');
        if (!isAuto) closeSettingsModal();
    } catch (error) {
        console.error('同步失敗:', error);
        handleSyncErrorAlert('網路連線失敗，無法取得雲端更新');
    }
}

/**
 * 輕量級檢查遠端更新（僅讀取 Gist updated_at 元資料，不預先抓取完整資料）
 */
export async function checkForRemoteUpdates() {
    const token = localStorage.getItem('github_token');
    const gistId = localStorage.getItem('gist_id');
    if (!token || !gistId || isCheckingUpdates) return;

    isCheckingUpdates = true;
    try {
        const response = await fetch(`https://api.github.com/gists/${gistId}?t=${Date.now()}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            cache: 'no-store'
        });

        if (!response.ok) {
            // 背景輪詢遇到 401/403 即刻切換紅燈警示，終結靜默孤島狀態
            if (response.status === 401 || response.status === 403) {
                handleAuthFailureAlert();
            } else {
                updateSyncStatusIndicator(true);
            }
            return;
        }

        const gistMeta = await response.json();
        const remoteUpdatedStr = gistMeta.updated_at;
        if (!remoteUpdatedStr) return;

        const remoteUpdatedTime = Date.parse(remoteUpdatedStr);
        const lastSyncTime = parseInt(localStorage.getItem('last_sync_time') || '0', 10);

        // 預留 2 秒緩衝，避免本機上傳剛完成時造成的微小時間差誤判
        if (remoteUpdatedTime > (lastSyncTime + 2000)) {
            showCloudToast('發現雲端新版本，點擊同步', {
                persistent: true,
                onClick: async () => {
                    await downloadFromGist(false);
                }
            });
        }
    } catch (error) {
        console.warn('檢查遠端更新時發生異常:', error);
        updateSyncStatusIndicator(true);
    } finally {
        isCheckingUpdates = false;
    }
}

/**
 * 啟動定時輪詢
 */
export function startCloudPolling() {
    stopCloudPolling();
    const token = localStorage.getItem('github_token');
    const gistId = localStorage.getItem('gist_id');
    if (!token || !gistId) return;

    bindVisibilityEvents();

    pollingTimer = setInterval(() => {
        if (!document.hidden) {
            checkForRemoteUpdates();
        }
    }, POLLING_INTERVAL_MS);
}

/**
 * 停止定時輪詢
 */
export function stopCloudPolling() {
    if (pollingTimer) {
        clearInterval(pollingTimer);
        pollingTimer = null;
    }
}

/**
 * 綁定 Page Visibility API 監聽
 */
function bindVisibilityEvents() {
    if (isVisibilityBound) return;
    isVisibilityBound = true;

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopCloudPolling();
        } else {
            checkForRemoteUpdates();
            startCloudPolling();
        }
    });
}