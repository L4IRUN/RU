// state.js
// 職責：集中管理應用程式的所有全域狀態與資料快取（包含刪除墓碑紀錄追蹤）

export const APP_VERSION = '20261025';

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

    // 新增過渡分頁與取消還原狀態
    previousCategory: null,
    
    // 編輯器狀態與防覆蓋隔離
    currentEditingBookmarkId: null,
    currentEditingReminderId: null,
    editingBaselineUpdatedAt: 0,
    hasEditConflict: false,
    pendingSyncItems: null,
    hasPendingSyncRender: false,
    
    // 刪除與日曆狀態
    deleteTargetType: null,
    calDate: new Date(),
    
    // 右鍵選單狀態
    contextTarget: { type: null, id: null },

    // 提醒事項與資料儲存多選與批次操作狀態
    isSelectionMode: false,
    selectedReminderIds: new Set(),
    selectedBookmarkIds: new Set(),
    selectedSubCategories: new Set(),
    isMoveSelectionActive: false,
    moveTargetType: null,
    
    // 編輯器暫存資料（note/bookmark 共用 bookmark 表單；reminder 使用獨立表單）
    tempBookmarkTitle: '',
    tempBookmarkContent: '',
    tempReminderTitle: '',
    tempReminderContent: '',
    tempReminderIsDone: false,
    tempSelectedReminderDate: '',

    // 分類與子分類選擇視窗暫存狀態
    tempModalCategory: '',
    tempModalSubCategory: '',
    categoryModalStep: 1, // 1: 主分類未選, 2: 已選主分類, 3: 瀏覽子分類, 4: 已選子分類
    isAddingCategoryInline: false,
    isAddingSubCategoryInline: false,

    // 排序視窗暫存狀態（分類 - 子分類 - 卡片）
    tempSortCategory: '',
    tempSortSubCategory: '',
    sortModalStep: 1, // 1: 滿版分類, 2: 分類-子分類, 3: 子分類-卡片
    tempSortCategoryOrder: [],
    tempSortSubCategoryOrders: {},
    tempSortCardOrders: {},

    // 提醒事項起訖日期區間拖曳與起訖雙時間滾輪之暫存狀態
    tempSelectedReminderStartDate: '',
    tempSelectedReminderEndDate: '',
    isCalendarDateDragging: false,
    calendarDragAnchorDate: '',
    calendarDragHoverDate: '',
    calendarCrossMonthAnchorDate: '',
    timeWheelStartHour: 12,
    timeWheelStartMinute: 0,
    timeWheelEndHour: 18,
    timeWheelEndMinute: 0,
    isReminderStartTimeAdjusted: false,
    isReminderEndTimeAdjusted: false,
    
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