// main.js
// 職責：應用程式入口，負責啟動系統、載入資料（含墓碑紀錄）、初始化設定、背景輪詢啟動與串接所有模組

import { state } from './state.js';
import * as UI from './ui.js';
import { 
    renderSidebar, 
    updateVisualEffectsSegment,
    initClocks,
    showCloudToast,
    getLocalDateString
} from './ui.js';
import { 
    initGlobalInteractions, 
    selectRemindersView,
    resetFabIdleTimer
} from './interaction.js';
import { StorageAPI, safeJSONParse, setStorageErrorHandler, requestPersistentStorage, initCrossTabSync } from './storage.js';
import { 
    uploadToDrive,
    downloadFromDrive, 
    startCloudPolling, 
    isGoogleLinked, 
    isTokenValid,
    ensureTokenSilently,
    initGisTokenClient, 
    updateSyncStatusIndicator, 
    initSyncLifecycle,
    recordObservedTimestamp,
    PENDING_SYNC_FLAG
} from './sync.js'; 

// 開窗抖動防護：視窗開啟的 360ms 內暫停子元件過渡與 hover 縮放（對應 style.css 的 .is-opening），
// 並將輸入框內部捲動位置歸零，避免長網址在開窗瞬間被推到尾端再彈回
function initModalOpenGuard() {
    const modal = document.getElementById('editor-modal');
    if (!modal) return;
    let wasActive = false;
    let timer = null;
    new MutationObserver(() => {
        const isActive = modal.classList.contains('active');
        if (isActive === wasActive) return;
        wasActive = isActive;
        clearTimeout(timer);
        if (isActive) {
            modal.classList.add('is-opening');
            ['bookmark-title', 'bookmark-url', 'bookmark-desc', 'full-reminder-title-input'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.scrollLeft = 0;
            });
            timer = setTimeout(() => modal.classList.remove('is-opening'), 360);
        } else {
            modal.classList.remove('is-opening');
        }
    }).observe(modal, { attributes: true, attributeFilter: ['class'] });
}

async function initApp() {
    // 優先初始化 GIS Token Client 與同步生命週期監聽，完成啟動生命週期解耦
    initSyncLifecycle();
    const gisClientPromise = initGisTokenClient();

    // 本機儲存失敗時提示使用者；並請求持久儲存以降低被系統清除的風險
    setStorageErrorHandler((msg) => showCloudToast(msg, { persistent: true }));
    requestPersistentStorage();

    // 全面強制鎖定深色模式
    document.body.setAttribute('data-theme', 'dark');
    const themeMeta = document.getElementById('theme-color-meta');
    if (themeMeta) themeMeta.setAttribute('content', '#121212');

    // 視覺效果開關：正向邏輯儲存於 localStorage（visual_effects: 'true'/'false'）
    if (localStorage.getItem('visual_effects') === null && localStorage.getItem('no_glass') !== null) {
        const wasGlassOff = localStorage.getItem('no_glass') === 'true';
        localStorage.setItem('visual_effects', wasGlassOff ? 'false' : 'true');
        localStorage.removeItem('no_glass');
    }
    const storedVisualEffects = localStorage.getItem('visual_effects');
    const isVisualEffectsOn = storedVisualEffects === null ? true : storedVisualEffects === 'true';
    if (!isVisualEffectsOn) {
        document.body.setAttribute('data-no-glass', 'true');
    }

    updateVisualEffectsSegment(isVisualEffectsOn);

    try {
        state.bookmarks = await StorageAPI.loadAll('bookmarks', 'my_bookmarks');
        state.reminders = await StorageAPI.loadAll('reminders', 'my_reminders');
        state.userProfile = await StorageAPI.loadProfile();

        // 載入本地刪除墓碑追蹤紀錄（Tombstones）
        state.deletedRecords = {
            bookmarks: await StorageAPI.loadAll('deleted_bookmarks'),
            reminders: await StorageAPI.loadAll('deleted_reminders')
        };

        Object.values(state.bookmarks || {}).forEach(bm => {
            if (bm && bm.updatedAt) recordObservedTimestamp(bm.updatedAt);
        });
        Object.values(state.reminders || {}).forEach(rem => {
            if (rem && rem.updatedAt) recordObservedTimestamp(rem.updatedAt);
        });
        Object.values(state.deletedRecords.bookmarks || {}).forEach(ts => {
            const delTime = typeof ts === 'number' ? ts : (ts?.deletedAt || 0);
            if (delTime) recordObservedTimestamp(delTime);
        });
        Object.values(state.deletedRecords.reminders || {}).forEach(ts => {
            const delTime = typeof ts === 'number' ? ts : (ts?.deletedAt || 0);
            if (delTime) recordObservedTimestamp(delTime);
        });
        if (state.userProfile && typeof state.userProfile === 'object') {
            if (state.userProfile.avatarUpdatedAt) recordObservedTimestamp(state.userProfile.avatarUpdatedAt);
            if (state.userProfile.usernameUpdatedAt) recordObservedTimestamp(state.userProfile.usernameUpdatedAt);
        }
        recordObservedTimestamp(parseInt(localStorage.getItem('my_category_order_updatedAt') || '0', 10));
        recordObservedTimestamp(parseInt(localStorage.getItem('my_subcategory_order_updatedAt') || '0', 10));
        recordObservedTimestamp(parseInt(localStorage.getItem('my_empty_categories_updatedAt') || '0', 10));
    } catch (error) {
        console.error('資料庫載入失敗:', error);
        showCloudToast('資料庫載入失敗，已暫停自動同步以防資料遺失，請重新整理頁面。', { persistent: true });
        return;
    }

    const cats = new Set();
    Object.values(state.bookmarks).forEach(bm => {
        if (bm.category && bm.category !== '未分類' && bm.category !== '新增分類' && bm.category !== '新增內容' && bm.category !== '新增網址') {
            cats.add(bm.category);
        }
    });
    const emptyCatsOnInit = safeJSONParse(localStorage.getItem('my_empty_categories'), []);
    if (Array.isArray(emptyCatsOnInit)) {
        emptyCatsOnInit.forEach(c => {
            if (typeof c === 'string' && c.trim() !== '' && c.trim() !== '未分類' && c !== '新增分類' && c !== '新增內容' && c !== '新增網址') {
                cats.add(c.trim());
            }
        });
    }

    if (cats.size > 0 && !state.currentCategory) {
        let savedCatOrder = safeJSONParse(localStorage.getItem('my_category_order'), []);
        const sortedCats = Array.from(cats).sort((a, b) => {
            let idxA = savedCatOrder.indexOf(a);
            let idxB = savedCatOrder.indexOf(b);
            if (idxA === -1 && idxB === -1) return a.localeCompare(b);
            if (idxA === -1) return 1;
            if (idxB === -1) return -1;
            return idxA - idxB;
        });
        state.currentCategory = sortedCats[0];
    } else if (!state.currentCategory) {
        state.currentCategory = '未分類';
    }

    renderSidebar();
    if (typeof UI.renderUserProfileUI === 'function') {
        UI.renderUserProfileUI();
    }

    // 啟動時一律進入提醒視圖
    state.currentView = null;
    selectRemindersView();

    initGlobalInteractions();
    initModalOpenGuard();
    resetFabIdleTimer();

    initClocks();

    // 啟動跨分頁即時同步監聽
    initCrossTabSync(async () => {
        try {
            const isEditorOpen = Boolean(
                document.getElementById('editor-modal')?.classList.contains('active') ||
                document.getElementById('full-editor-modal')?.classList.contains('active')
            );
            const isSortModalActive = Boolean(
                document.getElementById('sort-modal')?.classList.contains('active') ||
                document.getElementById('sort-modal')?.style.display === 'flex'
            );
            const isCategoryModalActive = Boolean(
                document.getElementById('category-modal')?.classList.contains('active') ||
                document.getElementById('category-modal')?.style.display === 'flex'
            );
            const isDraggingActive = Boolean(
                state.isSortDragging ||
                state.isCalendarDateDragging ||
                document.body.classList.contains('is-dragging-item')
            );
            const shouldDeferDOMRender = Boolean(
                isEditorOpen ||
                state.isSelectionMode ||
                isSortModalActive ||
                isCategoryModalActive ||
                isDraggingActive
            );

            const loadedBookmarks = await StorageAPI.loadAll('bookmarks');
            const loadedReminders = await StorageAPI.loadAll('reminders');
            const loadedDelBookmarks = await StorageAPI.loadAll('deleted_bookmarks');
            const loadedDelReminders = await StorageAPI.loadAll('deleted_reminders');
            const loadedUserProfile = await StorageAPI.loadProfile();

            Object.values(loadedBookmarks || {}).forEach(bm => {
                if (bm && bm.updatedAt) recordObservedTimestamp(bm.updatedAt);
            });
            Object.values(loadedReminders || {}).forEach(rem => {
                if (rem && rem.updatedAt) recordObservedTimestamp(rem.updatedAt);
            });
            Object.values(loadedDelBookmarks || {}).forEach(ts => {
                const delTime = typeof ts === 'number' ? ts : (ts?.deletedAt || 0);
                if (delTime) recordObservedTimestamp(delTime);
            });
            Object.values(loadedDelReminders || {}).forEach(ts => {
                const delTime = typeof ts === 'number' ? ts : (ts?.deletedAt || 0);
                if (delTime) recordObservedTimestamp(delTime);
            });
            if (loadedUserProfile && typeof loadedUserProfile === 'object') {
                if (loadedUserProfile.avatarUpdatedAt) recordObservedTimestamp(loadedUserProfile.avatarUpdatedAt);
                if (loadedUserProfile.usernameUpdatedAt) recordObservedTimestamp(loadedUserProfile.usernameUpdatedAt);
            }

            if (isEditorOpen) {
                const activeType = state.currentUnifiedType === 'note' ? 'bookmark' : state.currentUnifiedType;
                const baselineTime = state.editingBaselineUpdatedAt || 0;

                if (activeType === 'bookmark' && state.currentEditingBookmarkId) {
                    const activeId = state.currentEditingBookmarkId;
                    const newBm = loadedBookmarks[activeId];
                    const isDel = Boolean(loadedDelBookmarks[activeId]);
                    const updatedTime = newBm ? (Number(newBm.updatedAt) || 0) : 0;

                    if (isDel || updatedTime > baselineTime) {
                        const delTs = typeof loadedDelBookmarks[activeId] === 'number'
                            ? loadedDelBookmarks[activeId]
                            : (loadedDelBookmarks[activeId]?.deletedAt || Date.now());
                        if (!state.pendingSyncItems) state.pendingSyncItems = {};
                        state.pendingSyncItems.bookmark = {
                            id: activeId,
                            data: isDel ? null : newBm,
                            isDeleted: isDel,
                            deletedAt: isDel ? delTs : 0
                        };
                        state.hasEditConflict = true;
                        showCloudToast('當前編輯的資料在其他分頁已有新版本');
                    }
                    if (state.bookmarks[activeId]) {
                        loadedBookmarks[activeId] = state.bookmarks[activeId];
                    }
                } else if (activeType === 'reminder' && state.currentEditingReminderId) {
                    const activeId = state.currentEditingReminderId;
                    const newRem = loadedReminders[activeId];
                    const isDel = Boolean(loadedDelReminders[activeId]);
                    const updatedTime = newRem ? (Number(newRem.updatedAt) || 0) : 0;

                    if (isDel || updatedTime > baselineTime) {
                        const delTs = typeof loadedDelReminders[activeId] === 'number'
                            ? loadedDelReminders[activeId]
                            : (loadedDelReminders[activeId]?.deletedAt || Date.now());
                        if (!state.pendingSyncItems) state.pendingSyncItems = {};
                        state.pendingSyncItems.reminder = {
                            id: activeId,
                            data: isDel ? null : newRem,
                            isDeleted: isDel,
                            deletedAt: isDel ? delTs : 0
                        };
                        state.hasEditConflict = true;
                        showCloudToast('當前編輯的提醒在其他分頁已有新版本');
                    }
                    if (state.reminders[activeId]) {
                        loadedReminders[activeId] = state.reminders[activeId];
                    }
                }
            }

            state.bookmarks = loadedBookmarks;
            state.reminders = loadedReminders;
            state.deletedRecords = {
                bookmarks: loadedDelBookmarks,
                reminders: loadedDelReminders
            };
            state.userProfile = loadedUserProfile;
            state.syncVersion = parseInt(localStorage.getItem('sync_version') || '0', 10);

            if (typeof UI.renderUserProfileUI === 'function') {
                UI.renderUserProfileUI();
            }

            if (state.isSelectionMode) {
                if (state.selectedBookmarkIds && state.selectedBookmarkIds.size > 0) {
                    for (const id of Array.from(state.selectedBookmarkIds)) {
                        if (!state.bookmarks[id] || loadedDelBookmarks[id]) {
                            state.selectedBookmarkIds.delete(id);
                        }
                    }
                }
                if (state.selectedReminderIds && state.selectedReminderIds.size > 0) {
                    for (const id of Array.from(state.selectedReminderIds)) {
                        if (!state.reminders[id] || loadedDelReminders[id]) {
                            state.selectedReminderIds.delete(id);
                        }
                    }
                }
            }

            if (state.currentCategory && state.currentCategory !== '未分類') {
                const isTransition = (c) => c === '新增內容' || c === '新增網址' || c === '新增分類';
                if (!isTransition(state.currentCategory)) {
                    const validCategories = new Set();
                    Object.values(state.bookmarks || {}).forEach(bm => {
                        if (bm && bm.category && typeof bm.category === 'string') {
                            const cat = bm.category.trim();
                            if (cat !== '' && cat !== '未分類' && !isTransition(cat)) {
                                validCategories.add(cat);
                            }
                        }
                    });
                    const emptyCats = safeJSONParse(localStorage.getItem('my_empty_categories'), []);
                    if (Array.isArray(emptyCats)) {
                        emptyCats.forEach(c => {
                            if (typeof c === 'string' && c.trim() !== '' && c.trim() !== '未分類' && !isTransition(c.trim())) {
                                validCategories.add(c.trim());
                            }
                        });
                    }

                    if (!validCategories.has(state.currentCategory)) {
                        const renameMap = safeJSONParse(localStorage.getItem('my_category_renames'), {});
                        let redirectedCategory = state.currentCategory;
                        const visitedCategories = new Set();
                        const nowMs = Date.now();
                        const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

                        while (renameMap[redirectedCategory] && !visitedCategories.has(redirectedCategory)) {
                            visitedCategories.add(redirectedCategory);
                            const record = renameMap[redirectedCategory];
                            const recordTime = Number(record?.at) || 0;
                            if (recordTime > 0 && (nowMs - recordTime) >= TOMBSTONE_TTL_MS) {
                                break;
                            }
                            if (record && typeof record.to === 'string' && record.to.trim()) {
                                redirectedCategory = record.to.trim();
                            } else {
                                break;
                            }
                        }

                        if (validCategories.has(redirectedCategory)) {
                            state.currentCategory = redirectedCategory;
                        } else {
                            const savedCatOrder = safeJSONParse(localStorage.getItem('my_category_order'), []);
                            const sortedCats = Array.from(validCategories).sort((a, b) => {
                                let idxA = savedCatOrder.indexOf(a);
                                let idxB = savedCatOrder.indexOf(b);
                                if (idxA === -1 && idxB === -1) return a.localeCompare(b);
                                if (idxA === -1) return 1;
                                if (idxB === -1) return -1;
                                return idxA - idxB;
                            });
                            state.currentCategory = sortedCats.length > 0 ? sortedCats[0] : '未分類';
                        }
                    }
                }
            }

            if (!shouldDeferDOMRender) {
                state.hasPendingSyncRender = false;
                renderSidebar();
            } else {
                state.hasPendingSyncRender = true;
            }

            if (!document.hidden && isGoogleLinked() && localStorage.getItem(PENDING_SYNC_FLAG) === 'true') {
                uploadToDrive(true);
            }
        } catch (crossTabErr) {
            console.error('跨分頁資料重載失敗:', crossTabErr);
        }
    });

    await (gisClientPromise || initGisTokenClient());

    if (isGoogleLinked()) {
        try {
            const tokenReady = isTokenValid() || (await ensureTokenSilently());
            if (tokenReady) {
                if (localStorage.getItem(PENDING_SYNC_FLAG) === 'true') {
                    await uploadToDrive(true);
                } else {
                    await downloadFromDrive(true);
                }
                startCloudPolling();
                updateSyncStatusIndicator(false);
                setTimeout(() => {
                    showCloudToast('連接成功');
                }, 600);
            } else {
                updateSyncStatusIndicator(true);
            }
        } catch (syncError) {
            console.error('啟動時雲端同步失敗:', syncError);
            updateSyncStatusIndicator(true);
        }
    } else {
        updateSyncStatusIndicator(true);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}