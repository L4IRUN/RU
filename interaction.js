// @ts-nocheck
// interaction.js
// 職責：管理所有的使用者操作（點擊、手勢拖曳、Modal 開關、鍵盤快捷鍵、資料存刪邏輯、墓碑紀錄追蹤與手動資料合併）

import {
    toggleSelectionMode,
    exitSelectionMode,
    toggleSubCategorySelection,
    toggleBookmarkCardSelection,
    toggleReminderCardSelection,
    triggerHeaderMenuSelect,
    triggerBatchMove,
    confirmCategorySubCategorySelection,
    handleSearch,
    clearSearch,
    handleContextMenuTrigger,
    hideContextMenu,
    showContextMenu,
    triggerContextAdd,
    triggerContextEdit,
    triggerContextDelete
} from './modules/listInteractions.js';


import { selectCategory, selectRemindersView, handleSidebarCategoryClick, handleSidebarRemindersClick, expandSidebarForBookmarks } from './modules/viewNavigation.js';


import { startInlineAddMainCategory, configureCategoryMenuNavigation } from './modules/categoryMenu.js';


import { initSidebarEdgeSwipe, initMainScrollInteractions, initChapterHoverBridge } from './modules/navigationInteractions.js';


import { initEditorCaretScrolling, initFabInteractions, initEditorViewportInteractions, initTextSelectionInteractions } from './modules/editorInteractions.js';


import { triggerImportFileInput, exportLocalData, importLocalData, configureDataTransferNavigation } from './modules/dataTransfer.js';

import { state } from './state.js';
import { hasModal } from './domain.js';
import { APP_EVENTS, onAppEvent } from './events.js';
import {
    closeAllModals,
    registerModalHandler,
    registerPopoverCloser
} from './modules/modalManager.js';


import { renderSidebar, renderBookmarks, showCloudToast } from './ui.js';
import {
    uploadToDrive,
    getMonotonicTimestamp,
    markLocalDataDirty
} from './sync.js';
import { StorageAPI, safeJSONParse, notifyCrossTabChange, sanitizeUrl } from './storage.js';
import { initCleanPasteHandling } from './modules/paste.js';
import { openFullEditor, closeFullEditor, saveFullEditor, handleClipboard, handleFormat } from './modules/fullEditor.js';
import { updateCalendarRangeHighlight, initCalendarDragInteractions, toggleCalendar, confirmCalendarSelection, closeCalendar, changeMonth, changeYear, selectDate } from './modules/calendar.js';
import { openCategorySubCategoryModal, handleCategoryPathClick, handleSelectModalCategory, handleSelectModalSubCategory, triggerAddNewCategoryOrSubCategory, closeCategoryModal, initCategoryCarousel, initCategoryModalDrag } from './modules/categoryModal.js';
import { openSortModal, closeSortModal, handleSortPathClick, handleSelectSortCategory, handleSelectSortSubCategory, initSortCarousel, initSortModalDrag } from './modules/sortModal.js';



import {
    setVisualEffects,
    scrollToSettingsSlide,
    handleAvatarUpload,
    triggerDeleteAvatarConfirm,
    handleAvatarCircleClick,
    openSettingsModal,
    closeSettingsModal,
    closeCloudAlert,
    returnFromCloudAlert,
    handleGoogleAuthClick,
    handleGoogleSignOutClick,
    openSyncSettingsFromAlert,
    forceDownload,
    initSettingsCarousel,
    initProfileUsernameInput
} from './modules/settings.js';

import {
    showCategoryPopoverMenu,
    hideCategoryPopoverMenu,
    toggleHeaderPopoverMenu,
    hideHeaderPopoverMenu,
    triggerHeaderMenuSort,
    triggerCategoryRenameFromMenu
} from './modules/categoryMenu.js';

import {
    toggleChapterPopover,
    closeChapterPopover,
    scrollToChapterTarget,
    clearChapterScrollSpy,
    initChapterScrollSpy,
    toggleSidebarDesktop,
    toggleSidebar,
    hideSidebarProfilePopover,
    hideSidebarCollapsedMenu,
    handleSidebarProfileClick,
    triggerCollapsedMenuSettings,
    triggerCollapsedMenuSync,
    triggerCollapsedMenuLogout,
    toggleFloatingAvatarPopover,
    closeFloatingAvatarPopover,
    handleFloatingManualSync,
    handleFloatingSignOut
} from './modules/navigation.js';
import {
    configureEditorNavigation,
    handleMainAction,
    resetFabIdleTimer,
    openBookmarkEditor,
    openReminderEditor,
    closeAllEditors,
    switchCreateType,
    toggleReminderModalDone,
    initEditorDraftInputs
} from './modules/editor.js';
import {
    configureSaveDeleteHandlers,
    triggerBatchDeleteReminders, triggerCategoryDeleteFromMenu,
    saveUnified, triggerUnifiedDelete, closeConfirm, flushPendingDeleteSync, confirmDelete
} from './modules/saveDelete.js';






// ==========================================
// 章節導航條（側邊章節與卡片快速跳轉）
// ==========================================






// 章節判定基準線（距離 main 頂部的像素）：ScrollSpy 與底部餘裕空間計算共用，確保兩者一致


// 章節被點擊跳轉後，目標元素頂端預期停靠的位置（距離 main 頂部）


// 動態計算底部餘裕：讓「最後一個章節」的頂端能滑動到判定基準線 / 跳轉停靠位置，
// 取代原本「滑到底部就強制啟用最後一個刻度」的補償判定





















































// ==========================================
// Modal 開關邏輯
// ==========================================



























































































export const openCategoryModal = openCategorySubCategoryModal;
export const openSubCategoryModal = openCategorySubCategoryModal;





export function closeAllConfirms() {
    if (document.activeElement) document.activeElement.blur();
    if (hasModal(state, 'confirm')) {
        closeConfirm();
        return;
    }
    if (hasModal(state, 'category')) {
        closeCategoryModal();
        return;
    }
    if (hasModal(state, 'sort')) {
        closeAllModals({ mode: 'all' });
        return;
    }
    if (hasModal(state, 'cloud-alert')) {
        closeCloudAlert();
        return;
    }
    if (hasModal(state, 'settings')) {
        closeSettingsModal();
        return;
    }
    closeAllModals({ mode: 'all' });
}

// ==========================================
// 儲存與刪除邏輯
// ==========================================












































































// ==========================================
// 排序、拖曳、搜尋、右鍵選單與同步設定
// ==========================================
























export function cancelSortModal() {
    state.tempSortCategoryOrder = [];
    state.tempSortSubCategoryOrders = {};
    state.tempSortCardOrders = {};
    closeSortModal();
    closeAllEditors();
}

export async function confirmSortModalSelection() {
    const now = getMonotonicTimestamp();

    // 1. 提交分類排序
    if (Array.isArray(state.tempSortCategoryOrder) && state.tempSortCategoryOrder.length > 0) {
        localStorage.setItem('my_category_order', JSON.stringify(state.tempSortCategoryOrder));
        localStorage.setItem('my_category_order_updatedAt', now.toString());
    }

    // 2. 提交子分類排序
    if (state.tempSortSubCategoryOrders && Object.keys(state.tempSortSubCategoryOrders).length > 0) {
        const subOrdersMap = safeJSONParse(localStorage.getItem('my_subcategory_order'), {});
        const subTimestampsMap = safeJSONParse(localStorage.getItem('my_subcategory_order_timestamps'), {});
        Object.keys(state.tempSortSubCategoryOrders).forEach(cat => {
            subOrdersMap[cat] = state.tempSortSubCategoryOrders[cat];
            subTimestampsMap[cat] = now;
        });
        localStorage.setItem('my_subcategory_order', JSON.stringify(subOrdersMap));
        localStorage.setItem('my_subcategory_order_updatedAt', now.toString());
        localStorage.setItem('my_subcategory_order_timestamps', JSON.stringify(subTimestampsMap));
    }

    // 3. 提交卡片排序 (更新各卡片 order 屬性)
    if (state.tempSortCardOrders && Object.keys(state.tempSortCardOrders).length > 0) {
        const updatedBookmarks = {};
        Object.values(state.tempSortCardOrders).forEach(cardIdList => {
            if (Array.isArray(cardIdList)) {
                cardIdList.forEach((id, index) => {
                    if (state.bookmarks[id] && state.bookmarks[id].order !== index) {
                        state.bookmarks[id].order = index;
                        state.bookmarks[id].updatedAt = now;
                        updatedBookmarks[id] = state.bookmarks[id];
                    }
                });
            }
        });
        if (Object.keys(updatedBookmarks).length > 0) {
            await StorageAPI.saveItems('bookmarks', updatedBookmarks);
        }
    }

    markLocalDataDirty();
    notifyCrossTabChange({ type: 'DATA_CHANGED' });

    renderSidebar();
    if (state.currentView === 'bookmarks') {
        renderBookmarks();
    }

    uploadToDrive(true);
    showCloudToast('排序已儲存');

    closeSortModal();
    closeAllEditors();
}

// ==========================================
// 集中式鍵盤快捷鍵（依 state.activeModals 堆疊由最上層逐層關閉）
// ==========================================
function initKeyboardShortcuts() {
    registerPopoverCloser('category-popover-menu', () => hideCategoryPopoverMenu());
    registerPopoverCloser('header-popover-menu', () => hideHeaderPopoverMenu());
    registerPopoverCloser('sidebar-profile-popover', () => hideSidebarProfilePopover());
    registerPopoverCloser('sidebar-collapsed-menu', () => hideSidebarCollapsedMenu());
    registerPopoverCloser('floating-avatar-popover', () => closeFloatingAvatarPopover());
    registerPopoverCloser('custom-context-menu', () => hideContextMenu());
    registerPopoverCloser('chapter-popover', () => closeChapterPopover());

    registerModalHandler('calendar', { close: () => closeCalendar(false) });
    registerModalHandler('confirm', { close: () => closeConfirm() });
    registerModalHandler('category', { close: () => closeCategoryModal() });
    registerModalHandler('cloud-alert', { close: () => closeCloudAlert() });
    registerModalHandler('settings', { close: () => closeSettingsModal() });
    registerModalHandler('full-editor', { close: () => closeFullEditor(), onEsc: () => saveFullEditor() });
    registerModalHandler('sort', {
        close: () => closeSortModal(),
        onEsc: () => {
            closeSortModal();
            closeAllEditors();
        }
    });
    registerModalHandler('editor', { close: () => closeAllEditors() });

    document.addEventListener('keydown', (e) => {
        const key = e.key;
        if (key === 'Escape') {
            if (document.getElementById('same-category-warning')?.hasAttribute('open')) return;
            if (closeAllModals({ mode: 'top' })) {
                return;
            }

            if (state.isSelectionMode) {
                exitSelectionMode();
                return;
            }

            return;
        }
    });
}



// ==========================================
// 靜態 HTML 事件委派路由表（Action Maps）
// ==========================================


/** @type {Record<string, (e: MouseEvent, el: HTMLElement) => any>} */
const CLICK_ACTIONS = {
    toggleSidebar: (e) => toggleSidebar(e),
    handleMainAction: () => handleMainAction(),
    toggleChapterPopover: (e) => toggleChapterPopover(e),
    triggerContextAdd: () => triggerContextAdd(),
    triggerContextEdit: () => triggerContextEdit(),
    triggerContextDelete: () => triggerContextDelete(),
    toggleSidebarDesktop: () => toggleSidebarDesktop(),
    selectRemindersView: () => selectRemindersView(),
    expandSidebarForBookmarks: () => expandSidebarForBookmarks(),
    startInlineAddMainCategory: () => startInlineAddMainCategory(),
    openSortModal: (_e, el) => (el.dataset.param === 'autoLocate' ? openSortModal({ autoLocate: true }) : openSortModal()),
    handleSidebarProfileClick: (e) => handleSidebarProfileClick(e),
    openSettingsModal: () => {
        closeFloatingAvatarPopover();
        openSettingsModal();
    },
    toggleFloatingAvatarPopover: (e) => toggleFloatingAvatarPopover(e),
    handleFloatingManualSync: (e) => handleFloatingManualSync(e),
    handleFloatingSignOut: (e) => handleFloatingSignOut(e),
    clearSearch: () => clearSearch(),
    toggleSelectionMode: () => toggleSelectionMode(),
    toggleHeaderPopoverMenu: (e) => toggleHeaderPopoverMenu(e),
    triggerBatchDeleteReminders: () => triggerBatchDeleteReminders(),
    triggerBatchMove: () => triggerBatchMove(),
    exitSelectionMode: () => exitSelectionMode(),
    closeAllEditors: () => closeAllEditors(),
    switchCreateType: (_e, el) => switchCreateType(el.dataset.param || ''),
    triggerUnifiedDelete: () => triggerUnifiedDelete(),
    toggleReminderModalDone: () => toggleReminderModalDone(),
    toggleCalendar: () => toggleCalendar(),
    openFullEditor: () => openFullEditor(),
    openCategorySubCategoryModal: () => openCategorySubCategoryModal(),
    saveUnified: () => saveUnified(),
    closeCalendar: (_e, el) => closeCalendar(el.dataset.param === 'true'),
    confirmCalendarSelection: () => confirmCalendarSelection(),
    changeYear: (_e, el) => changeYear(Number(el.dataset.param)),
    changeMonth: (_e, el) => changeMonth(Number(el.dataset.param)),
    closeAllConfirms: () => closeAllConfirms(),
    closeConfirm: () => closeConfirm(),
    confirmDelete: () => confirmDelete(),
    handleCategoryPathClick: (_e, el) => handleCategoryPathClick(Number(el.dataset.param)),
    triggerAddNewCategoryOrSubCategory: () => triggerAddNewCategoryOrSubCategory(),
    confirmCategorySubCategorySelection: () => confirmCategorySubCategorySelection(),
    closeCategoryModal: () => closeCategoryModal(),
    handleSortPathClick: (_e, el) => handleSortPathClick(Number(el.dataset.param)),
    cancelSortModal: () => cancelSortModal(),
    confirmSortModalSelection: () => confirmSortModalSelection(),
    handleGoogleAuthClick: () => handleGoogleAuthClick(),
    handleGoogleSignOutClick: () => handleGoogleSignOutClick(),
    handleAvatarCircleClick: (e) => handleAvatarCircleClick(e),
    triggerDeleteAvatarConfirm: (e) => {
        e.stopPropagation();
        triggerDeleteAvatarConfirm();
    },
    scrollToSettingsSlide: (_e, el) => scrollToSettingsSlide(Number(el.dataset.param)),
    forceDownload: () => forceDownload(),
    exportLocalData: () => exportLocalData(),
    triggerImportFileInput: () => triggerImportFileInput(),
    closeSettingsModal: () => closeSettingsModal(),
    returnFromCloudAlert: () => returnFromCloudAlert(),
    openSyncSettingsFromAlert: () => openSyncSettingsFromAlert(),
    triggerCategoryRenameFromMenu: (e) => triggerCategoryRenameFromMenu(e),
    triggerCategoryDeleteFromMenu: (e) => triggerCategoryDeleteFromMenu(e),
    triggerHeaderMenuSelect: (e) => triggerHeaderMenuSelect(e),
    triggerHeaderMenuSort: (e) => triggerHeaderMenuSort(e),
    triggerCollapsedMenuSettings: (e) => triggerCollapsedMenuSettings(e),
    triggerCollapsedMenuSync: (e) => triggerCollapsedMenuSync(e),
    triggerCollapsedMenuLogout: (e) => triggerCollapsedMenuLogout(e),
    handleClipboard: (e, el) => handleClipboard(e, el.dataset.param || '', el),
    handleFormat: (e, el) => handleFormat(e, el.dataset.param || '', el),
    saveFullEditor: () => saveFullEditor(),
    copyBookmarkUrl: (e, el) => {
        e.stopPropagation();
        const id = el.dataset.id;
        if (!id) return;
        if (state.isSelectionMode) {
            if (state.selectedSubCategories && state.selectedSubCategories.size > 0) return;
            toggleBookmarkCardSelection(id, e);
        } else {
            const b = state.bookmarks[id];
            if (b && b.url) {
                navigator.clipboard.writeText(b.url).then(() => {
                    showCloudToast('已複製網址');
                }).catch(() => { });
            }
        }
    },
    openBookmarkLink: (e, el) => {
        const id = el.dataset.id;
        const b = id ? state.bookmarks[id] : null;
        const safeUrl = b ? sanitizeUrl(b.url) : '';
        if (state.isSelectionMode || !safeUrl) {
            e.preventDefault();
            if (state.isSelectionMode && id) {
                e.stopPropagation();
                if (state.selectedSubCategories && state.selectedSubCategories.size > 0) return;
                toggleBookmarkCardSelection(id, e);
            }
        } else {
            e.stopPropagation();
        }
    },
    handleBookmarkCardClick: (e, el) => {
        const id = el.dataset.id;
        if (!id) return;
        if (state.isSelectionMode) {
            if (state.selectedSubCategories && state.selectedSubCategories.size > 0) return;
            toggleBookmarkCardSelection(id, e);
        } else {
            openBookmarkEditor(id);
        }
    },
    handleReminderCardClick: (e, el) => {
        const id = el.dataset.id;
        if (!id) return;
        if (state.isSelectionMode) {
            toggleReminderCardSelection(id, e);
        } else {
            openReminderEditor(id);
        }
    },
    toggleSubCategorySelection: (e, el) => {
        e.stopPropagation();
        if (state.selectedBookmarkIds && state.selectedBookmarkIds.size > 0) return;
        const wrapper = el.closest('[data-subcategory]');
        const subCatName = wrapper ? wrapper.dataset.subcategory : '';
        if (subCatName) {
            toggleSubCategorySelection(subCatName, e);
        }
    },
    handleSidebarRemindersClick: (_e, el) => handleSidebarRemindersClick(el),
    handleSidebarCategoryClick: (e, el) => {
        const cat = el.dataset.category;
        const text = el.querySelector('.item-text');
        if (el.classList.contains('is-renaming')) {
            if (text && e.target !== text) {
                text.focus();
            }
            return;
        }
        if (cat) {
            handleSidebarCategoryClick(cat, el);
        }
    },
    showCategoryPopoverMenu: (e, el) => {
        e.stopPropagation();
        const item = el.closest('.year-item[data-category]');
        if (!item) return;
        const cat = item.dataset.category;
        const text = item.querySelector('.item-text');
        if (cat) {
            showCategoryPopoverMenu(e, cat, text, el, item, false);
        }
    },
    scrollToChapterItem: (e, el) => {
        e.stopPropagation();
        const popover = document.getElementById('chapter-popover');
        const idx = Number(el.dataset.index);
        const items = popover && Array.isArray(popover._chapterItems) ? popover._chapterItems : [];
        const item = items[idx];
        if (item && item.targetDOM) {
            scrollToChapterTarget(item.targetDOM);
        }
    },
    scrollToChapterGroup: (e, el) => {
        e.stopPropagation();
        const popover = document.getElementById('chapter-popover');
        const idx = Number(el.dataset.index);
        const items = popover && Array.isArray(popover._chapterItems) ? popover._chapterItems : [];
        const item = items[idx];
        if (item && item.groupDOM) {
            scrollToChapterTarget(item.groupDOM);
        }
    },
    handleSelectModalCategory: (_e, el) => handleSelectModalCategory(el.dataset.param || ''),
    handleSelectModalSubCategory: (_e, el) => handleSelectModalSubCategory(el.dataset.param || ''),
    handleSelectSortCategory: (_e, el) => handleSelectSortCategory(el.dataset.param || ''),
    handleSelectSortSubCategory: (_e, el) => handleSelectSortSubCategory(el.dataset.param || ''),
    selectCalendarDay: (e, el) => {
        e.stopPropagation();
        const dateStr = el.dataset.date || '';
        const parts = dateStr.split('-');
        if (parts.length === 3) {
            selectDate(parseInt(parts[0], 10), parseInt(parts[1], 10), parseInt(parts[2], 10));
        }
    }
};

/** @type {Record<string, (e: Event, el: HTMLElement) => any>} */
const INPUT_ACTIONS = {
    handleSearch: () => handleSearch()
};

/** @type {Record<string, (e: Event, el: HTMLElement) => any>} */
const CHANGE_ACTIONS = {
    handleAvatarUpload: (e) => handleAvatarUpload(e),
    importLocalData: (e) => importLocalData(e)
};

/** @type {Record<string, (e: MouseEvent, el: HTMLElement) => any>} */
const CONTEXTMENU_ACTIONS = {
    showContextMenu: (e) => showContextMenu(e, 'bg', null, document.getElementById('content-container')),
    showBookmarkContextMenu: (e, el) => showContextMenu(e, 'bookmark', el.dataset.id || null, el),
    showReminderContextMenu: (e, el) => showContextMenu(e, 'reminder', el.dataset.id || null, el),
    showCategoryPopoverMenu: (e, el) => {
        e.preventDefault();
        e.stopPropagation();
        const cat = el.dataset.category;
        const text = el.querySelector('.item-text');
        const moreBtn = el.querySelector('.category-more-btn');
        if (cat) {
            showCategoryPopoverMenu(e, cat, text, moreBtn, el, true);
        }
    },
    preventContextMenu: (e) => {
        e.preventDefault();
        e.stopPropagation();
    }
};

const handleBookmarkLinkMiddleClick = (e, el) => {
    if (e.button === 1) {
        const id = el.dataset.id;
        const b = id ? state.bookmarks[id] : null;
        const safeUrl = b ? sanitizeUrl(b.url) : '';
        if (state.isSelectionMode || !safeUrl) {
            e.preventDefault();
        }
        e.stopPropagation();
    }
};

/** @type {Record<string, (e: MouseEvent, el: HTMLElement) => any>} */
const AUXCLICK_ACTIONS = {
    handleBookmarkLinkMiddleClick
};

/** @type {Record<string, (e: MouseEvent, el: HTMLElement) => any>} */
const MOUSEDOWN_ACTIONS = {
    handleBookmarkLinkMiddleClick
};

export function getActionRegistry() {
    return Object.freeze({
        click: Object.freeze(Object.keys(CLICK_ACTIONS)),
        input: Object.freeze(Object.keys(INPUT_ACTIONS)),
        change: Object.freeze(Object.keys(CHANGE_ACTIONS)),
        contextmenu: Object.freeze(Object.keys(CONTEXTMENU_ACTIONS)),
        auxclick: Object.freeze(Object.keys(AUXCLICK_ACTIONS)),
        mousedown: Object.freeze(Object.keys(MOUSEDOWN_ACTIONS))
    });
}

let isDelegatedEventsBound = false;

function isDelegatedElementDisabled(el) {
    return el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true';
}

function invokeDelegatedHandler(handler, e, el) {
    const origStopPropagation = e.stopPropagation;
    e.stopPropagation = function () {
        origStopPropagation.call(e);
        if (typeof e.stopImmediatePropagation === 'function') {
            e.stopImmediatePropagation();
        }
    };
    try {
        return handler(e, el);
    } finally {
        e.stopPropagation = origStopPropagation;
    }
}

function initDelegatedEvents() {
    if (isDelegatedEventsBound) return;
    isDelegatedEventsBound = true;

    document.addEventListener('click', (e) => {
        if (!(e.target instanceof Element)) return;
        const el = e.target.closest('[data-action]');
        if (!el) return;
        if (isDelegatedElementDisabled(el)) return;

        const actionName = el.dataset.action;
        if (!actionName) return;

        if (!Object.prototype.hasOwnProperty.call(CLICK_ACTIONS, actionName)) {
            console.warn('[EventDelegation] Unknown click action:', actionName, el);
            return;
        }
        invokeDelegatedHandler(CLICK_ACTIONS[actionName], e, el);
    });

    document.addEventListener('input', (e) => {
        if (!(e.target instanceof Element)) return;
        const el = e.target.closest('[data-input-action]');
        if (!el) return;
        if (isDelegatedElementDisabled(el)) return;

        const actionName = el.dataset.inputAction;
        if (!actionName) return;

        if (!Object.prototype.hasOwnProperty.call(INPUT_ACTIONS, actionName)) {
            console.warn('[EventDelegation] Unknown input action:', actionName, el);
            return;
        }
        invokeDelegatedHandler(INPUT_ACTIONS[actionName], e, el);
    });

    document.addEventListener('change', (e) => {
        if (!(e.target instanceof Element)) return;
        const el = e.target.closest('[data-change-action]');
        if (!el) return;
        if (isDelegatedElementDisabled(el)) return;

        const actionName = el.dataset.changeAction;
        if (!actionName) return;

        if (!Object.prototype.hasOwnProperty.call(CHANGE_ACTIONS, actionName)) {
            console.warn('[EventDelegation] Unknown change action:', actionName, el);
            return;
        }
        invokeDelegatedHandler(CHANGE_ACTIONS[actionName], e, el);
    });

    document.addEventListener('contextmenu', (e) => {
        if (!(e.target instanceof Element)) return;
        const el = e.target.closest('[data-contextmenu-action]');
        if (!el) return;

        const actionName = el.dataset.contextmenuAction;
        if (!actionName) return;

        if (!Object.prototype.hasOwnProperty.call(CONTEXTMENU_ACTIONS, actionName)) {
            console.warn('[EventDelegation] Unknown contextmenu action:', actionName, el);
            return;
        }
        invokeDelegatedHandler(CONTEXTMENU_ACTIONS[actionName], e, el);
    });

    document.addEventListener('auxclick', (e) => {
        if (!(e.target instanceof Element)) return;
        const el = e.target.closest('[data-auxclick-action]');
        if (!el) return;
        if (isDelegatedElementDisabled(el)) return;

        const actionName = el.dataset.auxclickAction;
        if (!actionName) return;

        if (!Object.prototype.hasOwnProperty.call(AUXCLICK_ACTIONS, actionName)) {
            console.warn('[EventDelegation] Unknown auxclick action:', actionName, el);
            return;
        }
        invokeDelegatedHandler(AUXCLICK_ACTIONS[actionName], e, el);
    });

    document.addEventListener('mousedown', (e) => {
        if (!(e.target instanceof Element)) return;
        const el = e.target.closest('[data-mousedown-action]');
        if (!el) return;
        if (isDelegatedElementDisabled(el)) return;

        const actionName = el.dataset.mousedownAction;
        if (!actionName) return;

        if (!Object.prototype.hasOwnProperty.call(MOUSEDOWN_ACTIONS, actionName)) {
            console.warn('[EventDelegation] Unknown mousedown action:', actionName, el);
            return;
        }
        invokeDelegatedHandler(MOUSEDOWN_ACTIONS[actionName], e, el);
    });

    const textToolbar = document.getElementById('text-toolbar');
    if (textToolbar) {
        const preventToolbarBlur = (e) => {
            if (!(e.target instanceof Element)) return;
            if (e.target.closest('[data-action]')) {
                e.preventDefault();
            }
        };
        textToolbar.addEventListener('mousedown', preventToolbarBlur);
        textToolbar.addEventListener('touchstart', preventToolbarBlur, { passive: false });
    }
}

// ==========================================
// 全域事件監聽初始化 
// ==========================================
let isInteractionEventsBound = false;

function bindInteractionEvents() {
    if (isInteractionEventsBound) return;
    isInteractionEventsBound = true;
    onAppEvent(APP_EVENTS.SYNC_FLUSH_PENDING, () => {
        flushPendingDeleteSync();
    });
    onAppEvent(APP_EVENTS.FAB_IDLE_RESET, () => {
        resetFabIdleTimer();
    });
    onAppEvent(APP_EVENTS.CHAPTER_INIT_SPY, (detail) => {
        if (detail && Array.isArray(detail.items)) {
            initChapterScrollSpy(detail.items);
        }
    });
    onAppEvent(APP_EVENTS.CHAPTER_CLEAR_SPY, () => {
        clearChapterScrollSpy();
    });
    onAppEvent(APP_EVENTS.SEARCH_CLEAR, () => {
        clearSearch();
    });
    onAppEvent(APP_EVENTS.SEARCH_FILTER, () => {
        handleSearch();
    });
    onAppEvent(APP_EVENTS.CALENDAR_HIGHLIGHT_RANGE, (detail) => {
        if (detail && detail.start && detail.end) {
            updateCalendarRangeHighlight(detail.start, detail.end);
        }
    });
}

function initAutofillSuppression() {
    // 在 pointerdown 與 focusin 階段雙重壓制，全面杜絕 Chromium 原生 Autofill / 歷史建議下拉框
    const suppressAutofill = (el) => {
        if (el && el.tagName === 'INPUT' && el.type !== 'file' && el.type !== 'hidden') {
            el.setAttribute('autocomplete', 'new-password');
            el.setAttribute('aria-autocomplete', 'none');
            el.setAttribute('autocorrect', 'off');
            el.setAttribute('autocapitalize', 'off');
            el.setAttribute('spellcheck', 'false');
            el.setAttribute('data-form-type', 'other');
            el.setAttribute('data-lpignore', 'true');
            el.setAttribute('data-1p-ignore', 'true');
        }
    };

    document.addEventListener('pointerdown', (e) => suppressAutofill(e.target), true);
    document.addEventListener('focusin', (e) => suppressAutofill(e.target), true);

}





function initOutsideInteractions() {
    document.addEventListener('contextmenu', (e) => {
        if (state.isSelectionMode) {
            e.preventDefault();
            return;
        }

        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.closest('[contenteditable="true"]')) {
            return;
        }

        const activeModals = document.querySelectorAll('.active');
        for (let i = 0; i < activeModals.length; i++) {
            const el = activeModals[i];
            if (el.id.endsWith('-modal') || el.id.endsWith('-overlay')) {
                e.preventDefault();
                return;
            }
        }

        if (e.target.closest('#sidebar')) {
            e.preventDefault();
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        const element = e.target.closest('.note-card') || e.target.closest('.reminder-card') || document.getElementById('content-container');
        if (element || e.target instanceof Element) {
            handleContextMenuTrigger(element || e.target, e.pageX, e.pageY);
        }
    }, true);

    const customContextMenu = document.getElementById('custom-context-menu');
    if (customContextMenu) {
        customContextMenu.addEventListener('mouseleave', () => {
            hideContextMenu();
        });
    }

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#custom-context-menu') && e.button !== 2) {
            hideContextMenu();
        }
        if (!e.target.closest('#category-popover-menu') && !e.target.closest('.category-more-btn')) {
            hideCategoryPopoverMenu();
        }
        if (!e.target.closest('#header-popover-menu') && !e.target.closest('#header-more-btn')) {
            hideHeaderPopoverMenu();
        }
        if (!e.target.closest('#sidebar-profile-popover') && !e.target.closest('#sidebar-profile-trigger')) {
            hideSidebarProfilePopover();
        }
        if (!e.target.closest('#sidebar-collapsed-menu') && !e.target.closest('#sidebar-profile-trigger')) {
            hideSidebarCollapsedMenu();
        }
        if (!e.target.closest('#floating-avatar-group')) {
            closeFloatingAvatarPopover();
        }
    });

    const handleOutsideTap = (e) => {
        const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
        const isTargetIn = (selector) => {
            if (path.length > 0) {
                return path.some(el => el instanceof Element && el.matches(selector));
            }
            return Boolean(e.target && e.target.closest && e.target.closest(selector));
        };

        if (!isTargetIn('#chapter-popover') && !isTargetIn('#chapter-nav-rail')) {
            if (typeof closeChapterPopover === 'function') closeChapterPopover();
        }
        if (!isTargetIn('#header-popover-menu') && !isTargetIn('#header-more-btn')) {
            hideHeaderPopoverMenu();
        }
        if (!isTargetIn('#sidebar-profile-popover') && !isTargetIn('#sidebar-profile-trigger')) {
            hideSidebarProfilePopover();
        }
        if (!isTargetIn('#sidebar-collapsed-menu') && !isTargetIn('#sidebar-profile-trigger')) {
            hideSidebarCollapsedMenu();
        }
        if (!isTargetIn('#floating-avatar-group')) {
            if (Date.now() - (state.floatingAvatarOpenedAt || 0) > 400) {
                closeFloatingAvatarPopover();
            }
        }

        if (state._cachedInnerWidth <= 768) {
            const sidebar = document.getElementById('sidebar');
            const overlay = document.getElementById('mobile-sidebar-overlay');
            // 遮罩由委派 click 收合，避免 touchstart 收合後同一次點擊又打開。
            if (e.type === 'touchstart' && e.target === overlay) return;
            if (sidebar && sidebar.classList.contains('mobile-open')) {
                if (state.isRenamingMainCategory || state.isAddingMainCategory || isTargetIn('#category-popover-menu') || isTargetIn('.category-more-btn')) {
                    return;
                }
                const isSortModalActive = hasModal(state, 'sort');
                const isSettingsModalActive = hasModal(state, 'settings');
                const isConfirmOverlayActive = hasModal(state, 'confirm') || hasModal(state, 'settings') || hasModal(state, 'cloud-alert') || hasModal(state, 'category');
                const isModalOverlayActive = hasModal(state, 'editor') || hasModal(state, 'sort');

                if (
                    isSortModalActive ||
                    isSettingsModalActive ||
                    isConfirmOverlayActive ||
                    isModalOverlayActive ||
                    (e.target && !e.target.isConnected) ||
                    isTargetIn('#settings-modal') ||
                    isTargetIn('#confirm-overlay') ||
                    isTargetIn('#confirm-modal') ||
                    isTargetIn('#sort-modal') ||
                    isTargetIn('#sort-external-top-bar') ||
                    isTargetIn('#sort-external-bottom-bar') ||
                    isTargetIn('#editor-external-top-bar') ||
                    isTargetIn('#editor-external-bottom-bar') ||
                    isTargetIn('#modal-overlay')
                ) {
                    return;
                }

                if (e.target === overlay || (!isTargetIn('#sidebar') && !isTargetIn('.sidebar-toggle-btn') && !isTargetIn('#title-sidebar-btn') && !isTargetIn('#floating-sidebar-btn'))) {
                    if (typeof toggleSidebar === 'function') toggleSidebar();
                }
            }
        }
    };

    document.addEventListener('click', handleOutsideTap);
    document.addEventListener('touchstart', handleOutsideTap, { passive: true });

}







function initSegmentedControls() {
    const allSegments = document.querySelectorAll('.ios-segmented-control');
    allSegments.forEach(segment => {
        const slider = segment.querySelector('.segment-slider');
        const btns = segment.querySelectorAll('.segment-btn');
        const numOptions = btns.length;
        if (numOptions === 0) return;

        let isDragging = false, startX = 0, currentSliderX = 0, segmentWidth = 0;
        let hasMoved = false;
        const isUnifiedType = segment.id === 'unified-type-selector';
        const typeTabs = ['reminder', 'bookmark', 'note'];
        const isVisualType = segment.id === 'visual-effects-segment';

        const getEffectiveNumOptions = () => numOptions;

        const getActiveIndex = () => {
            let active = segment.getAttribute('data-active');
            if (isVisualType) return active === '1' ? 0 : 1;
            return parseInt(active, 10) || 0;
        };

        const startDrag = (clientX) => {
            isDragging = true;
            hasMoved = false;
            startX = clientX;
            const currentCount = getEffectiveNumOptions();
            const paddingAllowance = isUnifiedType ? 0 : 8;
            segmentWidth = Math.max(1, ((segment.offsetWidth || 140) - paddingAllowance) / currentCount);
            let currentIndex = getActiveIndex();
            currentSliderX = currentIndex * segmentWidth;
        };

        const moveDrag = (clientX) => {
            if (!isDragging || !slider) return;
            let diffX = clientX - startX;
            if (Math.abs(diffX) > 5) hasMoved = true;

            if (hasMoved) {
                slider.style.transition = 'none';
                let newX = currentSliderX + diffX;
                const currentCount = getEffectiveNumOptions();
                let maxTranslate = segmentWidth * (currentCount - 1);
                if (newX < 0) newX = 0;
                if (newX > maxTranslate) newX = maxTranslate;
                slider.style.transform = `translateX(${newX}px)`;

                let targetIndex = Math.round(newX / segmentWidth);
                if (targetIndex < 0) targetIndex = 0;
                if (targetIndex >= currentCount) targetIndex = currentCount - 1;

                btns.forEach((btn, index) => {
                    btn.classList.toggle('active', index === targetIndex);
                });
            }
        };

        const endDrag = (clientX) => {
            if (!isDragging) return;
            isDragging = false;
            if (slider) { slider.style.transition = ''; slider.style.transform = ''; }
            if (!hasMoved) return;

            const currentCount = getEffectiveNumOptions();
            let finalX = currentSliderX + (clientX - startX);
            let targetIndex = Math.round(finalX / segmentWidth);
            if (targetIndex < 0) targetIndex = 0;
            if (targetIndex >= currentCount) targetIndex = currentCount - 1;

            if (isUnifiedType) {
                const targetType = typeTabs[targetIndex];
                if (state.currentUnifiedType === targetType) btns.forEach((btn, idx) => btn.classList.toggle('active', idx === targetIndex));
                else switchCreateType(targetType);
            } else if (isVisualType) {
                const targetState = targetIndex === 0 ? '1' : '2';
                if (segment.getAttribute('data-active') !== targetState) {
                    setVisualEffects(targetIndex === 1);
                } else btns.forEach((btn, idx) => btn.classList.toggle('active', idx === targetIndex));
            }
        };

        btns.forEach((btn, index) => {
            const handleTap = (e) => {
                if (e.cancelable) e.preventDefault();
                if (isUnifiedType) {
                    if (btn.id === 'unified-type-reminder') switchCreateType('reminder');
                    else if (btn.id === 'unified-type-note') switchCreateType('note');
                    else if (btn.id === 'unified-type-bookmark') switchCreateType('bookmark');
                } else if (isVisualType) {
                    setVisualEffects(index === 1);
                }
            };
            btn.addEventListener('mousedown', handleTap);
            btn.addEventListener('touchstart', handleTap, { passive: false });
        });

        segment.addEventListener('touchstart', (e) => { startDrag(e.touches[0].clientX); }, { passive: true });
        segment.addEventListener('mousedown', (e) => { startDrag(e.clientX); });

        document.addEventListener('touchmove', (e) => {
            if (isDragging) {
                if (e.cancelable) e.preventDefault();
                moveDrag(e.touches[0].clientX);
            }
        }, { passive: false });

        document.addEventListener('touchend', (e) => {
            if (isDragging && e.changedTouches.length > 0) endDrag(e.changedTouches[0].clientX);
        }, { passive: true });

        document.addEventListener('mousemove', (e) => { if (isDragging) moveDrag(e.clientX); });
        document.addEventListener('mouseup', (e) => { if (isDragging) endDrag(e.clientX); });
    });

}





export function initGlobalInteractions() {
    configureEditorNavigation({ selectCategory, selectRemindersView });
    configureSaveDeleteHandlers({ selectCategory, selectRemindersView, exitSelectionMode });
    configureCategoryMenuNavigation({ selectCategory });
    configureDataTransferNavigation({ selectCategory });
    initDelegatedEvents();
    bindInteractionEvents();
    initKeyboardShortcuts();
    initEditorDraftInputs();
    initCleanPasteHandling();
    initCalendarDragInteractions();
    initSortModalDrag();
    initSortCarousel();
    initCategoryModalDrag();
    initCategoryCarousel();
    initSettingsCarousel();
    initProfileUsernameInput();

    initAutofillSuppression();

    initSidebarEdgeSwipe();

    initMainScrollInteractions();

    initOutsideInteractions();

    initChapterHoverBridge();

    initEditorCaretScrolling();

    initFabInteractions();

    initSegmentedControls();

    initEditorViewportInteractions();

    initTextSelectionInteractions();


}
