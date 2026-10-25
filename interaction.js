// interaction.js
// 職責：管理所有的使用者操作（點擊、手勢拖曳、Modal 開關、鍵盤快捷鍵、資料存刪邏輯、墓碑紀錄追蹤與手動資料合併）

import { state } from './state.js';
import {
    renderSidebar, renderBookmarks, renderReminders, updateBookmarkDOM,
    showCloudToast, hideToast, getToastState, renderCalendar, renderBookmarkSortLists,
    renderSortModalColumns, positionSortConfirmBtn,
    getTimestamp,
    updateVisualEffectsSegment, updateSelectionBarUI, updateBookmarkCategoryDisplayUI,
    positionCategoryConfirmBtn, renderCategoryModalColumns, updateReminderPreviewDisplay,
    updateBookmarkPreviewDisplay, updateFloatingCategoryTitle, stopReminderCountdownTimer,
    isTransitionCategory, updateChapterNav
} from './ui.js';
import { 
    uploadToDrive, 
    downloadFromDrive, 
    mergeDatasets, 
    requestGoogleAuth, 
    signOutGoogle, 
    isGoogleLinked,
    isTokenValid,
    initGisTokenClient,
    sanitizeDatasetPayload
} from './sync.js';
import { StorageAPI, safeJSONParse, notifyCrossTabChange } from './storage.js';
import { PENDING_SYNC_FLAG } from './sync.js';

// ==========================================
// FAB 邏輯
// ==========================================
export function resetFabIdleTimer(e) {
    clearTimeout(state.fabIdleTimer);
    const mainBtn = document.querySelector('.fab-main-btn');
    if (state._cachedInnerWidth > 768 || state.isSelectionMode || state.isFabTucked || (mainBtn && mainBtn.classList.contains('toast-mode'))) return;

    state.fabIdleTimer = setTimeout(() => {
        if (state._cachedInnerWidth <= 768 && !state.isSelectionMode && !state.isFabTucked && mainBtn && !mainBtn.classList.contains('toast-mode')) {
            state.isFabTucked = true;
            mainBtn.classList.add('tucked');
        }
    }, 5000);
}

export function handleMainAction() {
    const mainBtn = document.querySelector('.fab-main-btn');
    if (state.isFabTucked || (mainBtn && mainBtn.classList.contains('tucked'))) {
        state.isFabTucked = false;
        if (mainBtn) mainBtn.classList.remove('tucked');
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
                return;
            }
            hideToast();
            return;
        }
    }
    
    if (state.currentView === 'bookmarks') openBookmarkEditor();
    else openReminderEditor();
}

// ==========================================
// 切換與導覽邏輯
// ==========================================
// 判斷一筆 bookmarks 表中的紀錄是「內容（note）」還是「網址書籤（bookmark）」
export function isNoteRecord(bm) {
    return !!bm && (!!bm.isCustomRecord || (!bm.url && !!bm.content));
}

// 依分頁型別（note / bookmark）套用 bookmark 表單的版型與欄位提示
function applyBookmarkFormType(type) {
    const isNote = type === 'note';
    const container = document.getElementById('bookmark-form-container');
    const titleInput = document.getElementById('bookmark-title');
    const contentEl = document.getElementById('bookmark-content');

    if (container) container.classList.toggle('mode-note', isNote);

    if (titleInput) {
        titleInput.placeholder = isNote ? '名稱' : '名稱';
        // 「內容」分頁的名稱顯示於預覽框內，需與輸入框保持同步
        if (isNote) state.tempBookmarkTitle = titleInput.value.trim();
    }

    if (contentEl) {
        if (isNote) updateBookmarkPreviewDisplay();
        else contentEl.innerHTML = '';
    }
}

const UNIFIED_TAB_INDEX = { reminder: 0, note: 1, bookmark: 2 };

// 同步「新增視窗」右上角三段式切換器的外觀（提醒 / 內容 / 書籤）
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

export function switchCreateType(type) {
    if (type !== 'reminder' && type !== 'note' && type !== 'bookmark') return;
    if (state.currentUnifiedType === type) return;
    const prevType = state.currentUnifiedType;
    state.currentUnifiedType = type;

    const bookmarkContainer = document.getElementById('bookmark-form-container');
    const reminderContainer = document.getElementById('reminder-form-container');
    const titleEl = document.getElementById('editor-modal-title');
    const reminderDoneBtn = document.getElementById('reminder-modal-done-btn');

    if (bookmarkContainer) bookmarkContainer.style.display = 'none';
    if (reminderContainer) reminderContainer.style.display = 'none';

    if (reminderDoneBtn) {
        if (type === 'reminder' && state.currentEditingReminderId) {
            reminderDoneBtn.style.display = 'flex';
            reminderDoneBtn.classList.toggle('checked', !!state.tempReminderIsDone);
        } else {
            reminderDoneBtn.style.display = 'none';
        }
    }

    if (type === 'reminder') {
        if (isTransitionCategory(state.currentCategory)) {
            state.currentCategory = (state.previousCategory && !isTransitionCategory(state.previousCategory))
                ? state.previousCategory
                : (Object.keys(state.bookmarks).map(id => state.bookmarks[id].category).find(c => c && c !== '未分類' && !isTransitionCategory(c)) || '未分類');
        }
        if (reminderContainer) reminderContainer.style.display = 'flex';
        titleEl.innerText = state.currentEditingReminderId ? '編輯提醒' : '新增提醒';
        if (!state.currentEditingReminderId) {
            openEditorSwitchBar();
            positionEditorSwitchBar();
        } else {
            closeEditorSwitchBar();
        }
        if (!state.currentEditingReminderId) {
            const today = new Date();
            const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            const rDateVal = document.getElementById('reminder-date-val');
            const rStartDateVal = document.getElementById('reminder-start-date-val');
            const rEndDateVal = document.getElementById('reminder-end-date-val');
            const rId = document.getElementById('reminder-id-val');
            if (rId) rId.value = '';
            if (rDateVal) rDateVal.value = todayStr;
            if (rStartDateVal) rStartDateVal.value = todayStr;
            if (rEndDateVal) rEndDateVal.value = todayStr;
            state.tempSelectedReminderStartDate = todayStr;
            state.tempSelectedReminderEndDate = todayStr;
            state.tempSelectedReminderDate = todayStr;
            state.isReminderStartTimeAdjusted = false;
            state.isReminderEndTimeAdjusted = false;
            state.timeWheelStartHour = today.getHours();
            state.timeWheelStartMinute = today.getMinutes();
            state.timeWheelEndHour = Math.min(23, today.getHours() + 1);
            state.timeWheelEndMinute = today.getMinutes();
            state.tempReminderTitle = '';
            state.tempReminderContent = '';
            state.tempReminderIsDone = false;
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
            ? (state.currentEditingBookmarkId ? '編輯內容' : '新增內容')
            : (state.currentEditingBookmarkId ? '編輯網址' : '新增網址');

        const transitionCat = isNote ? '新增內容' : '新增網址';

        if (!state.currentEditingBookmarkId) {
            const isAlreadyInBookmarkCat = (state.previousView === 'bookmarks' || state.currentView === 'bookmarks') && state.currentCategory && !isTransitionCategory(state.currentCategory);

            if (isAlreadyInBookmarkCat) {
                // 已在資料儲存的分類：不跳轉過渡分頁視窗，直接在所在分類，分類欄位保持顯示
                const bCat = document.getElementById('bookmark-category');
                const bSubCat = document.getElementById('bookmark-sub-category');
                if (bCat && (!bCat.value || prevType === 'reminder')) {
                    const catVal = state.currentCategory === '未分類' ? '' : state.currentCategory;
                    bCat.value = catVal;
                    updateBookmarkCategoryDisplayUI(catVal, bSubCat ? bSubCat.value : '');
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

                const bCat = document.getElementById('bookmark-category');
                if (bCat) bCat.value = '';
                const bSubCat = document.getElementById('bookmark-sub-category');
                if (bSubCat) bSubCat.value = '';
                updateBookmarkCategoryDisplayUI('', '');
            }

            if (prevType === 'reminder') {
                const bId = document.getElementById('bookmark-id-val');
                const bTitle = document.getElementById('bookmark-title');
                const bUrl = document.getElementById('bookmark-url');
                const bDesc = document.getElementById('bookmark-desc');
                const bContent = document.getElementById('bookmark-content');
                if (bId) bId.value = '';
                if (bTitle) bTitle.value = '';
                if (bUrl) bUrl.value = '';
                if (bDesc) bDesc.value = '';
                if (bContent) bContent.innerHTML = '';
                state.tempBookmarkTitle = '';
                state.tempBookmarkContent = '';
            }
        }

        // 先套用表單型態，讓 DOM 結構與元素顯示/隱藏立即更新
        applyBookmarkFormType(type);

        if (!state.currentEditingBookmarkId) {
            openEditorSwitchBar();
            positionEditorSwitchBar();
        } else {
            closeEditorSwitchBar();
        }
    }

    applyTypeSelectorState(type);
    const isCreatingNew = type === 'reminder' ? !state.currentEditingReminderId : !state.currentEditingBookmarkId;
    if (isCreatingNew) {
        requestAnimationFrame(() => positionEditorSwitchBar());
    }
}

export function updateCollapsedIcons(view) {
    // 筆記圖標僅保留外觀：永遠不會被標記為 active
    const isReminders = view === 'reminders';

    document.querySelectorAll('.collapsed-icon-btn').forEach(btn => btn.classList.remove('active'));
    const btn = document.getElementById(isReminders ? 'collapsed-reminders-btn' : 'collapsed-bookmarks-btn');
    if (btn) btn.classList.add('active');

    document.querySelectorAll('.mobile-tab-btn').forEach(btn => btn.classList.remove('active'));
    const mobileBtn = document.getElementById(isReminders ? 'mobile-tab-reminders' : 'mobile-tab-bookmarks');
    if (mobileBtn) mobileBtn.classList.add('active');

    const floatingBtn = document.getElementById(isReminders ? 'floating-tab-reminders' : 'floating-tab-bookmarks');
    if (floatingBtn) floatingBtn.classList.add('active');
}

export function selectCategory(category, closeSidebarOnMobile = true) {
    if (isRenamingMainCategory || document.querySelector('.year-item.is-renaming')) {
        return;
    }

    if (state.currentView === 'bookmarks' && state.currentCategory === category) {
        if (closeSidebarOnMobile && state._cachedInnerWidth <= 768) {
            const sidebar = document.getElementById('sidebar');
            if (sidebar && sidebar.classList.contains('mobile-open')) toggleSidebar();
        }
        return;
    }

    if (closeSidebarOnMobile && state._cachedInnerWidth <= 768) {
        const sidebar = document.getElementById('sidebar');
        if (sidebar && sidebar.classList.contains('mobile-open')) toggleSidebar();
    }

    if (state.isSelectionMode) {
        exitSelectionMode(false);
    }

    clearChapterScrollSpy();
    stopReminderCountdownTimer();

    state.currentView = 'bookmarks';
    state.currentCategory = category;

    const selectionWrapper = document.getElementById('selection-wrapper') || document.querySelector('.sort-wrapper');
    if (selectionWrapper) selectionWrapper.style.display = 'block'; 
    document.querySelectorAll('.year-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.year-item[data-category]').forEach(el => {
        if (el.dataset.category === category) el.classList.add('active');
    });

    updateCollapsedIcons('bookmarks');

    renderBookmarks();
    updateFloatingCategoryTitle();

    const isEditorOpen = Boolean(
        document.getElementById('editor-modal')?.classList.contains('active') ||
        document.getElementById('full-editor-modal')?.classList.contains('active')
    );
    if (!isEditorOpen) {
        document.querySelector('main').scrollTo(0, 0);
    }
}

export function selectRemindersView(closeSidebarOnMobile = true) {
    if (isTransitionCategory(state.currentCategory)) {
        state.currentCategory = (state.previousCategory && !isTransitionCategory(state.previousCategory))
            ? state.previousCategory
            : (Object.keys(state.bookmarks).map(id => state.bookmarks[id].category).find(c => c && c !== '未分類' && !isTransitionCategory(c)) || '未分類');
    }

    if (state.currentView === 'reminders') {
        if (closeSidebarOnMobile && state._cachedInnerWidth <= 768) {
            const sidebar = document.getElementById('sidebar');
            if (sidebar && sidebar.classList.contains('mobile-open')) toggleSidebar();
        }
        return;
    }

    if (closeSidebarOnMobile && state._cachedInnerWidth <= 768) {
        const sidebar = document.getElementById('sidebar');
        if (sidebar && sidebar.classList.contains('mobile-open')) toggleSidebar();
    }

    if (state.isSelectionMode) {
        exitSelectionMode(false);
    }

    clearChapterScrollSpy();

    state.currentView = 'reminders';
    const selectionWrapper = document.getElementById('selection-wrapper') || document.getElementById('sort-wrapper');
    if (selectionWrapper) selectionWrapper.style.display = 'block'; 
    document.querySelectorAll('.year-item').forEach(el => el.classList.remove('active'));
    const navRemindersBtn = document.getElementById('nav-reminders-btn');
    if (navRemindersBtn) navRemindersBtn.classList.add('active');
    
    updateCollapsedIcons('reminders');

    updateSelectionBarUI();
    renderReminders();
    updateFloatingCategoryTitle();

    const isEditorOpen = Boolean(
        document.getElementById('editor-modal')?.classList.contains('active') ||
        document.getElementById('full-editor-modal')?.classList.contains('active')
    );
    if (!isEditorOpen) {
        document.querySelector('main').scrollTo(0, 0);
    }
}

// ==========================================
// 章節導航條（側邊章節與卡片快速跳轉）
// ==========================================
let currentChapterItems = [];
let chapterScrollListener = null;
let isClickScrolling = false;
let clickScrollTimer = null;
let smoothScrollRAF = null;

// 章節判定基準線（距離 main 頂部的像素）：ScrollSpy 與底部餘裕空間計算共用，確保兩者一致
function getChapterReferenceOffset() {
    return state._cachedInnerWidth <= 768 ? 100 : 120;
}

// 章節被點擊跳轉後，目標元素頂端預期停靠的位置（距離 main 頂部）
function getChapterDesiredTop(targetDOM, targetHeight, mainClientHeight) {
    const isMobile = state._cachedInnerWidth <= 768;
    const topOffset = isMobile ? 74 : 20;
    if (targetDOM.classList.contains('reminder-card') || targetDOM.classList.contains('note-card')) {
        return Math.max(topOffset, (mainClientHeight / 2) - (targetHeight / 2));
    }
    return topOffset;
}

// 動態計算底部餘裕：讓「最後一個章節」的頂端能滑動到判定基準線 / 跳轉停靠位置，
// 取代原本「滑到底部就強制啟用最後一個刻度」的補償判定
function updateChapterBottomSpace(items) {
    const mainEl = document.querySelector('main');
    const container = document.getElementById('content-container');
    if (!mainEl || !container) return;

    // 歸零量測會讓 scrollHeight 暫時縮小而夾住 scrollTop，因此先記下捲動位置，結束後還原
    const prevScrollTop = mainEl.scrollTop;
    container.style.removeProperty('--chapter-extra-space');

    if (!items || items.length === 0 || !shouldEnableChapterSpy()) return;

    let lastEl = null;
    for (let i = items.length - 1; i >= 0; i--) {
        const el = items[i].targetDOM;
        if (el && el.isConnected) { lastEl = el; break; }
    }
    if (!lastEl) return;

    const mainRect = mainEl.getBoundingClientRect();
    const lastRect = lastEl.getBoundingClientRect();
    const lastTopInScroll = (lastRect.top - mainRect.top) + mainEl.scrollTop;
    const spaceBelowLastTop = mainEl.scrollHeight - lastTopInScroll;

    // 最後章節頂端需要能抵達的位置：取「判定基準線」與「跳轉停靠位置」中較靠上者
    const reachTop = Math.min(
        getChapterReferenceOffset(),
        getChapterDesiredTop(lastEl, lastRect.height, mainEl.clientHeight)
    );
    const needed = mainEl.clientHeight - reachTop;
    const extra = Math.max(0, Math.ceil(needed - spaceBelowLastTop));

    if (extra > 0) container.style.setProperty('--chapter-extra-space', `${extra}px`);
    if (mainEl.scrollTop !== prevScrollTop) mainEl.scrollTop = prevScrollTop;
}

function resetChapterBottomSpace() {
    const container = document.getElementById('content-container');
    if (container) container.style.removeProperty('--chapter-extra-space');
}

let chapterSpaceResizeTimer = null;
window.addEventListener('resize', () => {
    clearTimeout(chapterSpaceResizeTimer);
    chapterSpaceResizeTimer = setTimeout(() => {
        if (currentChapterItems.length > 0) updateChapterBottomSpace(currentChapterItems);
    }, 120);
}, { passive: true });

function shouldEnableChapterSpy() {
    if (state.currentView === 'bookmarks') return true;
    if (state._cachedInnerWidth <= 768) return true;
    return false;
}

export function toggleChapterPopover(e) {
    if (e) e.stopPropagation();
    const rail = document.getElementById('chapter-nav-rail');
    const popover = document.getElementById('chapter-popover');
    if (!rail || !popover) return;

    if (popover.classList.contains('active')) {
        closeChapterPopover();
    } else {
        popover.style.top = '';
        popover.style.left = '';
        popover.style.bottom = '';
        popover.classList.add('active');
        rail.classList.add('active');
    }
}

export function closeChapterPopover() {
    const rail = document.getElementById('chapter-nav-rail');
    const popover = document.getElementById('chapter-popover');
    if (popover) popover.classList.remove('active');
    if (rail) rail.classList.remove('active');
}

export function syncFloatingCategoryByItem(item) {
    if (!item || (item.targetDOM && !item.targetDOM.isConnected)) return;
    let title = '';
    if (state.currentView === 'reminders') {
        title = item.label || item.group || (item.targetDOM?.classList.contains('is-done') ? '已結束' : '進行中');
    } else if (state.currentView === 'bookmarks') {
        title = item.label || state.currentCategory || '未分類';
    }
    if (title) {
        updateFloatingCategoryTitle(title);
    }
}

export function scrollToChapterTarget(targetDOM) {
    if (!targetDOM) {
        closeChapterPopover();
        return;
    }

    const mainEl = document.querySelector('main');
    if (!mainEl) {
        closeChapterPopover();
        return;
    }

    const targetIndex = currentChapterItems.findIndex(item => item.targetDOM === targetDOM);
    if (targetIndex !== -1) {
        highlightChapterTick(targetIndex);
        syncFloatingCategoryByItem(currentChapterItems[targetIndex]);
    }

    if (smoothScrollRAF) {
        cancelAnimationFrame(smoothScrollRAF);
        smoothScrollRAF = null;
    }
    clearTimeout(clickScrollTimer);
    isClickScrolling = true;
    document.body.classList.add('is-chapter-scrolling');

    // 移除殘留縮放及待進場 class，確保量測坐標為元素未變形的真實物理位置
    targetDOM.classList.remove('card-pending', 'title-scale-pop', 'reminder-card-pop');

    const mainRect = mainEl.getBoundingClientRect();
    const targetRect = targetDOM.getBoundingClientRect();
    const currentScrollTop = mainEl.scrollTop;
    const maxScroll = Math.max(0, mainEl.scrollHeight - mainEl.clientHeight);

    const desiredTop = getChapterDesiredTop(targetDOM, targetRect.height, mainEl.clientHeight);

    let initialDestination = currentScrollTop + (targetRect.top - mainRect.top) - desiredTop;
    const targetScrollTop = Math.min(maxScroll, Math.max(0, initialDestination));
    const distance = targetScrollTop - currentScrollTop;
    const isMobile = state._cachedInnerWidth <= 768;

    // 輕量化適中滑行時長，杜絕長距離過度拖延與高負載掉幀
    const duration = isMobile
        ? Math.min(480, Math.max(260, Math.abs(distance) * 0.16))
        : Math.min(420, Math.max(240, Math.abs(distance) * 0.13));
    const startTime = performance.now();

    // 採用單調遞減的純減速曲線，兼顧高響應速度與終點自然平滑停靠
    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

    const triggerTargetAnimation = () => {
        if (!targetDOM) return;
        if (targetDOM.classList.contains('reminder-card')) {
            targetDOM.classList.remove('reminder-card-pop');
            void targetDOM.offsetWidth;
            targetDOM.classList.add('reminder-card-pop');
            setTimeout(() => {
                targetDOM.classList.remove('reminder-card-pop');
            }, 600);
        } else {
            targetDOM.classList.remove('title-scale-pop');
            void targetDOM.offsetWidth;
            targetDOM.classList.add('title-scale-pop');
            setTimeout(() => {
                targetDOM.classList.remove('title-scale-pop');
            }, 550);
        }
    };

    if (Math.abs(distance) < 2) {
        mainEl.scrollTop = targetScrollTop;
        document.body.classList.remove('is-chapter-scrolling');
        isClickScrolling = false;
        triggerTargetAnimation();
        closeChapterPopover();
        return;
    }

    const stepScroll = (now) => {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / duration);
        const easedProgress = easeOutCubic(progress);

        // 純粹寫入滾動位移，迴圈中嚴禁讀取任何引發強制重繪（Forced Reflow）之幾何屬性
        mainEl.scrollTop = currentScrollTop + (distance * easedProgress);

        if (progress < 1) {
            smoothScrollRAF = requestAnimationFrame(stepScroll);
        } else {
            mainEl.scrollTop = targetScrollTop;
            smoothScrollRAF = null;
            document.body.classList.remove('is-chapter-scrolling');
            clickScrollTimer = setTimeout(() => {
                isClickScrolling = false;
            }, 100);
            triggerTargetAnimation();
        }
    };

    smoothScrollRAF = requestAnimationFrame(stepScroll);
    closeChapterPopover();
}

export function clearChapterScrollSpy(keepBottomSpace = false) {
    const mainEl = document.querySelector('main');
    if (chapterScrollListener && mainEl) {
        mainEl.removeEventListener('scroll', chapterScrollListener);
        chapterScrollListener = null;
    }
    if (smoothScrollRAF) {
        cancelAnimationFrame(smoothScrollRAF);
        smoothScrollRAF = null;
    }
    clearTimeout(clickScrollTimer);
    isClickScrolling = false;
    document.body.classList.remove('is-chapter-scrolling');
    currentChapterItems = [];
    if (!keepBottomSpace) resetChapterBottomSpace();
}

export function initChapterScrollSpy(items) {
    clearChapterScrollSpy(true);

    const mainEl = document.querySelector('main');
    currentChapterItems = items || [];

    if (!shouldEnableChapterSpy()) {
        resetChapterBottomSpace();
        document.querySelectorAll('.chapter-tick').forEach(tick => tick.classList.remove('active'));
        document.querySelectorAll('.chapter-item').forEach(item => item.classList.remove('active'));
        return;
    }

    if (!items || items.length === 0 || !mainEl) {
        resetChapterBottomSpace();
        return;
    }

    // 先預留足夠的底部滑動空間，再進行首次判定
    updateChapterBottomSpace(items);

    const updateSpy = () => {
        if (isClickScrolling || !shouldEnableChapterSpy()) return;
        if (currentChapterItems !== items) return;

        const mainRect = mainEl.getBoundingClientRect();
        const referenceLine = mainRect.top + getChapterReferenceOffset();
        
        let bestIndex = -1;

        for (let i = 0; i < items.length; i++) {
            const el = items[i].targetDOM;
            if (!el || !el.isConnected) continue;
            const rect = el.getBoundingClientRect();
            if (rect.top <= referenceLine) {
                bestIndex = i;
            } else {
                break;
            }
        }

        if (bestIndex === -1 && items.length > 0 && items[0].targetDOM?.isConnected) {
            bestIndex = 0;
        }

        if (bestIndex !== -1 && items[bestIndex]?.targetDOM?.isConnected) {
            highlightChapterTick(bestIndex);
            syncFloatingCategoryByItem(items[bestIndex]);
        }
    };

    chapterScrollListener = () => {
        window.requestAnimationFrame(updateSpy);
    };

    mainEl.addEventListener('scroll', chapterScrollListener, { passive: true });
    updateSpy();

    // 卡片進場動畫與字型載入可能在首次量測後才改變版面高度，下一個影格與稍後各補算一次
    requestAnimationFrame(() => {
        if (currentChapterItems !== items) return;
        updateChapterBottomSpace(items);
        updateSpy();
    });
    setTimeout(() => {
        if (currentChapterItems !== items) return;
        updateChapterBottomSpace(items);
    }, 600);
}

function highlightChapterTick(activeIndex) {
    if (!shouldEnableChapterSpy()) {
        document.querySelectorAll('.chapter-tick').forEach(tick => tick.classList.remove('active'));
        document.querySelectorAll('.chapter-item').forEach(item => item.classList.remove('active'));
        return;
    }

    document.querySelectorAll('.chapter-tick').forEach(tick => tick.classList.remove('active'));
    let activeTick = document.querySelector(`.chapter-tick[data-index="${activeIndex}"]`);
    
    if (!activeTick) {
        const allTicks = Array.from(document.querySelectorAll('.chapter-tick'));
        if (allTicks.length > 0) {
            activeTick = allTicks.reduce((prev, curr) => {
                const prevDiff = Math.abs(parseInt(prev.dataset.index, 10) - activeIndex);
                const currDiff = Math.abs(parseInt(curr.dataset.index, 10) - activeIndex);
                return currDiff < prevDiff ? curr : prev;
            });
        }
    }
    if (activeTick) activeTick.classList.add('active');

    document.querySelectorAll('.chapter-item').forEach(item => item.classList.remove('active'));
    const activePopItem = document.querySelector(`.chapter-item[data-index="${activeIndex}"]`);
    if (activePopItem) {
        activePopItem.classList.add('active');
        activePopItem.scrollIntoView({ block: 'nearest' });
    }
}

export function toggleSidebarDesktop() {
    hideCategoryPopoverMenu(true);
    if (state._cachedInnerWidth > 768) {
        document.getElementById('sidebar').classList.toggle('collapsed');
    } else {
        toggleSidebar(); 
    }
}

export function syncSidebarActiveState() {
    const isReminders = state.currentView === 'reminders';
    document.querySelectorAll('.year-item').forEach(el => {
        if (el.id === 'nav-reminders-btn') {
            el.classList.toggle('active', isReminders);
        } else if (el.dataset.category) {
            el.classList.toggle('active', !isReminders && el.dataset.category === state.currentCategory);
        }
    });
}

export function handleSidebarCategoryClick(category, itemEl) {
    if (itemEl && itemEl.classList.contains('is-renaming')) return;
    hideCategoryPopoverMenu(true);
    selectCategory(category, true);
}

export function handleSidebarRemindersClick(itemEl) {
    hideCategoryPopoverMenu(true);
    selectRemindersView(true);
}

export function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const mobileOverlay = document.getElementById('mobile-sidebar-overlay');
    
    if (state._cachedInnerWidth <= 768) {
        hideCategoryPopoverMenu(true);
        if (sidebar.classList.contains('mobile-open')) {
            sidebar.classList.remove('mobile-open');
            mobileOverlay.classList.remove('active');
            syncSidebarActiveState();
        } else {
            syncSidebarActiveState();
            sidebar.classList.add('mobile-open');
            mobileOverlay.classList.add('active');
        }
    }
}

export function expandSidebarForBookmarks() {
    if (state.currentView !== 'bookmarks') {
        const cat = state.currentCategory || '未分類';
        selectCategory(cat);
    }
    const sidebar = document.getElementById('sidebar');
    if (sidebar.classList.contains('collapsed')) {
        toggleSidebarDesktop();
    }
}

export function handleBookmarksNavClick() {
    if (state._cachedInnerWidth <= 768) {
        const validCategoriesSet = new Set();
        Object.values(state.bookmarks || {}).forEach(bm => {
            if (bm && bm.category && typeof bm.category === 'string') {
                const cat = bm.category.trim();
                if (cat !== '' && cat !== '未分類' && !isTransitionCategory(cat)) {
                    validCategoriesSet.add(cat);
                }
            }
        });

        const savedCatOrder = safeJSONParse(localStorage.getItem('my_category_order'), []);
        const sortedCategories = Array.from(validCategoriesSet).sort((a, b) => {
            let idxA = savedCatOrder.indexOf(a);
            let idxB = savedCatOrder.indexOf(b);
            if (idxA === -1 && idxB === -1) return a.localeCompare(b);
            if (idxA === -1) return 1;
            if (idxB === -1) return -1;
            return idxA - idxB;
        });

        if (state.currentView !== 'bookmarks') {
            const targetCat = sortedCategories.length > 0 ? sortedCategories[0] : '未分類';
            selectCategory(targetCat, false);
            document.querySelector('main')?.scrollTo(0, 0);
        } else {
            if (sortedCategories.length === 0) {
                if (state.currentCategory !== '未分類') {
                    selectCategory('未分類', false);
                }
                document.querySelector('main')?.scrollTo(0, 0);
            } else {
                const currentIndex = sortedCategories.indexOf(state.currentCategory);
                let nextIndex = 0;
                if (currentIndex !== -1) {
                    nextIndex = (currentIndex + 1) % sortedCategories.length;
                }
                const nextCategory = sortedCategories[nextIndex];
                selectCategory(nextCategory, false);
                document.querySelector('main')?.scrollTo(0, 0);
            }
        }
    } else {
        expandSidebarForBookmarks();
    }
}

export function setVisualEffects(isOn) {
    const body = document.body;
    const isEnabled = Boolean(isOn);

    if (isEnabled) {
        body.removeAttribute('data-no-glass');
        localStorage.setItem('visual_effects', 'true');
    } else {
        body.setAttribute('data-no-glass', 'true');
        localStorage.setItem('visual_effects', 'false');
    }
    updateVisualEffectsSegment(isEnabled);
}

function resetFabStateClean(mainBtn) {
    clearTimeout(state.fabIdleTimer);
    state.isFabTucked = false;
    hideToast(true);
    if (mainBtn) {
        mainBtn.classList.remove('tucked', 'toast-mode', 'icon-zoom-out', 'icon-zoom-in');
        mainBtn.style.width = '';
        const iconWrapper = mainBtn.querySelector('.fab-icon-wrapper');
        if (iconWrapper) {
            iconWrapper.style.opacity = '';
            iconWrapper.style.transform = '';
        }
        const toastText = mainBtn.querySelector('.fab-toast-text');
        if (toastText) {
            toastText.style.opacity = '0';
            toastText.textContent = '';
        }
    }
}

export function toggleSelectionMode() {
    if (state.currentView !== 'reminders' && state.currentView !== 'bookmarks') return;
    state.isSelectionMode = !state.isSelectionMode;
    const mainBtn = document.querySelector('.fab-main-btn');
    resetFabStateClean(mainBtn);

    if (!state.isSelectionMode) {
        if (state.selectedReminderIds) state.selectedReminderIds.clear();
        if (state.selectedBookmarkIds) state.selectedBookmarkIds.clear();
        if (state.selectedSubCategories) state.selectedSubCategories.clear();
        state.isMoveSelectionActive = false;
        state.moveTargetType = null;
        document.body.classList.remove('selection-mode-active');
        resetFabIdleTimer();
    } else {
        clearSearch();
        document.body.classList.add('selection-mode-active');
    }
    updateSelectionBarUI();
    if (state.currentView === 'bookmarks') {
        renderBookmarks();
    } else {
        renderReminders();
    }
}

export function exitSelectionMode(shouldRender = true) {
    state.isSelectionMode = false;
    if (state.selectedReminderIds) state.selectedReminderIds.clear();
    if (state.selectedBookmarkIds) state.selectedBookmarkIds.clear();
    if (state.selectedSubCategories) state.selectedSubCategories.clear();
    state.isMoveSelectionActive = false;
    state.moveTargetType = null;
    document.body.classList.remove('selection-mode-active');
    const mainBtn = document.querySelector('.fab-main-btn');
    resetFabStateClean(mainBtn);
    resetFabIdleTimer();
    updateSelectionBarUI();
    if (shouldRender) {
        if (state.currentView === 'reminders') {
            renderReminders();
        } else if (state.currentView === 'bookmarks') {
            renderBookmarks();
        }
    }
}

export function toggleSubCategorySelection(subCategoryName, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    if (!state.isSelectionMode || !subCategoryName) return;
    if (state.selectedBookmarkIds && state.selectedBookmarkIds.size > 0) return;

    if (!state.selectedSubCategories) {
        state.selectedSubCategories = new Set();
    }

    if (state.selectedSubCategories.has(subCategoryName)) {
        state.selectedSubCategories.delete(subCategoryName);
    } else {
        state.selectedSubCategories.add(subCategoryName);
    }

    updateSelectionBarUI();
    renderBookmarks();
}

export function toggleBookmarkCardSelection(id, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    if (!state.isSelectionMode || !id) return;
    if (state.selectedSubCategories && state.selectedSubCategories.size > 0) return;

    if (!state.selectedBookmarkIds) {
        state.selectedBookmarkIds = new Set();
    }

    const hadCards = state.selectedBookmarkIds.size > 0;
    if (state.selectedBookmarkIds.has(id)) {
        state.selectedBookmarkIds.delete(id);
    } else {
        state.selectedBookmarkIds.add(id);
    }
    const hasCardsNow = state.selectedBookmarkIds.size > 0;

    const card = document.querySelector(`.note-card[data-id="${id}"]`);
    if (card) {
        const isSelected = state.selectedBookmarkIds.has(id);
        card.classList.toggle('is-selected', isSelected);
    }

    updateSelectionBarUI();
    if (hadCards !== hasCardsNow) {
        renderBookmarks();
    }
}

export function toggleReminderCardSelection(id, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    if (!state.isSelectionMode || !id) return;

    if (!state.selectedReminderIds) {
        state.selectedReminderIds = new Set();
    }

    if (state.selectedReminderIds.has(id)) {
        state.selectedReminderIds.delete(id);
    } else {
        state.selectedReminderIds.add(id);
    }

    const card = document.querySelector(`.reminder-card[data-id="${id}"]`);
    if (card) {
        const isSelected = state.selectedReminderIds.has(id);
        card.classList.toggle('is-selected', isSelected);
    }

    updateSelectionBarUI();
}

export function triggerBatchDeleteReminders() {
    if (!state.isSelectionMode) return;
    const isBookmarks = state.currentView === 'bookmarks';
    const subCount = state.selectedSubCategories ? state.selectedSubCategories.size : 0;
    const cardCount = isBookmarks ? (state.selectedBookmarkIds?.size || 0) : (state.selectedReminderIds?.size || 0);
    if (cardCount === 0 && subCount === 0) return;

    if (isBookmarks && subCount > 0) {
        state.deleteTargetType = 'batch-subcategories';
    } else {
        state.deleteTargetType = isBookmarks ? 'batch-bookmarks' : 'batch-reminders';
    }

    const overlay = document.getElementById('confirm-overlay');
    const modal = document.getElementById('confirm-modal');
    const titleEl = modal.querySelector('h2');
    const descEl = modal.querySelector('p');

    if (titleEl) titleEl.innerText = '確定要刪除？';
    if (descEl) descEl.innerText = '刪除後將無法復原資料。';

    overlay.style.display = 'block';
    modal.style.display = 'block';
    requestAnimationFrame(() => requestAnimationFrame(() => {
        overlay.classList.add('active');
        modal.classList.add('active');
    }));
}

export function toggleReminderModalDone() {
    state.tempReminderIsDone = !state.tempReminderIsDone;
    const btn = document.getElementById('reminder-modal-done-btn');
    if (btn) {
        btn.classList.toggle('checked', state.tempReminderIsDone);
    }
}

// ==========================================
// Modal 開關邏輯
// ==========================================
export function getItemBaselineTimestamp(item) {
    if (!item) return 0;
    if (typeof item.updatedAt === 'number' && !Number.isNaN(item.updatedAt) && item.updatedAt > 0) {
        return item.updatedAt;
    }
    if (item.timestamp && typeof item.timestamp === 'string') {
        const cleaned = item.timestamp.replace(/\(.*?\)/g, '').trim().replace(/\//g, '-');
        const parsed = Date.parse(cleaned);
        if (!Number.isNaN(parsed)) return parsed;
    }
    return 0;
}

// 編輯器關閉後 250ms 的收尾定時器；若在這段期間又開啟新編輯器，必須取消，避免舊回呼抹除新狀態
let closeEditorTimer = null;

export function openBookmarkEditor(id = null, forcedType = null) {
    if (closeEditorTimer) {
        clearTimeout(closeEditorTimer);
        closeEditorTimer = null;
    }

    // 編輯既有紀錄時依資料本身決定型別；在資料儲存分頁新增時預設鎖定為「內容（note）」
    const existingRecord = id ? state.bookmarks[id] : null;
    const editorType = existingRecord
        ? (isNoteRecord(existingRecord) ? 'note' : 'bookmark')
        : (forcedType || 'note');
    state.currentUnifiedType = editorType;
    state.currentEditingBookmarkId = id;
    state.editingBaselineUpdatedAt = id && state.bookmarks[id] ? getItemBaselineTimestamp(state.bookmarks[id]) : Date.now();
    state.hasEditConflict = false;
    state.pendingSyncItems = null;

    // 判斷是否為在資料儲存的具體分類中觸發新增
    const isNew = !id;
    const isFromBookmarkCategory = isNew && state.currentView === 'bookmarks' && state.currentCategory && !isTransitionCategory(state.currentCategory);

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

    const overlay = document.getElementById('modal-overlay');
    const modal = document.getElementById('editor-modal');
    const titleEl = document.getElementById('editor-modal-title');
    const typeSelector = document.getElementById('unified-type-selector');
    const deleteBtn = document.getElementById('btn-delete-unified');
    const reminderDoneBtn = document.getElementById('reminder-modal-done-btn');

    switchEditorModalTab('create', false);

    if (typeSelector) {
        typeSelector.style.display = id ? 'none' : 'flex';
        applyTypeSelectorState(editorType);
    }

    if (reminderDoneBtn) reminderDoneBtn.style.display = 'none';
    document.getElementById('bookmark-form-container').style.display = 'flex';
    const reminderContainer = document.getElementById('reminder-form-container');
    if (reminderContainer) reminderContainer.style.display = 'none';

    document.getElementById('editor-modal').scrollTop = 0;

    modal.classList.remove('shake-animation');
    overlay.style.display = 'block';
    modal.style.display = 'block';
    requestAnimationFrame(() => requestAnimationFrame(() => {
        overlay.classList.add('active');
        modal.classList.add('active');
        if (!id) {
            openEditorSwitchBar();
        } else {
            closeEditorSwitchBar();
        }
    }));

    if (id && state.bookmarks[id]) {
        titleEl.innerText = editorType === 'note' ? '編輯內容' : '編輯網址';
        const bm = state.bookmarks[id];
        document.getElementById('bookmark-id-val').value = id;
        document.getElementById('bookmark-title').value = bm.title || '';
        document.getElementById('bookmark-url').value = bm.url || '';
        const existingCat = (!bm.category || bm.category === '未分類') ? '' : bm.category;
        const existingSubCat = bm.subCategory || '';
        document.getElementById('bookmark-category').value = existingCat;
        const subCatInput = document.getElementById('bookmark-sub-category');
        if (subCatInput) subCatInput.value = existingSubCat;
        updateBookmarkCategoryDisplayUI(existingCat, existingSubCat);
        document.getElementById('bookmark-desc').value = bm.description || '';
        state.tempBookmarkTitle = bm.title || '';
        state.tempBookmarkContent = bm.content || '';

        applyBookmarkFormType(editorType);

        deleteBtn.style.display = 'flex';
    } else {
        titleEl.innerText = editorType === 'note' ? '新增內容' : '新增網址';
        document.getElementById('bookmark-id-val').value = '';
        document.getElementById('bookmark-title').value = '';
        document.getElementById('bookmark-url').value = '';

        // 若已在所在分類則直接顯示於輸入框；若在提醒分頁則重置為空
        let defaultCat = '';
        if (isFromBookmarkCategory) {
            defaultCat = state.currentCategory === '未分類' ? '' : state.currentCategory;
            document.getElementById('bookmark-category').value = defaultCat;
        } else {
            document.getElementById('bookmark-category').value = '';
        }

        const subCatInput = document.getElementById('bookmark-sub-category');
        if (subCatInput) subCatInput.value = '';
        updateBookmarkCategoryDisplayUI(defaultCat, '');
        document.getElementById('bookmark-desc').value = '';
        const bookmarkContentEl = document.getElementById('bookmark-content');
        if (bookmarkContentEl) bookmarkContentEl.innerHTML = '';
        state.tempBookmarkTitle = '';
        state.tempBookmarkContent = '';
        applyBookmarkFormType(editorType);

        deleteBtn.style.display = 'none';
    }
}

export function openReminderEditor(id = null) {
    if (closeEditorTimer) {
        clearTimeout(closeEditorTimer);
        closeEditorTimer = null;
    }

    state.currentUnifiedType = 'reminder';
    state.currentEditingReminderId = id;
    state.editingBaselineUpdatedAt = id && state.reminders[id] ? getItemBaselineTimestamp(state.reminders[id]) : Date.now();
    state.hasEditConflict = false;
    state.pendingSyncItems = null;

    if (!id) {
        state.previousView = state.currentView;
        state.previousCategory = state.currentCategory;
    }

    switchEditorModalTab('create', false);

    const overlay = document.getElementById('modal-overlay');
    const modal = document.getElementById('editor-modal');
    const titleEl = document.getElementById('editor-modal-title');
    const typeSelector = document.getElementById('unified-type-selector');
    const deleteBtn = document.getElementById('btn-delete-unified');
    const reminderDoneBtn = document.getElementById('reminder-modal-done-btn');

    if (typeSelector) {
        typeSelector.style.display = id ? 'none' : 'flex';
        applyTypeSelectorState('reminder');
    }

    document.getElementById('bookmark-form-container').style.display = 'none';
    const reminderContainer = document.getElementById('reminder-form-container');
    if (reminderContainer) reminderContainer.style.display = 'flex';

    document.getElementById('editor-modal').scrollTop = 0;

    modal.classList.remove('shake-animation');
    overlay.style.display = 'block';
    modal.style.display = 'block';
    requestAnimationFrame(() => requestAnimationFrame(() => {
        overlay.classList.add('active');
        modal.classList.add('active');
        if (!id) {
            openEditorSwitchBar();
        } else {
            closeEditorSwitchBar();
        }
    }));

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    if (id && state.reminders[id]) {
        titleEl.innerText = '編輯提醒';
        const r = state.reminders[id];
        const rId = document.getElementById('reminder-id-val');
        const rDateVal = document.getElementById('reminder-date-val');
        const rStartDateVal = document.getElementById('reminder-start-date-val');
        const rEndDateVal = document.getElementById('reminder-end-date-val');

        state.tempReminderIsDone = !!r.isDone;
        if (reminderDoneBtn) {
            reminderDoneBtn.style.display = 'flex';
            reminderDoneBtn.classList.toggle('checked', state.tempReminderIsDone);
        }

        if (rId) rId.value = id;

        let parsedStartDate = r.startDate || '';
        let parsedEndDate = r.endDate || '';
        let parsedStartTime = r.startTime || '';
        let parsedEndTime = r.endTime || '';

        if (!parsedStartDate && r.date) {
            const raw = r.date.trim();
            if (raw.includes('~')) {
                const sides = raw.split('~').map(s => s.trim());
                const leftMatch = sides[0].match(/(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?/);
                if (leftMatch) {
                    parsedStartDate = leftMatch[1];
                    if (leftMatch[2]) parsedStartTime = leftMatch[2];
                }
                const rightMatch = sides[1].match(/(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?/);
                if (rightMatch) {
                    parsedEndDate = rightMatch[1];
                    if (rightMatch[2]) parsedEndTime = rightMatch[2];
                } else {
                    const timeOnlyMatch = sides[1].match(/(\d{1,2}:\d{2})/);
                    if (timeOnlyMatch) {
                        parsedEndDate = parsedStartDate;
                        parsedEndTime = timeOnlyMatch[1];
                    }
                }
            } else {
                const singleMatch = raw.match(/(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?/);
                if (singleMatch) {
                    parsedStartDate = singleMatch[1];
                    parsedEndDate = singleMatch[1];
                    if (singleMatch[2]) parsedStartTime = singleMatch[2];
                }
            }
        }

        if (!parsedStartDate) parsedStartDate = todayStr;
        if (!parsedEndDate) parsedEndDate = parsedStartDate;

        state.tempSelectedReminderStartDate = parsedStartDate;
        state.tempSelectedReminderEndDate = parsedEndDate;
        state.tempSelectedReminderDate = parsedStartDate;

        if (parsedStartTime) {
            const [sh, sm] = parsedStartTime.split(':').map(n => parseInt(n, 10));
            state.timeWheelStartHour = isNaN(sh) ? 12 : sh;
            state.timeWheelStartMinute = isNaN(sm) ? 0 : sm;
            state.isReminderStartTimeAdjusted = true;
        } else {
            state.isReminderStartTimeAdjusted = false;
        }

        if (parsedEndTime) {
            const [eh, em] = parsedEndTime.split(':').map(n => parseInt(n, 10));
            state.timeWheelEndHour = isNaN(eh) ? 18 : eh;
            state.timeWheelEndMinute = isNaN(em) ? 0 : em;
            state.isReminderEndTimeAdjusted = true;
        } else {
            state.isReminderEndTimeAdjusted = false;
        }


        const setDate = r.date || todayStr;
        if (rDateVal) rDateVal.value = setDate;
        if (rStartDateVal) rStartDateVal.value = parsedStartDate;
        if (rEndDateVal) rEndDateVal.value = parsedEndDate;

        state.tempReminderTitle = r.title || '';
        state.tempReminderContent = r.content || '';
        updateReminderPreviewDisplay();

        const parts = parsedStartDate.split('-');
        state.calDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));

        deleteBtn.style.display = 'flex';
    } else {
        titleEl.innerText = '新增提醒';
        state.tempReminderIsDone = false;
        if (reminderDoneBtn) {
            reminderDoneBtn.style.display = 'none';
            reminderDoneBtn.classList.remove('checked');
        }

        const rId = document.getElementById('reminder-id-val');
        const rDateVal = document.getElementById('reminder-date-val');
        const rStartDateVal = document.getElementById('reminder-start-date-val');
        const rEndDateVal = document.getElementById('reminder-end-date-val');

        if (rId) rId.value = '';
        if (rDateVal) rDateVal.value = todayStr;
        if (rStartDateVal) rStartDateVal.value = todayStr;
        if (rEndDateVal) rEndDateVal.value = todayStr;

        state.tempSelectedReminderStartDate = todayStr;
        state.tempSelectedReminderEndDate = todayStr;
        state.tempSelectedReminderDate = todayStr;
        state.isReminderStartTimeAdjusted = false;
        state.isReminderEndTimeAdjusted = false;
        state.timeWheelStartHour = today.getHours();
        state.timeWheelStartMinute = today.getMinutes();
        state.timeWheelEndHour = Math.min(23, today.getHours() + 1);
        state.timeWheelEndMinute = today.getMinutes();

        state.tempReminderTitle = '';
        state.tempReminderContent = '';
        updateReminderPreviewDisplay();
        state.calDate = new Date();

        document.getElementById('bookmark-id-val').value = '';
        document.getElementById('bookmark-title').value = '';
        document.getElementById('bookmark-url').value = '';
        document.getElementById('bookmark-category').value = '';
        const subCatInput = document.getElementById('bookmark-sub-category');
        if (subCatInput) subCatInput.value = '';
        document.getElementById('bookmark-desc').value = '';
        const bookmarkContentEl = document.getElementById('bookmark-content');
        if (bookmarkContentEl) bookmarkContentEl.innerHTML = '';
        state.tempBookmarkTitle = '';
        state.tempBookmarkContent = '';

        deleteBtn.style.display = 'none';
    }
}

export function closeAllEditors() {
    const fullModal = document.getElementById('full-editor-modal');
    if (fullModal && fullModal.classList.contains('active')) {
        closeFullEditor();
        return; 
    }
    if (document.activeElement) document.activeElement.blur();
    window.getSelection().removeAllRanges();

    closeEditorSwitchBar();
    closeSortModal();

    const overlay = document.getElementById('modal-overlay');
    const modals = [document.getElementById('editor-modal'), document.getElementById('sort-modal')];
    const reminderDoneBtn = document.getElementById('reminder-modal-done-btn');
    if (reminderDoneBtn) {
        reminderDoneBtn.style.display = 'none';
        reminderDoneBtn.classList.remove('checked');
    }
    
    overlay.classList.remove('active');
    modals.forEach(m => {
        if (!m) return;
        m.classList.remove('active');
        m.style.opacity = '';
        m.style.pointerEvents = '';
    });
    closeCalendar();
    
    const toolbar = document.getElementById('text-toolbar');
    if (toolbar) toolbar.classList.remove('active');

    state.tempBookmarkTitle = '';
    state.tempBookmarkContent = '';
    state.tempReminderTitle = '';
    state.tempReminderContent = '';
    state.tempReminderIsDone = false;
    state.tempSelectedReminderStartDate = '';
    state.tempSelectedReminderEndDate = '';
    state.tempSelectedReminderDate = '';
    state.isCalendarDateDragging = false;
    state.calendarDragAnchorDate = '';
    state.calendarDragHoverDate = '';
    state.calendarCrossMonthAnchorDate = '';
    state.isReminderStartTimeAdjusted = false;
    state.isReminderEndTimeAdjusted = false;

    const fullNoteContentEl = document.getElementById('full-note-content');
    if (fullNoteContentEl) fullNoteContentEl.innerHTML = '';
    const bookmarkContentEl = document.getElementById('bookmark-content');
    if (bookmarkContentEl) bookmarkContentEl.innerHTML = '';
    const reminderContentEl = document.getElementById('reminder-content');
    if (reminderContentEl) reminderContentEl.innerHTML = '';
    const fullReminderTitleInput = document.getElementById('full-reminder-title-input');
    if (fullReminderTitleInput) fullReminderTitleInput.value = '';
    const bmTitleEl = document.getElementById('bookmark-title');
    if (bmTitleEl) bmTitleEl.value = '';
    const bmUrlEl = document.getElementById('bookmark-url');
    if (bmUrlEl) bmUrlEl.value = '';
    const bmCatEl = document.getElementById('bookmark-category');
    if (bmCatEl) bmCatEl.value = '';
    const bmSubCatEl = document.getElementById('bookmark-sub-category');
    if (bmSubCatEl) bmSubCatEl.value = '';
    updateBookmarkCategoryDisplayUI('', '');
    const bmDescEl = document.getElementById('bookmark-desc');
    if (bmDescEl) bmDescEl.value = '';

    // 取消退出新增時，自動還原回原本所在的分類分頁或提醒分頁
    const prevViewToRestore = state.previousView;
    const prevCatToRestore = state.previousCategory;
    const wasEditingExistingReminder = Boolean(state.currentEditingReminderId);
    const wasEditingExistingBookmark = Boolean(state.currentEditingBookmarkId);
    state.previousView = null;
    state.previousCategory = null;

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
        overlay.style.display = 'none';
        modals.forEach(m => { if (m) m.style.display = 'none'; });

        if (state.pendingSyncItems) {
            if (state.pendingSyncItems.bookmark) {
                const { id, data, isDeleted } = state.pendingSyncItems.bookmark;
                if (isDeleted) {
                    delete state.bookmarks[id];
                    await StorageAPI.deleteItem('bookmarks', id);
                } else if (data) {
                    state.bookmarks[id] = data;
                    await StorageAPI.saveItem('bookmarks', id, data);
                }
            }
            if (state.pendingSyncItems.reminder) {
                const { id, data, isDeleted } = state.pendingSyncItems.reminder;
                if (isDeleted) {
                    delete state.reminders[id];
                    await StorageAPI.deleteItem('reminders', id);
                } else if (data) {
                    state.reminders[id] = data;
                    await StorageAPI.saveItem('reminders', id, data);
                }
            }
            state.pendingSyncItems = null;
            state.hasPendingSyncRender = true;
        }

        state.currentEditingBookmarkId = null;
        state.currentEditingReminderId = null;
        state.editingBaselineUpdatedAt = 0;
        state.hasEditConflict = false;

        if (state.hasPendingSyncRender) {
            state.hasPendingSyncRender = false;
            renderSidebar();
        }
    }, 250);
}

export function openSettingsModal() {
    updateVisualEffectsSegment();
    updateGoogleAccountUIState();
    const overlay = document.getElementById('confirm-overlay'); 
    const modal = document.getElementById('settings-modal');
    overlay.style.display = 'block';
    modal.style.display = 'block';
    requestAnimationFrame(() => requestAnimationFrame(() => {
        overlay.classList.add('active');
        modal.classList.add('active');
    }));
    if (state._cachedInnerWidth <= 768) {
        const sidebar = document.getElementById('sidebar');
        if (sidebar.classList.contains('mobile-open')) toggleSidebar();
    }
}

export function closeSettingsModal() {
    if (document.activeElement) document.activeElement.blur();
    const overlay = document.getElementById('confirm-overlay');
    const modal = document.getElementById('settings-modal');
    modal.classList.remove('active');
    overlay.classList.remove('active');
    setTimeout(() => {
        modal.style.display = 'none';
        overlay.style.display = 'none';
    }, 250);
}

export function updateGoogleAccountUIState() {
    const isLinked = isGoogleLinked();
    const isValid = isTokenValid();
    const statusText = document.getElementById('google-auth-status-text');
    const loginBtnText = document.getElementById('google-login-btn-text');
    const logoutBtn = document.getElementById('google-logout-btn');
    const dot = document.getElementById('sync-modal-status-dot');

    if (isLinked && isValid) {
        // 狀態 1：已連線（Connected）
        if (statusText) {
            statusText.textContent = '已連接 Google 雲端';
            statusText.className = 'google-auth-status-badge connected';
        }
        if (loginBtnText) {
            loginBtnText.textContent = '切換 Google 帳號';
        }
        if (logoutBtn) {
            logoutBtn.textContent = '登出';
            logoutBtn.style.display = 'inline-flex';
        }
        if (dot) {
            dot.classList.remove('red', 'gray');
            dot.classList.add('primary');
        }
    } else if (isLinked && !isValid) {
        // 狀態 2：授權已過期 / 需重新驗證（Expired / Needs Reauth）
        if (statusText) {
            statusText.textContent = '授權已過期';
            statusText.className = 'google-auth-status-badge expired';
        }
        if (loginBtnText) {
            loginBtnText.textContent = '重新驗證 Google 帳號';
        }
        if (logoutBtn) {
            logoutBtn.textContent = '登出';
            logoutBtn.style.display = 'inline-flex';
        }
        if (dot) {
            dot.classList.remove('primary', 'red');
            dot.classList.add('gray');
        }
    } else {
        // 狀態 3：未連接（Disconnected）
        if (statusText) {
            statusText.textContent = '未連接';
            statusText.className = 'google-auth-status-badge';
        }
        if (loginBtnText) {
            loginBtnText.textContent = '登入 Google 帳號';
        }
        if (logoutBtn) {
            logoutBtn.style.display = 'none';
        }
        if (dot) {
            dot.classList.remove('primary', 'red');
            dot.classList.add('gray');
        }
    }
}

export function openCloudAlert() {
    const overlay = document.getElementById('confirm-overlay');
    const modal = document.getElementById('cloud-alert-modal');
    const settingsModal = document.getElementById('settings-modal');
    if (settingsModal && settingsModal.classList.contains('active')) {
        settingsModal.classList.remove('active');
        setTimeout(() => settingsModal.style.display = 'none', 0);
    }
    overlay.style.display = 'block';
    modal.style.display = 'block';
    requestAnimationFrame(() => requestAnimationFrame(() => {
        overlay.classList.add('active');
        modal.classList.add('active');
    }));
}

export function closeCloudAlert() {
    if (document.activeElement) document.activeElement.blur();
    const overlay = document.getElementById('confirm-overlay');
    const modal = document.getElementById('cloud-alert-modal');
    modal.classList.remove('active');
    overlay.classList.remove('active');
    setTimeout(() => {
        modal.style.display = 'none';
        overlay.style.display = 'none';
    }, 250);
}

export function returnFromCloudAlert() {
    const alertModal = document.getElementById('cloud-alert-modal');
    alertModal.classList.remove('active');
    setTimeout(() => {
        alertModal.style.display = 'none';
        openSettingsModal();
    }, 250);
}

let isRenamingMainCategory = false;
let currentCategoryMenuContext = null;

export function showCategoryPopoverMenu(e, category, textEl, btnEl, itemEl) {
    e.stopPropagation();
    e.preventDefault();

    const menu = document.getElementById('category-popover-menu');
    if (!menu) return;

    if (menu.classList.contains('active') && currentCategoryMenuContext?.category === category) {
        hideCategoryPopoverMenu();
        return;
    }

    currentCategoryMenuContext = { category, textEl, btnEl, itemEl };

    menu.style.display = 'block';

    const menuWidth = menu.offsetWidth || 140;
    const menuHeight = menu.offsetHeight || 44;

    // 取得分類框本體外緣矩形以達成與分類框對齊
    const itemRect = itemEl ? itemEl.getBoundingClientRect() : btnEl.getBoundingClientRect();

    let left = itemRect.right - menuWidth;
    let top = itemRect.bottom + 4;

    if (left < 10) left = 10;
    if (left + menuWidth > window.innerWidth - 10) {
        left = window.innerWidth - menuWidth - 10;
    }
    if (top + menuHeight > window.innerHeight - 10) {
        top = itemRect.top - menuHeight - 4;
    }

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    requestAnimationFrame(() => {
        menu.classList.add('active');
    });
}

export function hideCategoryPopoverMenu(immediate = false) {
    const menu = document.getElementById('category-popover-menu');
    if (!menu || !menu.classList.contains('active')) {
        if (menu && immediate) {
            menu.style.display = 'none';
        }
        return;
    }
    menu.classList.remove('active');
    if (immediate) {
        menu.style.display = 'none';
    } else {
        setTimeout(() => {
            if (!menu.classList.contains('active')) {
                menu.style.display = 'none';
            }
        }, 150);
    }
}

export function triggerCategoryRenameFromMenu(e) {
    const evt = e || window.event;
    if (evt && typeof evt.stopPropagation === 'function') {
        evt.stopPropagation();
    }
    if (!currentCategoryMenuContext) return;
    const { category, textEl, btnEl, itemEl } = currentCategoryMenuContext;
    hideCategoryPopoverMenu();
    startInlineRenameMainCategory(category, textEl, btnEl, itemEl);
}

export function startInlineRenameMainCategory(oldCategory, textEl, btnEl, itemEl) {
    if (!oldCategory || oldCategory === '未分類') return;
    if (!textEl || isRenamingMainCategory) return;

    isRenamingMainCategory = true;
    const originalName = oldCategory;
    textEl.contentEditable = 'true';
    if (btnEl) btnEl.style.display = 'none';
    if (itemEl) itemEl.classList.add('is-renaming');

    textEl.focus();
    const range = document.createRange();
    range.selectNodeContents(textEl);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    let isFinished = false;

    const finish = (commit) => {
        if (isFinished) return;
        isFinished = true;
        isRenamingMainCategory = false;

        textEl.contentEditable = 'false';
        if (btnEl) btnEl.style.display = 'flex';
        if (itemEl) itemEl.classList.remove('is-renaming');
        textEl.removeEventListener('keydown', onKeyDown);
        textEl.removeEventListener('blur', onBlur);
        textEl.removeEventListener('paste', onPaste);

        if (!commit) {
            textEl.innerText = originalName;
            return;
        }

        const newName = (textEl.innerText || '').trim();
        if (!newName || newName === originalName || newName === '未分類') {
            textEl.innerText = originalName;
            return;
        }

        commitCategoryRename(newName, originalName);
    };

    const onKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            finish(true);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            finish(false);
        }
    };

    const onBlur = () => {
        finish(true);
    };

    const onPaste = (e) => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text/plain').replace(/[\r\n]+/g, ' ').trim();
        document.execCommand('insertText', false, text);
    };

    textEl.addEventListener('keydown', onKeyDown);
    textEl.addEventListener('blur', onBlur);
    textEl.addEventListener('paste', onPaste);
}

function commitCategoryRename(newCategory, oldCategory) {
    const now = Date.now();
    Object.keys(state.bookmarks).forEach(id => {
        if (state.bookmarks[id].category === oldCategory) {
            state.bookmarks[id].category = newCategory;
            state.bookmarks[id].updatedAt = now;
            StorageAPI.saveItem('bookmarks', id, state.bookmarks[id]);
        }
    });

    let savedCatOrder = safeJSONParse(localStorage.getItem('my_category_order'), []);
    const index = savedCatOrder.indexOf(oldCategory);
    if (index !== -1) {
        savedCatOrder[index] = newCategory;
    } else {
        savedCatOrder.push(newCategory);
    }
    savedCatOrder = Array.from(new Set(savedCatOrder)).filter(c => typeof c === 'string' && c.trim() !== '' && c.trim() !== '未分類');
    localStorage.setItem('my_category_order', JSON.stringify(savedCatOrder));
    localStorage.setItem('my_category_order_updatedAt', now.toString());

    const subcategoryOrdersMap = safeJSONParse(localStorage.getItem('my_subcategory_order'), {});
    if (subcategoryOrdersMap[oldCategory]) {
        subcategoryOrdersMap[newCategory] = subcategoryOrdersMap[oldCategory];
        delete subcategoryOrdersMap[oldCategory];
        localStorage.setItem('my_subcategory_order', JSON.stringify(subcategoryOrdersMap));
        localStorage.setItem('my_subcategory_order_updatedAt', now.toString());
    }

    if (state.currentCategory === oldCategory) {
        state.currentCategory = newCategory;
    }

    localStorage.setItem(PENDING_SYNC_FLAG, 'true');
    notifyCrossTabChange({ type: 'DATA_CHANGED' });

    renderSidebar();

    setTimeout(() => {
        showCloudToast('分類已重新命名');
        uploadToDrive(true);
    }, 250);
}

export function openCategorySubCategoryModal() {
    const curCatInput = document.getElementById('bookmark-category');
    const curSubCatInput = document.getElementById('bookmark-sub-category');
    const curCat = curCatInput ? curCatInput.value.trim() : '';
    const curSubCat = curSubCatInput ? curSubCatInput.value.trim() : '';

    state.tempModalCategory = curCat || ((state.currentCategory && !isTransitionCategory(state.currentCategory) && state.currentCategory !== '未分類') ? state.currentCategory : '');
    state.tempModalSubCategory = curSubCat || '';

    if (state.tempModalCategory && state.tempModalSubCategory) {
        state.categoryModalStep = 4;
    } else if (state.tempModalCategory) {
        state.categoryModalStep = 2;
    } else {
        state.categoryModalStep = 1;
    }

    state.isAddingCategoryInline = false;
    state.isAddingSubCategoryInline = false;

    renderCategoryModalColumns();

    const overlay = document.getElementById('confirm-overlay');
    const modal = document.getElementById('category-modal');
    const confirmBtn = document.getElementById('category-confirm-btn');
    const externalTopBar = document.getElementById('category-external-top-bar');

    overlay.style.zIndex = '10002';
    overlay.style.display = 'block';
    modal.style.display = 'flex';
    if (confirmBtn) confirmBtn.style.display = 'flex';
    if (externalTopBar) externalTopBar.style.display = 'flex';

    requestAnimationFrame(() => requestAnimationFrame(() => {
        overlay.classList.add('active');
        modal.classList.add('active');
        positionCategoryConfirmBtn();
        if (confirmBtn) confirmBtn.classList.add('active');
        if (externalTopBar) externalTopBar.classList.add('active');
    }));
}

export function openCategoryModal() {
    openCategorySubCategoryModal();
}

export function openSubCategoryModal() {
    openCategorySubCategoryModal();
}

export function triggerBatchMove() {
    if (!state.isSelectionMode || state.currentView !== 'bookmarks') return;
    const subCatCount = state.selectedSubCategories ? state.selectedSubCategories.size : 0;
    const cardCount = state.selectedBookmarkIds ? state.selectedBookmarkIds.size : 0;
    if (subCatCount === 0 && cardCount === 0) return;

    state.isMoveSelectionActive = true;
    if (subCatCount > 0) {
        state.moveTargetType = 'subcategory';
    } else {
        state.moveTargetType = 'card';
    }

    openMoveModal();
}

export function openMoveModal() {
    state.tempModalCategory = '';
    state.tempModalSubCategory = '';
    state.categoryModalStep = 1;
    state.isAddingCategoryInline = false;
    state.isAddingSubCategoryInline = false;

    renderCategoryModalColumns();

    const overlay = document.getElementById('confirm-overlay');
    const modal = document.getElementById('category-modal');
    const confirmBtn = document.getElementById('category-confirm-btn');
    const externalTopBar = document.getElementById('category-external-top-bar');

    overlay.style.zIndex = '10002';
    overlay.style.display = 'block';
    modal.style.display = 'flex';
    if (confirmBtn) {
        confirmBtn.style.display = 'flex';
        confirmBtn.classList.remove('active');
    }
    if (externalTopBar) externalTopBar.style.display = 'flex';

    requestAnimationFrame(() => requestAnimationFrame(() => {
        overlay.classList.add('active');
        modal.classList.add('active');
        positionCategoryConfirmBtn();
        if (externalTopBar) externalTopBar.classList.add('active');
    }));
}

export function handleSelectModalCategory(cat) {
    if (state.isMoveSelectionActive && state.moveTargetType === 'subcategory') {
        state.tempModalCategory = (state.tempModalCategory === cat) ? '' : cat;
        state.tempModalSubCategory = '';
        state.categoryModalStep = 1;
        state.isAddingCategoryInline = false;
        state.isAddingSubCategoryInline = false;
        renderCategoryModalColumns();
        return;
    }

    if (state.tempModalCategory === cat) {
        state.tempModalCategory = '';
        state.tempModalSubCategory = '';
        state.categoryModalStep = 1;
    } else {
        state.tempModalCategory = cat;
        state.tempModalSubCategory = '';
        state.categoryModalStep = 2;
    }
    state.isAddingCategoryInline = false;
    state.isAddingSubCategoryInline = false;
    renderCategoryModalColumns();
}

export function handleSelectModalSubCategory(sub) {
    if (state.tempModalSubCategory === sub && state.categoryModalStep === 4) {
        state.tempModalSubCategory = '';
        state.categoryModalStep = 2;
    } else {
        state.tempModalSubCategory = sub;
        state.categoryModalStep = 4;
    }
    state.isAddingCategoryInline = false;
    state.isAddingSubCategoryInline = false;
    renderCategoryModalColumns();
}

export function handleCategoryBackStep() {
    if (state.isAddingSubCategoryInline || state.isAddingCategoryInline) {
        state.isAddingCategoryInline = false;
        state.isAddingSubCategoryInline = false;
        renderCategoryModalColumns();
        return;
    }

    state.tempModalCategory = '';
    state.tempModalSubCategory = '';
    state.categoryModalStep = 1;
    state.isAddingCategoryInline = false;
    state.isAddingSubCategoryInline = false;
    renderCategoryModalColumns();
}

export function triggerAddNewCategoryOrSubCategory() {
    if (state.categoryModalStep >= 2) {
        state.isAddingSubCategoryInline = true;
        state.isAddingCategoryInline = false;
    } else {
        state.isAddingCategoryInline = true;
        state.isAddingSubCategoryInline = false;
    }
    renderCategoryModalColumns();
}

export function confirmCategorySubCategorySelection() {
    if (state.isMoveSelectionActive) {
        if (state.moveTargetType === 'subcategory') {
            const targetCategory = state.tempModalCategory;
            const subCatsToMove = Array.from(state.selectedSubCategories || []);
            if (!targetCategory || subCatsToMove.length === 0) return;

            if (targetCategory === state.currentCategory) {
                showCloudToast('目標分類與目前分類相同');
                closeCategoryModal();
                return;
            }

            const now = Date.now();
            const subOrdersMap = safeJSONParse(localStorage.getItem('my_subcategory_order'), {});
            const targetSubOrder = Array.isArray(subOrdersMap[targetCategory]) ? subOrdersMap[targetCategory] : [];
            const sourceSubOrder = Array.isArray(subOrdersMap[state.currentCategory]) ? subOrdersMap[state.currentCategory] : [];

            Object.keys(state.bookmarks).forEach(id => {
                const bm = state.bookmarks[id];
                const cat = bm.category || '未分類';
                const subCat = (bm.subCategory && bm.subCategory.trim() !== '') ? bm.subCategory.trim() : '未分類';
                if (cat === state.currentCategory && subCatsToMove.includes(subCat)) {
                    bm.category = targetCategory;
                    bm.updatedAt = now;
                    StorageAPI.saveItem('bookmarks', id, bm);
                }
            });

            subCatsToMove.forEach(sub => {
                if (sub !== '未分類' && !targetSubOrder.includes(sub)) {
                    targetSubOrder.push(sub);
                }
            });
            subOrdersMap[targetCategory] = targetSubOrder;
            subOrdersMap[state.currentCategory] = sourceSubOrder.filter(s => !subCatsToMove.includes(s));
            localStorage.setItem('my_subcategory_order', JSON.stringify(subOrdersMap));
            localStorage.setItem('my_subcategory_order_updatedAt', now.toString());

            localStorage.setItem(PENDING_SYNC_FLAG, 'true');
            notifyCrossTabChange({ type: 'DATA_CHANGED' });

            const hasRemainingInCurrentCategory = Object.values(state.bookmarks || {}).some(bm => {
                const cat = bm.category || '未分類';
                return cat === state.currentCategory;
            });
            if (!hasRemainingInCurrentCategory) {
                state.currentCategory = targetCategory;
            }

            closeCategoryModal();
            exitSelectionMode();

            setTimeout(() => {
                renderSidebar();
                showCloudToast(`已成功搬移 ${subCatsToMove.length} 個子分類`);
                uploadToDrive(true);
            }, 100);
            return;
        } else if (state.moveTargetType === 'card') {
            let finalCat = '';
            let finalSubCat = '';
            if (state.categoryModalStep === 4) {
                finalCat = state.tempModalCategory;
                finalSubCat = state.tempModalSubCategory;
            } else if (state.categoryModalStep >= 2) {
                finalCat = state.tempModalCategory;
                finalSubCat = '';
            }
            if (!finalCat) return;

            const cardIdsToMove = Array.from(state.selectedBookmarkIds || [])
                .filter(id => !!state.bookmarks[id])
                .sort((a, b) => (state.bookmarks[a].order || 0) - (state.bookmarks[b].order || 0));
            if (cardIdsToMove.length === 0) return;

            const isAllSameDestination = cardIdsToMove.every(id => {
                const bm = state.bookmarks[id];
                if (!bm) return false;
                const currentBmCat = bm.category || '未分類';
                const currentBmSub = (bm.subCategory && bm.subCategory.trim() !== '') ? bm.subCategory.trim() : '';
                return currentBmCat === finalCat && currentBmSub === finalSubCat;
            });
            if (isAllSameDestination) {
                showCloudToast('目標分類與目前位置相同');
                closeCategoryModal();
                return;
            }

            const existingOrders = Object.values(state.bookmarks || {})
                .filter(bm => {
                    if (!bm || cardIdsToMove.includes(bm.id)) return false;
                    const bmCat = bm.category || '未分類';
                    const bmSub = (bm.subCategory && bm.subCategory.trim() !== '') ? bm.subCategory.trim() : '';
                    return bmCat === finalCat && bmSub === finalSubCat;
                })
                .map(bm => typeof bm.order === 'number' ? bm.order : 0);
            let nextOrder = existingOrders.length > 0 ? Math.max(...existingOrders) + 1 : 0;

            const now = Date.now();
            cardIdsToMove.forEach(id => {
                const bm = state.bookmarks[id];
                if (bm) {
                    bm.category = finalCat;
                    bm.subCategory = finalSubCat;
                    bm.order = nextOrder++;
                    bm.updatedAt = now;
                    StorageAPI.saveItem('bookmarks', id, bm);
                }
            });

            if (finalSubCat && finalSubCat !== '未分類') {
                const subOrdersMap = safeJSONParse(localStorage.getItem('my_subcategory_order'), {});
                const targetOrder = Array.isArray(subOrdersMap[finalCat]) ? subOrdersMap[finalCat] : [];
                if (!targetOrder.includes(finalSubCat)) {
                    targetOrder.push(finalSubCat);
                    subOrdersMap[finalCat] = targetOrder;
                    localStorage.setItem('my_subcategory_order', JSON.stringify(subOrdersMap));
                    localStorage.setItem('my_subcategory_order_updatedAt', now.toString());
                }
            }

            localStorage.setItem(PENDING_SYNC_FLAG, 'true');
            notifyCrossTabChange({ type: 'DATA_CHANGED' });

            const hasRemainingInCurrentCategory = Object.values(state.bookmarks || {}).some(bm => {
                const cat = bm.category || '未分類';
                return cat === state.currentCategory;
            });
            if (!hasRemainingInCurrentCategory) {
                state.currentCategory = finalCat;
            }

            closeCategoryModal();
            exitSelectionMode();

            setTimeout(() => {
                renderSidebar();
                showCloudToast(`已成功搬移 ${cardIdsToMove.length} 個卡片`);
                uploadToDrive(true);
            }, 100);
            return;
        }
    }

    let finalCat = '';
    let finalSubCat = '';

    if (state.categoryModalStep === 4) {
        finalCat = state.tempModalCategory;
        finalSubCat = state.tempModalSubCategory;
    } else if (state.categoryModalStep >= 2) {
        finalCat = state.tempModalCategory;
        finalSubCat = '';
    }

    updateBookmarkCategoryDisplayUI(finalCat, finalSubCat);
    closeCategoryModal();
}

export function closeCategoryModal() {
    const overlay = document.getElementById('confirm-overlay');
    const modal = document.getElementById('category-modal');
    const confirmBtn = document.getElementById('category-confirm-btn');
    const externalTopBar = document.getElementById('category-external-top-bar');

    if (confirmBtn) confirmBtn.classList.remove('active');
    if (externalTopBar) externalTopBar.classList.remove('active');
    modal.classList.remove('active');
    overlay.classList.remove('active');

    state.isAddingCategoryInline = false;
    state.isAddingSubCategoryInline = false;
    state.isMoveSelectionActive = false;
    state.moveTargetType = null;

    setTimeout(() => {
        modal.style.display = 'none';
        overlay.style.display = 'none';
        if (confirmBtn) confirmBtn.style.display = 'none';
        if (externalTopBar) externalTopBar.style.display = 'none';
        overlay.style.zIndex = '';
    }, 250);
}

export function closeAllConfirms() {
    if (document.activeElement) document.activeElement.blur();
    const catModal = document.getElementById('category-modal');
    if (catModal && catModal.classList.contains('active')) {
        closeCategoryModal();
        return;
    }
    const sortModal = document.getElementById('sort-modal');
    if (sortModal && sortModal.classList.contains('active')) {
        closeSortModal();
        closeAllEditors();
        return;
    }
    closeConfirm();
    closeCalendarTimeBar();
    closeCategoryModal();
    closeSortModal();
    closeSettingsModal();
    closeCloudAlert();
    hideCategoryPopoverMenu();
    closeAllEditors();
}

// ==========================================
// 儲存與刪除邏輯
// ==========================================
export function saveUnified() {
    const type = state.currentUnifiedType;
    // note（內容）與 bookmark（網址書籤）共用 bookmarks 資料表，以 isCustomRecord 區分
    if (type === 'bookmark' || type === 'note') saveBookmark();
    else if (type === 'reminder') saveReminder();
}

export function saveReminder() {
    const title = (state.tempReminderTitle || '').trim();
    const content = state.tempReminderContent || '';
    const dateVal = document.getElementById('reminder-date-val');
    const startDateVal = document.getElementById('reminder-start-date-val');
    const endDateVal = document.getElementById('reminder-end-date-val');

    let startDate = startDateVal ? startDateVal.value.trim() : '';
    let endDate = endDateVal ? endDateVal.value.trim() : '';
    let date = dateVal ? dateVal.value.trim() : '';

    if (!startDate) startDate = state.tempSelectedReminderStartDate || new Date().toISOString().slice(0, 10);
    if (!endDate) endDate = state.tempSelectedReminderEndDate || startDate;
    if (!date) date = startDate;

    const startTime = state.isReminderStartTimeAdjusted
        ? `${String(state.timeWheelStartHour).padStart(2, '0')}:${String(state.timeWheelStartMinute).padStart(2, '0')}`
        : '';
    const endTime = state.isReminderEndTimeAdjusted
        ? `${String(state.timeWheelEndHour).padStart(2, '0')}:${String(state.timeWheelEndMinute).padStart(2, '0')}`
        : '';

    if (!title) {
        const modal = document.getElementById('editor-modal');
        modal.classList.remove('shake-animation');
        void modal.offsetWidth; 
        modal.classList.add('shake-animation');
        return;
    }

    const hadConflict = state.hasEditConflict;
    if (state.pendingSyncItems?.reminder) {
        delete state.pendingSyncItems.reminder;
    }
    state.hasEditConflict = false;

    const isNew = !state.currentEditingReminderId;
    const id = state.currentEditingReminderId || Date.now().toString();
    const existingReminder = state.reminders[id];
    const order = (existingReminder && existingReminder.order !== undefined) ? existingReminder.order : -Date.now();
    const isDone = state.tempReminderIsDone !== undefined ? !!state.tempReminderIsDone : (existingReminder ? !!existingReminder.isDone : false);
    
    if (!state.deletedRecords) {
        state.deletedRecords = { bookmarks: {}, reminders: {} };
    }
    if (state.deletedRecords?.reminders?.[id]) {
        delete state.deletedRecords.reminders[id];
        StorageAPI.deleteItem('deleted_reminders', id);
    }

    state.reminders[id] = {
        title,
        content,
        date,
        startDate,
        endDate,
        startTime,
        endTime,
        isDone,
        timestamp: getTimestamp(),
        updatedAt: Date.now(),
        order
    };
    StorageAPI.saveItem('reminders', id, state.reminders[id]);

    // 立即標記待上傳與廣播，避免使用者於延遲期間關閉瀏覽器導致漏傳
    localStorage.setItem(PENDING_SYNC_FLAG, 'true');
    notifyCrossTabChange({ type: 'DATA_CHANGED' });

    // 成功確認儲存，清空取消還原暫存
    state.previousCategory = null;
    closeAllEditors();
    
    setTimeout(() => {
        if (state.currentView !== 'reminders') selectRemindersView();
        else renderReminders();
        if (hadConflict) {
            showCloudToast('已以本地修改覆蓋並同步雲端');
        } else if (isGoogleLinked() && !isTokenValid()) {
            showCloudToast('已存至本機 (點此連線雲端)', {
                onClick: () => window.handleGoogleAuthClick()
            });
        } else {
            showCloudToast(isNew ? '新增成功' : '儲存成功');
        }
        uploadToDrive(true);
    }, 250);
}

export function saveBookmark() {
    const isNote = state.currentUnifiedType === 'note';
    const rawTitle = document.getElementById('bookmark-title') ? document.getElementById('bookmark-title').value.trim() : '';
    const title = isNote 
        ? ((state.tempBookmarkTitle !== undefined && state.tempBookmarkTitle.trim() !== '') ? state.tempBookmarkTitle.trim() : rawTitle)
        : rawTitle;
    let url = document.getElementById('bookmark-url').value.trim();
    let category = document.getElementById('bookmark-category').value.trim() || '未分類';
    const subCategoryInput = document.getElementById('bookmark-sub-category');
    const subCategory = subCategoryInput ? subCategoryInput.value.trim() : '';
    const desc = document.getElementById('bookmark-desc').value.trim();
    const content = isNote ? (state.tempBookmarkContent || '') : '';
    
    if (!isNote) {
        if (!url) {
            const modal = document.getElementById('editor-modal');
            modal.classList.remove('shake-animation');
            void modal.offsetWidth; 
            modal.classList.add('shake-animation');
            return;
        }
        if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;
    } else {
        const cleanContent = content.replace(/<br\s*[\/]?>/gi, '').replace(/<div>\s*<\/div>/gi, '').trim();
        if (!title && !cleanContent && !desc) {
            const modal = document.getElementById('editor-modal');
            modal.classList.remove('shake-animation');
            void modal.offsetWidth; 
            modal.classList.add('shake-animation');
            return;
        }
    }

    const hadConflict = state.hasEditConflict;
    if (state.pendingSyncItems?.bookmark) {
        delete state.pendingSyncItems.bookmark;
    }
    state.hasEditConflict = false;

    const isNew = !state.currentEditingBookmarkId;
    const id = state.currentEditingBookmarkId || Date.now().toString();
    const order = (state.bookmarks[id] && state.bookmarks[id].order !== undefined) ? state.bookmarks[id].order : -Date.now(); 
    const oldCategory = state.bookmarks[id] ? state.bookmarks[id].category : null;
    const oldSubCategory = state.bookmarks[id] ? (state.bookmarks[id].subCategory || '') : null;
    const categoryChanged = oldCategory !== null && oldCategory !== category;
    const subCategoryChanged = oldSubCategory !== null && oldSubCategory !== subCategory;
    
    if (!state.deletedRecords) {
        state.deletedRecords = { bookmarks: {}, reminders: {} };
    }
    if (state.deletedRecords?.bookmarks?.[id]) {
        delete state.deletedRecords.bookmarks[id];
        StorageAPI.deleteItem('deleted_bookmarks', id);
    }

    state.bookmarks[id] = {     
        id,
        title, 
        url: isNote ? (state.bookmarks[id]?.url || '') : url, 
        category, 
        subCategory, 
        description: desc, 
        content: isNote ? content : (state.bookmarks[id]?.content || ''),
        isCustomRecord: isNote,
        timestamp: getTimestamp(), 
        updatedAt: Date.now(), 
        order 
    };
    StorageAPI.saveItem('bookmarks', id, state.bookmarks[id]);

    // 立即標記待上傳與廣播，避免使用者於延遲期間關閉瀏覽器導致漏傳
    localStorage.setItem(PENDING_SYNC_FLAG, 'true');
    notifyCrossTabChange({ type: 'DATA_CHANGED' });

    // 成功確認儲存，清空取消還原暫存並切換至新設定分類
    state.previousCategory = null;
    state.currentCategory = category;
    closeAllEditors();
    
    setTimeout(() => {
        if (state.currentView !== 'bookmarks') {
            selectCategory(category);
        } else if (isNew || categoryChanged || subCategoryChanged || isNote) {
            renderSidebar();
        } else {
            updateBookmarkDOM(id);
        }
        if (hadConflict) {
            showCloudToast('已以本地修改覆蓋並同步雲端');
        } else if (isGoogleLinked() && !isTokenValid()) {
            showCloudToast('已存至本機 (點此連線雲端)', {
                onClick: () => window.handleGoogleAuthClick()
            });
        } else {
            showCloudToast(isNew ? '新增成功' : '儲存成功');
        }
        uploadToDrive(true);
    }, 250);
}

export function triggerUnifiedDelete() {
    const type = state.currentUnifiedType;
    if (type === 'bookmark' || type === 'note') showDeleteConfirm('bookmark');
    else if (type === 'reminder') showDeleteConfirm('reminder');
}

export function showDeleteConfirm(type) {
    state.deleteTargetType = type;
    const targetBtn = document.getElementById('btn-delete-unified');
    if (targetBtn) targetBtn.style.pointerEvents = 'none';

    const overlay = document.getElementById('confirm-overlay');
    const modal = document.getElementById('confirm-modal');
    overlay.style.display = 'block';
    modal.style.display = 'block';
    requestAnimationFrame(() => requestAnimationFrame(() => {
        overlay.classList.add('active');
        modal.classList.add('active');
    }));
}

export function closeConfirm() {
    if (document.activeElement) document.activeElement.blur();
    const overlay = document.getElementById('confirm-overlay');
    const modal = document.getElementById('confirm-modal');
    overlay.classList.remove('active');
    modal.classList.remove('active');
    setTimeout(() => {
        overlay.style.display = 'none';
        modal.style.display = 'none';
        state.deleteTargetType = null;
        const unifiedBtn = document.getElementById('btn-delete-unified');
        if (unifiedBtn) unifiedBtn.style.pointerEvents = '';
        const titleEl = modal.querySelector('h2');
        const descEl = modal.querySelector('p');
        if (titleEl) titleEl.innerText = '確定要刪除？';
        if (descEl) descEl.innerText = '刪除後將無法復原資料。';
    }, 250);
}

let deleteSyncDebounceTimer = null;
let lastDeleteTimestamp = 0;

function scheduleDeleteCloudSync() {
    clearTimeout(deleteSyncDebounceTimer);
    deleteSyncDebounceTimer = setTimeout(() => {
        uploadToDrive(true);
    }, 500);
}

export async function confirmDelete() {
    const currentNow = Date.now();
    const safeNow = Math.max(currentNow, lastDeleteTimestamp + 1);
    lastDeleteTimestamp = safeNow;

    if (!state.deletedRecords) {
        state.deletedRecords = { bookmarks: {}, reminders: {} };
    }

    if (state.deleteTargetType === 'bookmark' && state.currentEditingBookmarkId) {
        const targetId = state.currentEditingBookmarkId;
        delete state.bookmarks[targetId];
        if (!state.deletedRecords.bookmarks) state.deletedRecords.bookmarks = {};
        state.deletedRecords.bookmarks[targetId] = safeNow;

        // 本地記憶體與 IndexedDB 立即同步硬性落地，防止任何後續非同步覆蓋
        await StorageAPI.deleteItem('bookmarks', targetId);
        await StorageAPI.saveItem('deleted_bookmarks', targetId, safeNow);

        localStorage.setItem(PENDING_SYNC_FLAG, 'true');
        notifyCrossTabChange({ type: 'DATA_CHANGED' });

        closeConfirm();
        closeAllEditors();

        setTimeout(() => {
            renderSidebar();
            if (isGoogleLinked() && !isTokenValid()) {
                showCloudToast('已從本機刪除 (點此連線雲端)', {
                    onClick: () => window.handleGoogleAuthClick()
                });
            } else {
                showCloudToast('刪除成功');
            }
            scheduleDeleteCloudSync();
        }, 100);
    } else if (state.deleteTargetType === 'reminder' && state.currentEditingReminderId) {
        const targetId = state.currentEditingReminderId;
        delete state.reminders[targetId];
        if (!state.deletedRecords.reminders) state.deletedRecords.reminders = {};
        state.deletedRecords.reminders[targetId] = safeNow;

        // 本地記憶體與 IndexedDB 立即同步硬性落地，防止任何後續非同步覆蓋
        await StorageAPI.deleteItem('reminders', targetId);
        await StorageAPI.saveItem('deleted_reminders', targetId, safeNow);

        localStorage.setItem(PENDING_SYNC_FLAG, 'true');
        notifyCrossTabChange({ type: 'DATA_CHANGED' });

        closeConfirm();
        closeAllEditors();

        setTimeout(() => {
            renderReminders();
            if (isGoogleLinked() && !isTokenValid()) {
                showCloudToast('已從本機刪除 (點此連線雲端)', {
                    onClick: () => window.handleGoogleAuthClick()
                });
            } else {
                showCloudToast('刪除成功');
            }
            scheduleDeleteCloudSync();
        }, 100);
    } else if (state.deleteTargetType === 'batch-reminders' && state.selectedReminderIds && state.selectedReminderIds.size > 0) {
        const idsToDelete = Array.from(state.selectedReminderIds);
        if (!state.deletedRecords.reminders) state.deletedRecords.reminders = {};

        for (const targetId of idsToDelete) {
            delete state.reminders[targetId];
            state.deletedRecords.reminders[targetId] = safeNow;
        }

        await StorageAPI.batchDeleteWithTombstone('reminders', 'deleted_reminders', idsToDelete, safeNow);

        localStorage.setItem(PENDING_SYNC_FLAG, 'true');
        notifyCrossTabChange({ type: 'DATA_CHANGED' });

        closeConfirm();
        exitSelectionMode();

        setTimeout(() => {
            renderReminders();
            if (isGoogleLinked() && !isTokenValid()) {
                showCloudToast(`已從本機刪除 ${idsToDelete.length} 項提醒 (點此連線雲端)`, {
                    onClick: () => window.handleGoogleAuthClick()
                });
            } else {
                showCloudToast(`已成功刪除 ${idsToDelete.length} 項提醒`);
            }
            scheduleDeleteCloudSync();
        }, 100);
    } else if (state.deleteTargetType === 'batch-bookmarks' && state.selectedBookmarkIds && state.selectedBookmarkIds.size > 0) {
        const idsToDelete = Array.from(state.selectedBookmarkIds);
        if (!state.deletedRecords.bookmarks) state.deletedRecords.bookmarks = {};

        for (const targetId of idsToDelete) {
            delete state.bookmarks[targetId];
            state.deletedRecords.bookmarks[targetId] = safeNow;
        }

        await StorageAPI.batchDeleteWithTombstone('bookmarks', 'deleted_bookmarks', idsToDelete, safeNow);

        localStorage.setItem(PENDING_SYNC_FLAG, 'true');
        notifyCrossTabChange({ type: 'DATA_CHANGED' });

        const remainingInCat = Object.values(state.bookmarks || {}).some(bm => {
            const cat = bm.category || '未分類';
            return cat === state.currentCategory;
        });
        if (!remainingInCat) {
            const otherCat = Object.values(state.bookmarks || {})
                .map(bm => bm.category || '未分類')
                .find(c => c !== state.currentCategory && !isTransitionCategory(c));
            state.currentCategory = otherCat || '未分類';
        }

        closeConfirm();
        exitSelectionMode();

        setTimeout(() => {
            renderSidebar();
            if (isGoogleLinked() && !isTokenValid()) {
                showCloudToast(`已從本機刪除 ${idsToDelete.length} 項資料 (點此連線雲端)`, {
                    onClick: () => window.handleGoogleAuthClick()
                });
            } else {
                showCloudToast(`已成功刪除 ${idsToDelete.length} 項資料`);
            }
            scheduleDeleteCloudSync();
        }, 100);
    } else if (state.deleteTargetType === 'batch-subcategories' && state.selectedSubCategories && state.selectedSubCategories.size > 0) {
        const subCatsToDelete = Array.from(state.selectedSubCategories);
        const idsToDelete = [];
        Object.keys(state.bookmarks).forEach(id => {
            const bm = state.bookmarks[id];
            const cat = bm.category || '未分類';
            const subCat = (bm.subCategory && bm.subCategory.trim() !== '') ? bm.subCategory.trim() : '未分類';
            if (cat === state.currentCategory && subCatsToDelete.includes(subCat)) {
                idsToDelete.push(id);
            }
        });

        if (!state.deletedRecords.bookmarks) state.deletedRecords.bookmarks = {};

        for (const targetId of idsToDelete) {
            delete state.bookmarks[targetId];
            state.deletedRecords.bookmarks[targetId] = safeNow;
        }

        await StorageAPI.batchDeleteWithTombstone('bookmarks', 'deleted_bookmarks', idsToDelete, safeNow);

        const subOrdersMap = safeJSONParse(localStorage.getItem('my_subcategory_order'), {});
        if (Array.isArray(subOrdersMap[state.currentCategory])) {
            subOrdersMap[state.currentCategory] = subOrdersMap[state.currentCategory].filter(s => !subCatsToDelete.includes(s));
            localStorage.setItem('my_subcategory_order', JSON.stringify(subOrdersMap));
            localStorage.setItem('my_subcategory_order_updatedAt', safeNow.toString());
        }

        localStorage.setItem(PENDING_SYNC_FLAG, 'true');
        notifyCrossTabChange({ type: 'DATA_CHANGED' });

        const remainingInCat = Object.values(state.bookmarks || {}).some(bm => {
            const cat = bm.category || '未分類';
            return cat === state.currentCategory;
        });
        if (!remainingInCat) {
            const otherCat = Object.values(state.bookmarks || {})
                .map(bm => bm.category || '未分類')
                .find(c => c !== state.currentCategory && !isTransitionCategory(c));
            state.currentCategory = otherCat || '未分類';
        }

        closeConfirm();
        exitSelectionMode();

        setTimeout(() => {
            renderSidebar();
            if (isGoogleLinked() && !isTokenValid()) {
                showCloudToast(`已從本機刪除 ${subCatsToDelete.length} 個子分類 (點此連線雲端)`, {
                    onClick: () => window.handleGoogleAuthClick()
                });
            } else {
                showCloudToast(`已成功刪除 ${subCatsToDelete.length} 個子分類`);
            }
            scheduleDeleteCloudSync();
        }, 100);
    }
}

// ==========================================
// 全畫面編輯器、格式化與日曆
// ==========================================

function onTransitionEnd(el, propName, fallbackMs, callback) {
    let done = false;
    const finish = () => {
        if (done) return;
        done = true;
        el.removeEventListener('transitionend', handler);
        clearTimeout(fallbackTimer);
        callback();
    };
    const handler = (e) => {
        if (e.target === el && e.propertyName === propName) finish();
    };
    el.addEventListener('transitionend', handler);
    const fallbackTimer = setTimeout(finish, fallbackMs);
}

export function openFullEditor() {
    closeEditorSwitchBar();

    const fullModal = document.getElementById('full-editor-modal');
    const fullContent = document.getElementById('full-note-content');
    const editorModal = document.getElementById('editor-modal');

    // 網址書籤分頁沒有可編輯的內容預覽框，不需開啟全螢幕編輯器
    if (state.currentUnifiedType === 'bookmark') return;

    const fullReminderTitleInput = document.getElementById('full-reminder-title-input');
    if (fullReminderTitleInput) fullReminderTitleInput.style.display = 'none';

    if (state.currentUnifiedType === 'note') {
        fullContent.innerHTML = state.tempBookmarkContent || '';
        if (fullReminderTitleInput) {
            fullReminderTitleInput.style.display = 'block';
            fullReminderTitleInput.value = state.tempBookmarkTitle || (document.getElementById('bookmark-title') ? document.getElementById('bookmark-title').value : '') || '';
        }
    } else {
        fullContent.innerHTML = state.tempReminderContent || '';
        if (fullReminderTitleInput) {
            fullReminderTitleInput.style.display = 'block';
            fullReminderTitleInput.value = state.tempReminderTitle || '';
        }
    }

    fullModal.style.display = 'flex';
    editorModal.classList.remove('active');
    editorModal.style.pointerEvents = 'none';

    requestAnimationFrame(() => requestAnimationFrame(() => {
        fullModal.classList.add('active');
        fullContent.scrollTop = 0;
    }));

    onTransitionEnd(fullModal, 'opacity', 260, () => {
        if (fullModal.classList.contains('active')) {
            editorModal.style.visibility = 'hidden';
            fullContent.focus({ preventScroll: true });
        }
    });
}

export function closeFullEditor() {
    window.getSelection().removeAllRanges();
    const toolbar = document.getElementById('text-toolbar');
    if (toolbar) toolbar.classList.remove('active');

    const fullModal = document.getElementById('full-editor-modal');
    const editorModal = document.getElementById('editor-modal');
    const content = document.getElementById('full-note-content').innerHTML;
    const fullReminderTitleInput = document.getElementById('full-reminder-title-input');

    if (state.currentUnifiedType === 'note') {
        if (fullReminderTitleInput) {
            state.tempBookmarkTitle = fullReminderTitleInput.value.trim();
            const bmTitle = document.getElementById('bookmark-title');
            if (bmTitle) bmTitle.value = state.tempBookmarkTitle;
        }
        state.tempBookmarkContent = content;
        updateBookmarkPreviewDisplay();
    } else if (state.currentUnifiedType === 'reminder') {
        if (fullReminderTitleInput) {
            state.tempReminderTitle = fullReminderTitleInput.value.trim();
        }
        state.tempReminderContent = content;
        updateReminderPreviewDisplay();
    }

    fullModal.classList.remove('active');

    onTransitionEnd(fullModal, 'opacity', 260, () => {
        fullModal.style.display = 'none';

        editorModal.style.visibility = 'visible';
        editorModal.style.display = 'block';
        editorModal.style.opacity = '';
        editorModal.style.pointerEvents = '';

        requestAnimationFrame(() => requestAnimationFrame(() => {
            editorModal.classList.add('active');
            const isNewItem = state.currentUnifiedType === 'reminder'
                ? !state.currentEditingReminderId
                : !state.currentEditingBookmarkId;
            if (isNewItem) {
                openEditorSwitchBar();
            } else {
                closeEditorSwitchBar();
            }
        }));
    });
}

export function syncFullEditorContent() {
    const content = document.getElementById('full-note-content').innerHTML;
    
    if (state.currentUnifiedType === 'note') {
        const fullReminderTitleInput = document.getElementById('full-reminder-title-input');
        if (fullReminderTitleInput) {
            state.tempBookmarkTitle = fullReminderTitleInput.value.trim();
            const bmTitle = document.getElementById('bookmark-title');
            if (bmTitle) bmTitle.value = state.tempBookmarkTitle;
        }
        state.tempBookmarkContent = content;
        updateBookmarkPreviewDisplay();
        return;
    }

    if (state.currentUnifiedType === 'reminder') {
        const fullReminderTitleInput = document.getElementById('full-reminder-title-input');
        if (fullReminderTitleInput) {
            state.tempReminderTitle = fullReminderTitleInput.value.trim();
        }
        state.tempReminderContent = content;
        updateReminderPreviewDisplay();
    }
}

export function saveFullEditor() {
    syncFullEditorContent();
    closeFullEditor();
}

const PASTE_BLOCK_TAGS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'FIGCAPTION', 'FIGURE',
    'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'LI', 'MAIN',
    'NAV', 'OL', 'P', 'PRE', 'SECTION', 'UL'
]);

const PASTE_INLINE_TAGS = new Map([
    ['B', 'strong'],
    ['STRONG', 'strong'],
    ['I', 'em'],
    ['EM', 'em'],
    ['U', 'u'],
    ['S', 's'],
    ['STRIKE', 's'],
    ['DEL', 's'],
    ['CODE', 'code']
]);

const PASTE_SKIP_TAGS = new Set([
    'BASE', 'IFRAME', 'LINK', 'META', 'NOSCRIPT', 'OBJECT', 'SCRIPT', 'STYLE', 'SVG', 'TEMPLATE',
    'IMG', 'IMAGE', 'PICTURE', 'CANVAS', 'VIDEO', 'AUDIO', 'SOURCE'
]);

function appendSanitizedPasteChildren(sourceNode, targetNode) {
    sourceNode.childNodes.forEach(child => {
        const cleanChild = sanitizePasteNode(child);
        if (cleanChild) targetNode.appendChild(cleanChild);
    });
}

function sanitizePasteNode(node) {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.nodeValue);
    if (node.nodeType !== Node.ELEMENT_NODE) return document.createDocumentFragment();

    const tagName = node.tagName;
    if (PASTE_SKIP_TAGS.has(tagName)) return document.createDocumentFragment();
    if (tagName === 'BR') return document.createElement('br');

    if (PASTE_INLINE_TAGS.has(tagName)) {
        const cleanElement = document.createElement(PASTE_INLINE_TAGS.get(tagName));
        appendSanitizedPasteChildren(node, cleanElement);
        return cleanElement;
    }

    if (PASTE_BLOCK_TAGS.has(tagName)) {
        const cleanBlock = document.createElement('div');
        appendSanitizedPasteChildren(node, cleanBlock);
        if (!cleanBlock.childNodes.length) cleanBlock.appendChild(document.createElement('br'));
        return cleanBlock;
    }

    const fragment = document.createDocumentFragment();
    appendSanitizedPasteChildren(node, fragment);
    return fragment;
}

function normalizeSanitizedPasteHtml(html) {
    const template = document.createElement('template');
    template.innerHTML = html;

    const fragment = document.createDocumentFragment();
    appendSanitizedPasteChildren(template.content, fragment);

    const output = document.createElement('div');
    output.appendChild(fragment);
    return output.innerHTML
        .replace(/(?:<div><br><\/div>)+$/g, '')
        .trim();
}

function textToPasteHtml(text) {
    if (!text) return '';
    const normalizedText = text.replace(/\r\n?/g, '\n');
    if (!normalizedText.includes('\n')) {
        const inlineText = document.createElement('span');
        inlineText.textContent = normalizedText;
        return inlineText.innerHTML;
    }

    const lines = normalizedText.split('\n');
    return lines.map(line => {
        const div = document.createElement('div');
        if (line) div.textContent = line;
        else div.appendChild(document.createElement('br'));
        return div.outerHTML;
    }).join('');
}

function getCleanPasteHtml(dataTransfer) {
    const html = dataTransfer ? dataTransfer.getData('text/html') : '';
    const text = dataTransfer ? dataTransfer.getData('text/plain') : '';
    if (html) {
        const cleanHtml = normalizeSanitizedPasteHtml(html);
        if (cleanHtml) return cleanHtml;
    }
    return textToPasteHtml(text);
}

function selectionBelongsToEditor(selection, editor) {
    if (!selection || selection.rangeCount === 0) return false;
    const { anchorNode, focusNode } = selection;
    return (!anchorNode || editor.contains(anchorNode) || anchorNode === editor) &&
           (!focusNode || editor.contains(focusNode) || focusNode === editor);
}

function insertCleanHtmlAtSelection(editor, html) {
    if (!html) return;

    editor.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (!selection || !selectionBelongsToEditor(selection, editor)) {
        editor.insertAdjacentHTML('beforeend', html);
        return;
    }

    const range = selection.getRangeAt(0);
    range.deleteContents();

    const template = document.createElement('template');
    template.innerHTML = html;
    const fragment = template.content;
    const childNodes = Array.from(fragment.childNodes);
    if (childNodes.length === 0) return;

    const lastNode = childNodes[childNodes.length - 1];
    range.insertNode(fragment);

    if (lastNode && lastNode.parentNode) {
        const newRange = document.createRange();
        newRange.setStartAfter(lastNode);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);
    }
}

function notifyEditorContentChanged(editor) {
    const inputEvent = typeof InputEvent === 'function'
        ? new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' })
        : new Event('input', { bubbles: true });
    editor.dispatchEvent(inputEvent);
}

function handleCleanNotePaste(e) {
    const editor = e.currentTarget;
    if (!editor || !editor.matches('#full-note-content, #bookmark-content, #reminder-content')) return;

    // 先行強制終止瀏覽器預設貼上行為，防止原生 contenteditable 自動插入 Base64 圖片
    e.preventDefault();

    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    // 嚴格攔截剪貼簿檔案清單中的圖片
    if (clipboardData.files && clipboardData.files.length > 0) {
        for (let i = 0; i < clipboardData.files.length; i++) {
            if (clipboardData.files[i].type && clipboardData.files[i].type.startsWith('image/')) {
                return;
            }
        }
    }

    // 嚴格攔截剪貼簿 DataTransferItems 中的圖片
    if (clipboardData.items && clipboardData.items.length > 0) {
        for (let i = 0; i < clipboardData.items.length; i++) {
            if (clipboardData.items[i].type && clipboardData.items[i].type.startsWith('image/')) {
                return;
            }
        }
    }

    const cleanHtml = getCleanPasteHtml(clipboardData);
    if (!cleanHtml) return;

    // 二次過濾殘餘的 <img> 標籤與 Base64 字串屬性
    const finalCleanHtml = cleanHtml
        .replace(/<img\b[^>]*>/gi, '')
        .replace(/data:image\/[^;]+;base64,[^\s"']+/gi, '');

    if (!finalCleanHtml.trim()) return;

    insertCleanHtmlAtSelection(editor, finalCleanHtml);
    notifyEditorContentChanged(editor);
}

function preventEditorDragDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'none';
    }
}

function initCleanPasteHandling() {
    // 全域攔截檔案拖放，防止拖入視窗邊界導致瀏覽器跳頁離開 SPA
    window.removeEventListener('dragover', preventEditorDragDrop);
    window.addEventListener('dragover', preventEditorDragDrop, false);

    window.removeEventListener('drop', preventEditorDragDrop);
    window.addEventListener('drop', preventEditorDragDrop, false);

    const editors = document.querySelectorAll('#full-note-content, #bookmark-content, #reminder-content');
    editors.forEach(editor => {
        editor.removeEventListener('paste', handleCleanNotePaste);
        editor.addEventListener('paste', handleCleanNotePaste);

        editor.removeEventListener('dragover', preventEditorDragDrop);
        editor.addEventListener('dragover', preventEditorDragDrop);

        editor.removeEventListener('drop', preventEditorDragDrop);
        editor.addEventListener('drop', preventEditorDragDrop);
    });
}

export async function handleClipboard(e, action, btn) {
    e.preventDefault();
    const selection = window.getSelection();
    if ((action === 'cut' || action === 'copy') && (!selection || selection.rangeCount === 0 || selection.isCollapsed)) return;

    const isFullEditorOpen = document.getElementById('full-editor-modal').classList.contains('active');
    const editor = isFullEditorOpen ? document.getElementById('full-note-content') : null;
    if (!editor) return;

    let didChange = false;
    if (action === 'cut') {
        document.execCommand('cut', false, null);
        didChange = true;
    }
    else if (action === 'copy') document.execCommand('copy', false, null);
    else if (action === 'paste') {
        try {
            const text = await navigator.clipboard.readText();
            // 過濾掉可能夾帶在文字剪貼簿中的 Base64 圖片與 Data URI
            const cleanText = (text || '')
                .replace(/data:image\/[^;]+;base64,[^\s"']+/gi, '')
                .trim();

            if (cleanText) {
                insertCleanHtmlAtSelection(editor, textToPasteHtml(cleanText));
                didChange = true;
            }
        } catch (err) { console.error('貼上失敗', err); }
    }

    if (didChange) notifyEditorContentChanged(editor);
    if (document.activeElement !== editor) editor.focus();
}

export function handleFormat(e, command, btn) {
    e.preventDefault();
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const isFullEditorOpen = document.getElementById('full-editor-modal').classList.contains('active');
    const activeEditor = isFullEditorOpen ? document.getElementById('full-note-content') : null;
    if (!activeEditor) return;

    if (command === 'bold') document.execCommand('bold', false, null);
    else if (command === 'color') {
        document.execCommand('styleWithCSS', false, true);
        const currentColor = document.queryCommandValue('foreColor').toLowerCase();
        if (currentColor === '#9a871e' || currentColor === 'rgb(154, 135, 30)') {
            document.execCommand('foreColor', false, 'inherit');
            const spans = activeEditor.querySelectorAll('span');
            spans.forEach(span => {
                if (span.style.color === 'inherit') {
                    span.style.color = '';
                    if (span.getAttribute('style') === '') span.removeAttribute('style');
                }
            });
        } else {
            document.execCommand('foreColor', false, '#9a871e');
        }
    }
    if (document.activeElement !== activeEditor) activeEditor.focus();
}

export let timeWheelSelectedHour = 12;
export let timeWheelSelectedMinute = 0;
let isCalendarTimeWheelInitialized = false;

let initialWheelStartHour = 12;
let initialWheelStartMinute = 0;
let initialWheelEndHour = 18;
let initialWheelEndMinute = 0;

const TIME_WHEEL_ITEM_HEIGHT = 30;
const TIME_WHEEL_CENTER_OFFSET = 15;

function getTimeWheelCenterOffset() {
    return (window.innerWidth <= 768 ? 13 : TIME_WHEEL_CENTER_OFFSET);
}

function triggerHaptic(type = 'light') {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try {
            if (type === 'light') {
                navigator.vibrate(8);
            } else if (type === 'heavy') {
                navigator.vibrate(22);
            }
        } catch (e) {
            // 靜默略過未支援震動或限制環境
        }
    }
}

export function updateTimeBarAdjustedUI() {
    const startBar = document.getElementById('calendar-start-time-bar') || document.getElementById('calendar-time-bar');
    const endBar = document.getElementById('calendar-end-time-bar');
    const confirmBtn = document.getElementById('calendar-confirm-btn');

    if (startBar) {
        if (state.isReminderStartTimeAdjusted) {
            startBar.classList.remove('unadjusted-time');
            startBar.classList.add('adjusted-time');
        } else {
            startBar.classList.remove('adjusted-time');
            startBar.classList.add('unadjusted-time');
        }
    }

    if (endBar) {
        if (state.isReminderEndTimeAdjusted) {
            endBar.classList.remove('unadjusted-time');
            endBar.classList.add('adjusted-time');
        } else {
            endBar.classList.remove('adjusted-time');
            endBar.classList.add('unadjusted-time');
        }
    }

    const anyAdjusted = state.isReminderStartTimeAdjusted || state.isReminderEndTimeAdjusted;

    if (confirmBtn) {
        confirmBtn.classList.toggle('adjusted', anyAdjusted);
    }
}

export function updateCalendarRangeHighlight(start, end) {
    const calDays = document.getElementById('cal-days');
    if (!calDays) return;

    if (!start && !end) {
        calDays.querySelectorAll('.cal-day-cell').forEach(cell => {
            cell.classList.remove('selected', 'range-start', 'range-between', 'range-end', 'range-month-start', 'range-month-end');
        });
        return;
    }

    if (!start) start = end;
    if (!end) end = start;

    const actualStart = start <= end ? start : end;
    const actualEnd = start <= end ? end : start;

    const year = state.calDate.getFullYear();
    const month = state.calDate.getMonth() + 1;
    const daysInMonth = new Date(year, month, 0).getDate();

    calDays.querySelectorAll('.cal-day-cell').forEach(cell => {
        const dayNum = parseInt(cell.textContent.trim(), 10);
        if (isNaN(dayNum)) {
            cell.classList.remove('selected', 'range-start', 'range-between', 'range-end', 'range-month-start', 'range-month-end');
            return;
        }

        const cellDate = cell.dataset.date || `${year}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
        cell.dataset.date = cellDate;

        cell.classList.remove('selected', 'range-start', 'range-between', 'range-end', 'range-month-start', 'range-month-end');

        if (cellDate === actualStart && cellDate === actualEnd) {
            cell.classList.add('selected', 'range-start', 'range-end');
        } else if (cellDate === actualStart) {
            cell.classList.add('range-start');
        } else if (cellDate === actualEnd) {
            cell.classList.add('range-end');
        } else if (cellDate > actualStart && cellDate < actualEnd) {
            cell.classList.add('range-between');
            if (dayNum === 1) {
                cell.classList.add('range-month-start');
            }
            if (dayNum === daysInMonth) {
                cell.classList.add('range-month-end');
            }
        }
    });
}

function getCellDateFromElement(cell) {
    if (!cell) return '';
    if (cell.dataset.date) return cell.dataset.date;
    const dayNum = parseInt(cell.textContent.trim(), 10);
    if (isNaN(dayNum)) return '';
    const year = state.calDate.getFullYear();
    const month = state.calDate.getMonth() + 1;
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    cell.dataset.date = dateStr;
    return dateStr;
}

let justFinishedCalendarDrag = false;

export function initCalendarDragInteractions() {
    const calDays = document.getElementById('cal-days');
    if (!calDays) return;

    let isDragCandidate = false;
    let startPointerX = 0;
    let startPointerY = 0;
    let dragMode = 'new'; // 'adjust-end' | 'adjust-start' | 'new'
    let monthSwitchCooldown = false;
    let autoMonthSwitchTimer = null;

    const handlePointerDown = (e) => {
        const cell = e.target.closest('.cal-day-cell');
        if (!cell) return;

        const cellDate = getCellDateFromElement(cell);
        if (!cellDate) return;

        isDragCandidate = true;
        startPointerX = (e.touches && e.touches.length > 0) ? e.touches[0].clientX : e.clientX;
        startPointerY = (e.touches && e.touches.length > 0) ? e.touches[0].clientY : e.clientY;

        const curStart = state.tempSelectedReminderStartDate;
        const curEnd = state.tempSelectedReminderEndDate;
        const hasMultiDayRange = Boolean(curStart && curEnd && curStart !== curEnd);

        if (hasMultiDayRange && (cell.classList.contains('range-end') || cellDate === curEnd)) {
            dragMode = 'adjust-end';
            state.calendarDragAnchorDate = curStart;
            state.calendarDragHoverDate = curEnd;
        } else if (hasMultiDayRange && (cell.classList.contains('range-start') || cellDate === curStart)) {
            dragMode = 'adjust-start';
            state.calendarDragAnchorDate = curEnd;
            state.calendarDragHoverDate = curStart;
        } else {
            dragMode = 'new';
            state.calendarDragAnchorDate = cellDate;
            state.calendarDragHoverDate = cellDate;
        }
    };

    const handlePointerMove = (e) => {
        if (!isDragCandidate && !state.isCalendarDateDragging) return;

        const clientX = (e.touches && e.touches.length > 0) ? e.touches[0].clientX : e.clientX;
        const clientY = (e.touches && e.touches.length > 0) ? e.touches[0].clientY : e.clientY;

        if (!state.isCalendarDateDragging) {
            const dist = Math.hypot(clientX - startPointerX, clientY - startPointerY);
            if (dist > 5) {
                state.isCalendarDateDragging = true;
                const calDaysEl = document.getElementById('cal-days');
                if (calDaysEl) calDaysEl.classList.add('is-dragging');
            }
        }

        if (state.isCalendarDateDragging) {
            if (e.cancelable) e.preventDefault();
            const hoverTarget = document.elementFromPoint(clientX, clientY);
            const cell = hoverTarget ? hoverTarget.closest('.cal-day-cell') : null;

            const curYear = state.calDate.getFullYear();
            const curMonth = state.calDate.getMonth() + 1;
            const daysInCurMonth = new Date(curYear, curMonth, 0).getDate();
            const lastDayStr = `${curYear}-${String(curMonth).padStart(2, '0')}-${String(daysInCurMonth).padStart(2, '0')}`;
            const firstDayStr = `${curYear}-${String(curMonth).padStart(2, '0')}-01`;

            const triggerDragMonthSwitch = (delta) => {
                if (monthSwitchCooldown) return;
                monthSwitchCooldown = true;
                setTimeout(() => { monthSwitchCooldown = false; }, 380);

                const anchor = state.calendarDragAnchorDate;
                changeMonth(delta);

                const newYear = state.calDate.getFullYear();
                const newMonth = state.calDate.getMonth() + 1;
                const daysInNewMonth = new Date(newYear, newMonth, 0).getDate();

                let newHoverDate = '';
                if (delta > 0) {
                    newHoverDate = `${newYear}-${String(newMonth).padStart(2, '0')}-01`;
                } else {
                    newHoverDate = `${newYear}-${String(newMonth).padStart(2, '0')}-${String(daysInNewMonth).padStart(2, '0')}`;
                }

                state.calendarDragAnchorDate = anchor;
                state.calendarDragHoverDate = newHoverDate;

                let actualStart = state.calendarDragAnchorDate;
                let actualEnd = newHoverDate;
                if (dragMode === 'adjust-start') {
                    actualEnd = state.calendarDragAnchorDate;
                    actualStart = newHoverDate > actualEnd ? actualEnd : newHoverDate;
                } else {
                    actualStart = state.calendarDragAnchorDate;
                    actualEnd = newHoverDate < actualStart ? actualStart : newHoverDate;
                }
                state.tempSelectedReminderStartDate = actualStart;
                state.tempSelectedReminderEndDate = actualEnd;
                state.tempSelectedReminderDate = actualStart;
                enforceSameDayTimeOrder();
                updateCalendarRangeHighlight(actualStart, actualEnd);
                triggerHaptic('light');
            };

            if (cell) {
                const hoverDate = getCellDateFromElement(cell);
                if (hoverDate && hoverDate !== state.calendarDragHoverDate) {
                    state.calendarDragHoverDate = hoverDate;
                    let actualStart = state.calendarDragAnchorDate;
                    let actualEnd = hoverDate;
                    if (dragMode === 'adjust-start') {
                        actualEnd = state.calendarDragAnchorDate;
                        actualStart = hoverDate > actualEnd ? actualEnd : hoverDate;
                    } else {
                        actualStart = state.calendarDragAnchorDate;
                        actualEnd = hoverDate < actualStart ? actualStart : hoverDate;
                    }
                    state.tempSelectedReminderStartDate = actualStart;
                    state.tempSelectedReminderEndDate = actualEnd;
                    state.tempSelectedReminderDate = actualStart;
                    enforceSameDayTimeOrder();
                    updateCalendarRangeHighlight(actualStart, actualEnd);
                }

                if (hoverDate === lastDayStr && dragMode !== 'adjust-start') {
                    if (!autoMonthSwitchTimer && !monthSwitchCooldown) {
                        autoMonthSwitchTimer = setTimeout(() => {
                            if (state.isCalendarDateDragging && state.calendarDragHoverDate === lastDayStr) {
                                triggerDragMonthSwitch(1);
                            }
                            autoMonthSwitchTimer = null;
                        }, 320);
                    }
                } else if (hoverDate === firstDayStr && dragMode === 'adjust-start') {
                    if (!autoMonthSwitchTimer && !monthSwitchCooldown) {
                        autoMonthSwitchTimer = setTimeout(() => {
                            if (state.isCalendarDateDragging && state.calendarDragHoverDate === firstDayStr) {
                                triggerDragMonthSwitch(-1);
                            }
                            autoMonthSwitchTimer = null;
                        }, 320);
                    }
                } else {
                    if (autoMonthSwitchTimer) {
                        clearTimeout(autoMonthSwitchTimer);
                        autoMonthSwitchTimer = null;
                    }
                }
            } else {
                const calDaysEl = document.getElementById('cal-days');
                if (calDaysEl) {
                    const rect = calDaysEl.getBoundingClientRect();
                    if (state.calendarDragHoverDate === lastDayStr && (clientY > rect.bottom - 15 || clientX > rect.right - 25)) {
                        triggerDragMonthSwitch(1);
                    } else if (state.calendarDragHoverDate === firstDayStr && (clientY < rect.top + 15 || clientX < rect.left + 25)) {
                        triggerDragMonthSwitch(-1);
                    }
                }
            }
        }
    };

    const handlePointerUp = (e) => {
        if (!isDragCandidate && !state.isCalendarDateDragging) return;

        if (autoMonthSwitchTimer) {
            clearTimeout(autoMonthSwitchTimer);
            autoMonthSwitchTimer = null;
        }

        const wasDragging = state.isCalendarDateDragging;
        isDragCandidate = false;
        state.isCalendarDateDragging = false;

        const calDaysEl = document.getElementById('cal-days');
        if (calDaysEl) calDaysEl.classList.remove('is-dragging');

        // 僅限透過滑動拖曳（wasDragging === true）產生與保留起訖區間
        if (wasDragging && state.calendarDragAnchorDate && state.calendarDragHoverDate) {
            let actualStart = state.calendarDragAnchorDate;
            let actualEnd = state.calendarDragHoverDate;
            if (dragMode === 'adjust-start') {
                actualEnd = state.calendarDragAnchorDate;
                actualStart = state.calendarDragHoverDate > actualEnd ? actualEnd : state.calendarDragHoverDate;
            } else {
                actualStart = state.calendarDragAnchorDate;
                actualEnd = state.calendarDragHoverDate < actualStart ? actualStart : state.calendarDragHoverDate;
            }
            state.tempSelectedReminderStartDate = actualStart;
            state.tempSelectedReminderEndDate = actualEnd;
            state.tempSelectedReminderDate = actualStart;
            state.calendarCrossMonthAnchorDate = '';
            enforceSameDayTimeOrder();
            updateCalendarRangeHighlight(actualStart, actualEnd);
            triggerHaptic('light');

            justFinishedCalendarDrag = true;
            setTimeout(() => { justFinishedCalendarDrag = false; }, 180);
        }

        state.calendarDragAnchorDate = '';
        state.calendarDragHoverDate = '';
        dragMode = 'new';
    };

    calDays.removeEventListener('mousedown', handlePointerDown);
    calDays.removeEventListener('touchstart', handlePointerDown);
    calDays.addEventListener('mousedown', handlePointerDown);
    calDays.addEventListener('touchstart', handlePointerDown, { passive: true });

    document.removeEventListener('mousemove', handlePointerMove);
    document.removeEventListener('touchmove', handlePointerMove);
    document.addEventListener('mousemove', handlePointerMove, { passive: false });
    document.addEventListener('touchmove', handlePointerMove, { passive: false });

    document.removeEventListener('mouseup', handlePointerUp);
    document.removeEventListener('touchend', handlePointerUp);
    document.removeEventListener('touchcancel', handlePointerUp);
    document.addEventListener('mouseup', handlePointerUp);
    document.addEventListener('touchend', handlePointerUp);
    document.addEventListener('touchcancel', handlePointerUp);
}

export function toggleCalendar() {
    const overlay = document.getElementById('calendar-overlay');
    const modal = document.getElementById('calendar-modal');

    if (state.currentUnifiedType === 'reminder') {
        const rStartDateVal = document.getElementById('reminder-start-date-val');
        const rEndDateVal = document.getElementById('reminder-end-date-val');
        const rDateVal = document.getElementById('reminder-date-val');

        let sDate = rStartDateVal ? rStartDateVal.value.trim() : '';
        let eDate = rEndDateVal ? rEndDateVal.value.trim() : '';

        if (!sDate && rDateVal && rDateVal.value) {
            const raw = rDateVal.value.trim();
            const dateMatches = raw.match(/\d{4}-\d{2}-\d{2}/g);
            if (dateMatches && dateMatches.length > 0) {
                sDate = dateMatches[0];
                eDate = dateMatches[1] || dateMatches[0];
            }
        }

        if (!sDate) {
            const now = new Date();
            sDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            eDate = sDate;
        }

        state.tempSelectedReminderStartDate = sDate;
        state.tempSelectedReminderEndDate = eDate || sDate;
        state.tempSelectedReminderDate = sDate;
        state.calendarCrossMonthAnchorDate = '';

        const parts = sDate.split('-');
        if (parts.length === 3) {
            state.calDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        }
    } else {
        state.tempSelectedReminderStartDate = '';
        state.tempSelectedReminderEndDate = '';
        state.tempSelectedReminderDate = '';
        state.calendarCrossMonthAnchorDate = '';
    }

    renderCalendar();
    updateCalendarRangeHighlight(state.tempSelectedReminderStartDate, state.tempSelectedReminderEndDate);

    overlay.style.display = 'block';
    modal.style.display = 'block';

    if (state.currentUnifiedType === 'reminder') {
        openCalendarTimeBar();
    } else {
        closeCalendarTimeBar();
    }

    requestAnimationFrame(() => requestAnimationFrame(() => {
        overlay.classList.add('active');
        modal.classList.add('active');
        if (state.currentUnifiedType === 'reminder') {
            positionCalendarTimeBar();
        }
    }));
}

export function confirmCalendarSelection() {
    let startDate = state.tempSelectedReminderStartDate;
    let endDate = state.tempSelectedReminderEndDate;

    if (!startDate && !endDate) {
        if (state.tempSelectedReminderDate) {
            startDate = state.tempSelectedReminderDate;
            endDate = state.tempSelectedReminderDate;
        } else {
            const rStartVal = document.getElementById('reminder-start-date-val');
            const rEndVal = document.getElementById('reminder-end-date-val');
            const rDateVal = document.getElementById('reminder-date-val');
            if (rStartVal && rStartVal.value) startDate = rStartVal.value.trim();
            if (rEndVal && rEndVal.value) endDate = rEndVal.value.trim();
            if (!startDate && rDateVal && rDateVal.value) {
                const parts = rDateVal.value.trim().split(/\s+/);
                startDate = parts[0] || '';
                endDate = startDate;
            }
        }
    }

    if (!startDate && endDate) startDate = endDate;
    if (startDate && !endDate) endDate = startDate;

    if (!startDate && !endDate) {
        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        startDate = todayStr;
        endDate = todayStr;
    }

    if (startDate > endDate) {
        endDate = startDate;
    }

    state.tempSelectedReminderStartDate = startDate;
    state.tempSelectedReminderEndDate = endDate;
    state.tempSelectedReminderDate = startDate;

    enforceSameDayTimeOrder();

    const days = ['日', '一', '二', '三', '四', '五', '六'];
    const getWeekday = (dStr) => {
        const parts = dStr.split('-');
        if (parts.length !== 3) return '';
        const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        return isNaN(d.getTime()) ? '' : `(${days[d.getDay()]})`;
    };

    const hasTime = state.isReminderStartTimeAdjusted || state.isReminderEndTimeAdjusted;
    const startHH = String(state.timeWheelStartHour).padStart(2, '0');
    const startMM = String(state.timeWheelStartMinute).padStart(2, '0');
    const endHH = String(state.timeWheelEndHour).padStart(2, '0');
    const endMM = String(state.timeWheelEndMinute).padStart(2, '0');

    let formattedDisplay = '';
    let valString = '';

    if (hasTime) {
        const startW = getWeekday(startDate);
        const endW = getWeekday(endDate);

        if (startDate === endDate) {
            formattedDisplay = `${startDate} ${startHH}:${startMM} ~ ${endHH}:${endMM} ${startW}`;
            valString = formattedDisplay;
        } else {
            formattedDisplay = `${startDate} ${startHH}:${startMM} ${startW} ~ ${endDate} ${endHH}:${endMM} ${endW}`;
            valString = formattedDisplay;
        }
    } else {
        if (startDate === endDate) {
            const startW = getWeekday(startDate);
            formattedDisplay = `${startDate} ${startW}`;
            valString = startDate;
        } else {
            formattedDisplay = `${startDate} ~ ${endDate}`;
            valString = formattedDisplay;
        }
    }

    const rDateVal = document.getElementById('reminder-date-val');
    const rStartDateVal = document.getElementById('reminder-start-date-val');
    const rEndDateVal = document.getElementById('reminder-end-date-val');

    if (rDateVal) rDateVal.value = valString;
    if (rStartDateVal) rStartDateVal.value = startDate;
    if (rEndDateVal) rEndDateVal.value = endDate;

    updateReminderPreviewDisplay();

    closeCalendar(true);
}

export function closeCalendar(committed = false) {
    if (document.activeElement) document.activeElement.blur();

    if (!committed) {
        state.tempSelectedReminderStartDate = '';
        state.tempSelectedReminderEndDate = '';
        state.tempSelectedReminderDate = '';
        state.isCalendarDateDragging = false;
        state.calendarDragAnchorDate = '';
        state.calendarDragHoverDate = '';
        state.calendarCrossMonthAnchorDate = '';
    }

    closeCalendarTimeBar();

    const overlay = document.getElementById('calendar-overlay');
    const modal = document.getElementById('calendar-modal');
    overlay.classList.remove('active');
    modal.classList.remove('active');
    setTimeout(() => {
        overlay.style.display = 'none';
        modal.style.display = 'none';
    }, 250);
}

export function changeMonth(delta) {
    if (state.tempSelectedReminderStartDate && !state.calendarCrossMonthAnchorDate) {
        state.calendarCrossMonthAnchorDate = state.tempSelectedReminderStartDate;
    }
    state.calDate.setMonth(state.calDate.getMonth() + delta);
    renderCalendar();
    updateCalendarRangeHighlight(state.tempSelectedReminderStartDate, state.tempSelectedReminderEndDate);
}

export function changeYear(delta) {
    if (state.tempSelectedReminderStartDate && !state.calendarCrossMonthAnchorDate) {
        state.calendarCrossMonthAnchorDate = state.tempSelectedReminderStartDate;
    }
    state.calDate.setFullYear(state.calDate.getFullYear() + delta);
    renderCalendar();
    updateCalendarRangeHighlight(state.tempSelectedReminderStartDate, state.tempSelectedReminderEndDate);
}

export function selectDate(year, month, day) {
    if (justFinishedCalendarDrag) {
        return;
    }

    const yStr = year;
    const mStr = String(month).padStart(2, '0');
    const dStr = String(day).padStart(2, '0');
    const dateStr = `${yStr}-${mStr}-${dStr}`;
    
    const editorModal = document.getElementById('editor-modal');
    const isEditorOpen = editorModal && editorModal.classList.contains('active');

    if (isEditorOpen) {
        // 單擊一律重置為單日，並清除任何多日選取與跨月錨點
        state.tempSelectedReminderStartDate = dateStr;
        state.tempSelectedReminderEndDate = dateStr;
        state.tempSelectedReminderDate = dateStr;
        state.calendarCrossMonthAnchorDate = '';

        enforceSameDayTimeOrder();

        const currentYear = state.calDate.getFullYear();
        const currentMonth = state.calDate.getMonth() + 1;

        if (year !== currentYear || month !== currentMonth) {
            state.calDate = new Date(year, month - 1, day);
            renderCalendar();
        } else {
            updateCalendarRangeHighlight(dateStr, dateStr);
        }
    } else {
        closeCalendar(false);
    }
}

export function positionCalendarTimeBar() {
    const topBar = document.getElementById('calendar-top-bar');
    const calModal = document.getElementById('calendar-modal');
    if (!topBar || !calModal) return;

    const isMobile = window.innerWidth <= 768;
    const barHeight = topBar.offsetHeight || (isMobile ? 52 : 60);
    const gap = 12;
    const modalHeight = calModal.offsetHeight || 380;
    const topPos = Math.max(12, Math.round((window.innerHeight / 2) - (modalHeight / 2) - barHeight - gap));

    topBar.style.top = `${topPos}px`;
    topBar.style.left = '50%';
}

export function openCalendarTimeBar() {
    const topBar = document.getElementById('calendar-top-bar');
    if (!topBar) return;

    initCalendarTimeWheelDOM();

    if (!topBar.classList.contains('active')) {
        let sHour = 12;
        let sMinute = 0;
        let eHour = 18;
        let eMinute = 0;

        if (state.currentEditingReminderId && state.reminders[state.currentEditingReminderId]) {
            const r = state.reminders[state.currentEditingReminderId];
            if (r.startTime) {
                const [sh, sm] = r.startTime.split(':').map(n => parseInt(n, 10));
                if (!isNaN(sh)) sHour = sh;
                if (!isNaN(sm)) sMinute = sm;
                state.isReminderStartTimeAdjusted = true;
            } else {
                state.isReminderStartTimeAdjusted = false;
            }
            if (r.endTime) {
                const [eh, em] = r.endTime.split(':').map(n => parseInt(n, 10));
                if (!isNaN(eh)) eHour = eh;
                if (!isNaN(em)) eMinute = em;
                state.isReminderEndTimeAdjusted = true;
            } else {
                state.isReminderEndTimeAdjusted = false;
            }
        } else {
            const rDateVal = document.getElementById('reminder-date-val');
            if (rDateVal && rDateVal.value) {
                const val = rDateVal.value.trim();
                const timeMatches = val.match(/\b(\d{1,2}):(\d{2})\b/g);
                if (timeMatches && timeMatches.length > 0) {
                    const [sh, sm] = timeMatches[0].split(':').map(Number);
                    sHour = sh; sMinute = sm;
                    state.isReminderStartTimeAdjusted = true;
                    if (timeMatches.length > 1) {
                        const [eh, em] = timeMatches[1].split(':').map(Number);
                        eHour = eh; eMinute = em;
                        state.isReminderEndTimeAdjusted = true;
                    }
                } else {
                    const now = new Date();
                    sHour = now.getHours();
                    sMinute = now.getMinutes();
                    eHour = Math.min(23, sHour + 1);
                    eMinute = sMinute;
                    state.isReminderStartTimeAdjusted = false;
                    state.isReminderEndTimeAdjusted = false;
                }
            } else {
                const now = new Date();
                sHour = now.getHours();
                sMinute = now.getMinutes();
                eHour = Math.min(23, sHour + 1);
                eMinute = sMinute;
                state.isReminderStartTimeAdjusted = false;
                state.isReminderEndTimeAdjusted = false;
            }
        }

        state.timeWheelStartHour = Math.max(0, Math.min(23, sHour));
        state.timeWheelStartMinute = Math.max(0, Math.min(59, sMinute));
        state.timeWheelEndHour = Math.max(0, Math.min(23, eHour));
        state.timeWheelEndMinute = Math.max(0, Math.min(59, eMinute));

        const sDate = state.tempSelectedReminderStartDate;
        const eDate = state.tempSelectedReminderEndDate;
        if (!sDate || !eDate || sDate === eDate) {
            const startTotal = state.timeWheelStartHour * 60 + state.timeWheelStartMinute;
            const endTotal = state.timeWheelEndHour * 60 + state.timeWheelEndMinute;
            if (startTotal > endTotal) {
                state.timeWheelEndHour = state.timeWheelStartHour;
                state.timeWheelEndMinute = state.timeWheelStartMinute;
            }
        }

        timeWheelSelectedHour = state.timeWheelStartHour;
        timeWheelSelectedMinute = state.timeWheelStartMinute;

        initialWheelStartHour = state.timeWheelStartHour;
        initialWheelStartMinute = state.timeWheelStartMinute;
        initialWheelEndHour = state.timeWheelEndHour;
        initialWheelEndMinute = state.timeWheelEndMinute;
    }

    updateTimeBarAdjustedUI();

    topBar.style.display = 'flex';
    requestAnimationFrame(() => {
        positionCalendarTimeBar();
        topBar.classList.add('active');
        setTimeWheelIndex('start-hours', state.timeWheelStartHour, false);
        setTimeWheelIndex('start-minutes', state.timeWheelStartMinute, false);
        setTimeWheelIndex('end-hours', state.timeWheelEndHour, false);
        setTimeWheelIndex('end-minutes', state.timeWheelEndMinute, false);
    });
}

export function closeCalendarTimeBar() {
    const topBar = document.getElementById('calendar-top-bar');
    if (!topBar) return;
    topBar.classList.remove('active');
    setTimeout(() => {
        if (!topBar.classList.contains('active')) {
            topBar.style.display = 'none';
        }
    }, 250);
}

function initCalendarTimeWheelDOM() {
    if (isCalendarTimeWheelInitialized) return;
    isCalendarTimeWheelInitialized = true;

    const wheelUnits = [
        { colId: 'time-col-start-hours', trackId: 'time-track-start-hours', unit: 'start-hours', count: 24 },
        { colId: 'time-col-start-minutes', trackId: 'time-track-start-minutes', unit: 'start-minutes', count: 60 },
        { colId: 'time-col-end-hours', trackId: 'time-track-end-hours', unit: 'end-hours', count: 24 },
        { colId: 'time-col-end-minutes', trackId: 'time-track-end-minutes', unit: 'end-minutes', count: 60 }
    ];

    wheelUnits.forEach(({ colId, trackId, unit, count }) => {
        const track = document.getElementById(trackId);
        if (track) {
            track.innerHTML = '';
            for (let i = 0; i < count; i++) {
                const item = document.createElement('div');
                item.className = 'calendar-time-item';
                item.dataset.value = i;
                item.textContent = String(i).padStart(2, '0');
                track.appendChild(item);
            }
            setupElasticPhysicsWheel(colId, trackId, unit, count);
        }
    });

    window.addEventListener('resize', () => {
        if (document.getElementById('calendar-top-bar')?.classList.contains('active')) {
            positionCalendarTimeBar();
        }
    }, { passive: true });
}

function getTrackByUnit(unit) {
    if (unit === 'start-hours') return document.getElementById('time-track-start-hours');
    if (unit === 'start-minutes') return document.getElementById('time-track-start-minutes');
    if (unit === 'end-hours') return document.getElementById('time-track-end-hours');
    if (unit === 'end-minutes') return document.getElementById('time-track-end-minutes');
    if (unit === 'hours') return document.getElementById('time-track-start-hours');
    if (unit === 'minutes') return document.getElementById('time-track-start-minutes');
    return null;
}

function setTimeWheelIndex(unit, index, animate = true) {
    const track = getTrackByUnit(unit);
    if (!track) return;

    const centerOffset = getTimeWheelCenterOffset();
    const targetY = centerOffset - (index * TIME_WHEEL_ITEM_HEIGHT);
    if (!animate) {
        track.style.transition = 'none';
        track.style.transform = `translateY(${targetY}px)`;
        track._currentY = targetY;
        updateTimeWheelActiveState(unit, index, false);
    } else {
        animateSpringSnap(track, unit, targetY, index);
    }
}

let isEnforcingTimeOrder = false;

export function enforceSameDayTimeOrder(sourceUnit = null) {
    if (isEnforcingTimeOrder) return;

    const sDate = state.tempSelectedReminderStartDate;
    const eDate = state.tempSelectedReminderEndDate;
    const isSameDay = !sDate || !eDate || sDate === eDate;
    if (!isSameDay) return;

    const startTotal = state.timeWheelStartHour * 60 + state.timeWheelStartMinute;
    const endTotal = state.timeWheelEndHour * 60 + state.timeWheelEndMinute;

    if (startTotal <= endTotal) return;

    isEnforcingTimeOrder = true;
    try {
        if (sourceUnit === 'end-hours' || sourceUnit === 'end-minutes') {
            state.timeWheelStartHour = state.timeWheelEndHour;
            state.timeWheelStartMinute = state.timeWheelEndMinute;
            timeWheelSelectedHour = state.timeWheelStartHour;
            timeWheelSelectedMinute = state.timeWheelStartMinute;
            setTimeWheelIndex('start-hours', state.timeWheelStartHour, false);
            setTimeWheelIndex('start-minutes', state.timeWheelStartMinute, false);
        } else {
            state.timeWheelEndHour = state.timeWheelStartHour;
            state.timeWheelEndMinute = state.timeWheelStartMinute;
            setTimeWheelIndex('end-hours', state.timeWheelEndHour, false);
            setTimeWheelIndex('end-minutes', state.timeWheelEndMinute, false);
        }
    } finally {
        isEnforcingTimeOrder = false;
    }
}

function updateTimeWheelActiveState(unit, activeIndex, triggerHapticFeedback = true) {
    const track = getTrackByUnit(unit);
    if (!track) return;
    const items = track.querySelectorAll('.calendar-time-item');
    items.forEach((item, idx) => {
        item.classList.toggle('active', idx === activeIndex);
    });

    let previousValue = 0;
    if (unit === 'start-hours' || unit === 'hours') {
        previousValue = state.timeWheelStartHour;
        state.timeWheelStartHour = activeIndex;
        timeWheelSelectedHour = activeIndex;
        if (!state.isReminderStartTimeAdjusted && activeIndex !== initialWheelStartHour) {
            state.isReminderStartTimeAdjusted = true;
        }
    } else if (unit === 'start-minutes' || unit === 'minutes') {
        previousValue = state.timeWheelStartMinute;
        state.timeWheelStartMinute = activeIndex;
        timeWheelSelectedMinute = activeIndex;
        if (!state.isReminderStartTimeAdjusted && activeIndex !== initialWheelStartMinute) {
            state.isReminderStartTimeAdjusted = true;
        }
    } else if (unit === 'end-hours') {
        previousValue = state.timeWheelEndHour;
        state.timeWheelEndHour = activeIndex;
        if (!state.isReminderEndTimeAdjusted && activeIndex !== initialWheelEndHour) {
            state.isReminderEndTimeAdjusted = true;
        }
    } else if (unit === 'end-minutes') {
        previousValue = state.timeWheelEndMinute;
        state.timeWheelEndMinute = activeIndex;
        if (!state.isReminderEndTimeAdjusted && activeIndex !== initialWheelEndMinute) {
            state.isReminderEndTimeAdjusted = true;
        }
    }

    if (triggerHapticFeedback && previousValue !== activeIndex) {
        triggerHaptic('light');
    }

    enforceSameDayTimeOrder(unit);
    updateTimeBarAdjustedUI();
}

function animateSpringSnap(track, unit, targetY, targetIndex) {
    if (track._springRAF) cancelAnimationFrame(track._springRAF);

    let currentY = track._currentY || getTimeWheelCenterOffset();
    let velocity = track._velocity || 0;
    const stiffness = 0.18;
    const damping = 0.72;
    const maxIndex = (unit === 'start-hours' || unit === 'end-hours' || unit === 'hours') ? 23 : 59;

    const step = () => {
        const force = (targetY - currentY) * stiffness;
        velocity = (velocity + force) * damping;
        currentY += velocity;

        track.style.transition = 'none';
        track.style.transform = `translateY(${currentY}px)`;
        track._currentY = currentY;

        const centerOffset = getTimeWheelCenterOffset();
        const liveIndex = Math.max(0, Math.min(maxIndex, Math.round((centerOffset - currentY) / TIME_WHEEL_ITEM_HEIGHT)));
        updateTimeWheelActiveState(unit, liveIndex, true);

        if (Math.abs(targetY - currentY) < 0.2 && Math.abs(velocity) < 0.2) {
            track.style.transform = `translateY(${targetY}px)`;
            track._currentY = targetY;
            track._velocity = 0;
            track._springRAF = null;
            updateTimeWheelActiveState(unit, targetIndex, false);
            triggerHaptic('heavy');
            return;
        }

        track._springRAF = requestAnimationFrame(step);
    };

    track._springRAF = requestAnimationFrame(step);
}

function setupElasticPhysicsWheel(colId, trackId, unit, totalCount) {
    const col = document.getElementById(colId);
    const track = document.getElementById(trackId);
    if (!col || !track) return;

    track._currentY = getTimeWheelCenterOffset();
    track._velocity = 0;

    let isTouching = false;
    let startPointerY = 0;
    let startTrackY = 0;
    let lastPointerY = 0;
    let lastTime = 0;
    let pointerVelocity = 0;

    const onPointerDown = (e) => {
        isTouching = true;
        if (track._springRAF) cancelAnimationFrame(track._springRAF);

        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        startPointerY = clientY;
        lastPointerY = clientY;
        startTrackY = track._currentY;
        lastTime = performance.now();
        pointerVelocity = 0;
    };

    const onPointerMove = (e) => {
        if (!isTouching) return;
        if (e.cancelable) e.preventDefault();

        const centerOffset = getTimeWheelCenterOffset();
        const maxY = centerOffset;
        const minY = centerOffset - ((totalCount - 1) * TIME_WHEEL_ITEM_HEIGHT);

        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const now = performance.now();
        const deltaY = clientY - startPointerY;
        let nextY = startTrackY + deltaY;

        if (nextY > maxY) {
            const overflow = nextY - maxY;
            nextY = maxY + (overflow * 0.35);
        } else if (nextY < minY) {
            const overflow = minY - nextY;
            nextY = minY - (overflow * 0.35);
        }

        const dt = now - lastTime;
        if (dt > 10) {
            pointerVelocity = (clientY - lastPointerY) / dt * 16;
            lastPointerY = clientY;
            lastTime = now;
        }

        track.style.transition = 'none';
        track.style.transform = `translateY(${nextY}px)`;
        track._currentY = nextY;

        const liveIndex = Math.max(0, Math.min(totalCount - 1, Math.round((centerOffset - nextY) / TIME_WHEEL_ITEM_HEIGHT)));
        updateTimeWheelActiveState(unit, liveIndex, true);
    };

    const onPointerUp = () => {
        if (!isTouching) return;
        isTouching = false;

        const centerOffset = getTimeWheelCenterOffset();
        let projectedY = track._currentY + (pointerVelocity * 4);
        let targetIndex = Math.round((centerOffset - projectedY) / TIME_WHEEL_ITEM_HEIGHT);
        targetIndex = Math.max(0, Math.min(totalCount - 1, targetIndex));

        const targetY = centerOffset - (targetIndex * TIME_WHEEL_ITEM_HEIGHT);
        track._velocity = pointerVelocity;
        animateSpringSnap(track, unit, targetY, targetIndex);
    };

    const onWheel = (e) => {
        e.preventDefault();
        if (track._springRAF) cancelAnimationFrame(track._springRAF);

        const centerOffset = getTimeWheelCenterOffset();
        const maxY = centerOffset;
        const minY = centerOffset - ((totalCount - 1) * TIME_WHEEL_ITEM_HEIGHT);

        const delta = -e.deltaY * 0.45;
        let nextY = track._currentY + delta;

        if (nextY > maxY) nextY = maxY + (nextY - maxY) * 0.2;
        if (nextY < minY) nextY = minY - (minY - nextY) * 0.2;

        track.style.transition = 'none';
        track.style.transform = `translateY(${nextY}px)`;
        track._currentY = nextY;

        let targetIndex = Math.round((centerOffset - nextY) / TIME_WHEEL_ITEM_HEIGHT);
        targetIndex = Math.max(0, Math.min(totalCount - 1, targetIndex));
        updateTimeWheelActiveState(unit, targetIndex, true);

        clearTimeout(track._wheelSnapTimer);
        track._wheelSnapTimer = setTimeout(() => {
            const targetY = centerOffset - (targetIndex * TIME_WHEEL_ITEM_HEIGHT);
            animateSpringSnap(track, unit, targetY, targetIndex);
        }, 80);
    };

    col.addEventListener('mousedown', onPointerDown);
    col.addEventListener('touchstart', onPointerDown, { passive: false });
    col.addEventListener('wheel', onWheel, { passive: false });

    window.addEventListener('mousemove', onPointerMove, { passive: false });
    window.addEventListener('touchmove', onPointerMove, { passive: false });
    window.addEventListener('mouseup', onPointerUp);
    window.addEventListener('touchend', onPointerUp);
    window.addEventListener('touchcancel', onPointerUp);
}

// ==========================================
// 排序、拖曳、搜尋、右鍵選單與同步設定
// ==========================================
export async function handleGoogleAuthClick() {
    await initGisTokenClient();
    await requestGoogleAuth();
    updateGoogleAccountUIState();
}

export async function handleGoogleSignOutClick() {
    await signOutGoogle();
    updateGoogleAccountUIState();
}

export function openSyncSettingsFromAlert() {
    const alertModal = document.getElementById('cloud-alert-modal');
    alertModal.classList.remove('active');
    setTimeout(() => {
        alertModal.style.display = 'none';
        openSettingsModal();
    }, 250);
}

export function forceDownload() {
    closeSettingsModal();
    downloadFromDrive(false);
}

export function handleSearch() {
    const searchInput = document.getElementById('main-search-input');
    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
    if (state.isSelectionMode && document.activeElement === searchInput && query.length > 0) {
        exitSelectionMode(false);
    }
    const clearBtn = document.getElementById('clear-search-btn');
    if (clearBtn) clearBtn.classList.toggle('visible', query.length > 0);
    const container = document.getElementById(`${state.currentView}-view-container`) || document.getElementById('content-container');
    if (!container) return;

    // 清理舊有搜尋空狀態提示
    const existingSearchEmpty = container.querySelector('.search-empty-state');
    if (existingSearchEmpty) existingSearchEmpty.remove();

    // 若分類/視圖原本就無卡片，維持原始空狀態，不疊加搜尋提示
    const hasOriginalEmpty = container.querySelector('.empty-state-view:not(.search-empty-state)');
    if (hasOriginalEmpty && !container.querySelector('.note-card, .reminder-card')) {
        updateChapterNav([]);
        return;
    }

    const navItems = [];
    let totalVisibleCards = 0;

    if (state.currentView === 'bookmarks') {
        const wrappers = container.querySelectorAll('.category-wrapper');
        if (wrappers.length > 0) {
            wrappers.forEach(wrapper => {
                let hasVisibleCard = false;
                const cards = wrapper.querySelectorAll('.note-card');
                cards.forEach(card => {
                    const id = card.dataset.id;
                    const bm = state.bookmarks[id] || {};
                    const textToSearch = `${bm.title || ''} ${bm.url || ''} ${bm.description || ''} ${bm.content || ''} ${bm.category || ''} ${bm.subCategory || ''}`.toLowerCase();
                    if (!query || textToSearch.includes(query)) {
                        card.style.display = 'flex';
                        hasVisibleCard = true;
                        totalVisibleCards++;
                    } else {
                        card.style.display = 'none';
                    }
                });
                wrapper.style.display = hasVisibleCard ? 'block' : 'none';
                if (hasVisibleCard) {
                    const titleEl = wrapper.querySelector('.month-title');
                    const label = (titleEl ? titleEl.innerText : wrapper.dataset.subcategory) || '未分類';
                    navItems.push({ label, targetDOM: titleEl || wrapper });
                }
            });
        } else {
            const cards = container.querySelectorAll('.note-card');
            cards.forEach(card => {
                const id = card.dataset.id;
                const bm = state.bookmarks[id] || {};
                const textToSearch = `${bm.title || ''} ${bm.url || ''} ${bm.description || ''} ${bm.content || ''} ${bm.category || ''} ${bm.subCategory || ''}`.toLowerCase();
                if (!query || textToSearch.includes(query)) {
                    card.style.display = 'flex';
                    totalVisibleCards++;
                } else {
                    card.style.display = 'none';
                }
            });
            const grid = container.querySelector('.note-grid');
            if (grid) grid.style.display = totalVisibleCards > 0 ? 'grid' : 'none';
        }
    } else if (state.currentView === 'reminders') {
        const wrappers = container.querySelectorAll('.category-wrapper');
        if (wrappers.length > 0) {
            wrappers.forEach(wrapper => {
                let hasVisibleCard = false;
                const cards = wrapper.querySelectorAll('.reminder-card');
                cards.forEach(card => {
                    const id = card.dataset.id;
                    const r = state.reminders[id] || {};
                    const textToSearch = `${r.title || ''} ${r.content || ''} ${r.date || ''}`.toLowerCase();
                    if (!query || textToSearch.includes(query)) {
                        card.style.display = 'flex';
                        hasVisibleCard = true;
                        totalVisibleCards++;
                    } else {
                        card.style.display = 'none';
                    }
                });
                wrapper.style.display = hasVisibleCard ? 'block' : 'none';
                if (hasVisibleCard) {
                    const titleEl = wrapper.querySelector('.month-title');
                    const label = (titleEl ? titleEl.innerText : wrapper.dataset.reminderGroup) || '提醒';
                    navItems.push({ label, targetDOM: titleEl || wrapper });
                }
            });
        } else {
            const cards = container.querySelectorAll('.reminder-card');
            cards.forEach(card => {
                const id = card.dataset.id;
                const r = state.reminders[id] || {};
                const textToSearch = `${r.title || ''} ${r.content || ''} ${r.date || ''}`.toLowerCase();
                if (!query || textToSearch.includes(query)) {
                    card.style.display = 'flex';
                    totalVisibleCards++;
                } else {
                    card.style.display = 'none';
                }
            });
            const grid = container.querySelector('.reminders-masonry');
            if (grid) grid.style.display = totalVisibleCards > 0 ? 'grid' : 'none';
        }
    }

    if (totalVisibleCards === 0 && query) {
        const emptyEl = document.createElement('div');
        emptyEl.className = 'empty-state-view search-empty-state';
        const span = document.createElement('span');
        span.innerText = '查無相關搜尋結果';
        emptyEl.appendChild(span);
        container.appendChild(emptyEl);
        updateChapterNav([]);
    } else {
        updateChapterNav(navItems);
    }
}

export function clearSearch() {
    const input = document.getElementById('main-search-input');
    if (input) {
        input.value = '';
        handleSearch();
    }
}

export function handleContextMenuTrigger(targetNode, x, y) {
    const element = targetNode instanceof Element ? targetNode : targetNode.parentElement;
    if (!element) {
        hideContextMenu();
        return;
    }

    const card = element.closest('.note-card') || element.closest('.reminder-card');
    const contentContainer = element.closest('#content-container');
    const cm = document.getElementById('custom-context-menu');

    if (!card && !contentContainer) {
        hideContextMenu();
        return;
    }

    cm.classList.remove('active');
    cm.style.display = 'none';

    cm.dataset.triggerX = x;
    cm.dataset.triggerY = y;
    
    document.getElementById('context-add-btn').style.display = 'none';
    document.getElementById('context-edit-btn').style.display = 'none';
    document.getElementById('context-delete-btn').style.display = 'none';

    if (card) {
        document.getElementById('context-edit-btn').style.display = 'flex';
        document.getElementById('context-delete-btn').style.display = 'flex';
        let type = 'reminder';
        if (state.currentView === 'bookmarks') type = 'bookmark';
        state.contextTarget = { type, id: card.dataset.id };
    } else if (contentContainer) {
        document.getElementById('context-add-btn').style.display = 'flex';
        const addText = state.currentView === 'bookmarks' ? '新增內容' : '新增提醒';
        document.getElementById('context-add-text').innerText = addText;
    } 

    cm.style.display = 'block';
    const menuWidth = cm.offsetWidth || 140; 
    const menuHeight = cm.offsetHeight || 100; 
    
    let adjustedX = x - 5;
    let adjustedY = y - 5;

    if (adjustedX < 0) adjustedX = 0;
    if (adjustedY < 0) adjustedY = 0;
    if (adjustedX + menuWidth > state._cachedInnerWidth) adjustedX = state._cachedInnerWidth - menuWidth - 10;
    if (adjustedY + menuHeight > state._cachedInnerHeight) adjustedY = state._cachedInnerHeight - menuHeight - 10;

    cm.style.left = adjustedX + 'px';
    cm.style.top = adjustedY + 'px';
    requestAnimationFrame(() => requestAnimationFrame(() => cm.classList.add('active')));
}

export function hideContextMenu() {
    const cm = document.getElementById('custom-context-menu');
    if (!cm.classList.contains('active')) return;
    cm.classList.remove('active');
    
    setTimeout(() => {
        if (!cm.classList.contains('active')) {
            cm.style.display = 'none';
        }
    }, 150); 
}

export function showContextMenu(e, type, id, element) {
    e.preventDefault();
    e.stopPropagation();

    if (state.isSelectionMode) {
        return;
    }

    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.closest('[contenteditable="true"]')) {
        return;
    }
    
    const activeModals = document.querySelectorAll('.active');
    for (let i = 0; i < activeModals.length; i++) {
        const el = activeModals[i];
        if (el.id.endsWith('-modal') || el.id.endsWith('-overlay')) {
            return; 
        }
    }

    if (e.target.closest('#sidebar')) {
        return;
    }
    
    handleContextMenuTrigger(element, e.pageX, e.pageY);
}

export function triggerContextAdd() {
    hideContextMenu();
    if (state.currentView === 'bookmarks') openBookmarkEditor();
    else openReminderEditor();
}

export function triggerContextEdit() {
    hideContextMenu();
    if (state.contextTarget.type === 'bookmark') openBookmarkEditor(state.contextTarget.id);
    else if (state.contextTarget.type === 'reminder') openReminderEditor(state.contextTarget.id);
}

export function triggerContextDelete() {
    hideContextMenu();
    if (state.contextTarget.type === 'bookmark') {
        state.currentEditingBookmarkId = state.contextTarget.id;
        showDeleteConfirm('bookmark');
    } else if (state.contextTarget.type === 'reminder') {
        state.currentEditingReminderId = state.contextTarget.id;
        showDeleteConfirm('reminder');
    }
}

export function positionEditorSwitchBar() {
    const switchBar = document.getElementById('editor-bottom-switch-bar');
    const sortModal = document.getElementById('sort-modal');
    const editorModal = document.getElementById('editor-modal');
    const modal = (sortModal && sortModal.classList.contains('active')) ? sortModal : editorModal;
    if (!switchBar || !modal) return;

    // 直接取用未受進場動畫 transform: translateY(-42%) 扭曲之靜態本體高度
    const modalHeight = modal.offsetHeight || 536;
    const isMobile = window.innerWidth <= 768;
    const gap = isMobile ? 12 : 14;
    const barHeight = switchBar.offsetHeight || 40;

    let topPos = Math.round((window.innerHeight + modalHeight) / 2 + gap);
    if (topPos + barHeight > window.innerHeight - 8) {
        topPos = window.innerHeight - barHeight - 8;
    }

    switchBar.style.top = `${topPos}px`;
    switchBar.style.left = '50%';
}

export function openEditorSwitchBar() {
    const switchBar = document.getElementById('editor-bottom-switch-bar');
    if (!switchBar) return;
    switchBar.style.display = 'flex';
    positionEditorSwitchBar();
    requestAnimationFrame(() => {
        switchBar.classList.add('active');
    });
}

export function closeEditorSwitchBar() {
    const switchBar = document.getElementById('editor-bottom-switch-bar');
    if (!switchBar) return;
    switchBar.classList.remove('active');
    setTimeout(() => {
        if (!switchBar.classList.contains('active')) {
            switchBar.style.display = 'none';
            switchBar.setAttribute('data-active', 'create');
            const createBtn = document.getElementById('bottom-switch-create-btn');
            const sortBtn = document.getElementById('bottom-switch-sort-btn');
            if (createBtn) createBtn.classList.add('active');
            if (sortBtn) sortBtn.classList.remove('active');
        }
    }, 250);
}

let mobileSwitchTooltipTimer = null;

export function showEditorSwitchTooltipBriefly() {
    const bar = document.getElementById('editor-bottom-switch-bar');
    if (!bar) return;
    const active = bar.getAttribute('data-active') || 'create';
    const tooltip = bar.querySelector(`.tooltip-${active}`);
    if (!tooltip) return;

    clearTimeout(mobileSwitchTooltipTimer);
    bar.querySelectorAll('.bottom-switch-tooltip').forEach(el => el.classList.remove('show-tooltip'));
    tooltip.classList.add('show-tooltip');

    mobileSwitchTooltipTimer = setTimeout(() => {
        tooltip.classList.remove('show-tooltip');
    }, 1000);
}

export function switchEditorModalTab(tab, reposition = true, fromDrag = false) {
    const bar = document.getElementById('editor-bottom-switch-bar');
    const createBtn = document.getElementById('bottom-switch-create-btn');
    const sortBtn = document.getElementById('bottom-switch-sort-btn');
    const editorModal = document.getElementById('editor-modal');

    const isSort = tab === 'sort';
    if (bar) {
        bar.setAttribute('data-active', tab);
        if (createBtn) createBtn.classList.toggle('active', !isSort);
        if (sortBtn) sortBtn.classList.toggle('active', isSort);
    }

    if (isSort) {
        if (editorModal) {
            editorModal.classList.remove('active');
            editorModal.style.display = 'none';
        }
        openSortModal();
    } else {
        closeSortModal();
        if (editorModal) {
            editorModal.style.display = 'block';
            requestAnimationFrame(() => requestAnimationFrame(() => {
                editorModal.classList.add('active');
                positionEditorSwitchBar();
            }));
        }
    }

    showEditorSwitchTooltipBriefly();

    if (reposition) {
        requestAnimationFrame(() => {
            positionEditorSwitchBar();
        });
    }
}

export function initEditorBottomSwitchBarInteractions() {
    const bar = document.getElementById('editor-bottom-switch-bar');
    if (!bar) return;
    const slider = bar.querySelector('.bottom-switch-slider');
    const btns = bar.querySelectorAll('.bottom-switch-btn');
    if (!slider || btns.length < 2) return;

    let isDragging = false;
    let startX = 0;
    let currentSliderX = 0;
    let barWidth = 0;
    let hasMoved = false;

    const startDrag = (clientX) => {
        isDragging = true;
        hasMoved = false;
        startX = clientX;
        barWidth = bar.offsetWidth / 2;
        const activeMode = bar.getAttribute('data-active') || 'create';
        currentSliderX = activeMode === 'create' ? 0 : barWidth;
    };

    const moveDrag = (clientX) => {
        if (!isDragging || !slider) return;
        const diffX = clientX - startX;
        if (Math.abs(diffX) > 3) hasMoved = true;
        if (hasMoved) {
            slider.style.transition = 'none';
            let newX = currentSliderX + diffX;
            if (newX < 0) newX = 0;
            if (newX > barWidth) newX = barWidth;

            // 動態拉絲形變：在軌道中間 (50%) 時拉絲最長，越接近兩端端點 (0% 或 100%) 越縮小復原
            const progress = barWidth > 0 ? (newX / barWidth) : 0;
            const centerFactor = Math.sin(progress * Math.PI);
            const stretch = 1 + (0.55 * centerFactor);
            const squash = 1 / Math.sqrt(stretch);

            slider.style.transformOrigin = 'center center';
            slider.style.transform = `translateX(${newX}px) scaleX(${stretch.toFixed(3)}) scaleY(${squash.toFixed(3)})`;

            const targetIdx = newX > barWidth / 2 ? 1 : 0;
            btns[0].classList.toggle('active', targetIdx === 0);
            btns[1].classList.toggle('active', targetIdx === 1);
        }
    };

    const endDrag = (clientX) => {
        if (!isDragging) return;
        isDragging = false;

        if (!hasMoved) {
            slider.style.transition = '';
            slider.style.transform = '';
            slider.style.transformOrigin = '';
            return;
        }

        const finalX = currentSliderX + (clientX - startX);
        const targetMode = finalX > barWidth / 2 ? 'sort' : 'create';

        slider.style.transition = 'transform 0.38s cubic-bezier(0.34, 1.56, 0.64, 1)';
        slider.style.transformOrigin = 'center center';
        slider.style.transform = targetMode === 'create' ? 'translateX(0) scale(1)' : `translateX(${barWidth}px) scale(1)`;

        setTimeout(() => {
            if (!isDragging) {
                slider.style.transition = '';
                slider.style.transform = '';
                slider.style.transformOrigin = '';
            }
        }, 380);

        switchEditorModalTab(targetMode, true, true);
    };

    bar.addEventListener('mousedown', (e) => startDrag(e.clientX));
    bar.addEventListener('touchstart', (e) => {
        bar.classList.add('touch-active');
        showEditorSwitchTooltipBriefly();
        if (e.touches && e.touches[0]) startDrag(e.touches[0].clientX);
    }, { passive: true });

    document.addEventListener('mousemove', (e) => {
        if (isDragging) moveDrag(e.clientX);
    });
    document.addEventListener('touchmove', (e) => {
        if (isDragging && e.touches && e.touches[0]) {
            if (e.cancelable) e.preventDefault();
            moveDrag(e.touches[0].clientX);
        }
    }, { passive: false });

    document.addEventListener('mouseup', (e) => {
        if (isDragging) endDrag(e.clientX);
    });
    document.addEventListener('touchend', (e) => {
        bar.classList.remove('touch-active');
        btns.forEach(btn => btn.blur());
        if (isDragging && e.changedTouches && e.changedTouches[0]) {
            endDrag(e.changedTouches[0].clientX);
        }
    }, { passive: true });
    document.addEventListener('touchcancel', () => {
        bar.classList.remove('touch-active');
        btns.forEach(btn => btn.blur());
    }, { passive: true });

    window.addEventListener('resize', () => {
        if (bar.classList.contains('active')) {
            positionEditorSwitchBar();
        }
        const catModal = document.getElementById('category-modal');
        if (catModal && catModal.classList.contains('active')) {
            positionCategoryConfirmBtn();
        }
        const sortModal = document.getElementById('sort-modal');
        if (sortModal && sortModal.classList.contains('active')) {
            positionSortConfirmBtn();
        }
    }, { passive: true });
}

export let justFinishedSortDrag = false;

export function openSortModal() {
    state.sortModalStep = 1;
    state.tempSortCategory = '';
    state.tempSortSubCategory = '';
    state.tempSortCategoryOrder = [];
    state.tempSortSubCategoryOrders = {};
    state.tempSortCardOrders = {};

    renderSortModalColumns();

    const overlay = document.getElementById('modal-overlay');
    const modal = document.getElementById('sort-modal');
    const confirmBtn = document.getElementById('sort-confirm-btn');
    const externalTopBar = document.getElementById('sort-external-top-bar');

    if (overlay) {
        overlay.style.display = 'block';
        overlay.classList.add('active');
    }
    if (modal) {
        modal.style.display = 'flex';
        requestAnimationFrame(() => requestAnimationFrame(() => {
            modal.classList.add('active');
            positionSortConfirmBtn();
            positionEditorSwitchBar();
        }));
    }
    if (confirmBtn) {
        confirmBtn.style.display = 'flex';
        requestAnimationFrame(() => confirmBtn.classList.add('active'));
    }
    if (externalTopBar) {
        externalTopBar.style.display = 'flex';
        requestAnimationFrame(() => externalTopBar.classList.add('active'));
    }
}

export function closeSortModal() {
    const modal = document.getElementById('sort-modal');
    const confirmBtn = document.getElementById('sort-confirm-btn');
    const externalTopBar = document.getElementById('sort-external-top-bar');

    if (confirmBtn) confirmBtn.classList.remove('active');
    if (externalTopBar) externalTopBar.classList.remove('active');
    if (modal) modal.classList.remove('active');

    state.tempSortCategory = '';
    state.tempSortSubCategory = '';
    state.sortModalStep = 1;

    setTimeout(() => {
        if (modal && !modal.classList.contains('active')) modal.style.display = 'none';
        if (confirmBtn && !confirmBtn.classList.contains('active')) confirmBtn.style.display = 'none';
        if (externalTopBar && !externalTopBar.classList.contains('active')) externalTopBar.style.display = 'none';
    }, 250);
}

export function handleSelectSortCategory(cat) {
    if (state.tempSortCategory === cat && state.sortModalStep >= 2) {
        state.tempSortCategory = '';
        state.tempSortSubCategory = '';
        state.sortModalStep = 1;
    } else {
        state.tempSortCategory = cat;
        state.tempSortSubCategory = '';
        state.sortModalStep = 2;
    }
    renderSortModalColumns();
}

export function handleSelectSortSubCategory(sub) {
    if (state.tempSortSubCategory === sub && state.sortModalStep === 3) {
        state.tempSortSubCategory = '';
        state.sortModalStep = 2;
    } else {
        state.tempSortSubCategory = sub;
        state.sortModalStep = 3;
    }
    renderSortModalColumns();
}

export function handleSortBackStep() {
    if (state.sortModalStep === 3) {
        state.tempSortSubCategory = '';
        state.sortModalStep = 2;
    } else if (state.sortModalStep === 2) {
        state.tempSortCategory = '';
        state.tempSortSubCategory = '';
        state.sortModalStep = 1;
    }
    renderSortModalColumns();
}

export function confirmSortModalSelection() {
    const now = Date.now();

    // 1. 提交分類排序
    if (Array.isArray(state.tempSortCategoryOrder) && state.tempSortCategoryOrder.length > 0) {
        localStorage.setItem('my_category_order', JSON.stringify(state.tempSortCategoryOrder));
        localStorage.setItem('my_category_order_updatedAt', now.toString());
    }

    // 2. 提交子分類排序
    if (state.tempSortSubCategoryOrders && Object.keys(state.tempSortSubCategoryOrders).length > 0) {
        const subOrdersMap = safeJSONParse(localStorage.getItem('my_subcategory_order'), {});
        Object.keys(state.tempSortSubCategoryOrders).forEach(cat => {
            subOrdersMap[cat] = state.tempSortSubCategoryOrders[cat];
        });
        localStorage.setItem('my_subcategory_order', JSON.stringify(subOrdersMap));
        localStorage.setItem('my_subcategory_order_updatedAt', now.toString());
    }

    // 3. 提交卡片排序 (更新各卡片 order 屬性)
    if (state.tempSortCardOrders && Object.keys(state.tempSortCardOrders).length > 0) {
        Object.values(state.tempSortCardOrders).forEach(cardIdList => {
            if (Array.isArray(cardIdList)) {
                cardIdList.forEach((id, index) => {
                    if (state.bookmarks[id] && state.bookmarks[id].order !== index) {
                        state.bookmarks[id].order = index;
                        state.bookmarks[id].updatedAt = now;
                        StorageAPI.saveItem('bookmarks', id, state.bookmarks[id]);
                    }
                });
            }
        });
    }

    localStorage.setItem(PENDING_SYNC_FLAG, 'true');
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

export function initSortModalDrag() {
    const modal = document.getElementById('sort-modal');
    if (!modal) return;

    let isDragCandidate = false;
    let isDragging = false;
    let draggingItem = null;
    let dragGhost = null;
    let placeholder = null;
    let longPressTimer = null;
    let startPointerX = 0;
    let startPointerY = 0;
    let activeList = null;
    let sortType = '';

    const checkSortSwap = (clientY) => {
        if (!isDragging || !placeholder || !activeList) return;

        const allItems = Array.from(activeList.querySelectorAll('.sort-modal-item:not(.placeholder)'));
        if (allItems.length === 0) return;

        const listRect = activeList.getBoundingClientRect();
        const firstItem = allItems[0];
        const firstRect = firstItem.getBoundingClientRect();
        const firstCenterY = firstRect.top + (firstRect.height / 2);

        if (clientY <= firstCenterY || clientY <= (listRect.top + 16)) {
            if (activeList.firstElementChild !== placeholder) {
                activeList.prepend(placeholder);
            }
            return;
        }

        const lastItem = allItems[allItems.length - 1];
        const lastRect = lastItem.getBoundingClientRect();
        const lastCenterY = lastRect.top + (lastRect.height / 2);

        if (clientY >= lastCenterY || clientY >= (listRect.bottom - 8)) {
            if (lastItem.nextElementSibling !== placeholder) {
                lastItem.after(placeholder);
            }
            return;
        }

        for (let i = 0; i < allItems.length; i++) {
            const item = allItems[i];
            const rect = item.getBoundingClientRect();
            if (clientY >= rect.top && clientY <= rect.bottom) {
                const itemCenterY = rect.top + (rect.height / 2);
                if (clientY > itemCenterY) {
                    if (item.nextElementSibling !== placeholder) {
                        item.after(placeholder);
                    }
                } else {
                    if (item.previousElementSibling !== placeholder) {
                        item.before(placeholder);
                    }
                }
                break;
            }
        }
    };

    const startDrag = (item, clientX, clientY) => {
        isDragging = true;
        draggingItem = item;
        sortType = item.dataset.sortType || '';
        activeList = item.closest('.sort-column-list');

        item.classList.add('is-drag-origin');

        placeholder = document.createElement('div');
        placeholder.className = 'sort-modal-item placeholder';
        item.before(placeholder);

        dragGhost = document.createElement('div');
        dragGhost.className = 'sort-drag-ghost';
        const textVal = item.querySelector('.sort-modal-item-text')?.innerText || '';
        dragGhost.innerHTML = `
            <span class="item-icon category-dot">
                <span class="category-dot-circle"></span>
            </span>
            <span class="sort-modal-item-text">${textVal}</span>
        `;
        dragGhost.style.left = `${clientX}px`;
        dragGhost.style.top = `${clientY}px`;

        document.body.appendChild(dragGhost);
        document.body.classList.add('no-scroll', 'is-dragging-item');
    };

    const handlePointerDown = (e) => {
        const item = e.target.closest('.sort-modal-item');
        if (!item) return;

        isDragCandidate = true;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        startPointerX = clientX;
        startPointerY = clientY;

        longPressTimer = setTimeout(() => {
            if (navigator.vibrate) navigator.vibrate(30);
            startDrag(item, clientX, clientY);
        }, 280);
    };

    const handlePointerMove = (e) => {
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        if (isDragCandidate && !isDragging) {
            if (Math.hypot(clientX - startPointerX, clientY - startPointerY) > 8) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
                isDragCandidate = false;
            }
        }

        if (isDragging && dragGhost) {
            if (e.cancelable) e.preventDefault();
            dragGhost.style.left = `${clientX}px`;
            dragGhost.style.top = `${clientY}px`;
            checkSortSwap(clientY);
        }
    };

    const handlePointerUp = () => {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
        isDragCandidate = false;

        if (!isDragging) return;
        isDragging = false;

        if (dragGhost && dragGhost.parentNode) {
            dragGhost.parentNode.removeChild(dragGhost);
        }
        dragGhost = null;

        document.body.classList.remove('no-scroll', 'is-dragging-item');

        if (draggingItem) {
            draggingItem.classList.remove('is-drag-origin');
            if (placeholder && placeholder.parentNode) {
                placeholder.replaceWith(draggingItem);
            }
        }

        justFinishedSortDrag = true;
        window.justFinishedSortDrag = true;
        setTimeout(() => {
            justFinishedSortDrag = false;
            window.justFinishedSortDrag = false;
        }, 150);

        // 同步拖曳後的暫存陣列順序
        if (activeList) {
            const currentItems = Array.from(activeList.querySelectorAll('.sort-modal-item:not(.placeholder)'));
            if (sortType === 'category') {
                state.tempSortCategoryOrder = currentItems.map(el => el.dataset.category).filter(Boolean);
            } else if (sortType === 'subcategory') {
                const currentCat = state.tempSortCategory;
                if (!state.tempSortSubCategoryOrders) state.tempSortSubCategoryOrders = {};
                state.tempSortSubCategoryOrders[currentCat] = currentItems.map(el => el.dataset.subcategory).filter(Boolean);
            } else if (sortType === 'card') {
                const currentCat = state.tempSortCategory;
                const currentSub = state.tempSortSubCategory;
                const cardKey = `${currentCat}:::${currentSub}`;
                if (!state.tempSortCardOrders) state.tempSortCardOrders = {};
                state.tempSortCardOrders[cardKey] = currentItems.map(el => el.dataset.id).filter(Boolean);
            }
        }

        draggingItem = null;
        placeholder = null;
        activeList = null;
        sortType = '';
    };

    modal.addEventListener('mousedown', handlePointerDown);
    modal.addEventListener('touchstart', handlePointerDown, { passive: true });

    document.addEventListener('mousemove', handlePointerMove, { passive: false });
    document.addEventListener('touchmove', handlePointerMove, { passive: false });

    document.addEventListener('mouseup', handlePointerUp);
    document.addEventListener('touchend', handlePointerUp);
    document.addEventListener('touchcancel', handlePointerUp);
}

// ==========================================
// 集中式鍵盤快捷鍵
// ==========================================
function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        const key = e.key;
        if (key === 'Escape') {
            const calendarModal = document.getElementById('calendar-modal');
            if (calendarModal && calendarModal.classList.contains('active')) {
                closeCalendar();
                return;
            }

            const confirmModal = document.getElementById('confirm-modal');
            if (confirmModal && confirmModal.classList.contains('active')) {
                closeConfirm();
                return;
            }

            const categoryModal = document.getElementById('category-modal');
            if (categoryModal && categoryModal.classList.contains('active')) {
                closeCategoryModal();
                return;
            }
            const cloudAlert = document.getElementById('cloud-alert-modal');
            if (cloudAlert && cloudAlert.classList.contains('active')) {
                closeCloudAlert();
                return;
            }
            const settingsModal = document.getElementById('settings-modal');
            if (settingsModal && settingsModal.classList.contains('active')) {
                closeSettingsModal();
                return;
            }

            const popoverMenu = document.getElementById('category-popover-menu');
            if (popoverMenu && popoverMenu.classList.contains('active')) {
                hideCategoryPopoverMenu();
                return;
            }

            const fullModal = document.getElementById('full-editor-modal');
            if (fullModal && fullModal.classList.contains('active')) {
                saveFullEditor();
                return;
            }

            const sortModal = document.getElementById('sort-modal');
            if (sortModal && sortModal.classList.contains('active')) {
                closeSortModal();
                closeAllEditors();
                return;
            }

            const editorModal = document.getElementById('editor-modal');
            if (editorModal && editorModal.classList.contains('active')) {
                closeAllEditors();
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
// 全域事件監聽初始化 
// ==========================================
export function initGlobalInteractions() {
    initKeyboardShortcuts();
    initCleanPasteHandling();
    initCalendarDragInteractions(); 
    initSortModalDrag();
    initEditorBottomSwitchBarInteractions(); 

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

    let edgeSwipeStartX = -1;
    document.addEventListener('touchstart', (e) => {
        if (e.touches.length > 0 && e.touches[0].clientX <= 30) {
            edgeSwipeStartX = e.touches[0].clientX;
        } else {
            edgeSwipeStartX = -1;
        }
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
        if (edgeSwipeStartX >= 0 && e.changedTouches.length > 0) {
            let diffX = e.changedTouches[0].clientX - edgeSwipeStartX;
            if (diffX > 40) {
                const sidebar = document.getElementById('sidebar');
                if (state._cachedInnerWidth <= 768 && sidebar && !sidebar.classList.contains('mobile-open')) {
                    toggleSidebar();
                }
            }
        }
    }, { passive: true });

    const mainContainer = document.querySelector('main');
    let isScrollingTimer = null;

    const updateMobileFloatingNav = () => {
        const floatingNav = document.getElementById('mobile-floating-nav');
        if (!floatingNav || !mainContainer) return;

        if (state._cachedInnerWidth > 768) {
            floatingNav.classList.remove('visible');
            return;
        }

        const currentScroll = mainContainer.scrollTop;
        if (currentScroll > 60) {
            floatingNav.classList.add('visible');
        } else if (currentScroll < 30) {
            floatingNav.classList.remove('visible');
        }
    };

    if (mainContainer) {
        let scrollRAF = null;
        const clearScrollingState = () => {
            document.body.classList.remove('is-scrolling');
            isScrollingTimer = null;
        };

        mainContainer.addEventListener('scroll', () => {
            if (!scrollRAF) {
                scrollRAF = requestAnimationFrame(() => {
                    scrollRAF = null;
                    if (!document.body.classList.contains('is-scrolling')) {
                        document.body.classList.add('is-scrolling');
                    }
                    updateMobileFloatingNav();
                });
            }
            if (isScrollingTimer) clearTimeout(isScrollingTimer);
            isScrollingTimer = setTimeout(clearScrollingState, 120);
        }, { passive: true });
    }

    window.addEventListener('resize', updateMobileFloatingNav, { passive: true });

    document.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation(); 

        if (state.isSelectionMode) {
            return;
        }

        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.closest('[contenteditable="true"]')) {
            return;
        }

        const activeModals = document.querySelectorAll('.active');
        for (let i = 0; i < activeModals.length; i++) {
            const el = activeModals[i];
            if (el.id.endsWith('-modal') || el.id.endsWith('-overlay')) {
                return; 
            }
        }

        if (e.target.closest('#sidebar')) {
            return;
        }

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
    });

    const handleOutsideTap = (e) => {
        if (!e.target.closest('#chapter-popover') && !e.target.closest('#chapter-nav-rail')) {
            if (typeof closeChapterPopover === 'function') closeChapterPopover();
        }
        
        if (state._cachedInnerWidth <= 768) {
            const sidebar = document.getElementById('sidebar');
            const overlay = document.getElementById('mobile-sidebar-overlay');
            if (sidebar && sidebar.classList.contains('mobile-open')) {
                if (isRenamingMainCategory || e.target.closest('#category-popover-menu') || e.target.closest('.category-more-btn')) {
                    return;
                }
                if (e.target === overlay || (!e.target.closest('#sidebar') && !e.target.closest('.sidebar-toggle-btn'))) {
                    if (typeof toggleSidebar === 'function') toggleSidebar();
                }
            }
        }
    };

    document.addEventListener('click', handleOutsideTap);
    document.addEventListener('touchstart', handleOutsideTap, { passive: true });

    // 建立局部 Popover 懸浮橋接監聽器（完全消除全域 mousemove 與 Layout Thrashing）
    const bindPopoverHoverBridge = (triggerEl, popoverEl, closeFn, delay = 180) => {
        if (!triggerEl || !popoverEl) return;
        let leaveTimer = null;

        const cancelScheduledClose = () => {
            if (leaveTimer) {
                clearTimeout(leaveTimer);
                leaveTimer = null;
            }
        };

        const handlePointerLeave = (e) => {
            if (state._cachedInnerWidth <= 768) return;
            const nextTarget = e.relatedTarget;
            if (nextTarget && (triggerEl.contains(nextTarget) || popoverEl.contains(nextTarget))) {
                return;
            }
            cancelScheduledClose();
            leaveTimer = setTimeout(() => {
                if (popoverEl.classList.contains('active')) {
                    closeFn();
                }
                leaveTimer = null;
            }, delay);
        };

        const handlePointerEnter = () => {
            if (state._cachedInnerWidth <= 768) return;
            cancelScheduledClose();
        };

        triggerEl.addEventListener('mouseenter', handlePointerEnter);
        triggerEl.addEventListener('mouseleave', handlePointerLeave);

        popoverEl.addEventListener('mouseenter', handlePointerEnter);
        popoverEl.addEventListener('mouseleave', handlePointerLeave);
    };

    const rail = document.getElementById('chapter-nav-rail');
    const chapterPopover = document.getElementById('chapter-popover');
    bindPopoverHoverBridge(rail, chapterPopover, closeChapterPopover, 180);

    const fullNoteContent = document.getElementById('full-note-content');
    if (fullNoteContent) {
        let _scrollCaretRAF = null;
        const scrollToCaretThrottled = () => {
            if (_scrollCaretRAF) return;
            _scrollCaretRAF = requestAnimationFrame(() => {
                _scrollCaretRAF = null;
                if (state._cachedInnerWidth > 768) return;
                const selection = window.getSelection();
                if (!selection || selection.rangeCount === 0) return;
                const range = selection.getRangeAt(0);
                let rect = range.getBoundingClientRect();
                if (rect.x === 0 && rect.y === 0) {
                    const node = selection.anchorNode;
                    if (node && node.nodeType === 1) rect = node.getBoundingClientRect();
                    else if (node && node.parentElement) rect = node.parentElement.getBoundingClientRect();
                }
                const container = document.getElementById('full-note-content');
                if (!container) return;
                const containerRect = container.getBoundingClientRect();
                if (rect.bottom > containerRect.bottom - 40) container.scrollTop += (rect.bottom - containerRect.bottom + 40);
                else if (rect.top < containerRect.top + 40) container.scrollTop -= (containerRect.top - rect.top + 40);
            });
        };
        fullNoteContent.addEventListener('input', scrollToCaretThrottled, { passive: true });
        fullNoteContent.addEventListener('keyup', scrollToCaretThrottled, { passive: true });
        fullNoteContent.addEventListener('click', scrollToCaretThrottled, { passive: true });
    }

    const mainFab = document.querySelector('.fab-main-btn');
    let fabStartX = 0, fabStartY = 0;
    if (mainFab) {
        const startFabInteraction = (clientX, clientY) => { fabStartX = clientX; fabStartY = clientY; };
        const endFabInteraction = (clientX, clientY) => {
            if (mainFab.classList.contains('toast-mode') || state.isSelectionMode) return;
            if (state._cachedInnerWidth <= 768 && clientX !== undefined && clientY !== undefined) {
                let diffX = clientX - fabStartX;
                let diffY = Math.abs(clientY - fabStartY);
                if (diffY < 30) {
                    if (!state.isFabTucked && diffX > 20) {
                        state.isFabTucked = true;
                        mainFab.classList.add('tucked');
                    } else if (state.isFabTucked && diffX < -20) {
                        state.isFabTucked = false;
                        mainFab.classList.remove('tucked');
                        resetFabIdleTimer();
                    }
                }
            }
        };
        mainFab.addEventListener('mousedown', (e) => startFabInteraction(e.clientX, e.clientY));
        document.addEventListener('mouseup', (e) => endFabInteraction(e.clientX, e.clientY));
        mainFab.addEventListener('touchstart', (e) => startFabInteraction(e.touches[0].clientX, e.touches[0].clientY), {passive: true});
        mainFab.addEventListener('touchend', (e) => {
            if (e.changedTouches.length > 0) endFabInteraction(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
            else endFabInteraction();
        }, {passive: true});
    }

    const allSegments = document.querySelectorAll('.ios-segmented-control');
    allSegments.forEach(segment => {
        const slider = segment.querySelector('.segment-slider');
        const btns = segment.querySelectorAll('.segment-btn');
        const numOptions = btns.length;
        if (numOptions === 0) return;

        let isDragging = false, startX = 0, currentSliderX = 0, segmentWidth = 0;
        let hasMoved = false;
        const isUnifiedType = segment.id === 'unified-type-selector';
        const typeTabs = ['reminder', 'note', 'bookmark']; 
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
            segmentWidth = Math.max(1, ((segment.offsetWidth || 140) - 8) / currentCount); 
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
            btn.addEventListener('touchstart', handleTap, {passive: false});
        });

        segment.addEventListener('touchstart', (e) => { startDrag(e.touches[0].clientX); }, {passive: true});
        segment.addEventListener('mousedown', (e) => { startDrag(e.clientX); });
        
        document.addEventListener('touchmove', (e) => { 
            if (isDragging) {
                if (e.cancelable) e.preventDefault();
                moveDrag(e.touches[0].clientX); 
            }
        }, {passive: false});
        
        document.addEventListener('touchend', (e) => { 
            if (isDragging && e.changedTouches.length > 0) endDrag(e.changedTouches[0].clientX); 
        }, {passive: true});

        document.addEventListener('mousemove', (e) => { if (isDragging) moveDrag(e.clientX); });
        document.addEventListener('mouseup', (e) => { if (isDragging) endDrag(e.clientX); });
    });

    if (window.visualViewport) {
        let _vpRAF = null;
        const updateViewportHeight = () => {
            if (_vpRAF) return;
            _vpRAF = requestAnimationFrame(() => {
                _vpRAF = null;
                document.documentElement.style.setProperty('--vv-height', `${window.visualViewport.height}px`);
                document.documentElement.style.setProperty('--vv-top', `${window.visualViewport.offsetTop}px`);
            });
        };
        window.visualViewport.addEventListener('resize', updateViewportHeight);
        window.visualViewport.addEventListener('scroll', updateViewportHeight);
        updateViewportHeight();
    }

    let textSelectionTimer = null;
    let isPointerSelectingText = false;
    let selectionStartedInEditor = false;

    const getActiveTextEditor = () => {
        const fullEditorModal = document.getElementById('full-editor-modal');
        const isFullEditorOpen = fullEditorModal && fullEditorModal.classList.contains('active');
        return isFullEditorOpen ? document.getElementById('full-note-content') : null;
    };

    const nodeIsInside = (container, node) => {
        return !!(container && node && (node === container || container.contains(node)));
    };

    const getSelectionBounds = (selection) => {
        if (!selection || selection.rangeCount === 0) return null;
        const range = selection.getRangeAt(0);
        const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0);

        if (rects.length > 0) {
            return rects.reduce((bounds, rect) => ({
                left: Math.min(bounds.left, rect.left),
                top: Math.min(bounds.top, rect.top),
                right: Math.max(bounds.right, rect.right),
                bottom: Math.max(bounds.bottom, rect.bottom),
                width: Math.max(bounds.right, rect.right) - Math.min(bounds.left, rect.left),
                height: Math.max(bounds.bottom, rect.bottom) - Math.min(bounds.top, rect.top)
            }), {
                left: rects[0].left,
                top: rects[0].top,
                right: rects[0].right,
                bottom: rects[0].bottom,
                width: rects[0].width,
                height: rects[0].height
            });
        }

        const rect = range.getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0) return rect;

        const node = selection.anchorNode;
        if (node && node.nodeType === 1) return node.getBoundingClientRect();
        if (node && node.parentElement) return node.parentElement.getBoundingClientRect();
        return null;
    };

    const hideTextToolbar = () => {
        clearTimeout(textSelectionTimer);
        const toolbar = document.getElementById('text-toolbar');
        if (toolbar) toolbar.classList.remove('active');
    };

    const positionTextToolbar = (toolbar, selectionRect) => {
        const toolbarWidth = toolbar.offsetWidth || 240;
        const toolbarHeight = toolbar.offsetHeight || 48;
        const gap = 14;
        const edgeGap = 8;
        const viewport = window.visualViewport;
        const viewportLeft = viewport ? viewport.offsetLeft : 0;
        const viewportTop = viewport ? viewport.offsetTop : 0;
        const viewportWidth = viewport ? viewport.width : window.innerWidth;
        const viewportHeight = viewport ? viewport.height : window.innerHeight;
        const viewportRight = viewportLeft + viewportWidth;
        const viewportBottom = viewportTop + viewportHeight;
        const unclampedLeft = selectionRect.left + selectionRect.width / 2;
        const minLeft = viewportLeft + edgeGap + toolbarWidth / 2;
        const maxLeft = viewportRight - edgeGap - toolbarWidth / 2;
        const left = Math.min(Math.max(unclampedLeft, minLeft), maxLeft);
        const topAbove = selectionRect.top - toolbarHeight - gap;
        const topBelow = selectionRect.bottom + gap;
        const canFitAbove = topAbove >= viewportTop + edgeGap;
        const canFitBelow = topBelow + toolbarHeight <= viewportBottom - edgeGap;
        const placeAbove = canFitAbove || !canFitBelow;
        const unclampedTop = placeAbove ? topAbove : topBelow;
        const top = Math.min(Math.max(unclampedTop, viewportTop + edgeGap), viewportBottom - toolbarHeight - edgeGap);

        toolbar.dataset.placement = placeAbove ? 'above' : 'below';
        toolbar.style.left = `${left}px`;
        toolbar.style.top = `${top}px`;
    };

    const showTextToolbar = () => {
        const selection = window.getSelection();
        const toolbar = document.getElementById('text-toolbar');
        if (!toolbar) return;

        if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !selection.toString().trim()) {
            toolbar.classList.remove('active');
            return;
        }

        const activeEditor = getActiveTextEditor();
        if (!activeEditor || document.activeElement !== activeEditor) {
            toolbar.classList.remove('active');
            return;
        }

        if (!nodeIsInside(activeEditor, selection.anchorNode) || !nodeIsInside(activeEditor, selection.focusNode)) {
            toolbar.classList.remove('active');
            return;
        }

        const selectionRect = getSelectionBounds(selection);
        if (!selectionRect || (selectionRect.left === 0 && selectionRect.top === 0 && selectionRect.width === 0 && selectionRect.height === 0)) {
            toolbar.classList.remove('active');
            return;
        }

        toolbar.classList.remove('active');
        positionTextToolbar(toolbar, selectionRect);
        requestAnimationFrame(() => toolbar.classList.add('active'));
    };

    const queueTextToolbar = (delay = 220) => {
        clearTimeout(textSelectionTimer);
        if (isPointerSelectingText) {
            const toolbar = document.getElementById('text-toolbar');
            if (toolbar) toolbar.classList.remove('active');
            return;
        }
        textSelectionTimer = setTimeout(showTextToolbar, delay);
    };

    const handleSelectionPointerStart = (e) => {
        const target = e.target;
        if (!target || !target.closest) return;
        if (target.closest('#text-toolbar')) return;
        const editor = target.closest('#full-note-content');
        isPointerSelectingText = !!editor;
        selectionStartedInEditor = !!editor;
        hideTextToolbar();
    };

    const handleSelectionPointerMove = () => {
        if (isPointerSelectingText) hideTextToolbar();
    };

    const handleSelectionPointerEnd = () => {
        const shouldShowAfterSelection = isPointerSelectingText && selectionStartedInEditor;
        isPointerSelectingText = false;
        selectionStartedInEditor = false;
        if (shouldShowAfterSelection) queueTextToolbar(260);
    };

    document.addEventListener('mousedown', handleSelectionPointerStart, true);
    document.addEventListener('mousemove', handleSelectionPointerMove, true);
    document.addEventListener('mouseup', handleSelectionPointerEnd, true);
    document.addEventListener('touchstart', handleSelectionPointerStart, true);
    document.addEventListener('touchmove', handleSelectionPointerMove, true);
    document.addEventListener('touchend', handleSelectionPointerEnd, true);
    document.addEventListener('touchcancel', handleSelectionPointerEnd, true);
    document.addEventListener('keyup', () => queueTextToolbar(140));
    document.addEventListener('selectionchange', () => queueTextToolbar());
}

export function exportLocalData() {
    const data = {
        syncVersion: state.syncVersion || parseInt(localStorage.getItem('sync_version') || '0', 10),
        bookmarks: state.bookmarks,
        reminders: state.reminders,
        deletedRecords: state.deletedRecords || { bookmarks: {}, reminders: {} },
        category_order: localStorage.getItem('my_category_order') || '[]',
        category_order_updatedAt: parseInt(localStorage.getItem('my_category_order_updatedAt') || '0', 10),
        subcategory_order: localStorage.getItem('my_subcategory_order') || '{}',
        subcategory_order_updatedAt: parseInt(localStorage.getItem('my_subcategory_order_updatedAt') || '0', 10)
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ru_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    closeSettingsModal();
    showCloudToast('檔案下載完成');
}

export async function importLocalData(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const importedData = JSON.parse(e.target.result);

            // 結構驗證：避免畸形檔案（陣列、字串、null 項目）污染資料庫
            const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
            if (!isPlainObject(importedData)) throw new Error('INVALID_BACKUP_FORMAT');
            const rawBookmarks = importedData.bookmarks ?? {};
            const rawReminders = importedData.reminders ?? importedData.quotes ?? {};
            if (!isPlainObject(rawBookmarks) || !isPlainObject(rawReminders)) throw new Error('INVALID_BACKUP_FORMAT');
            importedData.bookmarks = rawBookmarks;
            importedData.reminders = rawReminders;
            // 清除備份檔內可能夾帶的 script / 事件屬性 / javascript: 連結
            sanitizeDatasetPayload(importedData);

            const importedBookmarks = importedData.bookmarks;
            const importedReminders = importedData.reminders;
            const importNow = Date.now();

            const updatedDeletedBookmarks = { ...(state.deletedRecords?.bookmarks || {}) };
            const updatedDeletedReminders = { ...(state.deletedRecords?.reminders || {}) };

            // 備份檔中包含的所有項目一律強制更新 updatedAt 至當前時間，
            // 確保匯入項目之時間戳記高於雲端既有墓碑，主動清除本地墓碑，杜絕雲端同步時被意外抹除
            for (const id of Object.keys(importedBookmarks)) {
                importedBookmarks[id].updatedAt = Math.max(Number(importedBookmarks[id].updatedAt) || 0, importNow);
                delete updatedDeletedBookmarks[id];
                await StorageAPI.deleteItem('deleted_bookmarks', id);
            }
            for (const id of Object.keys(importedReminders)) {
                importedReminders[id].updatedAt = Math.max(Number(importedReminders[id].updatedAt) || 0, importNow);
                delete updatedDeletedReminders[id];
                await StorageAPI.deleteItem('deleted_reminders', id);
            }

            // 正確分離本機資料與匯入資料作為 mergeDatasets 的兩端輸入
            const localDataForMerge = {
                syncVersion: state.syncVersion || parseInt(localStorage.getItem('sync_version') || '0', 10),
                bookmarks: state.bookmarks || {},
                reminders: state.reminders || {},
                deletedRecords: { bookmarks: updatedDeletedBookmarks, reminders: updatedDeletedReminders },
                category_order: localStorage.getItem('my_category_order') || '[]',
                category_order_updatedAt: parseInt(localStorage.getItem('my_category_order_updatedAt') || '0', 10),
                subcategory_order: localStorage.getItem('my_subcategory_order') || '{}',
                subcategory_order_updatedAt: parseInt(localStorage.getItem('my_subcategory_order_updatedAt') || '0', 10)
            };

            const importedDataForMerge = {
                syncVersion: Number(importedData.syncVersion) || 0,
                bookmarks: importedBookmarks,
                reminders: importedReminders,
                deletedRecords: importedData.deletedRecords || { bookmarks: {}, reminders: {} },
                category_order: importedData.category_order || '[]',
                category_order_updatedAt: parseInt(importedData.category_order_updatedAt || '0', 10),
                subcategory_order: importedData.subcategory_order || '{}',
                subcategory_order_updatedAt: parseInt(importedData.subcategory_order_updatedAt || '0', 10)
            };

            const finalMergedData = mergeDatasets(localDataForMerge, importedDataForMerge);

            // 版本號遞增，確保高於雲端舊版本
            state.syncVersion = Math.max(state.syncVersion || 0, Number(finalMergedData.syncVersion) || 0) + 1;
            localStorage.setItem('sync_version', state.syncVersion.toString());

            state.bookmarks = finalMergedData.bookmarks;
            state.reminders = finalMergedData.reminders;
            state.deletedRecords = finalMergedData.deletedRecords;

            if (finalMergedData.category_order) {
                localStorage.setItem('my_category_order', typeof finalMergedData.category_order === 'string' ? finalMergedData.category_order : JSON.stringify(finalMergedData.category_order));
            }
            if (finalMergedData.category_order_updatedAt) {
                localStorage.setItem('my_category_order_updatedAt', finalMergedData.category_order_updatedAt.toString());
            }
            if (finalMergedData.subcategory_order) {
                localStorage.setItem('my_subcategory_order', typeof finalMergedData.subcategory_order === 'string' ? finalMergedData.subcategory_order : JSON.stringify(finalMergedData.subcategory_order));
            }
            if (finalMergedData.subcategory_order_updatedAt) {
                localStorage.setItem('my_subcategory_order_updatedAt', finalMergedData.subcategory_order_updatedAt.toString());
            }

            await StorageAPI.replaceMulti({
                bookmarks: state.bookmarks,
                reminders: state.reminders,
                deleted_bookmarks: state.deletedRecords.bookmarks || {},
                deleted_reminders: state.deletedRecords.reminders || {}
            });

            localStorage.setItem(PENDING_SYNC_FLAG, 'true');
            notifyCrossTabChange({ type: 'DATA_CHANGED', syncVersion: state.syncVersion });

            renderSidebar();
            if (state.currentView === 'bookmarks') selectCategory(state.currentCategory);
            else if (state.currentView === 'reminders') renderReminders();

            showCloudToast('檔案匯入合併成功');
            closeSettingsModal();
            uploadToDrive(true);
        } catch (err) {
            alert('檔案解析失敗，請確認上傳的檔案格式是否正確。');
            console.error(err);
        }
        event.target.value = ''; 
    };
    reader.readAsText(file);
}

Object.assign(window, {
    toggleSidebar, toggleSidebarDesktop, openSettingsModal, closeSettingsModal,
    handleMainAction, triggerContextAdd, triggerContextEdit, triggerContextDelete,
    selectRemindersView,
    startInlineRenameMainCategory, handleSearch, clearSearch,
    toggleSelectionMode, exitSelectionMode,
    toggleReminderCardSelection, toggleBookmarkCardSelection, toggleSubCategorySelection,
    triggerBatchDeleteReminders, triggerBatchMove, openMoveModal,
    toggleReminderModalDone,
    showCategoryPopoverMenu, hideCategoryPopoverMenu, triggerCategoryRenameFromMenu,
    switchCreateType, openCategoryModal,
    openSubCategoryModal, openCategorySubCategoryModal, confirmCategorySubCategorySelection,
    handleSelectModalCategory, handleSelectModalSubCategory, handleCategoryBackStep,
    triggerAddNewCategoryOrSubCategory, positionCategoryConfirmBtn,
    triggerUnifiedDelete, closeAllEditors, saveUnified,
    changeYear, changeMonth, closeConfirm, confirmDelete, closeCategoryModal,
    setVisualEffects,
    returnFromCloudAlert, openSyncSettingsFromAlert,
    openSortModal, closeSortModal, handleSelectSortCategory, handleSelectSortSubCategory,
    handleSortBackStep, confirmSortModalSelection, positionSortConfirmBtn,
    handleClipboard, handleFormat,
    saveFullEditor, closeCalendar, toggleCalendar, confirmCalendarSelection, openFullEditor,
    closeAllConfirms, openBookmarkEditor, openReminderEditor,
    selectCategory, showContextMenu, selectDate,
    closeFullEditor, forceDownload, expandSidebarForBookmarks, exportLocalData, importLocalData,
    toggleChapterPopover, closeChapterPopover,
    scrollToChapterTarget, initChapterScrollSpy, clearChapterScrollSpy,
    updateBookmarkPreviewDisplay,
    openCalendarTimeBar, closeCalendarTimeBar, positionCalendarTimeBar,
    updateCalendarRangeHighlight, initCalendarDragInteractions, enforceSameDayTimeOrder,
    handleBookmarksNavClick,
    handleGoogleAuthClick, handleGoogleSignOutClick, updateGoogleAccountUIState,
    isGoogleLinked,
    switchEditorModalTab, openEditorSwitchBar, closeEditorSwitchBar, positionEditorSwitchBar,
    handleSidebarCategoryClick, handleSidebarRemindersClick, syncSidebarActiveState
});
