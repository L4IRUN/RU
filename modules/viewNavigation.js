// @ts-check
// @ts-nocheck
// 沿用來源型別檢查範圍；本階段只做機械搬移。

import { state } from '../state.js';

import { toggleSidebar, clearChapterScrollSpy, hideSidebarProfilePopover, hideSidebarCollapsedMenu, toggleSidebarDesktop } from './navigation.js';

import { exitSelectionMode } from './listInteractions.js';

import { stopReminderCountdownTimer, updateCollapsedIcons, renderBookmarks, updateFloatingCategoryTitle, updateSelectionBarUI, renderReminders } from '../ui.js';

import { hasModal, isTransitionCategory } from '../domain.js';

import { hideCategoryPopoverMenu } from './categoryMenu.js';

import { safeJSONParse } from '../storage.js';

export function selectCategory(category, closeSidebarOnMobile = true) {
    if (state.isRenamingMainCategory || document.querySelector('.year-item.is-renaming')) {
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
    const headerSortBtn = document.getElementById('header-sort-btn');
    if (headerSortBtn) headerSortBtn.style.display = 'flex';
    const headerMenuSortItem = document.getElementById('header-menu-sort-item');
    if (headerMenuSortItem) headerMenuSortItem.style.display = 'flex';
    document.querySelectorAll('.year-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.year-item[data-category]').forEach(el => {
        if (el.dataset.category === category) el.classList.add('active');
    });

    updateCollapsedIcons('bookmarks');

    renderBookmarks();
    updateFloatingCategoryTitle();

    const isEditorOpen = hasModal(state, 'editor') || hasModal(state, 'full-editor');
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
    const headerSortBtn = document.getElementById('header-sort-btn');
    if (headerSortBtn) headerSortBtn.style.display = 'none';
    const headerMenuSortItem = document.getElementById('header-menu-sort-item');
    if (headerMenuSortItem) headerMenuSortItem.style.display = 'none';
    document.querySelectorAll('.year-item').forEach(el => el.classList.remove('active'));
    const navRemindersBtn = document.getElementById('nav-reminders-btn');
    if (navRemindersBtn) navRemindersBtn.classList.add('active');
    
    updateCollapsedIcons('reminders');

    updateSelectionBarUI();
    renderReminders();
    updateFloatingCategoryTitle();

    const isEditorOpen = hasModal(state, 'editor') || hasModal(state, 'full-editor');
    if (!isEditorOpen) {
        document.querySelector('main').scrollTo(0, 0);
    }
}

export function handleSidebarCategoryClick(category, itemEl) {
    if (itemEl && itemEl.classList.contains('is-renaming')) return;
    hideCategoryPopoverMenu(true);
    hideSidebarProfilePopover(true);
    hideSidebarCollapsedMenu(true);
    selectCategory(category, true);
}

export function handleSidebarRemindersClick(itemEl) {
    hideCategoryPopoverMenu(true);
    hideSidebarProfilePopover(true);
    hideSidebarCollapsedMenu(true);
    selectRemindersView(true);
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
        const emptyCats = safeJSONParse(localStorage.getItem('my_empty_categories'), []);
        if (Array.isArray(emptyCats)) {
            emptyCats.forEach(c => {
                if (typeof c === 'string' && c.trim() !== '' && c.trim() !== '未分類' && !isTransitionCategory(c.trim())) {
                    validCategoriesSet.add(c.trim());
                }
            });
        }

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
