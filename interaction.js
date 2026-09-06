// interaction.js
// 職責：管理所有的使用者操作（點擊、手勢拖曳、Modal 開關、鍵盤快捷鍵、資料存刪邏輯、墓碑紀錄追蹤與手動資料合併）

import { state } from './state.js';
import { 
    renderSidebar, renderNotes, renderBookmarks, renderQuotes, 
    updateWordCount, setIndicatorState, updateNoteDOM, updateBookmarkDOM, 
    showCloudToast, renderCalendar, renderQuoteSortList, renderBookmarkSortLists, 
    formatTimeWithDay, getTimestamp, formatDateForDisplay, 
    updateThemeSegment, updateVisualEffectsSegment, updateSortIcon, renderExistingCategories, 
    getWordCount
} from './ui.js';
import { uploadToGist, downloadFromGist, mergeDatasets, startCloudPolling } from './sync.js';
import { StorageAPI, safeJSONParse } from './storage.js';

// ==========================================
// 自動儲存與 FAB 邏輯
// ==========================================
export function resetAutoSaveTimer() {
    clearTimeout(state.autoSaveTimer);
    state.autoSaveTimer = setTimeout(() => {
        if (!state.isNoteUnsaved) return;
        const editorModal = document.getElementById('editor-modal');
        const fullModal = document.getElementById('full-editor-modal');
        
        if (fullModal && fullModal.classList.contains('active')) {
            syncFullEditorContent();
            quickSaveNote();
        } else if (editorModal && editorModal.classList.contains('active')) {
            quickSaveNote();
        }
    }, 30000);
}

export function quickSaveNote() {
    if (!state.isNoteUnsaved || state.currentUnifiedType !== 'note') return;
    const date = document.getElementById('note-date-val').value;
    if (!date) return;

    const isNew = !state.currentEditingDate;
    if (!state.deletedRecords) {
        state.deletedRecords = { notes: {}, bookmarks: {}, quotes: {} };
    }

    if (state.isThemedNote) {
        const title = document.getElementById('note-theme-title').value.trim();
        const content = document.getElementById('note-content').innerHTML;
        state.tempNoteData.content = content;
        state.tempNoteData.title = title;

        const cleanContent = content.replace(/<br\s*[\/]?>/gi, '').replace(/<div>\s*<\/div>/gi, '').trim();
        if (!title && !cleanContent) return;

        const noteKey = state.currentEditingDate || `${date}_t${Date.now()}`;

        // 若曾存在刪除墓碑，重新儲存時予以清除
        if (state.deletedRecords?.notes?.[noteKey]) {
            delete state.deletedRecords.notes[noteKey];
            StorageAPI.deleteItem('deleted_notes', noteKey);
        }

        const reminderVal = document.getElementById('note-reminder-val') ? document.getElementById('note-reminder-val').value : 'none';
        state.notes[noteKey] = {
            isThemed: true,
            date: date,
            title: title || '未命名主題',
            content: content,
            reminder: reminderVal,
            timestamp: getTimestamp(),
            updatedAt: Date.now()
        };

        StorageAPI.saveItem('notes', noteKey, state.notes[noteKey]);
        state.currentEditingDate = noteKey;

        if (isNew) renderSidebar();
        else updateNoteDOM(noteKey);
    } else {
        state.tempNoteData[state.currentTimeTab] = document.getElementById('note-content').innerHTML;
        const hasContent = (state.tempNoteData.morning.trim() || state.tempNoteData.afternoon.trim() || state.tempNoteData.evening.trim()) !== '';
        if (!hasContent) return;

        if (state.currentEditingDate && state.currentEditingDate !== date) {
            const oldKey = state.currentEditingDate;
            delete state.notes[oldKey];
            const delTime = Date.now();
            if (!state.deletedRecords.notes) state.deletedRecords.notes = {};
            state.deletedRecords.notes[oldKey] = delTime;
            StorageAPI.deleteItem('notes', oldKey);
            StorageAPI.saveItem('deleted_notes', oldKey, delTime);
        }

        // 若曾存在刪除墓碑，重新儲存時予以清除
        if (state.deletedRecords?.notes?.[date]) {
            delete state.deletedRecords.notes[date];
            StorageAPI.deleteItem('deleted_notes', date);
        }

        const reminderVal = 'none';
        state.notes[date] = { 
            isThemed: false,
            date: date,
            morning: state.tempNoteData.morning, 
            afternoon: state.tempNoteData.afternoon, 
            evening: state.tempNoteData.evening, 
            reminder: reminderVal,
            timestamp: getTimestamp(), 
            updatedAt: Date.now() 
        };

        StorageAPI.saveItem('notes', date, state.notes[date]);
        state.currentEditingDate = date;

        if (isNew) renderSidebar();
        else updateNoteDOM(date);
    }
    
    state.isNoteUnsaved = false;
    setIndicatorState('saved');
    uploadToGist(true);
}

export function resetFabIdleTimer(e) {
    clearTimeout(state.fabIdleTimer);
    if (state._cachedInnerWidth > 768 || state.isFabTucked) return;

    state.fabIdleTimer = setTimeout(() => {
        if (state._cachedInnerWidth <= 768 && !state.isFabTucked) {
            state.isFabTucked = true;
            const mainBtn = document.querySelector('.fab-main-btn');
            if (mainBtn) mainBtn.classList.add('tucked');
        }
    }, 5000);
}

export function handleMainAction() {
    if (state.fabWasDragged) return;
    const mainBtn = document.querySelector('.fab-main-btn');
    if (state.isFabTucked || (mainBtn && mainBtn.classList.contains('tucked'))) {
        state.isFabTucked = false;
        if (mainBtn) mainBtn.classList.remove('tucked');
        resetFabIdleTimer();
        return;
    }
    
    if (state.currentView === 'notes') openEditor();
    else if (state.currentView === 'bookmarks') openBookmarkEditor();
    else if (state.currentView === 'quotes') openQuoteEditor();
}

// ==========================================
// 切換與導覽邏輯
// ==========================================
export function getDefaultTimeTab() {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 18) return 'afternoon';
    return 'evening';
}

export function updateNoteEditTimeIndicators() {
    const container = document.getElementById('note-edit-time-indicators');
    if (!container) return;

    const isEmpty = (html) => {
        if (!html) return true;
        const clean = html.replace(/<br\s*[\/]?>/gi, '').replace(/<div>\s*<\/div>/gi, '').replace(/&nbsp;/gi, ' ').trim();
        return clean === '';
    };

    const morningEl = document.getElementById('indicator-morning');
    const afternoonEl = document.getElementById('indicator-afternoon');
    const eveningEl = document.getElementById('indicator-evening');

    if (morningEl) morningEl.classList.toggle('active', !isEmpty(state.tempNoteData.morning));
    if (afternoonEl) afternoonEl.classList.toggle('active', !isEmpty(state.tempNoteData.afternoon));
    if (eveningEl) eveningEl.classList.toggle('active', !isEmpty(state.tempNoteData.evening));
}

export function switchTimeTab(tabName, isInit = false) {
    if (state.currentTimeTab === tabName && !isInit) return; 

    const isFullOpen = document.getElementById('full-editor-modal').classList.contains('active');
    const contentEl = document.getElementById('note-content');
    const fullContentEl = document.getElementById('full-note-content');

    if (!isInit) {
        let currentHtml = isFullOpen ? fullContentEl.innerHTML : contentEl.innerHTML;
        if (currentHtml === '<br>' || currentHtml === '<div><br></div>' || currentHtml.trim() === '') currentHtml = '';
        
        if (state.tempNoteData[state.currentTimeTab] !== currentHtml) {
            state.tempNoteData[state.currentTimeTab] = currentHtml;
            if (!state.isNoteUnsaved) {
                state.isNoteUnsaved = true;
                setIndicatorState('unsaved');
            }
        }
    }
    
    state.currentTimeTab = tabName;
    const newContent = state.tempNoteData[state.currentTimeTab] || '';
    
    contentEl.innerHTML = newContent;
    fullContentEl.innerHTML = newContent;
    
    contentEl.scrollTop = 0;
    fullContentEl.scrollTop = 0;
    
    const fullTimeSelector = document.getElementById('full-time-selector');
    if (fullTimeSelector) {
        fullTimeSelector.querySelectorAll('.segment-btn').forEach(btn => {
            btn.classList.toggle('active', btn.id === `full-seg-${tabName}`);
        });
        fullTimeSelector.setAttribute('data-active', tabName);
    }
    
    updateWordCount();
    updateNoteEditTimeIndicators();
}

export function setBookmarkMode(isCustom) {
    state.isCustomBookmark = isCustom;
    const segment = document.getElementById('bookmark-mode-segment');
    const container = document.getElementById('bookmark-form-container');
    const titleInput = document.getElementById('bookmark-title');
    const contentEl = document.getElementById('bookmark-content');

    if (segment) {
        segment.setAttribute('data-active', isCustom ? '2' : '1');
        const urlBtn = document.getElementById('seg-bookmark-mode-url');
        const customBtn = document.getElementById('seg-bookmark-mode-custom');
        if (urlBtn) urlBtn.classList.toggle('active', !isCustom);
        if (customBtn) customBtn.classList.toggle('active', isCustom);
    }

    if (container) {
        container.classList.toggle('mode-custom', isCustom);
    }

    if (titleInput) {
        titleInput.placeholder = isCustom ? '名稱' : '網站名稱';
    }

    if (contentEl) {
        contentEl.innerHTML = isCustom ? (state.tempBookmarkContent || '') : '';
    }
}

export function switchCreateType(type) {
    if (state.currentUnifiedType === type) return;
    state.currentUnifiedType = type;
    
    const noteContainer = document.getElementById('note-form-container');
    const bookmarkContainer = document.getElementById('bookmark-form-container');
    const quoteContainer = document.getElementById('quote-form-container');
    const titleEl = document.getElementById('editor-modal-title');
    const selector = document.getElementById('unified-type-selector');
    const timeIndicators = document.getElementById('note-edit-time-indicators');
    const bookmarkModeSegment = document.getElementById('bookmark-mode-segment');
    if (timeIndicators) timeIndicators.style.display = 'none';

    const saveIndicator = document.getElementById('save-indicator-wrapper');
    if (saveIndicator) saveIndicator.style.display = type === 'note' ? 'flex' : 'none';

    noteContainer.style.display = 'none';
    bookmarkContainer.style.display = 'none';
    quoteContainer.style.display = 'none';

    if (bookmarkModeSegment) {
        bookmarkModeSegment.style.display = (type === 'bookmark' && !state.currentEditingBookmarkId) ? 'flex' : 'none';
    }

    let activeIndex = 0;

    if (type === 'quote') {
        quoteContainer.style.display = 'flex';
        titleEl.innerText = state.currentEditingQuoteId ? '編輯語錄' : '新增語錄';
        activeIndex = 0;
        if (!state.currentEditingQuoteId) {
            const quoteMain = document.getElementById('quote-main-content');
            const quoteSub = document.getElementById('quote-sub-text');
            const quoteId = document.getElementById('quote-id-val');
            if (quoteId) quoteId.value = '';
            if (quoteMain) quoteMain.value = '';
            if (quoteSub) quoteSub.value = '';
        }
        if (state.currentView !== 'quotes') selectQuotesView();
    } else if (type === 'note') {
        noteContainer.style.display = 'flex';
        titleEl.innerText = state.currentEditingDate ? '編輯筆記' : '新增筆記';
        activeIndex = 1;
        if (!state.currentEditingDate) {
            const today = new Date();
            const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            const dateVal = document.getElementById('note-date-val');
            const dateText = document.getElementById('date-text');
            const themeInput = document.getElementById('note-theme-title');
            const reminderVal = document.getElementById('note-reminder-val');
            const reminderText = document.getElementById('reminder-text');
            const themeWrapper = document.getElementById('note-theme-wrapper');
            const reminderDisplay = document.getElementById('reminder-ui-display');

            if (dateVal) dateVal.value = todayStr;
            if (dateText) dateText.innerText = formatDateForDisplay(todayStr);
            if (themeInput) themeInput.value = '';
            if (reminderVal) reminderVal.value = 'none';
            if (reminderText) reminderText.innerText = '無';
            if (themeWrapper) themeWrapper.style.display = 'none';
            if (reminderDisplay) reminderDisplay.style.display = 'none';

            state.tempNoteData = { morning: '', afternoon: '', evening: '', title: '', content: '', reminder: 'none' };
            state.isThemedNote = false;
            state.isNoteUnsaved = false;
            clearTimeout(state.autoSaveTimer);
            setIndicatorState('');

            const noteContent = document.getElementById('note-content');
            const fullNoteContent = document.getElementById('full-note-content');
            if (noteContent) noteContent.innerHTML = '';
            if (fullNoteContent) fullNoteContent.innerHTML = '';

            switchTimeTab(getDefaultTimeTab(), true);
        }
        if (state.currentView !== 'notes') selectYear(state.currentYear);
    } else {
        bookmarkContainer.style.display = 'flex';
        titleEl.innerText = state.currentEditingBookmarkId ? '編輯資料' : '新增資料';
        activeIndex = 2;
        if (!state.currentEditingBookmarkId) {
            const bId = document.getElementById('bookmark-id-val');
            const bTitle = document.getElementById('bookmark-title');
            const bUrl = document.getElementById('bookmark-url');
            const bCat = document.getElementById('bookmark-category');
            const bDesc = document.getElementById('bookmark-desc');
            const bContent = document.getElementById('bookmark-content');

            if (bId) bId.value = '';
            if (bTitle) bTitle.value = '';
            if (bUrl) bUrl.value = '';
            if (bCat) bCat.value = (state.currentCategory && state.currentCategory !== '未分類') ? state.currentCategory : '';
            if (bDesc) bDesc.value = '';
            if (bContent) bContent.innerHTML = '';
            state.tempBookmarkContent = '';
            setBookmarkMode(false);
        }
        if (state.currentView !== 'bookmarks') {
            if (!state.currentCategory) state.currentCategory = '未分類'; 
            selectCategory(state.currentCategory);
        }
    }

    if (selector) {
        selector.setAttribute('data-active', activeIndex.toString());
        selector.querySelectorAll('.segment-btn').forEach((btn, index) => {
            btn.classList.toggle('active', index === activeIndex);
        });
    }
}

export function updateCollapsedIcons(view) {
    document.querySelectorAll('.collapsed-icon-btn').forEach(btn => btn.classList.remove('active'));
    const btnId = view === 'notes' ? 'collapsed-notes-btn' : 
                  view === 'quotes' ? 'collapsed-quotes-btn' : 
                  'collapsed-bookmarks-btn';
    const btn = document.getElementById(btnId);
    if (btn) btn.classList.add('active');
}

export function selectCurrentYearView() {
    selectYear(state.currentYear);
}

export function selectYear(year) {
    if (state.currentView === 'notes' && state.currentYear === year) {
        if (state._cachedInnerWidth <= 768) {
            const sidebar = document.getElementById('sidebar');
            if (sidebar.classList.contains('mobile-open')) toggleSidebar();
        }
        return;
    }

    state.currentView = 'notes';
    state.currentYear = year;
    state.currentCategory = null;
    
    document.querySelector('.sort-wrapper').style.display = 'block'; 
    document.getElementById('bookmark-sort-btn').style.display = 'none';
    
    document.querySelectorAll('.year-item').forEach(el => el.classList.remove('active'));
    
    const navNotesBtn = document.getElementById('nav-notes-btn');
    if (navNotesBtn) navNotesBtn.classList.add('active');

    updateCollapsedIcons('notes');

    renderNotes();
    document.querySelector('main').scrollTo(0, 0);
    
    if (state._cachedInnerWidth <= 768) {
        const sidebar = document.getElementById('sidebar');
        if (sidebar.classList.contains('mobile-open')) toggleSidebar();
    }
}

export function selectCategory(category) {
    if (state.currentView === 'bookmarks' && state.currentCategory === category) {
        if (state._cachedInnerWidth <= 768) {
            const sidebar = document.getElementById('sidebar');
            if (sidebar.classList.contains('mobile-open')) toggleSidebar();
        }
        return;
    }

    state.currentView = 'bookmarks';
    state.currentCategory = category;

    document.querySelector('.sort-wrapper').style.display = 'none'; 
    document.getElementById('bookmark-sort-btn').style.display = 'flex';
    
    document.querySelectorAll('.year-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.year-item[data-category]').forEach(el => {
        if (el.dataset.category === category) el.classList.add('active');
    });

    updateCollapsedIcons('bookmarks');

    renderBookmarks();
    document.querySelector('main').scrollTo(0, 0);
    
    if (state._cachedInnerWidth <= 768) {
        const sidebar = document.getElementById('sidebar');
        if (sidebar.classList.contains('mobile-open')) toggleSidebar();
    }
}

export function selectQuotesView() {
    state.currentView = 'quotes';
    document.querySelector('.sort-wrapper').style.display = 'none'; 
    document.getElementById('bookmark-sort-btn').style.display = 'flex';
    
    document.querySelectorAll('.year-item').forEach(el => el.classList.remove('active'));
    const navQuotesBtn = document.getElementById('nav-quotes-btn');
    if (navQuotesBtn) navQuotesBtn.classList.add('active');
    
    updateCollapsedIcons('quotes');

    renderQuotes();
    document.querySelector('main').scrollTo(0, 0);
    
    if (state._cachedInnerWidth <= 768) {
        const sidebar = document.getElementById('sidebar');
        if (sidebar.classList.contains('mobile-open')) toggleSidebar();
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

function shouldEnableChapterSpy() {
    if (state.currentView === 'notes') return true;
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
    }

    if (smoothScrollRAF) {
        cancelAnimationFrame(smoothScrollRAF);
        smoothScrollRAF = null;
    }
    clearTimeout(clickScrollTimer);
    isClickScrolling = true;

    const isMobile = state._cachedInnerWidth <= 768;
    const topMargin = isMobile ? 16 : 20;

    const mainRect = mainEl.getBoundingClientRect();
    const targetRect = targetDOM.getBoundingClientRect();
    const maxScroll = Math.max(0, mainEl.scrollHeight - mainEl.clientHeight);
    const startScrollTop = mainEl.scrollTop;

    let destinationScrollTop = 0;
    if (state.currentView === 'quotes' || state.currentView === 'bookmarks') {
        destinationScrollTop = startScrollTop + (targetRect.top - mainRect.top) - ((mainEl.clientHeight / 2) - (targetRect.height / 2));
    } else {
        destinationScrollTop = startScrollTop + (targetRect.top - mainRect.top) - topMargin;
    }

    const targetScrollTop = Math.min(maxScroll, Math.max(0, destinationScrollTop));
    const distance = targetScrollTop - startScrollTop;
    const duration = Math.min(650, Math.max(320, Math.abs(distance) * 0.45));
    const startTime = performance.now();

    const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);

    const stepScroll = (now) => {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / duration);
        const easedProgress = easeOutQuart(progress);

        mainEl.scrollTop = startScrollTop + (distance * easedProgress);

        if (progress < 1) {
            smoothScrollRAF = requestAnimationFrame(stepScroll);
        } else {
            mainEl.scrollTop = targetScrollTop;
            smoothScrollRAF = null;
            clickScrollTimer = setTimeout(() => {
                isClickScrolling = false;
            }, 120);
        }
    };

    smoothScrollRAF = requestAnimationFrame(stepScroll);

    if (isMobile && (state.currentView === 'quotes' || state.currentView === 'bookmarks')) {
        targetDOM.classList.remove('highlight-pulse-mobile');
        void targetDOM.offsetWidth;
        targetDOM.classList.add('highlight-pulse-mobile');
        setTimeout(() => targetDOM.classList.remove('highlight-pulse-mobile'), 800);
    } else if (state.currentView === 'quotes' || state.currentView === 'bookmarks') {
        targetDOM.classList.remove('highlight-zoom-desktop');
        void targetDOM.offsetWidth;
        targetDOM.classList.add('highlight-zoom-desktop');
        setTimeout(() => targetDOM.classList.remove('highlight-zoom-desktop'), 800);
    }

    closeChapterPopover();
}

export function initChapterScrollSpy(items) {
    const mainEl = document.querySelector('main');
    currentChapterItems = items || [];

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

    if (!shouldEnableChapterSpy()) {
        document.querySelectorAll('.chapter-tick').forEach(tick => tick.classList.remove('active'));
        document.querySelectorAll('.chapter-item').forEach(item => item.classList.remove('active'));
        return;
    }

    if (!items || items.length === 0 || !mainEl) return;

    const updateSpy = () => {
        if (isClickScrolling || !shouldEnableChapterSpy()) return;

        const mainRect = mainEl.getBoundingClientRect();
        const referenceLine = mainRect.top + 120;
        
        let bestIndex = -1;
        const isAtBottom = (mainEl.scrollHeight - (mainEl.scrollTop + mainEl.clientHeight)) <= 25;

        for (let i = 0; i < items.length; i++) {
            const el = items[i].targetDOM;
            if (!el) continue;
            const rect = el.getBoundingClientRect();
            if (rect.top <= referenceLine) {
                bestIndex = i;
            } else {
                break;
            }
        }

        if (bestIndex === -1 && items.length > 0) {
            bestIndex = 0;
        }

        if (isAtBottom && items.length > 0) {
            const lastRect = items[items.length - 1].targetDOM.getBoundingClientRect();
            if (lastRect.top <= mainRect.bottom - 150) {
                bestIndex = items.length - 1;
            }
        }

        if (bestIndex !== -1) {
            highlightChapterTick(bestIndex);
        }
    };

    chapterScrollListener = () => {
        window.requestAnimationFrame(updateSpy);
    };

    mainEl.addEventListener('scroll', chapterScrollListener, { passive: true });
    updateSpy();
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
        activePopItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

export function toggleSidebarDesktop() {
    if (state._cachedInnerWidth > 768) {
        document.getElementById('sidebar').classList.toggle('collapsed');
    } else {
        toggleSidebar(); 
    }
}

export function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const mobileOverlay = document.getElementById('mobile-sidebar-overlay');
    
    if (state._cachedInnerWidth <= 768) {
        if (sidebar.classList.contains('mobile-open')) {
            sidebar.classList.remove('mobile-open');
            mobileOverlay.classList.remove('active');
        } else {
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

export function setDarkMode(isDark) {
    const body = document.body;
    const themeMeta = document.getElementById('theme-color-meta');

    if (isDark) {
        body.setAttribute('data-theme', 'dark');
        localStorage.setItem('dark_mode', 'true');
        if (themeMeta) themeMeta.setAttribute('content', '#121212');
    } else {
        body.removeAttribute('data-theme');
        localStorage.setItem('dark_mode', 'false');
        if (themeMeta) themeMeta.setAttribute('content', '#F7F3E8');
    }
    updateThemeSegment(isDark);
}

export function setVisualEffects(isOn) {
    const body = document.body;

    if (isOn) {
        body.removeAttribute('data-no-glass');
        localStorage.setItem('visual_effects', 'true');
    } else {
        body.setAttribute('data-no-glass', 'true');
        localStorage.setItem('visual_effects', 'false');
    }
    updateVisualEffectsSegment(isOn);
}

export function toggleSortOrder() {
    state.sortOrder = state.sortOrder === 'newest' ? 'oldest' : 'newest';
    const now = Date.now();
    localStorage.setItem('note_sort_order', state.sortOrder);
    localStorage.setItem('note_sort_order_updatedAt', now.toString());
    updateSortIcon();
    if (state.currentView === 'notes') renderNotes();
    uploadToGist(true);
}

// ==========================================
// Modal 開關邏輯
// ==========================================
export function openEditor(existingDate = null) {
    state.currentUnifiedType = 'note';
    document.getElementById('note-content').innerHTML = '';
    document.getElementById('full-note-content').innerHTML = '';

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    state.currentEditingDate = existingDate;
    
    if (!document.getElementById('save-indicator-wrapper')) {
        const group = document.getElementById('editor-title-group');
        group.insertAdjacentHTML('beforeend', `
            <div id="save-indicator-wrapper">
                <div class="save-dot"></div>
                <svg class="save-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
            </div>
        `);
    } else {
        document.getElementById('save-indicator-wrapper').style.display = 'flex';
    }

    clearTimeout(state.autoSaveTimer);
    state.isNoteUnsaved = false;
    setIndicatorState('');

    const overlay = document.getElementById('modal-overlay');
    const modal = document.getElementById('editor-modal');
    const titleEl = document.getElementById('editor-modal-title');
    const typeSelector = document.getElementById('unified-type-selector');
    const timeIndicators = document.getElementById('note-edit-time-indicators');
    const deleteBtn = document.getElementById('btn-delete-unified');
    const dateVal = document.getElementById('note-date-val');
    const dateText = document.getElementById('date-text');
    const bookmarkModeSegment = document.getElementById('bookmark-mode-segment');
    const themeInput = document.getElementById('note-theme-title');
    const themeWrapper = document.getElementById('note-theme-wrapper');
    const reminderDisplay = document.getElementById('reminder-ui-display');

    if (bookmarkModeSegment) bookmarkModeSegment.style.display = 'none';
    document.getElementById('note-form-container').style.display = 'flex';
    document.getElementById('bookmark-form-container').style.display = 'none';
    document.getElementById('quote-form-container').style.display = 'none';
    
    document.getElementById('note-content').scrollTop = 0;
    document.getElementById('editor-modal').scrollTop = 0;

    modal.classList.remove('shake-animation'); 
    overlay.style.display = 'block';
    modal.style.display = 'block'; 
    requestAnimationFrame(() => requestAnimationFrame(() => {
        overlay.classList.add('active');
        modal.classList.add('active');
    }));

    state.tempNoteData = { morning: '', afternoon: '', evening: '', title: '', content: '', reminder: 'none' };
    const reminderVal = document.getElementById('note-reminder-val');
    const reminderText = document.getElementById('reminder-text');

    if (existingDate) {
        titleEl.innerText = '編輯筆記';
        const noteData = state.notes[existingDate] || { morning: '', afternoon: '', evening: '' };
        const realDate = noteData.date || existingDate.split('_')[0] || todayStr;
        dateVal.value = realDate;
        dateText.innerText = formatDateForDisplay(realDate); 

        const currentReminder = noteData.reminder || 'none';
        if (reminderVal) reminderVal.value = currentReminder;
        if (reminderText) {
            const reminderMap = { 'none': '無', '1h': '1小時前', '2h': '2小時前', '1d': '1天前', '2d': '2天前', '1w': '1週前' };
            reminderText.innerText = reminderMap[currentReminder] || '無';
        }

        const isThemed = !!noteData.isThemed;
        state.isThemedNote = isThemed;

        if (isThemed) {
            themeInput.value = noteData.title || '';
            state.tempNoteData.title = noteData.title || '';
            state.tempNoteData.content = noteData.content || '';
            if (themeWrapper) themeWrapper.style.display = 'block';
            if (reminderDisplay) reminderDisplay.style.display = 'flex';
            if (timeIndicators) timeIndicators.style.display = 'none';
            const text = state.tempNoteData.content || '';
            const contentEl = document.getElementById('note-content');
            const fullContentEl = document.getElementById('full-note-content');
            if (contentEl) contentEl.innerHTML = text;
            if (fullContentEl) fullContentEl.innerHTML = text;
        } else {
            themeInput.value = '';
            if (themeWrapper) themeWrapper.style.display = 'none';
            if (reminderDisplay) reminderDisplay.style.display = 'none';
            if (timeIndicators) timeIndicators.style.display = 'flex';

            if (typeof noteData === 'string') {
                let text = noteData;
                if (!/<[a-z][\s\S]*>/i.test(text)) text = text.replace(/\n/g, '<br>');
                state.tempNoteData.morning = text;
            } else if (noteData.content !== undefined && !noteData.morning) {
                let text = noteData.content;
                if (!/<[a-z][\s\S]*>/i.test(text)) text = text.replace(/\n/g, '<br>');
                state.tempNoteData.morning = text;
            } else {
                state.tempNoteData.morning = noteData.morning || '';
                state.tempNoteData.afternoon = noteData.afternoon || '';
                state.tempNoteData.evening = noteData.evening || '';
            }

            const text = state.tempNoteData[state.currentTimeTab] || '';
            const contentEl = document.getElementById('note-content');
            const fullContentEl = document.getElementById('full-note-content');
            if (contentEl) contentEl.innerHTML = text;
            if (fullContentEl) fullContentEl.innerHTML = text;
            updateNoteEditTimeIndicators();
        }
        
        if (typeSelector) typeSelector.style.display = 'none';
        deleteBtn.style.display = 'flex';

        const parts = realDate.split('-');
        state.calDate = new Date(parts[0], parseInt(parts[1]) - 1, parts[2]);
    } else {
        titleEl.innerText = '新增筆記';
        state.calDate = new Date();
        dateVal.value = todayStr;
        dateText.innerText = formatDateForDisplay(todayStr); 
        themeInput.value = '';
        if (reminderVal) reminderVal.value = 'none';
        if (reminderText) reminderText.innerText = '無';
        
        state.isThemedNote = false;
        if (themeWrapper) themeWrapper.style.display = 'none';
        if (reminderDisplay) reminderDisplay.style.display = 'none';
        if (timeIndicators) timeIndicators.style.display = 'none';

        if (typeSelector) {
            typeSelector.style.display = 'flex';
            typeSelector.setAttribute('data-active', '1');
            typeSelector.querySelectorAll('.segment-btn').forEach((btn, idx) => btn.classList.toggle('active', idx === 1));
        }
        deleteBtn.style.display = 'none';

        document.getElementById('note-content').innerHTML = '';
        document.getElementById('full-note-content').innerHTML = '';
        document.getElementById('bookmark-id-val').value = '';
        document.getElementById('bookmark-title').value = '';
        document.getElementById('bookmark-url').value = '';
        document.getElementById('bookmark-category').value = (state.currentCategory && state.currentCategory !== '未分類') ? state.currentCategory : '';
        document.getElementById('bookmark-desc').value = '';
        const bookmarkContentEl = document.getElementById('bookmark-content');
        if (bookmarkContentEl) bookmarkContentEl.innerHTML = '';
        state.tempBookmarkContent = '';
        document.getElementById('quote-id-val').value = '';
        document.getElementById('quote-main-content').value = '';
        document.getElementById('quote-sub-text').value = '';
    }

    if (!state.isThemedNote) {
        let targetTab = 'morning';
        if (existingDate) {
            const isEmpty = (html) => html === '' || html === '<br>' || html === '<div><br></div>' || html.trim() === '';
            if (!isEmpty(state.tempNoteData.morning)) targetTab = 'morning';
            else if (!isEmpty(state.tempNoteData.afternoon)) targetTab = 'afternoon';
            else if (!isEmpty(state.tempNoteData.evening)) targetTab = 'evening';
        } else {
            targetTab = getDefaultTimeTab();
        }
        switchTimeTab(targetTab, true);
        if (existingDate) updateNoteEditTimeIndicators();
    }
}

export function openBookmarkEditor(id = null) {
    state.currentUnifiedType = 'bookmark';
    state.currentEditingBookmarkId = id;
    
    const overlay = document.getElementById('modal-overlay');
    const modal = document.getElementById('editor-modal');
    const titleEl = document.getElementById('editor-modal-title');
    const typeSelector = document.getElementById('unified-type-selector');
    const timeIndicators = document.getElementById('note-edit-time-indicators');
    const deleteBtn = document.getElementById('btn-delete-unified');
    const bookmarkModeSegment = document.getElementById('bookmark-mode-segment');
    
    if (bookmarkModeSegment) bookmarkModeSegment.style.display = id ? 'none' : 'flex';
    if (timeIndicators) timeIndicators.style.display = 'none';
    document.getElementById('note-form-container').style.display = 'none';
    document.getElementById('bookmark-form-container').style.display = 'flex';
    document.getElementById('quote-form-container').style.display = 'none';

    document.getElementById('editor-modal').scrollTop = 0;

    const saveIndicator = document.getElementById('save-indicator-wrapper');
    if (saveIndicator) saveIndicator.style.display = 'none';

    clearTimeout(state.autoSaveTimer);
    state.isNoteUnsaved = false;
    setIndicatorState('');

    modal.classList.remove('shake-animation'); 
    overlay.style.display = 'block';
    modal.style.display = 'block'; 
    requestAnimationFrame(() => requestAnimationFrame(() => {
        overlay.classList.add('active');
        modal.classList.add('active');
    }));

    if (id && state.bookmarks[id]) {
        titleEl.innerText = '編輯資料';
        const bm = state.bookmarks[id];
        document.getElementById('bookmark-id-val').value = id;
        document.getElementById('bookmark-title').value = bm.title || '';
        document.getElementById('bookmark-url').value = bm.url || '';
        document.getElementById('bookmark-category').value = (!bm.category || bm.category === '未分類') ? '' : bm.category;
        document.getElementById('bookmark-desc').value = bm.description || '';
        state.tempBookmarkContent = bm.content || '';
        
        const isCustom = !!bm.isCustomRecord || (!bm.url && !!bm.content);
        setBookmarkMode(isCustom);
        
        if (typeSelector) typeSelector.style.display = 'none';
        deleteBtn.style.display = 'flex';
        if (bookmarkModeSegment) bookmarkModeSegment.style.display = 'none';
    } else {
        titleEl.innerText = '新增資料';
        document.getElementById('bookmark-id-val').value = '';
        document.getElementById('bookmark-title').value = '';
        document.getElementById('bookmark-url').value = '';
        document.getElementById('bookmark-category').value = (state.currentCategory && state.currentCategory !== '未分類') ? state.currentCategory : '';
        document.getElementById('bookmark-desc').value = '';
        const bookmarkContentEl = document.getElementById('bookmark-content');
        if (bookmarkContentEl) bookmarkContentEl.innerHTML = '';
        state.tempBookmarkContent = '';
        setBookmarkMode(false);
        
        document.getElementById('note-content').innerHTML = '';
        document.getElementById('full-note-content').innerHTML = '';
        document.getElementById('note-theme-title').value = '';
        document.getElementById('quote-id-val').value = '';
        document.getElementById('quote-main-content').value = '';
        document.getElementById('quote-sub-text').value = '';
        state.tempNoteData = { morning: '', afternoon: '', evening: '', title: '', content: '', reminder: 'none' };
        state.isThemedNote = false;

        if (typeSelector) {
            typeSelector.style.display = 'flex';
            typeSelector.setAttribute('data-active', '2');
            typeSelector.querySelectorAll('.segment-btn').forEach((btn, idx) => btn.classList.toggle('active', idx === 2));
        }
        deleteBtn.style.display = 'none';
        if (bookmarkModeSegment) bookmarkModeSegment.style.display = 'flex';
    }
}

export function openQuoteEditor(id = null) {
    state.currentUnifiedType = 'quote';
    state.currentEditingQuoteId = id;
    
    const overlay = document.getElementById('modal-overlay');
    const modal = document.getElementById('editor-modal');
    const titleEl = document.getElementById('editor-modal-title');
    const typeSelector = document.getElementById('unified-type-selector');
    const timeIndicators = document.getElementById('note-edit-time-indicators');
    const deleteBtn = document.getElementById('btn-delete-unified');
    const bookmarkModeSegment = document.getElementById('bookmark-mode-segment');

    if (bookmarkModeSegment) bookmarkModeSegment.style.display = 'none';
    if (timeIndicators) timeIndicators.style.display = 'none';
    document.getElementById('note-form-container').style.display = 'none';
    document.getElementById('bookmark-form-container').style.display = 'none';
    document.getElementById('quote-form-container').style.display = 'flex';
    
    document.getElementById('quote-main-content').scrollTop = 0;
    document.getElementById('editor-modal').scrollTop = 0;

    const saveIndicator = document.getElementById('save-indicator-wrapper');
    if (saveIndicator) saveIndicator.style.display = 'none';

    clearTimeout(state.autoSaveTimer);
    state.isNoteUnsaved = false;
    setIndicatorState('');

    modal.classList.remove('shake-animation'); 
    overlay.style.display = 'block';
    modal.style.display = 'block'; 
    requestAnimationFrame(() => requestAnimationFrame(() => {
        overlay.classList.add('active');
        modal.classList.add('active');
    }));

    if (id && state.quotes[id]) {
        titleEl.innerText = '編輯語錄';
        const q = state.quotes[id];
        document.getElementById('quote-main-content').value = q.text || '';
        document.getElementById('quote-sub-text').value = q.sub || '';
        
        if (typeSelector) typeSelector.style.display = 'none';
        deleteBtn.style.display = 'flex';
    } else {
        titleEl.innerText = '新增語錄';
        const quoteId = document.getElementById('quote-id-val');
        if (quoteId) quoteId.value = '';
        document.getElementById('quote-main-content').value = '';
        document.getElementById('quote-sub-text').value = '';

        document.getElementById('note-content').innerHTML = '';
        document.getElementById('full-note-content').innerHTML = '';
        document.getElementById('note-theme-title').value = '';
        document.getElementById('bookmark-id-val').value = '';
        document.getElementById('bookmark-title').value = '';
        document.getElementById('bookmark-url').value = '';
        document.getElementById('bookmark-category').value = (state.currentCategory && state.currentCategory !== '未分類') ? state.currentCategory : '';
        document.getElementById('bookmark-desc').value = '';
        const bookmarkContentEl = document.getElementById('bookmark-content');
        if (bookmarkContentEl) bookmarkContentEl.innerHTML = '';
        state.tempBookmarkContent = '';
        state.tempNoteData = { morning: '', afternoon: '', evening: '', title: '', content: '', reminder: 'none' };
        state.isThemedNote = false;
        
        if (typeSelector) {
            typeSelector.style.display = 'flex';
            typeSelector.setAttribute('data-active', '0');
            typeSelector.querySelectorAll('.segment-btn').forEach((btn, idx) => btn.classList.toggle('active', idx === 0));
        }
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

    const overlay = document.getElementById('modal-overlay');
    const modals = [document.getElementById('editor-modal')];
    const bookmarkModeSegment = document.getElementById('bookmark-mode-segment');
    if (bookmarkModeSegment) bookmarkModeSegment.style.display = 'none';
    
    overlay.classList.remove('active');
    modals.forEach(m => {
        if (!m) return;
        m.classList.remove('active');
        m.style.opacity = '';
        m.style.pointerEvents = '';
    });
    closeCalendar();
    closeReminderPopover();
    
    const toolbar = document.getElementById('text-toolbar');
    if (toolbar) toolbar.classList.remove('active');

    clearTimeout(state.autoSaveTimer);
    state.isNoteUnsaved = false;
    setIndicatorState('');
    state.tempNoteData = { morning: '', afternoon: '', evening: '', title: '', content: '', reminder: 'none' };
    state.tempBookmarkContent = '';
    state.isThemedNote = false;

    const noteContentEl = document.getElementById('note-content');
    if (noteContentEl) noteContentEl.innerHTML = '';
    const fullNoteContentEl = document.getElementById('full-note-content');
    if (fullNoteContentEl) fullNoteContentEl.innerHTML = '';
    const bookmarkContentEl = document.getElementById('bookmark-content');
    if (bookmarkContentEl) bookmarkContentEl.innerHTML = '';
    const quoteMainEl = document.getElementById('quote-main-content');
    if (quoteMainEl) quoteMainEl.value = '';
    const quoteSubEl = document.getElementById('quote-sub-text');
    if (quoteSubEl) quoteSubEl.value = '';
    const bmTitleEl = document.getElementById('bookmark-title');
    if (bmTitleEl) bmTitleEl.value = '';
    const bmUrlEl = document.getElementById('bookmark-url');
    if (bmUrlEl) bmUrlEl.value = '';
    const bmDescEl = document.getElementById('bookmark-desc');
    if (bmDescEl) bmDescEl.value = '';
    const themeTitleEl = document.getElementById('note-theme-title');
    if (themeTitleEl) themeTitleEl.value = '';
    
    setTimeout(() => {
        overlay.style.display = 'none';
        modals.forEach(m => { if (m) m.style.display = 'none'; });
        if (bookmarkModeSegment) bookmarkModeSegment.style.display = 'none';
        state.currentEditingDate = null;
        state.currentEditingBookmarkId = null;
        state.currentEditingQuoteId = null;

        if (state.hasPendingSyncRender) {
            state.hasPendingSyncRender = false;
            renderSidebar();
            if (state.currentView === 'notes') selectYear(state.currentYear);
            else if (state.currentView === 'bookmarks') selectCategory(state.currentCategory);
            else if (state.currentView === 'quotes') selectQuotesView();
        }
    }, 250);
}

export function openSettingsModal() {
    updateThemeSegment();
    updateVisualEffectsSegment();
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

export function openSyncSettingsModal() {
    document.getElementById('setting-github-token').value = localStorage.getItem('github_token') || '';
    document.getElementById('setting-gist-id').value = localStorage.getItem('gist_id') || '';
    const settingsModal = document.getElementById('settings-modal');
    const alertModal = document.getElementById('cloud-alert-modal');
    const syncModal = document.getElementById('sync-settings-modal');

    if (settingsModal && settingsModal.classList.contains('active')) {
        settingsModal.classList.remove('active');
        setTimeout(() => settingsModal.style.display = 'none', 0);
        syncModal.dataset.fromSettings = 'true';
    } else syncModal.dataset.fromSettings = 'false';
    
    if (alertModal && alertModal.classList.contains('active')) {
        alertModal.classList.remove('active');
        setTimeout(() => alertModal.style.display = 'none', 0);
        syncModal.dataset.fromAlert = 'true';
    } else syncModal.dataset.fromAlert = 'false';

    const overlay = document.getElementById('confirm-overlay');
    overlay.style.display = 'block';
    syncModal.style.display = 'block';
    setTimeout(() => {
        overlay.classList.add('active');
        syncModal.classList.add('active');
        document.getElementById('setting-github-token').focus();
    }, 10);
}

export function closeSyncSettingsModal() {
    if (document.activeElement) document.activeElement.blur();
    const syncModal = document.getElementById('sync-settings-modal');
    syncModal.classList.remove('active');
    const fromSettings = syncModal.dataset.fromSettings === 'true';

    if (!fromSettings) {
        const overlay = document.getElementById('confirm-overlay');
        overlay.classList.remove('active');
        setTimeout(() => overlay.style.display = 'none', 250);
    }
    setTimeout(() => {
        syncModal.style.display = 'none';
        if (fromSettings) {
            const settingsModal = document.getElementById('settings-modal');
            settingsModal.style.display = 'block';
            requestAnimationFrame(() => requestAnimationFrame(() => settingsModal.classList.add('active')));
            syncModal.dataset.fromSettings = 'false';
        }
    }, 250);
}

export function openHelpModal() {
    const syncModal = document.getElementById('sync-settings-modal');
    const modal = document.getElementById('help-modal');
    if (syncModal && syncModal.classList.contains('active')) {
        syncModal.classList.remove('active');
        setTimeout(() => syncModal.style.display = 'none', 0);
        modal.dataset.fromSync = 'true';
    } else modal.dataset.fromSync = 'false';
    
    const overlay = document.getElementById('confirm-overlay');
    overlay.style.display = 'block';
    modal.style.display = 'block';
    requestAnimationFrame(() => requestAnimationFrame(() => {
        overlay.classList.add('active');
        modal.classList.add('active');
    }));
}

export function closeHelpModal() {
    const modal = document.getElementById('help-modal');
    if(modal) {
        modal.classList.remove('active');
        const fromSync = modal.dataset.fromSync === 'true';
        if (!fromSync) {
            const overlay = document.getElementById('confirm-overlay');
            overlay.classList.remove('active');
            setTimeout(() => overlay.style.display = 'none', 250);
        }
        setTimeout(() => {
            modal.style.display = 'none';
            if (fromSync) {
                const syncModal = document.getElementById('sync-settings-modal');
                syncModal.style.display = 'block';
                requestAnimationFrame(() => requestAnimationFrame(() => syncModal.classList.add('active')));
                modal.dataset.fromSync = 'false';
            }
        }, 250);
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
    const syncModal = document.getElementById('sync-settings-modal');
    modal.classList.remove('active');
    if (!syncModal || !syncModal.classList.contains('active')) overlay.classList.remove('active');
    setTimeout(() => {
        modal.style.display = 'none';
        if (!syncModal || !syncModal.classList.contains('active')) overlay.style.display = 'none';
    }, 250);
}

export function returnFromCloudAlert() {
    const alertModal = document.getElementById('cloud-alert-modal');
    const settingsModal = document.getElementById('settings-modal');
    alertModal.classList.remove('active');
    setTimeout(() => {
        alertModal.style.display = 'none';
        settingsModal.style.display = 'block';
        requestAnimationFrame(() => requestAnimationFrame(() => settingsModal.classList.add('active')));
    }, 250);
}

export function openRenameCategoryModal() {
    document.getElementById('rename-category-input').value = state.currentCategory;
    const overlay = document.getElementById('confirm-overlay');
    const modal = document.getElementById('rename-category-modal');
    overlay.style.zIndex = "10002"; 
    overlay.style.display = 'block';
    modal.style.display = 'block';
    requestAnimationFrame(() => requestAnimationFrame(() => {
        overlay.classList.add('active');
        modal.classList.add('active');
    }));
}

export function closeRenameCategoryModal() {
    const overlay = document.getElementById('confirm-overlay');
    const modal = document.getElementById('rename-category-modal');
    modal.classList.remove('active');
    if (!document.getElementById('category-modal').classList.contains('active')) {
        overlay.classList.remove('active');
    }
    setTimeout(() => {
        modal.style.display = 'none';
        if (!document.getElementById('category-modal').classList.contains('active')) {
            overlay.style.display = 'none';
            overlay.style.zIndex = ""; 
        }
    }, 250);
}

export function confirmRenameCategory() {
    const newCategory = document.getElementById('rename-category-input').value.trim();
    if (!newCategory || newCategory === state.currentCategory) {
        closeRenameCategoryModal();
        return;
    }
    const now = Date.now();
    Object.keys(state.bookmarks).forEach(id => {
        if (state.bookmarks[id].category === state.currentCategory) {
            state.bookmarks[id].category = newCategory;
            state.bookmarks[id].updatedAt = now;
            StorageAPI.saveItem('bookmarks', id, state.bookmarks[id]); 
        }
    });
    let savedCatOrder = safeJSONParse(localStorage.getItem('my_category_order'), []);
    const index = savedCatOrder.indexOf(state.currentCategory);
    if (index !== -1) {
        savedCatOrder[index] = newCategory;
    } else {
        savedCatOrder.push(newCategory);
    }
    localStorage.setItem('my_category_order', JSON.stringify(savedCatOrder));
    localStorage.setItem('my_category_order_updatedAt', now.toString());

    state.currentCategory = newCategory;
    renderSidebar(); 
    closeRenameCategoryModal();
    setTimeout(() => { showCloudToast('分類已重新命名'); uploadToGist(true); }, 250);
}

export function openCategoryModal() {
    renderExistingCategories();
    const overlay = document.getElementById('confirm-overlay');
    const modal = document.getElementById('category-modal');
    
    overlay.style.zIndex = "10002"; 
    overlay.style.display = 'block';
    modal.style.display = 'flex';

    document.getElementById('modal-category-list').scrollTop = 0;

    requestAnimationFrame(() => requestAnimationFrame(() => {
        overlay.classList.add('active');
        modal.classList.add('active');
    }));
}

export function closeCategoryModal() {
    const overlay = document.getElementById('confirm-overlay');
    const modal = document.getElementById('category-modal');
    modal.classList.remove('active');
    overlay.classList.remove('active');
    setTimeout(() => {
        modal.style.display = 'none';
        overlay.style.display = 'none';
        overlay.style.zIndex = ""; 
    }, 250);
}

// ==========================================
// 年份選擇器 (Popover)
// ==========================================
export function toggleYearSelectPopover(e) {
    if (e) e.stopPropagation();
    const popover = document.getElementById('year-select-popover');
    const btn = document.getElementById('year-select-btn');
    const title = document.getElementById('current-main-title');
    if (!popover || !btn || !title) return;

    if (popover.classList.contains('active')) {
        closeYearSelectPopover();
        return;
    }

    const years = new Set();
    Object.keys(state.notes).forEach(date => years.add(date.split('-')[0]));
    years.add(state.currentYear.toString());
    const sortedYears = Array.from(years).sort((a, b) => b - a);

    popover.innerHTML = '';
    sortedYears.forEach(year => {
        const item = document.createElement('div');
        item.className = `chapter-item ${year === state.currentYear.toString() ? 'active' : ''}`;
        item.innerText = year;
        item.onclick = (ev) => {
            ev.stopPropagation();
            if (state.currentYear.toString() !== year) {
                selectYear(year);
            }
            closeYearSelectPopover();
        };
        popover.appendChild(item);
    });

    const btnRect = btn.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();
    const centerLeft = titleRect.left + (btnRect.right - titleRect.left) / 2;
    const popoverWidth = 140; 
    let left = centerLeft - (popoverWidth / 2);
    let top = btnRect.bottom + 12;

    if (left < 10) left = 10;
    if (left + popoverWidth > state._cachedInnerWidth - 10) left = state._cachedInnerWidth - popoverWidth - 10;

    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
    
    popover.classList.add('active');
}

export function closeYearSelectPopover() {
    const popover = document.getElementById('year-select-popover');
    if (popover) popover.classList.remove('active');
}

// ==========================================
// 提醒選擇器 (Reminder Popover)
// ==========================================
const REMINDER_CONFIG = [
    { key: 'none', label: '無' },
    { key: '1h', label: '1小時前' },
    { key: '2h', label: '2小時前' },
    { key: '1d', label: '1天前' },
    { key: '2d', label: '2天前' },
    { key: '1w', label: '1週前' }
];

export function toggleReminderPopover(e) {
    if (e) e.stopPropagation();
    const popover = document.getElementById('reminder-select-popover');
    const display = document.getElementById('reminder-ui-display');
    if (!popover || !display) return;

    if (popover.classList.contains('active')) {
        closeReminderPopover();
        return;
    }

    const currentVal = document.getElementById('note-reminder-val') ? document.getElementById('note-reminder-val').value : 'none';
    popover.innerHTML = '';

    REMINDER_CONFIG.forEach(opt => {
        const item = document.createElement('div');
        item.className = `chapter-item ${opt.key === currentVal ? 'active' : ''}`;
        item.innerText = opt.label;
        item.onclick = (ev) => {
            ev.stopPropagation();
            selectReminderOption(opt.key, opt.label);
        };
        popover.appendChild(item);
    });

    const displayRect = display.getBoundingClientRect();
    const popoverWidth = 140;
    let left = displayRect.left + (displayRect.width - popoverWidth) / 2;
    let top = displayRect.bottom + 8;

    if (left < 10) left = 10;
    if (left + popoverWidth > state._cachedInnerWidth - 10) left = state._cachedInnerWidth - popoverWidth - 10;

    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
    popover.classList.add('active');
}

export function closeReminderPopover() {
    const popover = document.getElementById('reminder-select-popover');
    if (popover) popover.classList.remove('active');
}

export function selectReminderOption(key, label) {
    const valInput = document.getElementById('note-reminder-val');
    const textSpan = document.getElementById('reminder-text');
    if (valInput) valInput.value = key;
    if (textSpan) textSpan.innerText = label;
    closeReminderPopover();
}

export function closeAllConfirms() {
    if (document.activeElement) document.activeElement.blur();
    closeConfirm();
    closeCategoryModal();
    closeSettingsModal();
    closeSyncSettingsModal();
    closeCloudAlert();
    closeHelpModal(); 
    closeBookmarkSortModal();
    closeRenameCategoryModal(); 
    if (typeof closeYearSelectPopover === 'function') closeYearSelectPopover();
    if (typeof closeReminderPopover === 'function') closeReminderPopover();
}

// ==========================================
// 儲存與刪除邏輯
// ==========================================
export function saveUnified() {
    if (state.currentUnifiedType === 'note') saveNote();
    else if (state.currentUnifiedType === 'bookmark') saveBookmark();
    else if (state.currentUnifiedType === 'quote') saveQuote();
}

export function saveNote() {
    const date = document.getElementById('note-date-val').value;
    const isNew = !state.currentEditingDate;
    const prevKey = state.currentEditingDate;

    if (!state.deletedRecords) {
        state.deletedRecords = { notes: {}, bookmarks: {}, quotes: {} };
    }

    if (state.isThemedNote) {
        const title = document.getElementById('note-theme-title').value.trim();
        const content = document.getElementById('note-content').innerHTML;
        const cleanContent = content.replace(/<br\s*[\/]?>/gi, '').replace(/<div>\s*<\/div>/gi, '').trim();

        if (!date || (!title && !cleanContent)) {
            const modal = document.getElementById('editor-modal');
            modal.classList.remove('shake-animation');
            void modal.offsetWidth; 
            modal.classList.add('shake-animation');
            return;
        }

        const reminderVal = document.getElementById('note-reminder-val') ? document.getElementById('note-reminder-val').value : 'none';
        const noteKey = isNew ? `${date}_t${Date.now()}` : prevKey;

        // 若該 key 先前有刪除墓碑，重新儲存時清除墓碑
        if (state.deletedRecords?.notes?.[noteKey]) {
            delete state.deletedRecords.notes[noteKey];
            StorageAPI.deleteItem('deleted_notes', noteKey);
        }

        state.notes[noteKey] = {
            isThemed: true,
            date: date,
            title: title || '未命名主題',
            content: content,
            reminder: reminderVal,
            timestamp: getTimestamp(),
            updatedAt: Date.now()
        };

        StorageAPI.saveItem('notes', noteKey, state.notes[noteKey]);
    } else {
        state.tempNoteData[state.currentTimeTab] = document.getElementById('note-content').innerHTML;
        const hasContent = (state.tempNoteData.morning.trim() || state.tempNoteData.afternoon.trim() || state.tempNoteData.evening.trim()) !== '';
        
        if (!date || !hasContent) {
            const modal = document.getElementById('editor-modal');
            modal.classList.remove('shake-animation');
            void modal.offsetWidth; 
            modal.classList.add('shake-animation');
            return;
        }

        if (prevKey && prevKey !== date) {
            delete state.notes[prevKey];
            const delTime = Date.now();
            if (!state.deletedRecords.notes) state.deletedRecords.notes = {};
            state.deletedRecords.notes[prevKey] = delTime;
            StorageAPI.deleteItem('notes', prevKey);
            StorageAPI.saveItem('deleted_notes', prevKey, delTime);
        }

        // 若該 key 先前有刪除墓碑，重新儲存時清除墓碑
        if (state.deletedRecords?.notes?.[date]) {
            delete state.deletedRecords.notes[date];
            StorageAPI.deleteItem('deleted_notes', date);
        }

        const reminderVal = 'none';

        state.notes[date] = {
            isThemed: false,
            date: date,
            morning: state.tempNoteData.morning,
            afternoon: state.tempNoteData.afternoon,
            evening: state.tempNoteData.evening,
            reminder: reminderVal,
            timestamp: getTimestamp(),
            updatedAt: Date.now()
        };

        StorageAPI.saveItem('notes', date, state.notes[date]);
    }
    
    state.currentYear = date.split('-')[0];
    closeAllEditors();
    
    setTimeout(() => {
        renderSidebar();
        showCloudToast(isNew ? '新增成功' : '儲存成功');
        uploadToGist(true);
    }, 250);
}

export function saveBookmark() {
    const title = document.getElementById('bookmark-title').value.trim();
    let url = document.getElementById('bookmark-url').value.trim();
    let category = document.getElementById('bookmark-category').value.trim() || '未分類';
    const desc = document.getElementById('bookmark-desc').value.trim();
    const content = state.isCustomBookmark ? (state.tempBookmarkContent || (document.getElementById('bookmark-content') ? document.getElementById('bookmark-content').innerHTML : '')) : '';
    
    if (!state.isCustomBookmark) {
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
        if (url && !url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;
    }

    const isNew = !state.currentEditingBookmarkId;
    const id = state.currentEditingBookmarkId || Date.now().toString();
    const order = (state.bookmarks[id] && state.bookmarks[id].order !== undefined) ? state.bookmarks[id].order : -Date.now(); 
    const oldCategory = state.bookmarks[id] ? state.bookmarks[id].category : null;
    const categoryChanged = oldCategory !== null && oldCategory !== category;
    
    if (!state.deletedRecords) {
        state.deletedRecords = { notes: {}, bookmarks: {}, quotes: {} };
    }
    if (state.deletedRecords?.bookmarks?.[id]) {
        delete state.deletedRecords.bookmarks[id];
        StorageAPI.deleteItem('deleted_bookmarks', id);
    }

    state.bookmarks[id] = {     
        title, 
        url: state.isCustomBookmark ? (url || '') : url, 
        category, 
        description: desc, 
        content: state.isCustomBookmark ? content : (state.bookmarks[id]?.content || ''),
        isCustomRecord: !!state.isCustomBookmark,
        timestamp: getTimestamp(), 
        updatedAt: Date.now(), 
        order 
    };
    StorageAPI.saveItem('bookmarks', id, state.bookmarks[id]);
    state.currentCategory = category;
    closeAllEditors();
    
    setTimeout(() => {
        if (isNew || categoryChanged || state.isCustomBookmark) renderSidebar();
        else updateBookmarkDOM(id);
        showCloudToast(isNew ? '新增成功' : '儲存成功');
        uploadToGist(true);
    }, 250);
}

export function saveQuote() {
    const text = document.getElementById('quote-main-content').value.trim();
    const sub = document.getElementById('quote-sub-text').value.trim();
    
    if (!text) {
        const modal = document.getElementById('editor-modal');
        modal.classList.remove('shake-animation');
        void modal.offsetWidth; 
        modal.classList.add('shake-animation');
        return;
    }

    const isNew = !state.currentEditingQuoteId;
    const id = state.currentEditingQuoteId || Date.now().toString();
    const order = (state.quotes[id] && state.quotes[id].order !== undefined) ? state.quotes[id].order : -Date.now();
    
    if (!state.deletedRecords) {
        state.deletedRecords = { notes: {}, bookmarks: {}, quotes: {} };
    }
    if (state.deletedRecords?.quotes?.[id]) {
        delete state.deletedRecords.quotes[id];
        StorageAPI.deleteItem('deleted_quotes', id);
    }

    state.quotes[id] = { text, sub, timestamp: getTimestamp(), updatedAt: Date.now(), order };
    StorageAPI.saveItem('quotes', id, state.quotes[id]);
    closeAllEditors();
    
    setTimeout(() => {
        if (state.currentView !== 'quotes') selectQuotesView();
        else renderQuotes();
        showCloudToast(isNew ? '新增成功' : '儲存成功');
        uploadToGist(true);
    }, 250);
}

export function triggerUnifiedDelete() {
    if (state.currentUnifiedType === 'note') showDeleteConfirm('note');
    else if (state.currentUnifiedType === 'bookmark') showDeleteConfirm('bookmark');
    else if (state.currentUnifiedType === 'quote') showDeleteConfirm('quote');
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
    }, 250);
}

export function confirmDelete() {
    const now = Date.now();
    if (!state.deletedRecords) {
        state.deletedRecords = { notes: {}, bookmarks: {}, quotes: {} };
    }

    if (state.deleteTargetType === 'note' && state.currentEditingDate) {
        const targetKey = state.currentEditingDate;
        delete state.notes[targetKey];
        if (!state.deletedRecords.notes) state.deletedRecords.notes = {};
        state.deletedRecords.notes[targetKey] = now;
        
        StorageAPI.deleteItem('notes', targetKey);
        StorageAPI.saveItem('deleted_notes', targetKey, now);

        closeConfirm(); closeAllEditors();
        setTimeout(() => { renderSidebar(); showCloudToast('刪除成功'); uploadToGist(true); }, 250);
    } else if (state.deleteTargetType === 'bookmark' && state.currentEditingBookmarkId) {
        const targetId = state.currentEditingBookmarkId;
        delete state.bookmarks[targetId];
        if (!state.deletedRecords.bookmarks) state.deletedRecords.bookmarks = {};
        state.deletedRecords.bookmarks[targetId] = now;

        StorageAPI.deleteItem('bookmarks', targetId);
        StorageAPI.saveItem('deleted_bookmarks', targetId, now);

        closeConfirm(); closeAllEditors();
        setTimeout(() => { renderSidebar(); showCloudToast('刪除成功'); uploadToGist(true); }, 250);
    } else if (state.deleteTargetType === 'quote' && state.currentEditingQuoteId) {
        const targetId = state.currentEditingQuoteId;
        delete state.quotes[targetId];
        if (!state.deletedRecords.quotes) state.deletedRecords.quotes = {};
        state.deletedRecords.quotes[targetId] = now;

        StorageAPI.deleteItem('quotes', targetId);
        StorageAPI.saveItem('deleted_quotes', targetId, now);

        closeConfirm(); closeAllEditors();
        setTimeout(() => { renderQuotes(); showCloudToast('刪除成功'); uploadToGist(true); }, 250);
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
    const fullModal = document.getElementById('full-editor-modal');
    const noteContent = document.getElementById('note-content');
    const bookmarkContent = document.getElementById('bookmark-content');
    const fullContent = document.getElementById('full-note-content');
    const editorModal = document.getElementById('editor-modal');
    const timeSelector = document.getElementById('full-time-selector');
    const wordCount = document.getElementById('full-word-count');

    if (state.currentUnifiedType === 'bookmark') {
        fullContent.innerHTML = bookmarkContent ? bookmarkContent.innerHTML : (state.tempBookmarkContent || '');
        if (timeSelector) timeSelector.style.display = 'none';
        if (wordCount) wordCount.style.display = 'none';
    } else {
        fullContent.innerHTML = noteContent.innerHTML;
        if (state.isThemedNote) {
            if (timeSelector) timeSelector.style.display = 'none';
            if (wordCount) wordCount.style.display = 'none';
        } else {
            if (timeSelector) timeSelector.style.display = 'flex';
            if (wordCount) wordCount.style.display = 'flex';
        }
    }

    fullModal.style.display = 'flex';
    editorModal.classList.remove('active');
    editorModal.style.pointerEvents = 'none';

    requestAnimationFrame(() => requestAnimationFrame(() => {
        fullModal.classList.add('active');
        fullContent.focus({ preventScroll: true });
        fullContent.scrollTop = 0;
        if (state.currentUnifiedType === 'note' && !state.isThemedNote) updateWordCount();
    }));

    setTimeout(() => {
        if (fullModal.classList.contains('active')) {
            editorModal.style.visibility = 'hidden';
        }
    }, 260);
}

export function closeFullEditor() {
    window.getSelection().removeAllRanges();
    const toolbar = document.getElementById('text-toolbar');
    if (toolbar) toolbar.classList.remove('active');

    const fullModal = document.getElementById('full-editor-modal');
    const noteContent = document.getElementById('note-content');
    const bookmarkContent = document.getElementById('bookmark-content');
    const editorModal = document.getElementById('editor-modal');
    const content = document.getElementById('full-note-content').innerHTML;

    if (state.currentUnifiedType === 'bookmark') {
        if (bookmarkContent) bookmarkContent.innerHTML = content;
        state.tempBookmarkContent = content;
    } else {
        if (noteContent) noteContent.innerHTML = content;
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
        }));
    });
}

export function syncFullEditorContent() {
    const content = document.getElementById('full-note-content').innerHTML;
    
    if (state.currentUnifiedType === 'bookmark') {
        const bookmarkContent = document.getElementById('bookmark-content');
        if (bookmarkContent) bookmarkContent.innerHTML = content;
        state.tempBookmarkContent = content;
        return;
    }

    const mainContent = document.getElementById('note-content');
    mainContent.innerHTML = content;
    
    if (state.isThemedNote) {
        if (state.tempNoteData.content !== content) {
            state.tempNoteData.content = content;
            if (!state.isNoteUnsaved) {
                state.isNoteUnsaved = true;
                setIndicatorState('unsaved');
            }
        }
    } else {
        if (state.tempNoteData[state.currentTimeTab] !== content) {
            state.tempNoteData[state.currentTimeTab] = content;
            if (!state.isNoteUnsaved) {
                state.isNoteUnsaved = true;
                setIndicatorState('unsaved');
            }
            updateNoteEditTimeIndicators();
        }
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
    const lastNode = fragment.lastChild;
    range.insertNode(fragment);

    if (lastNode) {
        range.setStartAfter(lastNode);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
    }
}

function notifyNotePasteChanged(editor) {
    if (!state.isNoteUnsaved) {
        state.isNoteUnsaved = true;
        setIndicatorState('unsaved');
    }
    const inputEvent = typeof InputEvent === 'function'
        ? new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' })
        : new Event('input', { bubbles: true });
    editor.dispatchEvent(inputEvent);
    updateWordCount();
    resetAutoSaveTimer();
}

function handleCleanNotePaste(e) {
    const editor = e.currentTarget;
    if (!editor || !editor.matches('#full-note-content, #note-content, #bookmark-content')) return;

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
    notifyNotePasteChanged(editor);
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

    const editors = document.querySelectorAll('#full-note-content, #note-content, #bookmark-content');
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

    if (didChange) notifyNotePasteChanged(editor);
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
    if (!state.isNoteUnsaved) {
        state.isNoteUnsaved = true;
        setIndicatorState('unsaved');
    }
    if (document.activeElement !== activeEditor) activeEditor.focus();
}

export function toggleCalendar() {
    renderCalendar();
    const overlay = document.getElementById('calendar-overlay');
    const modal = document.getElementById('calendar-modal');
    overlay.style.display = 'block';
    modal.style.display = 'block';
    requestAnimationFrame(() => requestAnimationFrame(() => {
        overlay.classList.add('active');
        modal.classList.add('active');
    }));
}

export function closeCalendar() {
    if (document.activeElement) document.activeElement.blur();
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
    state.calDate.setMonth(state.calDate.getMonth() + delta);
    renderCalendar();
}

export function changeYear(delta) {
    state.calDate.setFullYear(state.calDate.getFullYear() + delta);
    renderCalendar();
}

export function selectDate(year, month, day) {
    const yStr = year;
    const mStr = String(month).padStart(2, '0');
    const dStr = String(day).padStart(2, '0');
    const dateStr = `${yStr}-${mStr}-${dStr}`;
    
    const editorModal = document.getElementById('editor-modal');
    const isEditorOpen = editorModal && editorModal.classList.contains('active');

    if (isEditorOpen) {
        const dateVal = document.getElementById('note-date-val');
        const dateText = document.getElementById('date-text');
        if (dateVal) dateVal.value = dateStr;
        if (dateText) dateText.innerText = formatDateForDisplay(dateStr);
        state.calDate = new Date(year, month - 1, day);
        closeCalendar();
    } else {
        closeCalendar();
        openEditor(dateStr);
    }
}

// ==========================================
// 排序、拖曳、搜尋、右鍵選單與同步設定
// ==========================================
export function saveSettings() {
    const token = document.getElementById('setting-github-token').value.trim();
    let gistId = document.getElementById('setting-gist-id').value.trim();
    const match = gistId.match(/[a-f0-9]{32}/);
    if (match) gistId = match[0];
    else if (gistId.includes('/')) {
        const parts = gistId.split('/').filter(Boolean);
        gistId = parts[parts.length - 1];
    }
    localStorage.setItem('github_token', token);
    localStorage.setItem('gist_id', gistId);
    closeSyncSettingsModal();
    alert('設定已儲存');
    downloadFromGist(true); 
    startCloudPolling();
}

export function openSyncSettingsFromAlert() { openSyncSettingsModal(); }

export function forceDownload() {
    closeSettingsModal();
    downloadFromGist(false);
}

export function handleSearch() {
    const query = document.getElementById('main-search-input').value.toLowerCase();
    const clearBtn = document.getElementById('clear-search-btn');
    clearBtn.classList.toggle('visible', query.length > 0);
    const container = document.getElementById('content-container');

    if (state.currentView === 'notes') {
        const months = container.querySelectorAll('.month-title');
        const grids = container.querySelectorAll('.note-grid');
        grids.forEach((grid, index) => {
            let hasVisibleCard = false;
            const cards = grid.querySelectorAll('.note-card');
            cards.forEach(card => {
                const id = card.dataset.id;
                const noteData = state.notes[id] || {};
                let textToSearch = id.toLowerCase();
                if (noteData.isThemed) {
                    textToSearch += ` ${noteData.title || ''} ${noteData.content || ''}`.toLowerCase();
                } else if (typeof noteData === 'string') {
                    textToSearch += " " + noteData.toLowerCase();
                } else if (noteData.content !== undefined) {
                    textToSearch += " " + noteData.content.toLowerCase();
                } else {
                    textToSearch += ` ${noteData.morning || ''} ${noteData.afternoon || ''} ${noteData.evening || ''}`.toLowerCase();
                }

                if (textToSearch.includes(query)) {
                    card.style.display = 'flex';
                    hasVisibleCard = true;
                } else card.style.display = 'none';
            });
            grid.style.display = hasVisibleCard ? 'grid' : 'none';
            if (months[index]) months[index].style.display = hasVisibleCard ? 'flex' : 'none';
        });
    } else if (state.currentView === 'bookmarks') {
        const cards = container.querySelectorAll('.note-card');
        let hasVisibleCard = false;
        cards.forEach(card => {
            const id = card.dataset.id;
            const bm = state.bookmarks[id];
            const textToSearch = `${bm.title || ''} ${bm.url || ''} ${bm.description || ''} ${bm.content || ''} ${state.currentCategory}`.toLowerCase();
            if (textToSearch.includes(query)) {
                card.style.display = 'flex';
                hasVisibleCard = true;
            } else card.style.display = 'none';
        });
        const grid = container.querySelector('.note-grid');
        if (grid) grid.style.display = hasVisibleCard ? 'grid' : 'none';
    } else if (state.currentView === 'quotes') {
        const cards = container.querySelectorAll('.quote-card');
        let hasVisibleCard = false;
        cards.forEach(card => {
            const id = card.dataset.id;
            const q = state.quotes[id];
            const textToSearch = `${q.text || ''} ${q.sub || ''}`.toLowerCase();
            if (textToSearch.includes(query)) {
                card.style.display = 'flex';
                hasVisibleCard = true;
            } else card.style.display = 'none';
        });
        const grid = container.querySelector('.quotes-masonry');
        if (grid) grid.style.display = hasVisibleCard ? 'block' : 'none';
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

    const card = element.closest('.note-card') || element.closest('.quote-card');
    const contentContainer = element.closest('#content-container');
    const cm = document.getElementById('custom-context-menu');

    if (!card && !contentContainer) {
        hideContextMenu();
        return;
    }

    cm.classList.remove('active');
    cm.style.display = 'none';

    state.currentContextMenuCard = card;
    cm.dataset.triggerX = x;
    cm.dataset.triggerY = y;
    
    document.getElementById('context-add-btn').style.display = 'none';
    document.getElementById('context-edit-btn').style.display = 'none';
    document.getElementById('context-delete-btn').style.display = 'none';

    if (card) {
        document.getElementById('context-edit-btn').style.display = 'flex';
        document.getElementById('context-delete-btn').style.display = 'flex';
        let type = 'note';
        if (state.currentView === 'bookmarks') type = 'bookmark';
        else if (state.currentView === 'quotes') type = 'quote';
        state.contextTarget = { type, id: card.dataset.id };
    } else if (contentContainer) {
        document.getElementById('context-add-btn').style.display = 'flex';
        let addText = '新增筆記';
        if (state.currentView === 'bookmarks') addText = '新增資料';
        else if (state.currentView === 'quotes') addText = '新增語錄';
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
    if (state.currentView === 'notes') openEditor();
    else if (state.currentView === 'bookmarks') openBookmarkEditor();
    else if (state.currentView === 'quotes') openQuoteEditor();
}

export function triggerContextEdit() {
    hideContextMenu();
    if(state.contextTarget.type === 'note') openEditor(state.contextTarget.id);
    else if (state.contextTarget.type === 'bookmark') openBookmarkEditor(state.contextTarget.id);
    else if (state.contextTarget.type === 'quote') openQuoteEditor(state.contextTarget.id);
}

export function triggerContextDelete() {
    hideContextMenu();
    if(state.contextTarget.type === 'note') {
        state.currentEditingDate = state.contextTarget.id;
        showDeleteConfirm('note');
    } else if (state.contextTarget.type === 'bookmark') {
        state.currentEditingBookmarkId = state.contextTarget.id;
        showDeleteConfirm('bookmark');
    } else if (state.contextTarget.type === 'quote') {
        state.currentEditingQuoteId = state.contextTarget.id;
        showDeleteConfirm('quote');
    }
}

export function openBookmarkSortModal() {
    const overlay = document.getElementById('confirm-overlay');
    const modal = document.getElementById('bookmark-sort-modal');
    const segment = document.getElementById('bookmark-sort-segment');

    if (state.currentView === 'quotes') {
        segment.style.display = 'none';
        document.getElementById('sort-category-container').classList.remove('active');
        document.getElementById('sort-card-container').classList.add('active');
        modal.querySelector('h2').innerText = '排序';
        renderQuoteSortList();
    } else {
        segment.style.display = 'flex';
        modal.querySelector('h2').innerText = '排序';
        switchBookmarkSortTab('card');
        segment.setAttribute('data-active', '2');
        document.getElementById('seg-sort-category').classList.remove('active');
        document.getElementById('seg-sort-card').classList.add('active');
        renderBookmarkSortLists();
    }

    overlay.style.display = 'block';
    modal.style.display = 'block';

    document.getElementById('sort-category-container').scrollTop = 0;
    document.getElementById('sort-card-container').scrollTop = 0;

    requestAnimationFrame(() => requestAnimationFrame(() => {
        overlay.classList.add('active');
        modal.classList.add('active');
    }));
}

export function closeBookmarkSortModal() {
    const overlay = document.getElementById('confirm-overlay');
    const modal = document.getElementById('bookmark-sort-modal');
    modal.classList.remove('active');
    overlay.classList.remove('active');
    setTimeout(() => {
        modal.style.display = 'none';
        overlay.style.display = 'none';
    }, 250);
}

export function switchBookmarkSortTab(tab) {
    const segment = document.getElementById('bookmark-sort-segment');
    const catBtn = document.getElementById('seg-sort-category');
    const cardBtn = document.getElementById('seg-sort-card');
    const catContainer = document.getElementById('sort-category-container');
    const cardContainer = document.getElementById('sort-card-container');
    
    if (tab === 'category') {
        segment.setAttribute('data-active', '1');
        catBtn.classList.add('active');
        cardBtn.classList.remove('active');
        catContainer.classList.add('active');
        cardContainer.classList.remove('active');
    } else {
        segment.setAttribute('data-active', '2');
        cardBtn.classList.add('active');
        catBtn.classList.remove('active');
        cardContainer.classList.add('active');
        catContainer.classList.remove('active');
        
        const currentCats = Array.from(catContainer.querySelectorAll('.sort-list-item')).map(el => el.dataset.category);
        currentCats.forEach(cat => {
            const header = cardContainer.querySelector(`.sort-list-header[data-category="${cat}"]`);
            const items = cardContainer.querySelectorAll(`.sort-list-item[data-category="${cat}"]`);
            if (header) cardContainer.appendChild(header);
            items.forEach(item => cardContainer.appendChild(item));
        });
    }

    catContainer.scrollTop = 0;
    cardContainer.scrollTop = 0;
}

export function saveBookmarkSortAndClose() {
    if (state.currentView === 'quotes') {
        const cardContainer = document.getElementById('sort-card-container');
        const items = cardContainer.querySelectorAll('.sort-list-item');
        Array.from(items).forEach((el, index) => {
            const id = el.dataset.id;
            if (state.quotes[id]) {
                state.quotes[id].order = index;
                state.quotes[id].updatedAt = Date.now();
                StorageAPI.saveItem('quotes', id, state.quotes[id]);
            }
        });
        renderQuotes();
        uploadToGist(true);
        closeBookmarkSortModal();
        return;
    }

    const catContainer = document.getElementById('sort-category-container');
    const cardContainer = document.getElementById('sort-card-container');
    
    if (catContainer.children.length > 0) {
        const items = catContainer.querySelectorAll('.sort-list-item');
        const order = Array.from(items).map(el => el.dataset.category);
        localStorage.setItem('my_category_order', JSON.stringify(order));
        localStorage.setItem('my_category_order_updatedAt', Date.now().toString());
    }

    if (cardContainer.children.length > 0) {
        const items = cardContainer.querySelectorAll('.sort-list-item');
        Array.from(items).forEach((el, index) => {
            const id = el.dataset.id;
            if (state.bookmarks[id]) {
                state.bookmarks[id].order = index;
                state.bookmarks[id].updatedAt = Date.now();
                StorageAPI.saveItem('bookmarks', id, state.bookmarks[id]);
            }
        });
    }

    renderSidebar();
    uploadToGist(true);
    closeBookmarkSortModal();
}

export function startSortDrag(item, e) {
    state.isSortDragging = true;
    state.draggingSortEl = item;
    const rect = item.getBoundingClientRect();
    state.sortStartY = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;

    state.sortPlaceholder = document.createElement('div');
    state.sortPlaceholder.className = 'sort-list-item placeholder';
    state.sortPlaceholder.style.height = `${rect.height}px`;
    state.sortPlaceholder.style.background = 'transparent';
    state.sortPlaceholder.style.border = '1px solid transparent';
    state.sortPlaceholder.style.boxShadow = 'none';
    state.sortPlaceholder.style.pointerEvents = 'none';

    item.before(state.sortPlaceholder);
    item.style.position = 'fixed';
    item.style.top = `${rect.top}px`;
    item.style.left = `${rect.left}px`;
    item.style.width = `${rect.width}px`;
    item.style.boxSizing = 'border-box';
    item.style.zIndex = '10005';
    item.style.pointerEvents = 'none'; 
    item.style.transition = 'none';
    item.classList.add('dragging');

    document.body.classList.add('no-scroll');
    document.body.classList.add('is-dragging-item');
    document.body.appendChild(item); 
}

export function initSortableLists() {
    let autoScrollVelocity = 0;
    let autoScrollRAF = null;
    let currentClientY = 0;

    const startAutoScroll = () => {
        if (autoScrollRAF) return;
        const scrollStep = () => {
            if (autoScrollVelocity !== 0 && state.activeSortContainer) {
                state.activeSortContainer.scrollTop += autoScrollVelocity;
                _checkSwapFunc(currentClientY);
            }
            autoScrollRAF = requestAnimationFrame(scrollStep);
        };
        autoScrollRAF = requestAnimationFrame(scrollStep);
    };

    const stopAutoScroll = () => {
        if (autoScrollRAF) {
            cancelAnimationFrame(autoScrollRAF);
            autoScrollRAF = null;
        }
        autoScrollVelocity = 0;
    };

    const handleAutoScroll = (clientY, container) => {
        const rect = container.getBoundingClientRect();
        const threshold = 60; 
        const maxSpeed = 15;

        if (clientY < rect.top + threshold) {
            let speed = maxSpeed * (1 - (clientY - rect.top) / threshold);
            autoScrollVelocity = -Math.max(2, speed);
            startAutoScroll();
        } else if (clientY > rect.bottom - threshold) {
            let speed = maxSpeed * (1 - (rect.bottom - clientY) / threshold);
            autoScrollVelocity = Math.max(2, speed);
            startAutoScroll();
        } else {
            stopAutoScroll();
        }
    };

    const _checkSwapFunc = (clientY) => {
        let items;
        if (state.activeSortContainer.id === 'sort-card-container') {
            if (state.currentView === 'quotes') {
                items = [...state.activeSortContainer.querySelectorAll('.sort-list-item:not(.placeholder)')];
            } else {
                const cat = state.draggingSortEl.dataset.category;
                items = [...state.activeSortContainer.querySelectorAll(`.sort-list-item[data-category="${cat}"]:not(.placeholder)`)];
            }
        } else {
            items = [...state.activeSortContainer.querySelectorAll('.sort-list-item:not(.placeholder)')];
        }

        const hoverItem = items.find(el => {
            if (el === state.draggingSortEl) return false;
            const rect = el.getBoundingClientRect();
            return clientY > rect.top && clientY < rect.bottom;
        });

        if (hoverItem) {
            const rect = hoverItem.getBoundingClientRect();
            const isAfter = clientY > rect.top + rect.height / 2;
            if (isAfter) hoverItem.after(state.sortPlaceholder);
            else hoverItem.before(state.sortPlaceholder);
        }
    };

    const handleStart = (e, container) => {
        const item = e.target.closest('.sort-list-item');
        if (!item) return;
        
        state.sortInitY = e.touches ? e.touches[0].clientY : e.clientY;
        state.activeSortContainer = container;

        state.sortLongPressTimer = setTimeout(() => {
            if (navigator.vibrate) navigator.vibrate(30);
            startSortDrag(item, e);
        }, 300);
    };

    const containers = ['sort-category-container', 'sort-card-container'];
    containers.forEach(id => {
        const container = document.getElementById(id);
        if(container) {
            container.addEventListener('mousedown', (e) => handleStart(e, container));
            container.addEventListener('touchstart', (e) => handleStart(e, container), {passive: true});
        }
    });

    let _dragRAF = null;
    const handleMove = (e) => {
        if (state.sortLongPressTimer && !state.isSortDragging) {
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            if (Math.abs(clientY - state.sortInitY) > 10) {
                clearTimeout(state.sortLongPressTimer);
                state.sortLongPressTimer = null;
            }
        }
        if (state.isSortDragging) {
            e.preventDefault();
            currentClientY = e.touches ? e.touches[0].clientY : e.clientY;
            state.draggingSortEl.style.top = `${currentClientY - state.sortStartY}px`;
            state.draggingSortEl.style.transform = 'scale(1.05)';
            if (!_dragRAF) {
                _dragRAF = requestAnimationFrame(() => {
                    _dragRAF = null;
                    _checkSwapFunc(currentClientY);
                    handleAutoScroll(currentClientY, state.activeSortContainer);
                });
            }
        }
    };

    const handleEnd = () => {
        if (state.sortLongPressTimer) {
            clearTimeout(state.sortLongPressTimer);
            state.sortLongPressTimer = null;
        }
        if (!state.isSortDragging) return;
        state.isSortDragging = false;
        if (_dragRAF) { cancelAnimationFrame(_dragRAF); _dragRAF = null; }
        stopAutoScroll();

        state.draggingSortEl.style.position = '';
        state.draggingSortEl.style.top = '';
        state.draggingSortEl.style.left = '';
        state.draggingSortEl.style.width = '';
        state.draggingSortEl.style.transform = '';
        state.draggingSortEl.style.zIndex = '';
        state.draggingSortEl.style.pointerEvents = '';
        state.draggingSortEl.style.boxSizing = '';
        state.draggingSortEl.style.transition = '';
        state.draggingSortEl.classList.remove('dragging');
        document.body.classList.remove('no-scroll');
        document.body.classList.remove('is-dragging-item');

        if (state.sortPlaceholder && state.sortPlaceholder.parentNode) {
            state.sortPlaceholder.replaceWith(state.draggingSortEl);
        } else if (state.draggingSortEl.parentNode === document.body) {
            document.body.removeChild(state.draggingSortEl);
        }
        
        state.draggingSortEl = null;
        state.sortPlaceholder = null;
        state.activeSortContainer = null;
    };

    document.addEventListener('mousemove', handleMove, {passive: false});
    document.addEventListener('touchmove', handleMove, {passive: false});
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchend', handleEnd);
    document.addEventListener('touchcancel', handleEnd);
}

// ==========================================
// 集中式鍵盤快捷鍵
// ==========================================
function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        const key = e.key;
        const isCtrlOrCmd = e.ctrlKey || e.metaKey;

        if (isCtrlOrCmd && key === 's') {
            e.preventDefault();

            const fullModal = document.getElementById('full-editor-modal');
            const editorModal = document.getElementById('editor-modal');
            const isFullOpen = fullModal && fullModal.classList.contains('active');
            const isEditorOpen = editorModal && editorModal.classList.contains('active');

            if ((isFullOpen || isEditorOpen) && state.currentUnifiedType === 'note') {
                if (isFullOpen) syncFullEditorContent();
                quickSaveNote();
            }
            return;
        }

        if (key === 'Tab' && !isCtrlOrCmd && !e.altKey) {
            const fullModal = document.getElementById('full-editor-modal');
            const editorModal = document.getElementById('editor-modal');
            const isFullOpen = fullModal && fullModal.classList.contains('active');
            const isEditorOpen = editorModal && editorModal.classList.contains('active');

            if ((isFullOpen || isEditorOpen) && state.currentUnifiedType === 'note') {
                e.preventDefault();
                const tabs = ['morning', 'afternoon', 'evening'];
                const currentIndex = tabs.indexOf(state.currentTimeTab);
                const nextIndex = e.shiftKey
                    ? (currentIndex - 1 + tabs.length) % tabs.length
                    : (currentIndex + 1) % tabs.length;
                switchTimeTab(tabs[nextIndex]);
            }
            return;
        }

        if (key === 'Escape') {
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
            const renameModal = document.getElementById('rename-category-modal');
            if (renameModal && renameModal.classList.contains('active')) {
                closeRenameCategoryModal();
                return;
            }
            const reminderPopover = document.getElementById('reminder-select-popover');
            if (reminderPopover && reminderPopover.classList.contains('active')) {
                closeReminderPopover();
                return;
            }

            const yearPopover = document.getElementById('year-select-popover');
            if (yearPopover && yearPopover.classList.contains('active')) {
                closeYearSelectPopover();
                return;
            }

            const calendarModal = document.getElementById('calendar-modal');
            if (calendarModal && calendarModal.classList.contains('active')) {
                closeCalendar();
                return;
            }

            const helpModal = document.getElementById('help-modal');
            if (helpModal && helpModal.classList.contains('active')) {
                closeHelpModal();
                return;
            }
            const syncModal = document.getElementById('sync-settings-modal');
            if (syncModal && syncModal.classList.contains('active')) {
                closeSyncSettingsModal();
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

            const sortModal = document.getElementById('bookmark-sort-modal');
            if (sortModal && sortModal.classList.contains('active')) {
                closeBookmarkSortModal();
                return;
            }

            const fullModal = document.getElementById('full-editor-modal');
            if (fullModal && fullModal.classList.contains('active')) {
                saveFullEditor();
                return;
            }

            const editorModal = document.getElementById('editor-modal');
            if (editorModal && editorModal.classList.contains('active')) {
                closeAllEditors();
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
                });
            }
            if (isScrollingTimer) clearTimeout(isScrollingTimer);
            isScrollingTimer = setTimeout(clearScrollingState, 120);
        }, { passive: true });
    }

    document.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation(); 

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

        const element = e.target.closest('.note-card') || e.target.closest('.quote-card') || document.getElementById('content-container');
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
    });

    const rail = document.getElementById('chapter-nav-rail');
    const popover = document.getElementById('chapter-popover');

    const handleOutsideTap = (e) => {
        if (!e.target.closest('#chapter-popover') && !e.target.closest('#chapter-nav-rail')) {
            if (typeof closeChapterPopover === 'function') closeChapterPopover();
        }
        
        if (!e.target.closest('#year-select-popover') && !e.target.closest('#year-select-btn')) {
            if (typeof closeYearSelectPopover === 'function') closeYearSelectPopover();
        }

        if (!e.target.closest('#reminder-select-popover') && !e.target.closest('#reminder-ui-display')) {
            if (typeof closeReminderPopover === 'function') closeReminderPopover();
        }

        if (state._cachedInnerWidth <= 768) {
            const sidebar = document.getElementById('sidebar');
            const overlay = document.getElementById('mobile-sidebar-overlay');
            if (sidebar && sidebar.classList.contains('mobile-open')) {
                if (e.target === overlay || (!e.target.closest('#sidebar') && !e.target.closest('.sidebar-toggle-btn'))) {
                    if (typeof toggleSidebar === 'function') toggleSidebar();
                }
            }
        }
    };

    document.addEventListener('click', handleOutsideTap);
    document.addEventListener('touchstart', handleOutsideTap, { passive: true });

    document.addEventListener('mousemove', (e) => {
        if (state._cachedInnerWidth <= 768) return;

        if (popover && popover.classList.contains('active')) {
            const popoverRect = popover.getBoundingClientRect();
            const railRect = rail.getBoundingClientRect();
            
            const safeArea = {
                top: Math.min(popoverRect.top, railRect.top) - 50,
                bottom: Math.max(popoverRect.bottom, railRect.bottom) + 50,
                left: Math.min(popoverRect.left, railRect.left) - 50,
                right: Math.max(popoverRect.right, railRect.right) + 50
            };

            if (
                e.clientX < safeArea.left ||
                e.clientX > safeArea.right ||
                e.clientY < safeArea.top ||
                e.clientY > safeArea.bottom
            ) {
                if (typeof closeChapterPopover === 'function') closeChapterPopover();
            }
        }

        const yearPopover = document.getElementById('year-select-popover');
        const yearBtn = document.getElementById('year-select-btn');
        if (yearPopover && yearPopover.classList.contains('active') && yearBtn) {
            const ypRect = yearPopover.getBoundingClientRect();
            const btnRect = yearBtn.getBoundingClientRect();
            
            const ypSafeArea = {
                top: Math.min(ypRect.top, btnRect.top) - 45,
                bottom: Math.max(ypRect.bottom, btnRect.bottom) + 45,
                left: Math.min(ypRect.left, btnRect.left) - 45,
                right: Math.max(ypRect.right, btnRect.right) + 45
            };

            if (
                e.clientX < ypSafeArea.left ||
                e.clientX > ypSafeArea.right ||
                e.clientY < ypSafeArea.top ||
                e.clientY > ypSafeArea.bottom
            ) {
                if (typeof closeYearSelectPopover === 'function') closeYearSelectPopover();
            }
        }

        const reminderPopover = document.getElementById('reminder-select-popover');
        const reminderDisplay = document.getElementById('reminder-ui-display');
        if (reminderPopover && reminderPopover.classList.contains('active') && reminderDisplay) {
            const rpRect = reminderPopover.getBoundingClientRect();
            const rdRect = reminderDisplay.getBoundingClientRect();
            
            const rpSafeArea = {
                top: Math.min(rpRect.top, rdRect.top) - 45,
                bottom: Math.max(rpRect.bottom, rdRect.bottom) + 45,
                left: Math.min(rpRect.left, rdRect.left) - 45,
                right: Math.max(rpRect.right, rdRect.right) + 45
            };

            if (
                e.clientX < rpSafeArea.left ||
                e.clientX > rpSafeArea.right ||
                e.clientY < rpSafeArea.top ||
                e.clientY > rpSafeArea.bottom
            ) {
                if (typeof closeReminderPopover === 'function') closeReminderPopover();
            }
        }
    });

    const fullNoteContent = document.getElementById('full-note-content');
    if (fullNoteContent) {
        fullNoteContent.addEventListener('input', () => {
            if (!state.isNoteUnsaved) {
                state.isNoteUnsaved = true;
                setIndicatorState('unsaved');
            }
            updateWordCount();
            resetAutoSaveTimer();
        });

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

    const smallNoteContent = document.getElementById('note-content');
    if (smallNoteContent) {
        smallNoteContent.addEventListener('input', () => {
            if (!state.isNoteUnsaved) {
                state.isNoteUnsaved = true;
                setIndicatorState('unsaved');
            }
            resetAutoSaveTimer();
        });
    }

    const mainFab = document.querySelector('.fab-main-btn');
    let fabStartX = 0, fabStartY = 0;
    if (mainFab) {
        const startFabInteraction = (clientX, clientY) => { fabStartX = clientX; fabStartY = clientY; };
        const endFabInteraction = (clientX, clientY) => {
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
        const typeTabs = ['quote', 'note', 'bookmark']; 
        const isSortType = segment.id === 'bookmark-sort-segment';
        const sortTabs = ['category', 'card'];
        const isTimeType = segment.id === 'full-time-selector' || segment.id === 'time-selector';
        const timeTabs = ['morning', 'afternoon', 'evening'];
        const isVisualType = segment.id === 'visual-effects-segment';
        const isThemeType = segment.id === 'dark-mode-segment';
        const isBookmarkModeType = segment.id === 'bookmark-mode-segment';

        const getActiveIndex = () => {
            let active = segment.getAttribute('data-active');
            if (isTimeType) return timeTabs.indexOf(active);
            if (isSortType || isVisualType || isThemeType || isBookmarkModeType) return active === '1' ? 0 : 1;
            return parseInt(active) || 0;
        };

        const startDrag = (clientX) => {
            isDragging = true;
            hasMoved = false; 
            startX = clientX;
            segmentWidth = Math.max(1, ((segment.offsetWidth || 140) - 8) / numOptions); 
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
                let maxTranslate = segmentWidth * (numOptions - 1);
                if (newX < 0) newX = 0;
                if (newX > maxTranslate) newX = maxTranslate;
                slider.style.transform = `translateX(${newX}px)`;

                let targetIndex = Math.round(newX / segmentWidth);
                if (targetIndex < 0) targetIndex = 0;
                if (targetIndex >= numOptions) targetIndex = numOptions - 1;
                
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

            let finalX = currentSliderX + (clientX - startX);
            let targetIndex = Math.round(finalX / segmentWidth);
            if (targetIndex < 0) targetIndex = 0;
            if (targetIndex >= numOptions) targetIndex = numOptions - 1;
            
            if (isUnifiedType) {
                if (getActiveIndex() !== targetIndex) switchCreateType(typeTabs[targetIndex]);
                else btns.forEach((btn, idx) => btn.classList.toggle('active', idx === targetIndex));
            } else if (isSortType) {
                const targetState = targetIndex === 0 ? '1' : '2';
                if (segment.getAttribute('data-active') !== targetState) {
                    segment.setAttribute('data-active', targetState);
                    switchBookmarkSortTab(sortTabs[targetIndex]);
                } else btns.forEach((btn, idx) => btn.classList.toggle('active', idx === targetIndex));
            } else if (isVisualType) {
                const targetState = targetIndex === 0 ? '1' : '2';
                if (segment.getAttribute('data-active') !== targetState) {
                    setVisualEffects(targetIndex === 1);
                } else btns.forEach((btn, idx) => btn.classList.toggle('active', idx === targetIndex));
            } else if (isThemeType) {
                const targetState = targetIndex === 0 ? '1' : '2';
                if (segment.getAttribute('data-active') !== targetState) {
                    setDarkMode(targetIndex === 1);
                } else btns.forEach((btn, idx) => btn.classList.toggle('active', idx === targetIndex));
            } else if (isBookmarkModeType) {
                const targetState = targetIndex === 0 ? '1' : '2';
                if (segment.getAttribute('data-active') !== targetState) {
                    setBookmarkMode(targetIndex === 1);
                } else btns.forEach((btn, idx) => btn.classList.toggle('active', idx === targetIndex));
            } else if (isTimeType) {
                switchTimeTab(timeTabs[targetIndex]);
            }
        };

        btns.forEach((btn, index) => {
            const handleTap = (e) => {
                if (e.cancelable) e.preventDefault(); 
                if (isUnifiedType) switchCreateType(typeTabs[index]);
                else if (isSortType) {
                    const targetState = index === 0 ? '1' : '2';
                    segment.setAttribute('data-active', targetState);
                    switchBookmarkSortTab(sortTabs[index]);
                } else if (isVisualType) setVisualEffects(index === 1);
                else if (isThemeType) setDarkMode(index === 1);
                else if (isBookmarkModeType) setBookmarkMode(index === 1);
                else if (isTimeType) switchTimeTab(timeTabs[index]);
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
        return isFullEditorOpen ? document.getElementById('full-note-content') : document.getElementById('note-content');
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
        const editor = target.closest('#full-note-content, #note-content');
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
        notes: state.notes,
        bookmarks: state.bookmarks,
        quotes: state.quotes,
        deletedRecords: state.deletedRecords || { notes: {}, bookmarks: {}, quotes: {} },
        category_order: localStorage.getItem('my_category_order') || '[]',
        category_order_updatedAt: parseInt(localStorage.getItem('my_category_order_updatedAt') || '0', 10),
        sort_order: state.sortOrder || localStorage.getItem('note_sort_order') || 'newest',
        sort_order_updatedAt: parseInt(localStorage.getItem('note_sort_order_updatedAt') || '0', 10)
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

            const finalMergedData = mergeDatasets(localData, importedData);

            state.syncVersion = Number(finalMergedData.syncVersion) || 0;
            localStorage.setItem('sync_version', state.syncVersion.toString());

            state.notes = finalMergedData.notes || {};
            state.bookmarks = finalMergedData.bookmarks || {};
            state.quotes = finalMergedData.quotes || {};
            state.deletedRecords = finalMergedData.deletedRecords || { notes: {}, bookmarks: {}, quotes: {} };

            if (finalMergedData.category_order) {
                localStorage.setItem('my_category_order', typeof finalMergedData.category_order === 'string' ? finalMergedData.category_order : JSON.stringify(finalMergedData.category_order));
            }
            if (finalMergedData.category_order_updatedAt) {
                localStorage.setItem('my_category_order_updatedAt', finalMergedData.category_order_updatedAt.toString());
            }
            if (finalMergedData.sort_order) {
                state.sortOrder = finalMergedData.sort_order;
                localStorage.setItem('note_sort_order', finalMergedData.sort_order);
                if (finalMergedData.sort_order_updatedAt) {
                    localStorage.setItem('note_sort_order_updatedAt', finalMergedData.sort_order_updatedAt.toString());
                }
                updateSortIcon();
            }

            await StorageAPI.replaceAll('notes', state.notes);
            await StorageAPI.replaceAll('bookmarks', state.bookmarks);
            await StorageAPI.replaceAll('quotes', state.quotes);
            await StorageAPI.replaceAll('deleted_notes', state.deletedRecords.notes || {});
            await StorageAPI.replaceAll('deleted_bookmarks', state.deletedRecords.bookmarks || {});
            await StorageAPI.replaceAll('deleted_quotes', state.deletedRecords.quotes || {});

            renderSidebar();
            if (state.currentView === 'notes') selectYear(state.currentYear);
            else if (state.currentView === 'bookmarks') selectCategory(state.currentCategory);
            else if (state.currentView === 'quotes') selectQuotesView();

            showCloudToast('檔案匯入合併成功');
            closeSettingsModal();
            uploadToGist(true);
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
    selectQuotesView, openRenameCategoryModal, handleSearch, clearSearch,
    toggleSortOrder, openBookmarkSortModal, switchCreateType, openCategoryModal,
    triggerUnifiedDelete, closeAllEditors, saveUnified, changeYear, changeMonth,
    closeConfirm, confirmDelete, closeCategoryModal, closeRenameCategoryModal,
    confirmRenameCategory, openSyncSettingsModal, setVisualEffects, setDarkMode, openHelpModal,
    closeSyncSettingsModal, saveSettings, closeHelpModal, returnFromCloudAlert,
    openSyncSettingsFromAlert, switchBookmarkSortTab, saveBookmarkSortAndClose,
    handleClipboard, handleFormat, switchTimeTab, saveFullEditor, closeCalendar,
    toggleCalendar, openFullEditor, closeAllConfirms, 
    openEditor, openBookmarkEditor, openQuoteEditor, selectYear, selectCategory,
    showContextMenu, selectDate, closeBookmarkSortModal, closeFullEditor,
    forceDownload, expandSidebarForBookmarks, toggleYearSelectPopover, closeYearSelectPopover,
    selectCurrentYearView, exportLocalData, importLocalData, updateNoteEditTimeIndicators,
    toggleChapterPopover, closeChapterPopover, scrollToChapterTarget, initChapterScrollSpy,
    setBookmarkMode, toggleReminderPopover, closeReminderPopover, selectReminderOption
});