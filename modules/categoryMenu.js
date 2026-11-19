// @ts-check
// @ts-nocheck
// 沿用 interaction.js 的型別檢查範圍；本階段只搬移函式，型別化另行處理。
// 分類與標頭選單

import { state } from '../state.js';
import { openSortModal } from './sortModal.js';
import { renderSidebar, showCloudToast } from '../ui.js';
import { getMonotonicTimestamp, markLocalDataDirty, uploadToDrive } from '../sync.js';
import { StorageAPI, notifyCrossTabChange, safeJSONParse } from '../storage.js';

export let currentCategoryMenuContext = null;

export function showCategoryPopoverMenu(e, category, textEl, btnEl, itemEl, isContextMenu = false) {
    if (e) {
        e.stopPropagation();
        e.preventDefault();
    }

    const menu = document.getElementById('category-popover-menu');
    if (!menu) return;

    if (menu.classList.contains('active') && currentCategoryMenuContext?.category === category && currentCategoryMenuContext?.isContextMenu === isContextMenu) {
        hideCategoryPopoverMenu();
        return;
    }

    document.querySelectorAll('.year-item.has-menu-open, .year-item.context-menu-mode').forEach(el => {
        el.classList.remove('has-menu-open', 'context-menu-mode');
    });

    currentCategoryMenuContext = { category, textEl, btnEl, itemEl, isContextMenu };

    if (itemEl) {
        itemEl.classList.add('has-menu-open');
        if (isContextMenu) {
            itemEl.classList.add('context-menu-mode');
        }
    }

    const hasCards = Object.values(state.bookmarks || {}).some(bm => bm && (bm.category || '未分類') === category);
    const deleteItem = document.getElementById('category-popover-delete-item');
    if (deleteItem) {
        deleteItem.style.display = hasCards ? 'none' : 'flex';
    }

    menu.style.display = 'block';

    const menuWidth = menu.offsetWidth || 140;
    const menuHeight = menu.offsetHeight || 44;

    let left = 0;
    let top = 0;

    if (isContextMenu && e && typeof e.clientX === 'number') {
        left = e.clientX;
        top = e.clientY;

        if (left < 10) left = 10;
        if (left + menuWidth > window.innerWidth - 10) {
            left = window.innerWidth - menuWidth - 10;
        }
        if (top + menuHeight > window.innerHeight - 10) {
            top = window.innerHeight - menuHeight - 10;
        }
        if (top < 10) top = 10;
    } else {
        const itemRect = itemEl ? itemEl.getBoundingClientRect() : btnEl.getBoundingClientRect();

        left = itemRect.right - menuWidth;
        top = itemRect.bottom + 4;

        if (left < 10) left = 10;
        if (left + menuWidth > window.innerWidth - 10) {
            left = window.innerWidth - menuWidth - 10;
        }
        if (top + menuHeight > window.innerHeight - 10) {
            top = itemRect.top - menuHeight - 4;
        }
    }

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    requestAnimationFrame(() => {
        menu.classList.add('active');
    });
}

export function hideCategoryPopoverMenu(immediate = false) {
    document.querySelectorAll('.year-item.has-menu-open, .year-item.context-menu-mode').forEach(el => {
        el.classList.remove('has-menu-open', 'context-menu-mode');
    });
    currentCategoryMenuContext = null;

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

export function toggleHeaderPopoverMenu(e) {
    if (e) {
        e.stopPropagation();
        e.preventDefault();
    }

    const menu = document.getElementById('header-popover-menu');
    const btn = document.getElementById('header-more-btn');
    if (!menu || !btn) return;

    if (menu.classList.contains('active')) {
        hideHeaderPopoverMenu();
        return;
    }

    hideCategoryPopoverMenu(true);

    menu.style.display = 'block';

    const menuWidth = menu.offsetWidth || 140;
    const menuHeight = menu.offsetHeight || 88;
    const btnRect = btn.getBoundingClientRect();

    let left = btnRect.right - menuWidth;
    let top = btnRect.bottom + 4;

    if (left < 10) left = 10;
    if (left + menuWidth > window.innerWidth - 10) {
        left = window.innerWidth - menuWidth - 10;
    }
    if (top + menuHeight > window.innerHeight - 10) {
        top = btnRect.top - menuHeight - 4;
    }
    if (top < 10) top = 10;

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    requestAnimationFrame(() => {
        menu.classList.add('active');
        btn.classList.add('active');
    });
}

export function hideHeaderPopoverMenu(immediate = false) {
    const menu = document.getElementById('header-popover-menu');
    const btn = document.getElementById('header-more-btn');
    if (btn) btn.classList.remove('active');

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

export function triggerHeaderMenuSort(e) {
    if (e) e.stopPropagation();
    hideHeaderPopoverMenu(true);
    openSortModal({ autoLocate: true });
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
    if (!textEl || state.isRenamingMainCategory) return;

    state.isRenamingMainCategory = true;
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
        state.isRenamingMainCategory = false;

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

async function commitCategoryRename(newCategory, oldCategory) {
    const now = getMonotonicTimestamp();
    const updatedBookmarks = {};
    Object.keys(state.bookmarks).forEach(id => {
        if ((state.bookmarks[id].category || '').trim() === oldCategory) {
            state.bookmarks[id].category = newCategory;
            state.bookmarks[id].updatedAt = now;
            updatedBookmarks[id] = state.bookmarks[id];
        }
    });

    if (Object.keys(updatedBookmarks).length > 0) {
        await StorageAPI.saveItems('bookmarks', updatedBookmarks);
    }

    const renameMap = safeJSONParse(localStorage.getItem('my_category_renames'), {});
    for (const [prevOld, record] of Object.entries(renameMap)) {
        if (record && record.to === oldCategory) {
            renameMap[prevOld] = { to: newCategory, at: now };
        }
    }
    renameMap[oldCategory] = { to: newCategory, at: now };
    localStorage.setItem('my_category_renames', JSON.stringify(renameMap));

    const deletedCats = safeJSONParse(localStorage.getItem('my_deleted_categories'), {});
    deletedCats[oldCategory] = now;
    delete deletedCats[newCategory];
    localStorage.setItem('my_deleted_categories', JSON.stringify(deletedCats));

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

    let emptyCats = safeJSONParse(localStorage.getItem('my_empty_categories'), []);
    if (Array.isArray(emptyCats) && emptyCats.includes(oldCategory)) {
        emptyCats = emptyCats.map(c => c === oldCategory ? newCategory : c);
        emptyCats = Array.from(new Set(emptyCats)).filter(c => typeof c === 'string' && c.trim() !== '' && c.trim() !== '未分類');
        localStorage.setItem('my_empty_categories', JSON.stringify(emptyCats));
        localStorage.setItem('my_empty_categories_updatedAt', now.toString());
    }

    const emptyCatTimestamps = safeJSONParse(localStorage.getItem('my_empty_categories_timestamps'), {});
    if (emptyCatTimestamps && Object.prototype.hasOwnProperty.call(emptyCatTimestamps, oldCategory)) {
        emptyCatTimestamps[newCategory] = now;
        delete emptyCatTimestamps[oldCategory];
        localStorage.setItem('my_empty_categories_timestamps', JSON.stringify(emptyCatTimestamps));
    }

    if (state.currentCategory === oldCategory) {
        state.currentCategory = newCategory;
    }

    markLocalDataDirty();
    notifyCrossTabChange({ type: 'DATA_CHANGED' });

    renderSidebar();

    setTimeout(() => {
        showCloudToast('分類已重新命名');
        uploadToDrive(true);
    }, 250);
}

import { isTransitionCategory } from '../domain.js';

let selectCategory = null;

export function configureCategoryMenuNavigation(handlers) {
    selectCategory = handlers.selectCategory;
}

export function startInlineAddMainCategory() {
    if (state.isAddingMainCategory || state.isRenamingMainCategory) return;
    const categoryList = document.getElementById('category-list');
    if (!categoryList) return;

    hideCategoryPopoverMenu(true);
    state.isAddingMainCategory = true;

    const addCatBtn = document.getElementById('sidebar-add-category-btn');
    if (addCatBtn) addCatBtn.classList.add('active');

    const item = document.createElement('div');
    item.className = 'year-item is-renaming';

    const iconSpan = document.createElement('span');
    iconSpan.className = 'item-icon category-dot';
    iconSpan.innerHTML = '<span class="category-dot-circle"></span>';
    item.appendChild(iconSpan);

    const textEl = document.createElement('span');
    textEl.className = 'item-text';
    textEl.contentEditable = 'true';
    item.appendChild(textEl);

    categoryList.prepend(item);
    categoryList.scrollTop = 0;

    textEl.focus();

    let isFinished = false;

    const finish = (commit) => {
        if (isFinished) return;
        isFinished = true;
        state.isAddingMainCategory = false;

        const btn = document.getElementById('sidebar-add-category-btn');
        if (btn) btn.classList.remove('active');

        textEl.removeEventListener('keydown', onKeyDown);
        textEl.removeEventListener('blur', onBlur);
        textEl.removeEventListener('paste', onPaste);

        if (!commit) {
            item.remove();
            return;
        }

        const newName = (textEl.innerText || '').trim();
        if (!newName) {
            item.remove();
            return;
        }

        if (newName === '未分類' || isTransitionCategory(newName)) {
            item.remove();
            showCloudToast('不可使用系統保留名稱');
            return;
        }

        const existingCats = new Set();
        Object.values(state.bookmarks || {}).forEach(bm => {
            if (bm && bm.category) existingCats.add(bm.category.trim());
        });
        const emptyCats = safeJSONParse(localStorage.getItem('my_empty_categories'), []);
        if (Array.isArray(emptyCats)) {
            emptyCats.forEach(c => existingCats.add(c.trim()));
        }

        if (existingCats.has(newName)) {
            item.remove();
            showCloudToast('分類名稱已存在');
            return;
        }

        item.remove();
        commitCategoryAdd(newName);
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

function commitCategoryAdd(newCategory) {
    const now = getMonotonicTimestamp();

    const deletedCats = safeJSONParse(localStorage.getItem('my_deleted_categories'), {});
    if (deletedCats && Object.prototype.hasOwnProperty.call(deletedCats, newCategory)) {
        delete deletedCats[newCategory];
        localStorage.setItem('my_deleted_categories', JSON.stringify(deletedCats));
    }

    let emptyCats = safeJSONParse(localStorage.getItem('my_empty_categories'), []);
    if (!Array.isArray(emptyCats)) emptyCats = [];
    if (!emptyCats.includes(newCategory)) {
        emptyCats.push(newCategory);
    }
    localStorage.setItem('my_empty_categories', JSON.stringify(emptyCats));
    localStorage.setItem('my_empty_categories_updatedAt', now.toString());

    const emptyCatTimestamps = safeJSONParse(localStorage.getItem('my_empty_categories_timestamps'), {});
    emptyCatTimestamps[newCategory] = now;
    localStorage.setItem('my_empty_categories_timestamps', JSON.stringify(emptyCatTimestamps));

    let savedCatOrder = safeJSONParse(localStorage.getItem('my_category_order'), []);
    if (!Array.isArray(savedCatOrder)) savedCatOrder = [];
    savedCatOrder = [newCategory, ...savedCatOrder.filter(c => c !== newCategory)];
    localStorage.setItem('my_category_order', JSON.stringify(savedCatOrder));
    localStorage.setItem('my_category_order_updatedAt', now.toString());

    markLocalDataDirty();
    notifyCrossTabChange({ type: 'DATA_CHANGED' });

    selectCategory(newCategory, false);
    renderSidebar();

    showCloudToast('已新增分類');
    uploadToDrive(true);
}
