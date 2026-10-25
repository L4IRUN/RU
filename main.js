// main.js
// 職責：應用程式入口，負責啟動系統、載入資料（含墓碑紀錄）、初始化設定、背景輪詢啟動與串接所有模組

import { state } from './state.js';
import { 
    renderSidebar, 
    updateVisualEffectsSegment,
    initClocks,
    showCloudToast
} from './ui.js';
import { 
    initGlobalInteractions, 
    selectRemindersView,
    resetFabIdleTimer
} from './interaction.js';
import { StorageAPI, safeJSONParse, setStorageErrorHandler, requestPersistentStorage, initCrossTabSync } from './storage.js';
import { 
    downloadFromDrive, 
    startCloudPolling, 
    isGoogleLinked, 
    isTokenValid,
    initGisTokenClient, 
    updateSyncStatusIndicator, 
    initSyncLifecycle
} from './sync.js'; 

// 舊版「語錄」資料遷移旗標：保留以維持歷史資料庫相容性
const QUOTES_MIGRATION_FLAG = 'legacy_quotes_to_reminders_done';

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
        state.bookmarks = await StorageAPI.loadAll('bookmarks', 'my_bookmarks') || {};
        state.reminders = await StorageAPI.loadAll('reminders', 'my_reminders') || {};

        // 載入本地刪除墓碑追蹤紀錄（Tombstones）
        state.deletedRecords = {
            bookmarks: await StorageAPI.loadAll('deleted_bookmarks') || {},
            reminders: await StorageAPI.loadAll('deleted_reminders') || {}
        };

        // 一次性舊版遷移：若偵測到從未遷移過的歷史語錄資料庫，自動轉換至提醒事項
        if (localStorage.getItem(QUOTES_MIGRATION_FLAG) !== '1') {
            try {
                if (Object.keys(state.reminders).length === 0) {
                    const legacyQuotes = await StorageAPI.loadAll('quotes', 'my_quotes') || {};
                    if (Object.keys(legacyQuotes).length > 0) {
                        const today = new Date().toISOString().slice(0, 10);
                        Object.keys(legacyQuotes).forEach(id => {
                            const item = legacyQuotes[id];
                            state.reminders[id] = {
                                title: item.title || '',
                                content: item.text || item.content || '',
                                date: item.date || today,
                                startDate: item.startDate || item.date || today,
                                endDate: item.endDate || item.date || today,
                                startTime: item.startTime || '',
                                endTime: item.endTime || '',
                                isDone: !!item.isDone,
                                timestamp: item.timestamp || '',
                                updatedAt: item.updatedAt || Date.now(),
                                order: item.order || 0
                            };
                        });
                        await StorageAPI.replaceAll('reminders', state.reminders);
                    }

                    if (Object.keys(state.deletedRecords.reminders).length === 0) {
                        const legacyDeleted = await StorageAPI.loadAll('deleted_quotes') || {};
                        if (Object.keys(legacyDeleted).length > 0) {
                            state.deletedRecords.reminders = legacyDeleted;
                            await StorageAPI.replaceAll('deleted_reminders', legacyDeleted);
                        }
                    }
                }

                const cleared = await StorageAPI.replaceMulti({ quotes: {}, deleted_quotes: {} });
                if (cleared) {
                    localStorage.setItem(QUOTES_MIGRATION_FLAG, '1');
                    localStorage.removeItem('my_quotes');
                }
            } catch (migrationError) {
                console.warn('舊版語錄遷移失敗，下次啟動會再嘗試:', migrationError);
            }
        }
    } catch (error) {
        console.error('資料庫載入失敗:', error);
    }

    const cats = new Set();
    Object.values(state.bookmarks).forEach(bm => {
        if (bm.category && bm.category !== '未分類' && bm.category !== '新增分類' && bm.category !== '新增內容' && bm.category !== '新增資料' && bm.category !== '新增網址') {
            cats.add(bm.category);
        }
    });

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

    // 啟動時一律進入提醒視圖
    state.currentView = null;
    selectRemindersView();

    initGlobalInteractions();
    initModalOpenGuard();
    resetFabIdleTimer();

    initClocks();

    // 啟動跨分頁即時同步監聽
    initCrossTabSync(async () => {
        const isEditing = Boolean(
            document.getElementById('editor-modal')?.classList.contains('active') ||
            document.getElementById('full-editor-modal')?.classList.contains('active')
        );
        state.bookmarks = await StorageAPI.loadAll('bookmarks') || {};
        state.reminders = await StorageAPI.loadAll('reminders') || {};
        state.deletedRecords = {
            bookmarks: await StorageAPI.loadAll('deleted_bookmarks') || {},
            reminders: await StorageAPI.loadAll('deleted_reminders') || {}
        };
        state.syncVersion = parseInt(localStorage.getItem('sync_version') || '0', 10);
        if (!isEditing) {
            renderSidebar();
        } else {
            state.hasPendingSyncRender = true;
        }
    });

    await initGisTokenClient();
    initSyncLifecycle();

    if (isGoogleLinked()) {
        try {
            if (isTokenValid()) {
                await downloadFromDrive(true);
                startCloudPolling();
                updateSyncStatusIndicator(false);
                setTimeout(() => {
                    showCloudToast('連接成功');
                }, 600);
            } else {
                updateSyncStatusIndicator(true);
                setTimeout(() => {
                    showCloudToast('授權已過期，點此重新連線', {
                        persistent: true,
                        onClick: () => window.handleGoogleAuthClick()
                    });
                }, 600);
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