// @ts-check
// domain.js
// 職責：存放零 DOM、零瀏覽器副作用的純業務規則與狀態判斷函式（可無痛遷移至 TypeScript / React）

/**
 * @typedef {import('./types.js').AppState} AppState
 * @typedef {import('./types.js').EditorDraft} EditorDraft
 * @typedef {import('./types.js').ModalId} ModalId
 */

/**
 * 新增流程中的系統保留過渡分類名稱（不應列入一般側邊欄分類清單）
 * @type {ReadonlySet<string>}
 */
export const TRANSITION_CATEGORIES = new Set(['新增內容', '新增網址', '新增分類']);

/**
 * 判斷指定分類名稱是否為新增流程的過渡分類
 * @param {string | null | undefined} cat
 * @returns {boolean}
 */
export function isTransitionCategory(cat) {
    if (typeof cat !== 'string') return false;
    return TRANSITION_CATEGORIES.has(cat);
}

/**
 * 依拖曳錨點與目前指標日期取得有序的日期區間
 * @param {string} anchorDate
 * @param {string} hoverDate
 * @returns {{ start: string, end: string }}
 */
export function getCalendarDateRange(anchorDate, hoverDate) {
    return anchorDate <= hoverDate
        ? { start: anchorDate, end: hoverDate }
        : { start: hoverDate, end: anchorDate };
}

/**
 * 建立一份全新的編輯器草稿初始物件（單一真相來源預設值）
 * @returns {EditorDraft}
 */
export function createEmptyEditorDraft() {
    return {
        editingBookmarkId: null,
        editingReminderId: null,
        bookmarkTitle: '',
        bookmarkUrl: '',
        bookmarkCategory: '',
        bookmarkSubCategory: '',
        bookmarkInsertion: null,
        bookmarkDesc: '',
        bookmarkContent: '',
        reminderTitle: '',
        reminderContent: '',
        reminderIsDone: false,
        reminderDate: '',
        reminderStartDate: '',
        reminderEndDate: '',
        calDate: new Date(),
        tempSelectedReminderDate: '',
        tempSelectedReminderStartDate: '',
        tempSelectedReminderEndDate: '',
        calendarDragAnchorDate: '',
        calendarDragHoverDate: '',
        calendarCrossMonthAnchorDate: '',
        timeWheelStartHour: 12,
        timeWheelStartMinute: 0,
        timeWheelEndHour: 18,
        timeWheelEndMinute: 0,
        initialWheelStartHour: 12,
        initialWheelStartMinute: 0,
        initialWheelEndHour: 18,
        initialWheelEndMinute: 0,
        isReminderStartTimeAdjusted: false,
        isReminderEndTimeAdjusted: false
    };
}

/**
 * @param {string[]} ids
 * @param {NonNullable<EditorDraft['bookmarkInsertion']>} insertion
 */
export function getBookmarkInsertionIndex(ids, insertion) {
    const before = insertion.beforeId === null ? -1 : ids.indexOf(insertion.beforeId);
    if (before !== -1) return before + 1;
    const after = insertion.afterId === null ? -1 : ids.indexOf(insertion.afterId);
    return after !== -1 ? after : 0;
}

/**
 * @param {AppState['bookmarks']} bookmarks
 * @param {string} category
 * @param {string} subCategory
 */
export function getBookmarkIdsInSubCategory(bookmarks, category, subCategory) {
    const targetSubCategory = subCategory || '未分類';
    return Object.keys(bookmarks).filter(id => {
        const bookmark = bookmarks[id];
        if (!bookmark) return false;
        return (bookmark.category?.trim() || '未分類') === category &&
            (bookmark.subCategory?.trim() || '未分類') === targetSubCategory;
    }).sort((a, b) => (bookmarks[a].order || 0) - (bookmarks[b].order || 0));
}

/**
 * 檢查指定彈窗目前是否處於開啟狀態（於 activeModals 堆疊中）
 * @param {Pick<AppState, 'activeModals'>} currentState
 * @param {ModalId} modalId
 * @returns {boolean}
 */
export function hasModal(currentState, modalId) {
    return Array.isArray(currentState.activeModals) && currentState.activeModals.includes(modalId);
}

/**
 * 取得目前最上層（最後開啟）的彈窗識別碼；若無任何彈窗開啟則回傳 null
 * @param {Pick<AppState, 'activeModals'>} currentState
 * @returns {ModalId | null}
 */
export function getTopModal(currentState) {
    if (!Array.isArray(currentState.activeModals) || currentState.activeModals.length === 0) {
        return null;
    }
    return currentState.activeModals[currentState.activeModals.length - 1];
}

/**
 * 將指定彈窗開啟並置頂於 activeModals 去重堆疊中，同時同步忙碌布林旗標
 * @param {AppState} currentState
 * @param {ModalId} modalId
 * @returns {ModalId[]}
 */
export function openModalState(currentState, modalId) {
    const filtered = (currentState.activeModals || []).filter(id => id !== modalId);
    filtered.push(modalId);
    currentState.activeModals = filtered;

    if (modalId === 'editor' || modalId === 'full-editor') {
        currentState.isEditing = true;
    } else if (modalId === 'category') {
        currentState.isCategoryModalOpen = true;
    } else if (modalId === 'sort') {
        currentState.isSortModalOpen = true;
    }

    return currentState.activeModals;
}

/**
 * 從 activeModals 堆疊中移除指定彈窗（支援非後進先出關閉底層視窗），並同步忙碌與拖曳旗標
 * @param {AppState} currentState
 * @param {ModalId} modalId
 * @returns {ModalId[]}
 */
export function closeModalState(currentState, modalId) {
    currentState.activeModals = (currentState.activeModals || []).filter(id => id !== modalId);

    if (modalId === 'editor' || modalId === 'full-editor') {
        currentState.isEditing = hasModal(currentState, 'editor') || hasModal(currentState, 'full-editor');
    } else if (modalId === 'category') {
        currentState.isCategoryModalOpen = false;
        currentState.isCategoryDragging = false;
    } else if (modalId === 'sort') {
        currentState.isSortModalOpen = false;
        currentState.isSortDragging = false;
    }

    return currentState.activeModals;
}

/**
 * 判斷使用者目前是否正處於操作忙碌狀態（編輯中、批次選取、排序／分類視窗開啟或拖曳中）。
 * 同步層與跨分頁監聽器可據此延後非破壞性 DOM 重繪，避免打斷使用者操作。
 * @param {Pick<AppState, 'activeModals' | 'isEditing' | 'isSelectionMode' | 'isSortModalOpen' | 'isCategoryModalOpen' | 'isSortDragging' | 'isCategoryDragging' | 'isCalendarDateDragging'>} currentState
 * @returns {boolean}
 */
export function isUserBusy(currentState) {
    const hasBusyModal = hasModal(currentState, 'editor') ||
        hasModal(currentState, 'full-editor') ||
        hasModal(currentState, 'sort') ||
        hasModal(currentState, 'category');

    return Boolean(
        hasBusyModal ||
        currentState.isEditing ||
        currentState.isSelectionMode ||
        currentState.isSortModalOpen ||
        currentState.isCategoryModalOpen ||
        currentState.isSortDragging ||
        currentState.isCategoryDragging ||
        currentState.isCalendarDateDragging
    );
}
