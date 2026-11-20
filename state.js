// @ts-check
// state.js
// 職責：集中管理應用程式的所有全域狀態與資料快取（包含刪除墓碑紀錄追蹤）

import { createEmptyEditorDraft } from './domain.js';

/**
 * @typedef {import('./types.js').AppState} AppState
 */

export const APP_VERSION = '20261120';

/** @type {AppState} */
export const state = {
    // 應用程式版本資訊
    appVersion: APP_VERSION,

    // 雲端同步基準版本號（樂觀鎖，預設為 0）
    syncVersion: parseInt(localStorage.getItem('sync_version') || '0', 10),

    // 效能快取
    _cachedInnerWidth: window.innerWidth,
    _cachedInnerHeight: window.innerHeight,

    // 當前視圖與狀態
    // 新增/編輯視窗目前的資料型別：'reminder'（提醒）｜'note'（內容，自訂紀錄）｜'bookmark'（網址書籤）
    currentUnifiedType: 'reminder',
    currentCategory: null,
    currentView: 'reminders',

    // UI 互動狀態
    isFabTucked: false,
    fabIdleTimer: null,

    // 核心資料庫 (記憶體快取)
    bookmarks: {},
    reminders: {},
    deletedRecords: {
        bookmarks: {},
        reminders: {}
    },
    userProfile: {
        avatarData: '',
        avatarUpdatedAt: 0,
        username: '',
        usernameUpdatedAt: 0
    },

    // 新增過渡分頁與取消還原狀態
    previousCategory: null,
    previousView: null,

    // 彈窗堆疊與編輯器草稿（單一真相來源）
    activeModals: [],
    editorDraft: createEmptyEditorDraft(),

    // 編輯器狀態與防覆蓋隔離
    isEditing: false,
    editingBaselineUpdatedAt: 0,
    hasEditConflict: false,
    pendingSyncItems: null,
    hasPendingSyncRender: false,

    // 刪除狀態
    deleteTargetType: null,

    // 右鍵選單狀態
    contextTarget: { type: null, id: null },

    // 提醒事項與資料儲存多選與批次操作狀態
    isSelectionMode: false,
    selectedReminderIds: new Set(),
    selectedBookmarkIds: new Set(),
    selectedSubCategories: new Set(),
    isMoveSelectionActive: false,
    moveTargetType: null,

    // 分類與子分類選擇視窗暫存狀態（分類 - 子分類 - 卡片）
    isCategoryModalOpen: false,
    tempModalCategory: '',
    tempModalSubCategory: '',
    categoryModalStep: 1, // 1: 分類, 2: 子分類, 3: 卡片
    isAddingCategoryInline: false,
    isAddingSubCategoryInline: false,
    tempCategoryModalCategoryOrder: [],
    tempCategoryModalSubCategoryOrders: {},
    tempCategoryModalCardOrders: {},

    // 排序視窗暫存狀態（分類 - 子分類 - 卡片）
    isSortModalOpen: false,
    tempSortCategory: '',
    tempSortSubCategory: '',
    sortModalStep: 1, // 1: 分類, 2: 子分類, 3: 卡片
    tempSortCategoryOrder: [],
    tempSortSubCategoryOrders: {},
    tempSortCardOrders: {},

    // 拖曳與輪播狀態旗標
    isCalendarDateDragging: false,
    isSortDragging: false,
    isCategoryDragging: false,
    isCategoryCarouselSwiping: false,
    justFinishedCategoryCarouselDrag: false,
    justFinishedCategoryDrag: false,
    isSortCarouselSwiping: false,
    justFinishedSortCarouselDrag: false,
    justFinishedSortDrag: false,

    // 側邊欄主分類行內編輯與手機懸浮頭像捲動錨點狀態
    isRenamingMainCategory: false,
    isAddingMainCategory: false,
    floatingAvatarOpenScrollTop: 0
};

// 獨立處理視窗大小更新的事件監聽，確保 state 內的尺寸數值始終為最新
window.addEventListener('resize', () => {
    state._cachedInnerWidth = window.innerWidth;
    state._cachedInnerHeight = window.innerHeight;
}, { passive: true });
