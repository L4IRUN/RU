// @ts-check
// @ts-nocheck
// 沿用 interaction.js 的型別檢查範圍；本階段只搬移函式，型別化另行處理。
// 編輯器、類型切換與 FAB

import { state } from '../state.js';
import { isTransitionCategory, createEmptyEditorDraft, hasModal } from '../domain.js';
import {
    renderSidebar, getToastState, hideToast, updateBookmarkCategoryDisplayUI,
    updateReminderPreviewDisplay, updateBookmarkPreviewDisplay, getLocalDateString,
    resetFabStateClean
} from '../ui.js';
import { SYNC_CONFIG, getMonotonicTimestamp } from '../sync.js';
import { StorageAPI } from '../storage.js';
import { cancelModalCloseTimer, openModal, closeModal } from './modalManager.js';
import { openFullEditor, closeFullEditor } from './fullEditor.js';
import { closeCalendar } from './calendar.js';
import { positionEditorExternalBars } from './editorLayout.js';
import { closeSortModal } from './sortModal.js';

let selectCategory = null;
let selectRemindersView = null;

export function configureEditorNavigation(handlers) {
    selectCategory = handlers.selectCategory;
    selectRemindersView = handlers.selectRemindersView;
}

/**
 * 將 state.editorDraft 的最新內容渲染到編輯器表單 DOM（僅於開窗、切頁、從全畫面編輯返回時呼叫，絕不干擾打字與 IME 組字）
 */
function syncEditorDraftToDOM() {
    const draft = state.editorDraft;
    const bmTitleEl = document.getElementById('bookmark-title');
    const bmUrlEl = document.getElementById('bookmark-url');
    const bmDescEl = document.getElementById('bookmark-desc');

    if (bmTitleEl && bmTitleEl.value !== draft.bookmarkTitle) bmTitleEl.value = draft.bookmarkTitle;
    if (bmUrlEl && bmUrlEl.value !== draft.bookmarkUrl) bmUrlEl.value = draft.bookmarkUrl;
    if (bmDescEl && bmDescEl.value !== draft.bookmarkDesc) bmDescEl.value = draft.bookmarkDesc;

    updateBookmarkCategoryDisplayUI(draft.bookmarkCategory, draft.bookmarkSubCategory);
    updateReminderPreviewDisplay();
}

function isFabToastBusy(mainBtn) {
    const toastState = getToastState();
    return Boolean(
        toastState.isMobileToastShowing ||
        toastState.isMobileToastDismissing ||
        (mainBtn && mainBtn.classList.contains('toast-mode'))
    );
}

export function setFabTucked(tucked) {
    const mainBtn = document.querySelector('.fab-main-btn');
    if (!mainBtn) {
        state.isFabTucked = false;
        return;
    }
    if (tucked) {
        if (state._cachedInnerWidth > 768 || state.isSelectionMode || isFabToastBusy(mainBtn)) return;
        clearTimeout(state.fabIdleTimer);
        state.isFabTucked = true;
        mainBtn.classList.add('tucked');
    } else {
        state.isFabTucked = false;
        mainBtn.classList.remove('tucked');
    }
}

export function resetFabIdleTimer(e) {
    clearTimeout(state.fabIdleTimer);
    const mainBtn = document.querySelector('.fab-main-btn');

    // 自我修復：狀態與 class 不一致，或視窗已變成桌面寬度卻仍處於收起狀態時，一律還原
    if (mainBtn) {
        const hasTuckedClass = mainBtn.classList.contains('tucked');
        if (state.isFabTucked !== hasTuckedClass || (state._cachedInnerWidth > 768 && hasTuckedClass)) {
            setFabTucked(false);
        }
    }
}

export function handleMainAction() {
    const mainBtn = document.querySelector('.fab-main-btn');
    if (state.isFabTucked || (mainBtn && mainBtn.classList.contains('tucked'))) {
        setFabTucked(false);
        resetFabIdleTimer();
        return;
    }

    // 僅在手機版且按鈕處於提示膠囊模式或關閉中時進行判斷
    const isMobile = state._cachedInnerWidth <= 768;
    const toastState = getToastState();
    if (isMobile) {
        if (toastState.isMobileToastDismissing || (!toastState.isMobileToastShowing && mainBtn && mainBtn.classList.contains('toast-mode'))) {
            hideToast(true);
        } else if (toastState.isMobileToastShowing || (mainBtn && mainBtn.classList.contains('toast-mode'))) {
            if (typeof toastState.currentToastClickHandler === 'function') {
                const clickHandler = toastState.currentToastClickHandler;
                clickHandler();
                hideToast();
                return;
            }
            hideToast();
            return;
        }
    }
    
    if (state.currentView === 'bookmarks') openBookmarkEditor();
    else openReminderEditor();
}

export function isNoteRecord(bm) {
    return !!bm && (!!bm.isCustomRecord || (!bm.url && !!bm.content));
}

function applyBookmarkFormType(type) {
    const draft = state.editorDraft;
    const isNote = type === 'note';
    const container = document.getElementById('bookmark-form-container');
    const titleInput = document.getElementById('bookmark-title');
    const contentEl = document.getElementById('bookmark-content');

    if (container) container.classList.toggle('mode-note', isNote);

    if (titleInput) {
        titleInput.placeholder = isNote ? '名稱' : '名稱';
        // 「內容」分頁的名稱顯示於預覽框內，需與輸入框保持同步
        if (isNote) draft.bookmarkTitle = titleInput.value.trim();
    }

    if (contentEl) {
        if (isNote) updateBookmarkPreviewDisplay();
        else contentEl.innerHTML = '';
    }
}

const UNIFIED_TAB_INDEX = { reminder: 0, bookmark: 1, note: 2 };

function applyTypeSelectorState(type) {
    const selector = document.getElementById('unified-type-selector');
    if (!selector) return;
    selector.classList.remove('two-options');
    selector.classList.add('three-options');
    selector.setAttribute('data-active', String(UNIFIED_TAB_INDEX[type] ?? 0));

    const reminderBtn = document.getElementById('unified-type-reminder');
    const noteBtn = document.getElementById('unified-type-note');
    const bookmarkBtn = document.getElementById('unified-type-bookmark');
    if (reminderBtn) reminderBtn.classList.toggle('active', type === 'reminder');
    if (noteBtn) noteBtn.classList.toggle('active', type === 'note');
    if (bookmarkBtn) bookmarkBtn.classList.toggle('active', type === 'bookmark');
}

const EDITOR_TYPE_ICONS = {
    reminder: `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="7" y1="9" x2="7" y2="15"></line>
            <line x1="12" y1="4" x2="12" y2="20"></line>
            <line x1="17" y1="7" x2="17" y2="17"></line>
        </svg>
    `,
    bookmark: `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <g transform="rotate(-45 12 12)">
                <path d="M9 17H7A5 5 0 0 1 7 7h2"></path>
                <path d="M15 7h2a5 5 0 1 1 0 10h-2"></path>
                <line x1="8" y1="12" x2="16" y2="12"></line>
            </g>
        </svg>
    `,
    note: `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="5" y="3" width="15" height="18" rx="2" ry="2"></rect>
            <line x1="2" y1="8" x2="8" y2="8"></line>
            <line x1="2" y1="12" x2="8" y2="12"></line>
            <line x1="2" y1="16" x2="8" y2="16"></line>
        </svg>
    `
};

const EDITOR_EDIT_TITLES = {
    reminder: '編輯提醒',
    bookmark: '編輯網址',
    note: '編輯內容'
};

function updateEditorTopBarUI(type, isEditMode) {
    const draft = state.editorDraft;
    const typeSelector = document.getElementById('unified-type-selector');
    const editHeader = document.getElementById('editor-edit-header');
    const titleIconEl = document.getElementById('editor-modal-title-icon');
    const titleEl = document.getElementById('editor-modal-title');
    const deleteBtn = document.getElementById('btn-delete-unified');
    const reminderDoneBtn = document.getElementById('reminder-modal-done-btn');

    if (isEditMode) {
        if (typeSelector) typeSelector.style.display = 'none';
        if (editHeader) editHeader.style.display = 'flex';
        if (titleIconEl) titleIconEl.innerHTML = EDITOR_TYPE_ICONS[type] || '';
        if (titleEl) titleEl.innerText = EDITOR_EDIT_TITLES[type] || '編輯';
        if (deleteBtn) deleteBtn.style.display = 'flex';
        if (reminderDoneBtn) {
            if (type === 'reminder') {
                reminderDoneBtn.style.display = 'flex';
                reminderDoneBtn.classList.toggle('checked', !!draft.reminderIsDone);
            } else {
                reminderDoneBtn.style.display = 'none';
                reminderDoneBtn.classList.remove('checked', 'check-pop');
            }
        }
    } else {
        if (editHeader) editHeader.style.display = 'none';
        if (typeSelector) {
            typeSelector.style.display = 'flex';
            applyTypeSelectorState(type);
        }
        if (deleteBtn) deleteBtn.style.display = 'none';
        if (reminderDoneBtn) {
            reminderDoneBtn.style.display = 'none';
            reminderDoneBtn.classList.remove('checked', 'check-pop');
        }
    }
}

export function switchCreateType(type) {
    if (type !== 'reminder' && type !== 'note' && type !== 'bookmark') return;
    if (state.currentUnifiedType === type) return;
    const prevType = state.currentUnifiedType;
    state.currentUnifiedType = type;

    const draft = state.editorDraft;
    const bookmarkContainer = document.getElementById('bookmark-form-container');
    const reminderContainer = document.getElementById('reminder-form-container');
    const titleEl = document.getElementById('editor-modal-title');
    const isEditMode = Boolean(draft.editingReminderId || draft.editingBookmarkId);

    if (bookmarkContainer) bookmarkContainer.style.display = 'none';
    if (reminderContainer) reminderContainer.style.display = 'none';

    updateEditorTopBarUI(type, isEditMode);

    if (type === 'reminder') {
        if (isTransitionCategory(state.currentCategory)) {
            state.currentCategory = (state.previousCategory && !isTransitionCategory(state.previousCategory))
                ? state.previousCategory
                : (Object.keys(state.bookmarks).map(id => state.bookmarks[id].category).find(c => c && c !== '未分類' && !isTransitionCategory(c)) || '未分類');
        }
        if (reminderContainer) reminderContainer.style.display = 'flex';
        titleEl.innerText = draft.editingReminderId ? '編輯提醒' : '新增提醒';
        if (!draft.editingReminderId) {
            const today = new Date();
            const todayStr = getLocalDateString(today);
            draft.editingReminderId = null;
            draft.reminderDate = todayStr;
            draft.reminderStartDate = todayStr;
            draft.reminderEndDate = todayStr;
            draft.tempSelectedReminderStartDate = todayStr;
            draft.tempSelectedReminderEndDate = todayStr;
            draft.tempSelectedReminderDate = todayStr;
            draft.isReminderStartTimeAdjusted = false;
            draft.isReminderEndTimeAdjusted = false;
            draft.timeWheelStartHour = today.getHours();
            draft.timeWheelStartMinute = today.getMinutes();
            draft.timeWheelEndHour = Math.min(23, today.getHours() + 1);
            draft.timeWheelEndMinute = today.getMinutes();
            draft.reminderTitle = '';
            draft.reminderContent = '';
            draft.reminderIsDone = false;
            updateReminderPreviewDisplay();
        }
        // 切換至提醒時，一律同步將主畫面切換至提醒分頁
        if (state.currentView !== 'reminders') {
            selectRemindersView(false);
        }
    } else {
        const isNote = type === 'note';
        if (bookmarkContainer) bookmarkContainer.style.display = 'flex';
        titleEl.innerText = isNote
            ? (draft.editingBookmarkId ? '編輯內容' : '新增內容')
            : (draft.editingBookmarkId ? '編輯網址' : '新增網址');

        const transitionCat = isNote ? '新增內容' : '新增網址';

        if (!draft.editingBookmarkId) {
            const isAlreadyInBookmarkCat = (state.previousView === 'bookmarks' || state.currentView === 'bookmarks') && state.currentCategory && !isTransitionCategory(state.currentCategory);

            if (isAlreadyInBookmarkCat) {
                // 已在資料儲存的分類：不跳轉過渡分頁視窗，直接在所在分類，分類欄位保持顯示
                if (!draft.bookmarkCategory || prevType === 'reminder') {
                    const catVal = state.currentCategory === '未分類' ? '' : state.currentCategory;
                    updateBookmarkCategoryDisplayUI(catVal, draft.bookmarkSubCategory || '');
                }
            } else {
                // 在提醒分頁或切換圖標在提醒時：切換到新增內容/新增網址過渡視窗，且分類輸入框重置為空
                if (!state.previousCategory && state.currentCategory && !isTransitionCategory(state.currentCategory)) {
                    state.previousCategory = state.currentCategory;
                }
                if (!state.previousView) {
                    state.previousView = state.currentView;
                }
                selectCategory(transitionCat, false);
                updateBookmarkCategoryDisplayUI('', '');
            }

            if (prevType === 'reminder') {
                draft.editingBookmarkId = null;
                draft.bookmarkTitle = '';
                draft.bookmarkUrl = '';
                draft.bookmarkDesc = '';
                draft.bookmarkContent = '';
                const bTitle = document.getElementById('bookmark-title');
                const bUrl = document.getElementById('bookmark-url');
                const bDesc = document.getElementById('bookmark-desc');
                const bContent = document.getElementById('bookmark-content');
                if (bTitle) bTitle.value = '';
                if (bUrl) bUrl.value = '';
                if (bDesc) bDesc.value = '';
                if (bContent) bContent.innerHTML = '';
            }
        }

        // 先套用表單型態，讓 DOM 結構與元素顯示/隱藏立即更新
        applyBookmarkFormType(type);
    }

    applyTypeSelectorState(type);
}

export function toggleReminderModalDone() {
    state.editorDraft.reminderIsDone = !state.editorDraft.reminderIsDone;
    const btn = document.getElementById('reminder-modal-done-btn');
    if (btn) {
        btn.classList.remove('check-pop');
        btn.classList.toggle('checked', state.editorDraft.reminderIsDone);
    }
}

export function getItemBaselineTimestamp(item) {
    if (!item) return 0;
    let time = 0;
    if (typeof item.updatedAt === 'number' && !Number.isNaN(item.updatedAt) && item.updatedAt > 0) {
        time = item.updatedAt;
    } else if (item.timestamp && typeof item.timestamp === 'string') {
        const cleaned = item.timestamp.replace(/\(.*?\)/g, '').trim().replace(/\//g, '-');
        const parsed = Date.parse(cleaned);
        if (!Number.isNaN(parsed)) time = parsed;
    }
    if (time <= 0) return 0;
    const maxAllowed = Date.now() + SYNC_CONFIG.CLOCK_SKEW_TOLERANCE_MS;
    return time > maxAllowed ? Date.now() : time;
}

let closeEditorTimer = null;

export function openBookmarkEditor(id = null, forcedType = null) {
    if (closeEditorTimer) {
        clearTimeout(closeEditorTimer);
        closeEditorTimer = null;
    }
    cancelModalCloseTimer('editor');

    // 編輯既有紀錄時依資料本身決定型別；在資料儲存分頁新增時預設為「網址（bookmark）」
    const existingRecord = id ? state.bookmarks[id] : null;
    const editorType = existingRecord
        ? (isNoteRecord(existingRecord) ? 'note' : 'bookmark')
        : (forcedType || 'bookmark');
    state.currentUnifiedType = editorType;

    // 判斷是否為在資料儲存的具體分類中觸發新增
    const isNew = !id;
    const isFromBookmarkCategory = isNew && state.currentView === 'bookmarks' && state.currentCategory && !isTransitionCategory(state.currentCategory);

    // 先重建乾淨草稿並填入編輯資料（確保在 openModal 加上 .active 前完成 DOM 賦值，維持 initModalOpenGuard 時序）
    const draft = createEmptyEditorDraft();
    state.editorDraft = draft;
    draft.editingBookmarkId = id;
    draft.editingReminderId = null;

    state.editingBaselineUpdatedAt = id && state.bookmarks[id] ? getItemBaselineTimestamp(state.bookmarks[id]) : Date.now();
    state.hasEditConflict = false;
    state.pendingSyncItems = null;

    if (isNew) {
        if (isFromBookmarkCategory) {
            // 已在資料儲存的所在分類：直接停留在所在分類，不跳轉過渡分類視窗
            state.previousCategory = null;
            state.previousView = 'bookmarks';
        } else {
            // 在提醒分頁觸發新增內容/網址：跳轉至過渡分類視窗並記錄來源以供取消還原
            const transitionCategoryName = editorType === 'note' ? '新增內容' : '新增網址';
            state.previousCategory = state.currentCategory;
            state.previousView = state.currentView;
            selectCategory(transitionCategoryName, false);
        }
    }

    const titleEl = document.getElementById('editor-modal-title');
    const deleteBtn = document.getElementById('btn-delete-unified');

    updateEditorTopBarUI(editorType, Boolean(id));

    document.getElementById('bookmark-form-container').style.display = 'flex';
    const reminderContainer = document.getElementById('reminder-form-container');
    if (reminderContainer) reminderContainer.style.display = 'none';

    document.getElementById('editor-modal').scrollTop = 0;

    if (id && state.bookmarks[id]) {
        titleEl.innerText = editorType === 'note' ? '編輯內容' : '編輯網址';
        const bm = state.bookmarks[id];
        const existingCat = (!bm.category || bm.category === '未分類') ? '' : bm.category;
        const existingSubCat = bm.subCategory || '';

        draft.bookmarkTitle = bm.title || '';
        draft.bookmarkUrl = bm.url || '';
        draft.bookmarkCategory = existingCat;
        draft.bookmarkSubCategory = existingSubCat;
        draft.bookmarkDesc = bm.description || '';
        draft.bookmarkContent = bm.content || '';

        syncEditorDraftToDOM();
        applyBookmarkFormType(editorType);

        deleteBtn.style.display = 'flex';
    } else {
        titleEl.innerText = editorType === 'note' ? '新增內容' : '新增網址';

        // 若已在所在分類則直接顯示於輸入框；若在提醒分頁則重置為空
        const defaultCat = isFromBookmarkCategory
            ? (state.currentCategory === '未分類' ? '' : state.currentCategory)
            : '';

        draft.bookmarkCategory = defaultCat;
        draft.bookmarkSubCategory = '';

        syncEditorDraftToDOM();
        const bookmarkContentEl = document.getElementById('bookmark-content');
        if (bookmarkContentEl) bookmarkContentEl.innerHTML = '';
        applyBookmarkFormType(editorType);

        deleteBtn.style.display = 'none';
    }

    openModal('editor', {
        onBeforeActivate: () => positionEditorExternalBars(),
        onAfterActivate: () => positionEditorExternalBars()
    });
}

export function openReminderEditor(id = null) {
    if (closeEditorTimer) {
        clearTimeout(closeEditorTimer);
        closeEditorTimer = null;
    }
    cancelModalCloseTimer('editor');

    state.currentUnifiedType = 'reminder';

    // 先重建乾淨草稿並填入編輯資料
    const draft = createEmptyEditorDraft();
    state.editorDraft = draft;
    draft.editingReminderId = id;
    draft.editingBookmarkId = null;

    state.editingBaselineUpdatedAt = id && state.reminders[id] ? getItemBaselineTimestamp(state.reminders[id]) : Date.now();
    state.hasEditConflict = false;
    state.pendingSyncItems = null;

    if (!id) {
        state.previousView = state.currentView;
        state.previousCategory = state.currentCategory;
    }

    const titleEl = document.getElementById('editor-modal-title');
    const deleteBtn = document.getElementById('btn-delete-unified');
    const reminderDoneBtn = document.getElementById('reminder-modal-done-btn');

    document.getElementById('bookmark-form-container').style.display = 'none';
    const reminderContainer = document.getElementById('reminder-form-container');
    if (reminderContainer) reminderContainer.style.display = 'flex';

    document.getElementById('editor-modal').scrollTop = 0;

    const today = new Date();
    const todayStr = getLocalDateString(today);

    if (id && state.reminders[id]) {
        titleEl.innerText = '編輯提醒';
        const r = state.reminders[id];

        draft.reminderIsDone = !!r.isDone;
        updateEditorTopBarUI('reminder', true);

        let parsedStartDate = r.startDate || '';
        let parsedEndDate = r.endDate || '';
        let parsedStartTime = r.startTime || '';
        let parsedEndTime = r.endTime || '';

        if (!parsedStartDate && r.date) {
            const raw = r.date.trim();
            if (raw.includes('~')) {
                const sides = raw.split('~').map(s => s.trim());
                const leftDateMatch = sides[0].match(/(\d{4}-\d{2}-\d{2})/);
                const leftTimeMatch = sides[0].match(/(\d{1,2}:\d{2})/);
                if (leftDateMatch) {
                    parsedStartDate = leftDateMatch[1];
                    if (leftTimeMatch) parsedStartTime = leftTimeMatch[1];
                }
                const rightDateMatch = sides[1].match(/(\d{4}-\d{2}-\d{2})/);
                const rightTimeMatch = sides[1].match(/(\d{1,2}:\d{2})/);
                if (rightDateMatch) {
                    parsedEndDate = rightDateMatch[1];
                    if (rightTimeMatch) parsedEndTime = rightTimeMatch[1];
                } else {
                    const timeOnlyMatch = sides[1].match(/(\d{1,2}:\d{2})/);
                    if (timeOnlyMatch) {
                        parsedEndDate = parsedStartDate;
                        parsedEndTime = timeOnlyMatch[1];
                    }
                }
            } else {
                const dateMatch = raw.match(/(\d{4}-\d{2}-\d{2})/);
                const timeMatch = raw.match(/(\d{1,2}:\d{2})/);
                if (dateMatch) {
                    parsedStartDate = dateMatch[1];
                    parsedEndDate = dateMatch[1];
                    if (timeMatch) parsedStartTime = timeMatch[1];
                }
            }
        }

        if (!parsedStartDate) parsedStartDate = todayStr;
        if (!parsedEndDate) parsedEndDate = parsedStartDate;

        draft.tempSelectedReminderStartDate = parsedStartDate;
        draft.tempSelectedReminderEndDate = parsedEndDate;
        draft.tempSelectedReminderDate = parsedStartDate;

        if (parsedStartTime) {
            const [sh, sm] = parsedStartTime.split(':').map(n => parseInt(n, 10));
            draft.timeWheelStartHour = isNaN(sh) ? 12 : sh;
            draft.timeWheelStartMinute = isNaN(sm) ? 0 : sm;
            draft.isReminderStartTimeAdjusted = true;
        } else {
            draft.isReminderStartTimeAdjusted = false;
        }

        if (parsedEndTime) {
            const [eh, em] = parsedEndTime.split(':').map(n => parseInt(n, 10));
            draft.timeWheelEndHour = isNaN(eh) ? 18 : eh;
            draft.timeWheelEndMinute = isNaN(em) ? 0 : em;
            draft.isReminderEndTimeAdjusted = true;
        } else {
            draft.isReminderEndTimeAdjusted = false;
        }

        draft.reminderDate = r.date || todayStr;
        draft.reminderStartDate = parsedStartDate;
        draft.reminderEndDate = parsedEndDate;
        draft.reminderTitle = r.title || '';
        draft.reminderContent = r.content || '';

        const parts = parsedStartDate.split('-');
        draft.calDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));

        syncEditorDraftToDOM();
        deleteBtn.style.display = 'flex';
    } else {
        titleEl.innerText = '新增提醒';
        draft.reminderIsDone = false;
        updateEditorTopBarUI('reminder', false);
        if (reminderDoneBtn) {
            reminderDoneBtn.style.display = 'none';
            reminderDoneBtn.classList.remove('checked', 'check-pop');
        }

        draft.reminderDate = todayStr;
        draft.reminderStartDate = todayStr;
        draft.reminderEndDate = todayStr;
        draft.tempSelectedReminderStartDate = todayStr;
        draft.tempSelectedReminderEndDate = todayStr;
        draft.tempSelectedReminderDate = todayStr;
        draft.isReminderStartTimeAdjusted = false;
        draft.isReminderEndTimeAdjusted = false;
        draft.timeWheelStartHour = today.getHours();
        draft.timeWheelStartMinute = today.getMinutes();
        draft.timeWheelEndHour = Math.min(23, today.getHours() + 1);
        draft.timeWheelEndMinute = today.getMinutes();
        draft.reminderTitle = '';
        draft.reminderContent = '';
        draft.calDate = new Date();

        syncEditorDraftToDOM();
        const bookmarkContentEl = document.getElementById('bookmark-content');
        if (bookmarkContentEl) bookmarkContentEl.innerHTML = '';

        deleteBtn.style.display = 'none';
    }

    openModal('editor', {
        onBeforeActivate: () => positionEditorExternalBars(),
        onAfterActivate: () => positionEditorExternalBars()
    });
}

export function closeAllEditors() {
    if (hasModal(state, 'full-editor')) {
        closeFullEditor();
        return;
    }
    if (document.activeElement) document.activeElement.blur();
    window.getSelection().removeAllRanges();

    closeSortModal();

    const reminderDoneBtn = document.getElementById('reminder-modal-done-btn');
    if (reminderDoneBtn) {
        reminderDoneBtn.style.display = 'none';
        reminderDoneBtn.classList.remove('checked', 'check-pop');
    }

    closeModal('editor');
    closeCalendar(false);

    const toolbar = document.getElementById('text-toolbar');
    if (toolbar) toolbar.classList.remove('active');

    // 取消退出新增時，先記住編輯目標 ID 以還原畫面，隨後徹底重置草稿為空
    const prevViewToRestore = state.previousView;
    const prevCatToRestore = state.previousCategory;
    const wasEditingExistingReminder = Boolean(state.editorDraft.editingReminderId);
    const wasEditingExistingBookmark = Boolean(state.editorDraft.editingBookmarkId);
    state.previousView = null;
    state.previousCategory = null;

    state.isCalendarDateDragging = false;
    state.editorDraft = createEmptyEditorDraft();

    const fullNoteContentEl = document.getElementById('full-note-content');
    if (fullNoteContentEl) fullNoteContentEl.innerHTML = '';
    const bookmarkContentEl = document.getElementById('bookmark-content');
    if (bookmarkContentEl) bookmarkContentEl.innerHTML = '';
    const reminderContentEl = document.getElementById('reminder-content');
    if (reminderContentEl) reminderContentEl.innerHTML = '';
    const fullReminderTitleInput = document.getElementById('full-reminder-title-input');
    if (fullReminderTitleInput) fullReminderTitleInput.value = '';
    syncEditorDraftToDOM();

    if (isTransitionCategory(state.currentCategory)) {
        state.currentCategory = (prevCatToRestore && !isTransitionCategory(prevCatToRestore))
            ? prevCatToRestore
            : (Object.keys(state.bookmarks).map(id => state.bookmarks[id].category).find(c => c && c !== '未分類' && !isTransitionCategory(c)) || '未分類');
    }

    if (wasEditingExistingReminder) {
        if (state.currentView !== 'reminders') {
            selectRemindersView(false);
        }
    } else if (wasEditingExistingBookmark) {
        if (state.currentView !== 'bookmarks') {
            selectCategory(state.currentCategory || '未分類', false);
        }
    } else if (prevViewToRestore === 'reminders') {
        selectRemindersView(false);
    } else if (prevCatToRestore && !isTransitionCategory(prevCatToRestore)) {
        selectCategory(prevCatToRestore, false);
    } else if (state.currentView === 'bookmarks' && isTransitionCategory(state.currentCategory)) {
        const fallbackCat = Object.keys(state.bookmarks).map(id => state.bookmarks[id].category).find(c => c && c !== '未分類' && !isTransitionCategory(c)) || '未分類';
        selectCategory(fallbackCat, false);
    }
    
    // 若前一個關閉回呼尚未執行，先取消，避免重複排程
    if (closeEditorTimer) clearTimeout(closeEditorTimer);
    closeEditorTimer = setTimeout(async () => {
        closeEditorTimer = null;

        if (state.pendingSyncItems) {
            if (!state.deletedRecords) {
                state.deletedRecords = { bookmarks: {}, reminders: {} };
            }
            if (state.pendingSyncItems.bookmark) {
                const { id, data, isDeleted, deletedAt } = state.pendingSyncItems.bookmark;
                if (isDeleted) {
                    const delTs = Number(deletedAt) || getMonotonicTimestamp();
                    delete state.bookmarks[id];
                    if (!state.deletedRecords.bookmarks) state.deletedRecords.bookmarks = {};
                    state.deletedRecords.bookmarks[id] = Math.max(state.deletedRecords.bookmarks[id] || 0, delTs);
                    await StorageAPI.batchDeleteWithTombstone('bookmarks', 'deleted_bookmarks', [id], state.deletedRecords.bookmarks[id]);
                } else if (data) {
                    state.bookmarks[id] = data;
                    await StorageAPI.saveItem('bookmarks', id, data);
                }
            }
            if (state.pendingSyncItems.reminder) {
                const { id, data, isDeleted, deletedAt } = state.pendingSyncItems.reminder;
                if (isDeleted) {
                    const delTs = Number(deletedAt) || getMonotonicTimestamp();
                    delete state.reminders[id];
                    if (!state.deletedRecords.reminders) state.deletedRecords.reminders = {};
                    state.deletedRecords.reminders[id] = Math.max(state.deletedRecords.reminders[id] || 0, delTs);
                    await StorageAPI.batchDeleteWithTombstone('reminders', 'deleted_reminders', [id], state.deletedRecords.reminders[id]);
                } else if (data) {
                    state.reminders[id] = data;
                    await StorageAPI.saveItem('reminders', id, data);
                }
            }
            state.pendingSyncItems = null;
            state.hasPendingSyncRender = true;
        }

        state.editorDraft.editingBookmarkId = null;
        state.editorDraft.editingReminderId = null;
        state.editingBaselineUpdatedAt = 0;
        state.hasEditConflict = false;

        if (state.hasPendingSyncRender) {
            state.hasPendingSyncRender = false;
            renderSidebar();
        }
    }, 250);
}

export function initEditorDraftInputs() {
    const bmTitleEl = document.getElementById('bookmark-title');
    if (bmTitleEl && bmTitleEl.dataset.draftBound !== 'true') {
        bmTitleEl.dataset.draftBound = 'true';
        bmTitleEl.addEventListener('input', () => {
            state.editorDraft.bookmarkTitle = bmTitleEl.value;
        });
    }

    const bmUrlEl = document.getElementById('bookmark-url');
    if (bmUrlEl && bmUrlEl.dataset.draftBound !== 'true') {
        bmUrlEl.dataset.draftBound = 'true';
        bmUrlEl.addEventListener('input', () => {
            state.editorDraft.bookmarkUrl = bmUrlEl.value;
        });
    }

    const bmDescEl = document.getElementById('bookmark-desc');
    if (bmDescEl && bmDescEl.dataset.draftBound !== 'true') {
        bmDescEl.dataset.draftBound = 'true';
        bmDescEl.addEventListener('input', () => {
            state.editorDraft.bookmarkDesc = bmDescEl.value;
        });
    }

    const fullTitleEl = document.getElementById('full-reminder-title-input');
    if (fullTitleEl && fullTitleEl.dataset.draftBound !== 'true') {
        fullTitleEl.dataset.draftBound = 'true';
        fullTitleEl.addEventListener('input', () => {
            if (state.currentUnifiedType === 'note') {
                state.editorDraft.bookmarkTitle = fullTitleEl.value;
            } else if (state.currentUnifiedType === 'reminder') {
                state.editorDraft.reminderTitle = fullTitleEl.value;
            }
        });
    }

    const fullNoteContentEl = document.getElementById('full-note-content');
    if (fullNoteContentEl && fullNoteContentEl.dataset.draftBound !== 'true') {
        fullNoteContentEl.dataset.draftBound = 'true';
        fullNoteContentEl.addEventListener('input', () => {
            if (state.currentUnifiedType === 'note') {
                state.editorDraft.bookmarkContent = fullNoteContentEl.innerHTML;
            } else if (state.currentUnifiedType === 'reminder') {
                state.editorDraft.reminderContent = fullNoteContentEl.innerHTML;
            }
        });
    }
}
