// @ts-check
// @ts-nocheck
// 沿用 interaction.js 的型別檢查範圍；本階段只搬移函式，型別化另行處理。
// 儲存與刪除邏輯

import { state } from '../state.js';
import { isTransitionCategory, getBookmarkIdsInSubCategory, getBookmarkInsertionIndex } from '../domain.js';
import {
    renderSidebar, renderReminders, updateBookmarkDOM, showCloudToast,
    getTimestamp, getLocalDateString, renderUserProfileUI
} from '../ui.js';
import {
    uploadToDrive, isGoogleConnected, promptAuthOncePerSession,
    getMonotonicTimestamp, markLocalDataDirty, PENDING_SYNC_FLAG
} from '../sync.js';
import { StorageAPI, safeJSONParse, notifyCrossTabChange, generateUUID, stripDangerousHtml } from '../storage.js';
import { openModal, closeModal } from './modalManager.js';
import { closeAllEditors } from './editor.js';
import { currentCategoryMenuContext, hideCategoryPopoverMenu } from './categoryMenu.js';

let selectCategory = null;
let selectRemindersView = null;
let exitSelectionMode = null;

export function configureSaveDeleteHandlers(handlers) {
    selectCategory = handlers.selectCategory;
    selectRemindersView = handlers.selectRemindersView;
    exitSelectionMode = handlers.exitSelectionMode;
}

let deleteSyncDebounceTimer = null;

let lastDeleteTimestamp = 0;

export function triggerBatchDeleteReminders() {
    if (!state.isSelectionMode) return;
    const isBookmarks = state.currentView === 'bookmarks';
    const subCount = state.selectedSubCategories ? state.selectedSubCategories.size : 0;
    const cardCount = isBookmarks ? (state.selectedBookmarkIds?.size || 0) : (state.selectedReminderIds?.size || 0);
    if (cardCount === 0 && subCount === 0) return;

    if (isBookmarks && subCount > 0) {
        state.deleteTargetType = 'batch-subcategories';
        if (state.selectedBookmarkIds) state.selectedBookmarkIds.clear();
    } else {
        state.deleteTargetType = isBookmarks ? 'batch-bookmarks' : 'batch-reminders';
        if (state.selectedSubCategories) state.selectedSubCategories.clear();
    }

    const modal = document.getElementById('confirm-modal');
    const titleEl = modal ? modal.querySelector('h2') : null;
    const descEl = modal ? modal.querySelector('p') : null;

    if (titleEl) titleEl.innerText = '確定要刪除？';
    if (descEl) descEl.innerText = '刪除後將無法復原資料。';

    openModal('confirm');
}

export function triggerCategoryDeleteFromMenu(e) {
    const evt = e || window.event;
    if (evt && typeof evt.stopPropagation === 'function') {
        evt.stopPropagation();
    }
    if (!currentCategoryMenuContext) return;
    const { category } = currentCategoryMenuContext;
    hideCategoryPopoverMenu(true);

    const hasCards = Object.values(state.bookmarks || {}).some(bm => {
        if (!bm) return false;
        const bmCat = (bm.category && bm.category.trim() !== '') ? bm.category.trim() : '未分類';
        return bmCat === category;
    });
    if (hasCards) return;

    const now = getMonotonicTimestamp();

    const deletedCats = safeJSONParse(localStorage.getItem('my_deleted_categories'), {});
    deletedCats[category] = now;
    localStorage.setItem('my_deleted_categories', JSON.stringify(deletedCats));

    const renameMap = safeJSONParse(localStorage.getItem('my_category_renames'), {});
    let renameMapChanged = false;
    for (const [oldCat, record] of Object.entries(renameMap)) {
        if (oldCat === category || (record && record.to === category)) {
            delete renameMap[oldCat];
            renameMapChanged = true;
        }
    }
    if (renameMapChanged) {
        localStorage.setItem('my_category_renames', JSON.stringify(renameMap));
    }

    let emptyCats = safeJSONParse(localStorage.getItem('my_empty_categories'), []);
    if (Array.isArray(emptyCats)) {
        emptyCats = emptyCats.filter(c => c !== category);
        localStorage.setItem('my_empty_categories', JSON.stringify(emptyCats));
        localStorage.setItem('my_empty_categories_updatedAt', now.toString());
    }

    const emptyCatTimestamps = safeJSONParse(localStorage.getItem('my_empty_categories_timestamps'), {});
    if (emptyCatTimestamps && Object.prototype.hasOwnProperty.call(emptyCatTimestamps, category)) {
        delete emptyCatTimestamps[category];
        localStorage.setItem('my_empty_categories_timestamps', JSON.stringify(emptyCatTimestamps));
    }

    let savedCatOrder = safeJSONParse(localStorage.getItem('my_category_order'), []);
    if (Array.isArray(savedCatOrder)) {
        savedCatOrder = savedCatOrder.filter(c => c !== category);
        localStorage.setItem('my_category_order', JSON.stringify(savedCatOrder));
        localStorage.setItem('my_category_order_updatedAt', now.toString());
    }

    const subcategoryOrdersMap = safeJSONParse(localStorage.getItem('my_subcategory_order'), {});
    if (subcategoryOrdersMap && subcategoryOrdersMap[category]) {
        delete subcategoryOrdersMap[category];
        localStorage.setItem('my_subcategory_order', JSON.stringify(subcategoryOrdersMap));
        localStorage.setItem('my_subcategory_order_updatedAt', now.toString());
    }

    markLocalDataDirty();
    notifyCrossTabChange({ type: 'DATA_CHANGED' });

    if (state.currentCategory === category) {
        const remainingCats = new Set();
        Object.values(state.bookmarks || {}).forEach(bm => {
            if (bm && bm.category && typeof bm.category === 'string') {
                const trimmedCat = bm.category.trim();
                if (trimmedCat && trimmedCat !== '未分類' && !isTransitionCategory(trimmedCat)) {
                    remainingCats.add(trimmedCat);
                }
            }
        });
        if (Array.isArray(emptyCats)) {
            emptyCats.forEach(c => remainingCats.add(c));
        }

        const sorted = Array.from(remainingCats).sort((a, b) => {
            let idxA = savedCatOrder.indexOf(a);
            let idxB = savedCatOrder.indexOf(b);
            if (idxA === -1 && idxB === -1) return a.localeCompare(b);
            if (idxA === -1) return 1;
            if (idxB === -1) return -1;
            return idxA - idxB;
        });

        if (sorted.length > 0) {
            selectCategory(sorted[0], false);
        } else {
            selectRemindersView(false);
        }
    }

    renderSidebar();
    showCloudToast('分類已刪除');
    uploadToDrive(true);
}

export async function saveUnified() {
    const type = state.currentUnifiedType;
    // note（內容）與 bookmark（網址書籤）共用 bookmarks 資料表，以 isCustomRecord 區分
    if (type === 'bookmark' || type === 'note') await saveBookmark();
    else if (type === 'reminder') await saveReminder();
}

export async function saveReminder() {
    const draft = state.editorDraft;
    const title = (draft.reminderTitle || '').trim();
    const content = draft.reminderContent || '';

    let startDate = (draft.reminderStartDate || '').trim();
    let endDate = (draft.reminderEndDate || '').trim();
    let date = (draft.reminderDate || '').trim();

    if (!startDate) startDate = draft.tempSelectedReminderStartDate || getLocalDateString();
    if (!endDate) endDate = draft.tempSelectedReminderEndDate || startDate;
    if (!date) date = startDate;

    if (startDate > endDate) {
        endDate = startDate;
    }

    if (startDate === endDate && draft.isReminderStartTimeAdjusted && draft.isReminderEndTimeAdjusted) {
        const startMinutes = draft.timeWheelStartHour * 60 + draft.timeWheelStartMinute;
        const endMinutes = draft.timeWheelEndHour * 60 + draft.timeWheelEndMinute;
        if (startMinutes > endMinutes) {
            draft.timeWheelEndHour = draft.timeWheelStartHour;
            draft.timeWheelEndMinute = draft.timeWheelStartMinute;
        }
    }

    const startTime = draft.isReminderStartTimeAdjusted
        ? `${String(draft.timeWheelStartHour).padStart(2, '0')}:${String(draft.timeWheelStartMinute).padStart(2, '0')}`
        : '';
    const endTime = draft.isReminderEndTimeAdjusted
        ? `${String(draft.timeWheelEndHour).padStart(2, '0')}:${String(draft.timeWheelEndMinute).padStart(2, '0')}`
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

    const editingId = draft.editingReminderId;
    const isNew = !editingId;
    const id = editingId || generateUUID();
    const existingReminder = state.reminders[id];
    const order = (existingReminder && existingReminder.order !== undefined) ? existingReminder.order : -Date.now();
    const isDone = draft.reminderIsDone !== undefined ? !!draft.reminderIsDone : (existingReminder ? !!existingReminder.isDone : false);
    
    if (!state.deletedRecords) {
        state.deletedRecords = { bookmarks: {}, reminders: {} };
    }
    if (state.deletedRecords?.reminders?.[id]) {
        delete state.deletedRecords.reminders[id];
        await StorageAPI.deleteItem('deleted_reminders', id);
    }

    const safeUpdatedAt = getMonotonicTimestamp(state.editingBaselineUpdatedAt || 0);

    state.reminders[id] = {
        title: stripDangerousHtml(title),
        content: stripDangerousHtml(content),
        date,
        startDate,
        endDate,
        startTime,
        endTime,
        isDone,
        timestamp: getTimestamp(),
        updatedAt: safeUpdatedAt,
        order
    };
    const saved = await StorageAPI.saveItem('reminders', id, state.reminders[id]);
    if (!saved) {
        showCloudToast('儲存失敗，請重試');
        return;
    }

    markLocalDataDirty();
    notifyCrossTabChange({ type: 'DATA_CHANGED' });

    state.previousCategory = null;
    closeAllEditors();
    uploadToDrive(true);
    
    setTimeout(() => {
        if (state.currentView !== 'reminders') selectRemindersView();
        else renderReminders();
        if (hadConflict) {
            showCloudToast('已以本地修改覆蓋並同步雲端');
        } else {
            const didPromptAuth = (isNew && !isGoogleConnected()) ? promptAuthOncePerSession() : false;
            if (!didPromptAuth) {
                showCloudToast(isNew ? '新增成功' : '儲存成功');
            }
        }
    }, 250);
}

export async function saveBookmark() {
    const draft = state.editorDraft;
    const isNote = state.currentUnifiedType === 'note';
    const titleInputEl = document.getElementById('bookmark-title');
    const urlInputEl = document.getElementById('bookmark-url');
    const descInputEl = document.getElementById('bookmark-desc');

    const title = (draft.bookmarkTitle || (titleInputEl ? titleInputEl.value : '') || '').trim();
    let url = (draft.bookmarkUrl || (urlInputEl ? urlInputEl.value : '') || '').trim();
    let category = (draft.bookmarkCategory || '').trim() || '未分類';
    if (category !== '未分類' && !isTransitionCategory(category)) {
        const renameMap = safeJSONParse(localStorage.getItem('my_category_renames'), {});
        const visited = new Set();
        const baselineTime = state.editingBaselineUpdatedAt || 0;
        while (renameMap[category] && !visited.has(category)) {
            visited.add(category);
            const record = renameMap[category];
            const renameTime = Number(record?.at) || 0;
            if (renameTime > baselineTime && record?.to && typeof record.to === 'string') {
                category = record.to.trim() || category;
            } else {
                break;
            }
        }

        const deletedCats = safeJSONParse(localStorage.getItem('my_deleted_categories'), {});
        if (deletedCats && Object.prototype.hasOwnProperty.call(deletedCats, category)) {
            delete deletedCats[category];
            localStorage.setItem('my_deleted_categories', JSON.stringify(deletedCats));
        }
    }
    const subCategory = (draft.bookmarkSubCategory || '').trim();
    const desc = (draft.bookmarkDesc || (descInputEl ? descInputEl.value : '') || '').trim();
    const content = isNote ? (draft.bookmarkContent || '') : '';
    
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

    const editingId = draft.editingBookmarkId;
    const isNew = !editingId;
    const id = editingId || generateUUID();
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
        await StorageAPI.deleteItem('deleted_bookmarks', id);
    }

    const safeUpdatedAt = getMonotonicTimestamp(state.editingBaselineUpdatedAt || 0);

    const bookmark = {
        id,
        title: stripDangerousHtml(title), 
        url: isNote ? (state.bookmarks[id]?.url || '') : url, 
        category, 
        subCategory, 
        description: stripDangerousHtml(desc), 
        content: isNote ? stripDangerousHtml(content) : (state.bookmarks[id]?.content || ''),
        isCustomRecord: isNote,
        timestamp: getTimestamp(), 
        updatedAt: safeUpdatedAt, 
        order 
    };
    if (!isNew) state.bookmarks[id] = bookmark;
    const insertion = draft.bookmarkInsertion;
    let updates = null;
    if (isNew && insertion?.category === category && insertion.subCategory === subCategory) {
        const ids = getBookmarkIdsInSubCategory(state.bookmarks, category, subCategory);
        const index = getBookmarkInsertionIndex(ids, insertion);
        bookmark.order = index;
        ids.splice(index, 0, id);
        updates = { [id]: bookmark };
        ids.forEach((cardId, order) => {
            if (cardId !== id && state.bookmarks[cardId].order !== order) {
                updates[cardId] = { ...state.bookmarks[cardId], order, updatedAt: safeUpdatedAt };
            }
        });
    }
    const saved = updates
        ? await StorageAPI.saveItems('bookmarks', updates, { atomic: true })
        : await StorageAPI.saveItem('bookmarks', id, bookmark);
    if (!saved) {
        showCloudToast('儲存失敗，請重試');
        return;
    }
    if (updates) Object.assign(state.bookmarks, updates);
    else if (isNew) state.bookmarks[id] = bookmark;

    markLocalDataDirty();
    notifyCrossTabChange({ type: 'DATA_CHANGED' });

    state.previousCategory = null;
    state.currentCategory = category;
    closeAllEditors();
    uploadToDrive(true);
    
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
        } else {
            const didPromptAuth = (isNew && !isGoogleConnected()) ? promptAuthOncePerSession() : false;
            if (!didPromptAuth) {
                showCloudToast(isNew ? '新增成功' : '儲存成功');
            }
        }
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

    openModal('confirm');
}

export function closeConfirm() {
    if (document.activeElement) document.activeElement.blur();
    const modal = document.getElementById('confirm-modal');
    closeModal('confirm', {
        afterClose: () => {
            document.body.classList.remove('avatar-delete-confirm');
            state.deleteTargetType = null;
            const unifiedBtn = document.getElementById('btn-delete-unified');
            if (unifiedBtn) unifiedBtn.style.pointerEvents = '';
            if (modal) {
                const titleEl = modal.querySelector('h2');
                const descEl = modal.querySelector('p');
                if (titleEl) titleEl.innerText = '確定要刪除？';
                if (descEl) descEl.innerText = '刪除後將無法復原資料。';
            }
        }
    });
}

function scheduleDeleteCloudSync() {
    clearTimeout(deleteSyncDebounceTimer);
    deleteSyncDebounceTimer = setTimeout(() => {
        deleteSyncDebounceTimer = null;
        uploadToDrive(true);
    }, 500);
}

export function flushPendingDeleteSync() {
    const hasTimer = deleteSyncDebounceTimer !== null;
    if (hasTimer) {
        clearTimeout(deleteSyncDebounceTimer);
        deleteSyncDebounceTimer = null;
    }
    if (hasTimer || localStorage.getItem(PENDING_SYNC_FLAG) === 'true') {
        uploadToDrive(true);
    }
}

export async function confirmDelete() {
    const safeNow = getMonotonicTimestamp(lastDeleteTimestamp);
    lastDeleteTimestamp = safeNow;

    if (!state.deletedRecords) {
        state.deletedRecords = { bookmarks: {}, reminders: {} };
    }

    if (state.deleteTargetType === 'bookmark' && state.editorDraft.editingBookmarkId) {
        const targetId = state.editorDraft.editingBookmarkId;
        delete state.bookmarks[targetId];
        if (!state.deletedRecords.bookmarks) state.deletedRecords.bookmarks = {};
        state.deletedRecords.bookmarks[targetId] = safeNow;

        if (state.pendingSyncItems?.bookmark?.id === targetId) {
            delete state.pendingSyncItems.bookmark;
        }

        await StorageAPI.batchDeleteWithTombstone('bookmarks', 'deleted_bookmarks', [targetId], safeNow);

        markLocalDataDirty();
        notifyCrossTabChange({ type: 'DATA_CHANGED' });

        closeConfirm();
        closeAllEditors();

        setTimeout(() => {
            renderSidebar();
            showCloudToast('刪除成功');
            scheduleDeleteCloudSync();
        }, 100);
    } else if (state.deleteTargetType === 'reminder' && state.editorDraft.editingReminderId) {
        const targetId = state.editorDraft.editingReminderId;
        delete state.reminders[targetId];
        if (!state.deletedRecords.reminders) state.deletedRecords.reminders = {};
        state.deletedRecords.reminders[targetId] = safeNow;

        if (state.pendingSyncItems?.reminder?.id === targetId) {
            delete state.pendingSyncItems.reminder;
        }

        await StorageAPI.batchDeleteWithTombstone('reminders', 'deleted_reminders', [targetId], safeNow);

        markLocalDataDirty();
        notifyCrossTabChange({ type: 'DATA_CHANGED' });

        closeConfirm();
        closeAllEditors();

        setTimeout(() => {
            renderReminders();
            showCloudToast('刪除成功');
            scheduleDeleteCloudSync();
        }, 100);
    } else if (state.deleteTargetType === 'batch-reminders' && state.selectedReminderIds && state.selectedReminderIds.size > 0) {
        const idsToDelete = Array.from(state.selectedReminderIds);
        if (!state.deletedRecords.reminders) state.deletedRecords.reminders = {};

        for (const targetId of idsToDelete) {
            delete state.reminders[targetId];
            state.deletedRecords.reminders[targetId] = safeNow;
        }

        if (state.pendingSyncItems?.reminder && idsToDelete.includes(state.pendingSyncItems.reminder.id)) {
            delete state.pendingSyncItems.reminder;
        }

        await StorageAPI.batchDeleteWithTombstone('reminders', 'deleted_reminders', idsToDelete, safeNow);

        markLocalDataDirty();
        notifyCrossTabChange({ type: 'DATA_CHANGED' });

        closeConfirm();
        exitSelectionMode();

        setTimeout(() => {
            renderReminders();
            showCloudToast(`已成功刪除 ${idsToDelete.length} 項提醒`);
            scheduleDeleteCloudSync();
        }, 100);
    } else if (state.deleteTargetType === 'batch-bookmarks' && state.selectedBookmarkIds && state.selectedBookmarkIds.size > 0) {
        const idsToDelete = Array.from(state.selectedBookmarkIds);
        if (!state.deletedRecords.bookmarks) state.deletedRecords.bookmarks = {};

        for (const targetId of idsToDelete) {
            delete state.bookmarks[targetId];
            state.deletedRecords.bookmarks[targetId] = safeNow;
        }

        if (state.pendingSyncItems?.bookmark && idsToDelete.includes(state.pendingSyncItems.bookmark.id)) {
            delete state.pendingSyncItems.bookmark;
        }

        await StorageAPI.batchDeleteWithTombstone('bookmarks', 'deleted_bookmarks', idsToDelete, safeNow);

        markLocalDataDirty();
        notifyCrossTabChange({ type: 'DATA_CHANGED' });

        const remainingInCat = Object.values(state.bookmarks || {}).some(bm => {
            const cat = (bm.category && bm.category.trim() !== '') ? bm.category.trim() : '未分類';
            return cat === state.currentCategory;
        });
        if (!remainingInCat) {
            const otherCat = Object.values(state.bookmarks || {})
                .map(bm => (bm.category && bm.category.trim() !== '') ? bm.category.trim() : '未分類')
                .find(c => c !== state.currentCategory && !isTransitionCategory(c));
            state.currentCategory = otherCat || '未分類';
        }

        closeConfirm();
        exitSelectionMode();

        setTimeout(() => {
            renderSidebar();
            showCloudToast(`已成功刪除 ${idsToDelete.length} 項資料`);
            scheduleDeleteCloudSync();
        }, 100);
    } else if (state.deleteTargetType === 'batch-subcategories' && state.selectedSubCategories && state.selectedSubCategories.size > 0) {
        const subCatsToDelete = Array.from(state.selectedSubCategories);
        const idsToDelete = [];
        Object.keys(state.bookmarks).forEach(id => {
            const bm = state.bookmarks[id];
            const cat = (bm.category && bm.category.trim() !== '') ? bm.category.trim() : '未分類';
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

        if (state.pendingSyncItems?.bookmark && idsToDelete.includes(state.pendingSyncItems.bookmark.id)) {
            delete state.pendingSyncItems.bookmark;
        }

        await StorageAPI.batchDeleteWithTombstone('bookmarks', 'deleted_bookmarks', idsToDelete, safeNow);

        const subOrdersMap = safeJSONParse(localStorage.getItem('my_subcategory_order'), {});
        const subTimestampsMap = safeJSONParse(localStorage.getItem('my_subcategory_order_timestamps'), {});
        if (Array.isArray(subOrdersMap[state.currentCategory])) {
            subOrdersMap[state.currentCategory] = subOrdersMap[state.currentCategory].filter(s => !subCatsToDelete.includes(s));
            subTimestampsMap[state.currentCategory] = safeNow;
            localStorage.setItem('my_subcategory_order', JSON.stringify(subOrdersMap));
            localStorage.setItem('my_subcategory_order_updatedAt', safeNow.toString());
            localStorage.setItem('my_subcategory_order_timestamps', JSON.stringify(subTimestampsMap));
        }

        markLocalDataDirty();
        notifyCrossTabChange({ type: 'DATA_CHANGED' });

        const remainingInCat = Object.values(state.bookmarks || {}).some(bm => {
            const cat = (bm.category && bm.category.trim() !== '') ? bm.category.trim() : '未分類';
            return cat === state.currentCategory;
        });
        if (!remainingInCat) {
            const otherCat = Object.values(state.bookmarks || {})
                .map(bm => (bm.category && bm.category.trim() !== '') ? bm.category.trim() : '未分類')
                .find(c => c !== state.currentCategory && !isTransitionCategory(c));
            state.currentCategory = otherCat || '未分類';
        }

        closeConfirm();
        exitSelectionMode();

        setTimeout(() => {
            renderSidebar();
            showCloudToast(`已成功刪除 ${subCatsToDelete.length} 個子分類`);
            scheduleDeleteCloudSync();
        }, 100);
    } else if (state.deleteTargetType === 'user-avatar') {
        if (!state.userProfile || typeof state.userProfile !== 'object') {
            state.userProfile = { avatarData: '', avatarUpdatedAt: 0, username: '', usernameUpdatedAt: 0 };
        }
        state.userProfile.avatarData = '';
        state.userProfile.avatarUpdatedAt = safeNow;

        await StorageAPI.saveItem('profile', 'current', state.userProfile);

        markLocalDataDirty();
        notifyCrossTabChange({ type: 'DATA_CHANGED' });
        renderUserProfileUI();

        closeConfirm();

        setTimeout(() => {
            showCloudToast('頭像已刪除');
            scheduleDeleteCloudSync();
        }, 100);
    }
}
