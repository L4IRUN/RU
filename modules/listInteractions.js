// @ts-check
// @ts-nocheck
// 沿用 interaction.js 的型別檢查範圍；本階段只搬移函式，型別化另行處理。
// 多選、批次搬移、搜尋與右鍵選單

import { state } from '../state.js';
import { isTransitionCategory } from '../domain.js';
import { renderSidebar, renderBookmarks, renderReminders, showCloudToast, updateSelectionBarUI, updateBookmarkCategoryDisplayUI, updateChapterNav, resetFabStateClean } from '../ui.js';
import { uploadToDrive, getMonotonicTimestamp, markLocalDataDirty } from '../sync.js';
import { StorageAPI, safeJSONParse, notifyCrossTabChange } from '../storage.js';
import { openMoveModal, closeCategoryModal } from './categoryModal.js';
import { hideHeaderPopoverMenu } from './categoryMenu.js';
import { resetFabIdleTimer, openBookmarkEditor, openReminderEditor } from './editor.js';
import { showDeleteConfirm } from './saveDelete.js';

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
        if (state.hasPendingSyncRender) {
            state.hasPendingSyncRender = false;
            renderSidebar();
        } else if (state.currentView === 'reminders') {
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

export function triggerHeaderMenuSelect(e) {
    if (e) e.stopPropagation();
    hideHeaderPopoverMenu(true);
    toggleSelectionMode();
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

export async function confirmCategorySubCategorySelection() {
    if (state.isMoveSelectionActive && state.moveTargetType === 'subcategory' && state.tempModalCategory === state.currentCategory) {
        const warning = document.getElementById('same-category-warning');
        if (warning instanceof HTMLDialogElement && !warning.open) warning.showModal();
        return;
    }

    const now = getMonotonicTimestamp();
    let orderChanged = false;

    const selectedModalCat = (state.tempModalCategory || '').trim();
    if (Array.isArray(state.tempCategoryModalCategoryOrder) && state.tempCategoryModalCategoryOrder.length > 0) {
        let nextCatOrder = [...state.tempCategoryModalCategoryOrder];
        if (selectedModalCat && selectedModalCat !== '未分類' && !isTransitionCategory(selectedModalCat) && !nextCatOrder.includes(selectedModalCat)) {
            nextCatOrder = [selectedModalCat, ...nextCatOrder];
        }
        localStorage.setItem('my_category_order', JSON.stringify(nextCatOrder));
        localStorage.setItem('my_category_order_updatedAt', now.toString());
        orderChanged = true;
    } else if (selectedModalCat && selectedModalCat !== '未分類' && !isTransitionCategory(selectedModalCat)) {
        const savedCatOrder = safeJSONParse(localStorage.getItem('my_category_order'), []);
        if (Array.isArray(savedCatOrder) && !savedCatOrder.includes(selectedModalCat)) {
            localStorage.setItem('my_category_order', JSON.stringify([selectedModalCat, ...savedCatOrder]));
            localStorage.setItem('my_category_order_updatedAt', now.toString());
            orderChanged = true;
        }
    }

    if (state.tempCategoryModalSubCategoryOrders && Object.keys(state.tempCategoryModalSubCategoryOrders).length > 0) {
        const subOrdersMap = safeJSONParse(localStorage.getItem('my_subcategory_order'), {});
        const subTimestampsMap = safeJSONParse(localStorage.getItem('my_subcategory_order_timestamps'), {});
        Object.keys(state.tempCategoryModalSubCategoryOrders).forEach(cat => {
            subOrdersMap[cat] = state.tempCategoryModalSubCategoryOrders[cat];
            subTimestampsMap[cat] = now;
        });
        localStorage.setItem('my_subcategory_order', JSON.stringify(subOrdersMap));
        localStorage.setItem('my_subcategory_order_updatedAt', now.toString());
        localStorage.setItem('my_subcategory_order_timestamps', JSON.stringify(subTimestampsMap));
        orderChanged = true;
    }

    const pendingCardOrderUpdates = {};
    if (state.tempCategoryModalCardOrders && Object.keys(state.tempCategoryModalCardOrders).length > 0) {
        Object.values(state.tempCategoryModalCardOrders).forEach(cardIdList => {
            if (Array.isArray(cardIdList)) {
                const ids = cardIdList.filter(id => id !== null && state.bookmarks[id]);
                const idSet = new Set(ids);
                const savedIds = Object.keys(state.bookmarks).filter(id => idSet.has(id))
                    .sort((a, b) => (state.bookmarks[a].order || 0) - (state.bookmarks[b].order || 0));
                if (ids.every((id, index) => id === savedIds[index])) return;

                ids.forEach((id, index) => {
                    if (state.bookmarks[id].order !== index) {
                        state.bookmarks[id].order = index;
                        state.bookmarks[id].updatedAt = now;
                        pendingCardOrderUpdates[id] = state.bookmarks[id];
                        orderChanged = true;
                    }
                });
            }
        });
    }

    if (state.isMoveSelectionActive) {
        if (state.moveTargetType === 'subcategory') {
            const targetCategory = state.tempModalCategory;
            const subCatsToMove = Array.from(state.selectedSubCategories || []);
            if (!targetCategory || subCatsToMove.length === 0) return;

            const subOrdersMap = safeJSONParse(localStorage.getItem('my_subcategory_order'), {});
            const subTimestampsMap = safeJSONParse(localStorage.getItem('my_subcategory_order_timestamps'), {});
            const targetSubOrder = Array.isArray(subOrdersMap[targetCategory]) ? subOrdersMap[targetCategory] : [];
            const sourceSubOrder = Array.isArray(subOrdersMap[state.currentCategory]) ? subOrdersMap[state.currentCategory] : [];

            const updatedBookmarks = { ...pendingCardOrderUpdates };
            Object.keys(state.bookmarks).forEach(id => {
                const bm = state.bookmarks[id];
                const cat = (bm.category && bm.category.trim() !== '') ? bm.category.trim() : '未分類';
                const subCat = (bm.subCategory && bm.subCategory.trim() !== '') ? bm.subCategory.trim() : '未分類';
                if (cat === state.currentCategory && subCatsToMove.includes(subCat)) {
                    bm.category = targetCategory;
                    bm.updatedAt = now;
                    updatedBookmarks[id] = bm;
                }
            });

            if (Object.keys(updatedBookmarks).length > 0) {
                await StorageAPI.saveItems('bookmarks', updatedBookmarks);
            }

            subCatsToMove.forEach(sub => {
                if (sub !== '未分類' && !targetSubOrder.includes(sub)) {
                    targetSubOrder.push(sub);
                }
            });
            subOrdersMap[targetCategory] = targetSubOrder;
            subOrdersMap[state.currentCategory] = sourceSubOrder.filter(s => !subCatsToMove.includes(s));
            subTimestampsMap[targetCategory] = now;
            subTimestampsMap[state.currentCategory] = now;
            localStorage.setItem('my_subcategory_order', JSON.stringify(subOrdersMap));
            localStorage.setItem('my_subcategory_order_updatedAt', now.toString());
            localStorage.setItem('my_subcategory_order_timestamps', JSON.stringify(subTimestampsMap));

            markLocalDataDirty();
            notifyCrossTabChange({ type: 'DATA_CHANGED' });

            const hasRemainingInCurrentCategory = Object.values(state.bookmarks || {}).some(bm => {
                const cat = (bm.category && bm.category.trim() !== '') ? bm.category.trim() : '未分類';
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
            const finalCat = (state.tempModalCategory || '').trim();
            const rawSub = (state.tempModalSubCategory || '').trim();
            const finalSubCat = rawSub === '未分類' ? '' : rawSub;
            if (!finalCat) return;

            const cardIdsToMove = Array.from(state.selectedBookmarkIds || [])
                .filter(id => !!state.bookmarks[id])
                .sort((a, b) => (state.bookmarks[a].order || 0) - (state.bookmarks[b].order || 0));
            if (cardIdsToMove.length === 0) return;

            const isAllSameDestination = cardIdsToMove.every(id => {
                const bm = state.bookmarks[id];
                if (!bm) return false;
                const currentBmCat = (bm.category && bm.category.trim() !== '') ? bm.category.trim() : '未分類';
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
                    const bmCat = (bm.category && bm.category.trim() !== '') ? bm.category.trim() : '未分類';
                    const bmSub = (bm.subCategory && bm.subCategory.trim() !== '') ? bm.subCategory.trim() : '';
                    return bmCat === finalCat && bmSub === finalSubCat;
                })
                .map(bm => typeof bm.order === 'number' ? bm.order : 0);
            let nextOrder = existingOrders.length > 0 ? Math.max(...existingOrders) + 1 : 0;

            const updatedBookmarks = { ...pendingCardOrderUpdates };
            cardIdsToMove.forEach(id => {
                const bm = state.bookmarks[id];
                if (bm) {
                    bm.category = finalCat;
                    bm.subCategory = finalSubCat;
                    bm.order = nextOrder++;
                    bm.updatedAt = now;
                    updatedBookmarks[id] = bm;
                }
            });

            if (Object.keys(updatedBookmarks).length > 0) {
                await StorageAPI.saveItems('bookmarks', updatedBookmarks);
            }

            if (finalSubCat && finalSubCat !== '未分類') {
                const subOrdersMap = safeJSONParse(localStorage.getItem('my_subcategory_order'), {});
                const subTimestampsMap = safeJSONParse(localStorage.getItem('my_subcategory_order_timestamps'), {});
                const targetOrder = Array.isArray(subOrdersMap[finalCat]) ? subOrdersMap[finalCat] : [];
                if (!targetOrder.includes(finalSubCat)) {
                    targetOrder.push(finalSubCat);
                    subOrdersMap[finalCat] = targetOrder;
                    subTimestampsMap[finalCat] = now;
                    localStorage.setItem('my_subcategory_order', JSON.stringify(subOrdersMap));
                    localStorage.setItem('my_subcategory_order_updatedAt', now.toString());
                    localStorage.setItem('my_subcategory_order_timestamps', JSON.stringify(subTimestampsMap));
                }
            }

            markLocalDataDirty();
            notifyCrossTabChange({ type: 'DATA_CHANGED' });

            const hasRemainingInCurrentCategory = Object.values(state.bookmarks || {}).some(bm => {
                const cat = (bm.category && bm.category.trim() !== '') ? bm.category.trim() : '未分類';
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

    if (Object.keys(pendingCardOrderUpdates).length > 0) {
        await StorageAPI.saveItems('bookmarks', pendingCardOrderUpdates);
    }

    const finalCat = (state.tempModalCategory || '').trim();
    const rawSub = (state.tempModalSubCategory || '').trim();
    const finalSubCat = rawSub === '未分類' ? '' : rawSub;

    const draft = state.editorDraft;
    const cardOrder = state.tempCategoryModalCardOrders[`${finalCat}:::${rawSub}`];
    const draftIndex = cardOrder?.indexOf(null) ?? -1;
    if (draftIndex !== -1) {
        draft.bookmarkInsertion = {
            category: finalCat,
            subCategory: finalSubCat,
            beforeId: cardOrder[draftIndex - 1] ?? null,
            afterId: cardOrder[draftIndex + 1] ?? null
        };
    } else if (draft.bookmarkInsertion?.category !== finalCat || draft.bookmarkInsertion?.subCategory !== finalSubCat) {
        draft.bookmarkInsertion = null;
    }
    updateBookmarkCategoryDisplayUI(finalCat, finalSubCat);
    closeCategoryModal();

    if (orderChanged) {
        markLocalDataDirty();
        notifyCrossTabChange({ type: 'DATA_CHANGED' });
        renderSidebar();
        uploadToDrive(true);
    }
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
        state.editorDraft.editingBookmarkId = state.contextTarget.id;
        showDeleteConfirm('bookmark');
    } else if (state.contextTarget.type === 'reminder') {
        state.editorDraft.editingReminderId = state.contextTarget.id;
        showDeleteConfirm('reminder');
    }
}
