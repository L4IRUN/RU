// state.js
// 職責：集中管理應用程式的所有全域狀態與資料快取（包含刪除墓碑紀錄追蹤）

import { safeJSONParse } from './storage.js';

export const APP_VERSION = '20260906';

export const state = {
    // 應用程式版本資訊
    appVersion: APP_VERSION,

    // 雲端同步基準版本號（樂觀鎖，預設為 0）
    syncVersion: parseInt(localStorage.getItem('sync_version') || '0', 10),

    // 效能快取
    _cachedInnerWidth: window.innerWidth,
    _cachedInnerHeight: window.innerHeight,
    
    // 當前視圖與狀態
    currentUnifiedType: 'quote',
    currentYear: new Date().getFullYear().toString(),
    currentCategory: null,
    currentView: 'notes',
    
    // UI 互動狀態
    fabWasDragged: false,
    isFabTucked: false,
    fabIdleTimer: null,
    
    // 核心資料庫 (記憶體快取)
    notes: {},
    bookmarks: {},
    quotes: {},
    deletedRecords: {
        notes: {},
        bookmarks: {},
        quotes: {}
    },
    lastDeletedItem: safeJSONParse(localStorage.getItem('last_deleted_item'), null),
    
    // 編輯器狀態
    currentEditingDate: null,
    currentEditingBookmarkId: null,
    currentEditingQuoteId: null,
    hasPendingSyncRender: false,
    
    // 刪除與日曆狀態
    deleteTargetType: null,
    calDate: new Date(),
    
    // 排序與選單狀態（支援本地持久化恢復）
    sortOrder: localStorage.getItem('note_sort_order') === 'oldest' ? 'oldest' : 'newest',
    contextTarget: { type: null, id: null },
    currentContextMenuCard: null,
    
    // 觸控與手勢座標
    swipeStartX: 0,
    swipeStartY: 0,
    
    // 筆記暫存資料
    isThemedNote: false,
    tempNoteData: { morning: '', afternoon: '', evening: '', title: '', content: '', reminder: 'none' },
    currentTimeTab: 'morning',
    isNoteUnsaved: false,
    autoSaveTimer: null,
    
    // 資料儲存自訂模式暫存資料
    isCustomBookmark: false,
    tempBookmarkContent: '',
    
    // 拖曳排序 (Sortable) 專用變數
    activeSortContainer: null,
    draggingSortEl: null,
    sortPlaceholder: null,
    sortStartY: 0,
    sortLongPressTimer: null,
    isSortDragging: false,
    sortInitY: 0
};

// 獨立處理視窗大小更新的事件監聽，確保 state 內的尺寸數值始終為最新
window.addEventListener('resize', () => {
    state._cachedInnerWidth = window.innerWidth;
    state._cachedInnerHeight = window.innerHeight;
}, { passive: true });