let notes = JSON.parse(localStorage.getItem('my_life_notes')) || {};
let bookmarks = JSON.parse(localStorage.getItem('my_bookmarks')) || {};

let currentYear = new Date().getFullYear().toString();
let currentView = 'notes';
let isFabTucked = false;

let currentEditingDate = null;
let currentEditingBookmarkId = null;

let deleteTargetType = null; 
let calDate = new Date();
let draggedCard = null;
let draggedCategory = null;
let sortOrder = 'newest';

let contextTarget = { type: null, id: null };
let currentContextMenuCard = null;

let swipeStartX = 0, swipeStartY = 0;

let fabIdleTimer = null;

function resetFabIdleTimer(e) {
    try {
        if (e && e.target && typeof e.target.closest === 'function' && e.target.closest('.fab-main-btn')) {
            return;
        }
    } catch (error) {}

    clearTimeout(fabIdleTimer);
    
    if (window.innerWidth > 768 || isFabTucked) return;

    fabIdleTimer = setTimeout(() => {
        if (window.innerWidth <= 768 && !isFabTucked) {
            isFabTucked = true;
            const mainBtn = document.querySelector('.fab-main-btn');
            if (mainBtn) mainBtn.classList.add('tucked');
            document.querySelectorAll('.fab-scroll-btn').forEach(btn => btn.classList.add('tucked'));
        }
    }, 5000);
}

document.addEventListener('touchstart', resetFabIdleTimer, {passive: true});
document.addEventListener('touchmove', resetFabIdleTimer, {passive: true});
document.addEventListener('scroll', resetFabIdleTimer, {passive: true, capture: true});
document.addEventListener('click', resetFabIdleTimer, {passive: true});

function initApp() {
    const isDark = localStorage.getItem('dark_mode') === 'true';
    const themeMeta = document.getElementById('theme-color-meta');
    if (isDark) {
        document.body.setAttribute('data-theme', 'dark');
        document.getElementById('theme-checkbox').checked = true;
        if (themeMeta) themeMeta.setAttribute('content', '#121212');
    }
    if (window.innerWidth > 768) {
        document.getElementById('sidebar').classList.remove('collapsed');
    }
    
    const appTitle = localStorage.getItem('my_app_title') || '筆記';
    document.getElementById('app-logo-text').innerText = appTitle;
    document.title = appTitle;

    renderSidebar();

    const navBookmarks = document.getElementById('nav-bookmarks');
    navBookmarks.addEventListener('click', (e) => {
        switchView('bookmarks');
    });

    resetFabIdleTimer();
}

function scrollToMonth(direction) {
    const titles = Array.from(document.querySelectorAll('#content-container .month-title'));
    if (titles.length === 0) return;

    const main = document.querySelector('main');
    const exportBtn = document.querySelector('.action-settings');
    
    let btnCenterY = 50; 
    if (exportBtn) {
        const btnRect = exportBtn.getBoundingClientRect();
        btnCenterY = btnRect.top + (btnRect.height / 2);
    }

    let target = null;

    if (direction === 'next') {
        target = titles.find(t => {
            const rect = t.getBoundingClientRect();
            return (rect.top + rect.height / 2) > btnCenterY + 5;
        });
    } else {
        target = titles.slice().reverse().find(t => {
            const rect = t.getBoundingClientRect();
            return (rect.top + rect.height / 2) < btnCenterY - 5;
        });
    }

    if (target) {
        const targetRect = target.getBoundingClientRect();
        const targetCenterY = targetRect.top + (targetRect.height / 2);
        const scrollDistance = targetCenterY - btnCenterY;
        
        main.scrollBy({ top: scrollDistance, behavior: 'smooth' });
    }
}

function openTitleModal() {
    const currentTitle = localStorage.getItem('my_app_title') || '筆記';
    document.getElementById('app-title-input').value = currentTitle;
    
    const overlay = document.getElementById('confirm-overlay'); 
    const modal = document.getElementById('title-modal');
    
    overlay.style.display = 'block';
    modal.style.display = 'block';
    
    setTimeout(() => {
        overlay.classList.add('active');
        modal.classList.add('active');
        document.getElementById('app-title-input').focus();
    }, 10);
}

function closeTitleModal() {
    if (document.activeElement) document.activeElement.blur();
    const overlay = document.getElementById('confirm-overlay');
    const modal = document.getElementById('title-modal');
    
    modal.classList.remove('active');
    overlay.classList.remove('active');
    
    setTimeout(() => {
        modal.style.display = 'none';
        overlay.style.display = 'none';
    }, 300);
}

function saveAppTitle() {
    const newTitle = document.getElementById('app-title-input').value.trim();
    if (newTitle !== '') {
        localStorage.setItem('my_app_title', newTitle);
        document.getElementById('app-logo-text').innerText = newTitle;
        document.title = newTitle;
    }
    closeTitleModal();
}

function toggleSidebarDesktop() {
    if (window.innerWidth > 768) {
        document.getElementById('sidebar').classList.toggle('collapsed');
    } else {
        toggleSidebar(); 
    }
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const mobileOverlay = document.getElementById('mobile-sidebar-overlay');
    
    if (window.innerWidth <= 768) {
        if (sidebar.classList.contains('mobile-open')) {
            sidebar.classList.remove('mobile-open');
            mobileOverlay.classList.remove('active');
            setTimeout(() => mobileOverlay.style.display = 'none', 300);
        } else {
            sidebar.classList.add('mobile-open');
            mobileOverlay.style.display = 'block';
            setTimeout(() => mobileOverlay.classList.add('active'), 10);
        }
    }
}

function toggleTheme() {
    const body = document.body;
    const checkbox = document.getElementById('theme-checkbox');
    const themeMeta = document.getElementById('theme-color-meta');
    
    if (checkbox.checked) {
        body.setAttribute('data-theme', 'dark');
        localStorage.setItem('dark_mode', 'true');
        if (themeMeta) themeMeta.setAttribute('content', '#121212');
    } else {
        body.removeAttribute('data-theme');
        localStorage.setItem('dark_mode', 'false');
        if (themeMeta) themeMeta.setAttribute('content', '#F7F3E8');
    }
}

function toggleSortMenu(e) {
    if(e) {
        e.preventDefault();
        e.stopPropagation();
    }
    const btn = document.getElementById('sort-toggle-btn');
    const menu = document.getElementById('sort-menu');
    
    if (!menu || !btn) return;

    if (menu.classList.contains('active')) {
        closeSortMenu();
    } else {
        const settingsMenu = document.getElementById('settings-menu');
        const settingsBtn = document.getElementById('settings-toggle-btn');
        if (settingsMenu && settingsMenu.classList.contains('active')) {
            settingsMenu.classList.remove('active');
            if (settingsBtn) settingsBtn.classList.remove('open');
        }
        
        btn.classList.add('open');
        menu.style.display = 'block';
        
        setTimeout(() => {
            menu.classList.add('active');
        }, 10);
    }
}

function closeSortMenu() {
    const btn = document.getElementById('sort-toggle-btn');
    const menu = document.getElementById('sort-menu');
    if(btn) btn.classList.remove('open');
    if(menu) {
        menu.classList.remove('active');
        setTimeout(() => {
            if (!menu.classList.contains('active')) {
                menu.style.display = '';
            }
        }, 200);
    }
}

function setSortOrder(order) {
    sortOrder = order;
    const items = document.querySelectorAll('#sort-menu .sort-item');
    items[0].classList.toggle('selected', order === 'newest');
    items[1].classList.toggle('selected', order === 'oldest');
    
    if (currentView === 'notes') renderNotes();
    
    closeSortMenu();
}

function toggleSettingsMenu(e) {
    if(e) {
        e.preventDefault();
        e.stopPropagation();
    }
    const btn = document.getElementById('settings-toggle-btn');
    const menu = document.getElementById('settings-menu');
    
    if (!menu || !btn) return;

    if (menu.classList.contains('active')) {
        closeSettingsMenu();
    } else {
        const sortMenu = document.getElementById('sort-menu');
        const sortBtn = document.getElementById('sort-toggle-btn');
        if (sortMenu && sortMenu.classList.contains('active')) {
            sortMenu.classList.remove('active');
            if (sortBtn) sortBtn.classList.remove('open');
        }
        
        btn.classList.add('open');
        menu.style.display = 'flex';
        
        setTimeout(() => {
            menu.classList.add('active');
        }, 10);
    }
}

function closeSettingsMenu() {
    const btn = document.getElementById('settings-toggle-btn');
    const menu = document.getElementById('settings-menu');
    if(btn) btn.classList.remove('open');
    if(menu) {
        menu.classList.remove('active');
        setTimeout(() => {
            if (!menu.classList.contains('active')) {
                menu.style.display = '';
            }
        }, 200);
    }
}

document.addEventListener('click', function(e) {
    const sortMenu = document.getElementById('sort-menu');
    const sortBtn = document.getElementById('sort-toggle-btn');
    if (sortMenu && sortMenu.classList.contains('active') && !sortMenu.contains(e.target) && !sortBtn.contains(e.target)) {
        closeSortMenu();
    }

    const settingsMenu = document.getElementById('settings-menu');
    const settingsBtn = document.getElementById('settings-toggle-btn');
    if (settingsMenu && settingsMenu.classList.contains('active') && !settingsMenu.contains(e.target) && !settingsBtn.contains(e.target)) {
        closeSettingsMenu();
    }

    const cm = document.getElementById('custom-context-menu');
    if (cm && cm.classList.contains('active') && !cm.contains(e.target)) {
        hideContextMenu();
    }
});

document.addEventListener('touchstart', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.id === 'note-content') return;
    swipeStartX = e.touches[0].clientX;
    swipeStartY = e.touches[0].clientY;
}, {passive: true});

document.addEventListener('touchend', function(e) {
    if (window.innerWidth <= 768) {
        let swipeEndX = e.changedTouches[0].clientX;
        let swipeEndY = e.changedTouches[0].clientY;

        let diffX = swipeEndX - swipeStartX;
        let diffY = Math.abs(swipeEndY - swipeStartY);

        if (diffY < 50) { 
            const sidebar = document.getElementById('sidebar');
            if (diffX > 60 && swipeStartX < 40) {
                if (!sidebar.classList.contains('mobile-open')) toggleSidebar();
            } else if (diffX < -60) {
                if (sidebar.classList.contains('mobile-open')) toggleSidebar();
            }
        }
    }
}, {passive: true});

function handleFormat(e, command, btn) {
    e.preventDefault();
    
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.toString().length === 0) return;

    btn.classList.add('success');
    setTimeout(() => btn.classList.remove('success'), 1500);

    if (command === 'bold') {
        document.execCommand('bold', false, null);
    } else if (command === 'color') {
        document.execCommand('styleWithCSS', false, true);
        const currentColor = document.queryCommandValue('foreColor').toLowerCase();
        
        if (currentColor === '#9a871e' || currentColor === 'rgb(154, 135, 30)') {
            document.execCommand('foreColor', false, 'inherit');
            
            const spans = document.getElementById('note-content').querySelectorAll('span');
            spans.forEach(span => {
                if (span.style.color === 'inherit') {
                    span.style.color = '';
                    if (span.getAttribute('style') === '') span.removeAttribute('style');
                }
            });
        } else {
            document.execCommand('foreColor', false, '#9A871E');
        }
    }
    
    selection.collapseToEnd();
    document.execCommand('insertHTML', false, '<span style="font-weight: normal; color: var(--text);">&#8203;</span>');
}

function handleContextMenuTrigger(targetNode, x, y) {
    const card = targetNode.closest('.note-card');
    const contentContainer = targetNode.closest('#content-container');
    const cm = document.getElementById('custom-context-menu');

    if (!card && !contentContainer) {
        hideContextMenu();
        return;
    }
    
    currentContextMenuCard = card;
    cm.dataset.triggerX = x;
    cm.dataset.triggerY = y;
    
    document.getElementById('context-add-btn').style.display = 'none';
    document.getElementById('context-edit-btn').style.display = 'none';
    document.getElementById('context-delete-btn').style.display = 'none';

    if (card) {
        document.getElementById('context-edit-btn').style.display = 'flex';
        document.getElementById('context-delete-btn').style.display = 'flex';
        
        const type = currentView === 'bookmarks' ? 'bookmark' : 'note';
        contextTarget = { type, id: card.dataset.id };
    } else if (contentContainer) {
        document.getElementById('context-add-btn').style.display = 'flex';
        document.getElementById('context-add-text').innerText = currentView === 'notes' ? '新增筆記' : '新增網站';
    }

    cm.style.display = 'block';
    const menuWidth = 140; 
    const menuHeight = cm.offsetHeight || 100; 
    
    if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 10;
    if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 10;

    cm.style.left = x + 'px';
    cm.style.top = y + 'px';
    
    setTimeout(() => cm.classList.add('active'), 10);
}

document.addEventListener('contextmenu', function(e) {
    if (window.innerWidth <= 768) return; 

    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.id === 'note-content' || e.target.closest('#note-content')) {
        return; 
    }

    e.preventDefault();

    if (e.target.closest('aside') || 
        e.target.closest('.header-actions') || 
        e.target.closest('.main-header-left') || 
        e.target.closest('[id$="-modal"]') || 
        e.target.closest('.context-menu')) {
        hideContextMenu();
        return; 
    }

    handleContextMenuTrigger(e.target, e.pageX, e.pageY);
});

document.addEventListener('mousemove', function(e) {
    const cm = document.getElementById('custom-context-menu');
    if (cm && cm.classList.contains('active')) {
        const mouseX = e.clientX;
        const mouseY = e.clientY;
        const cmRect = cm.getBoundingClientRect();
        
        let isHovering = false;
        const distance = 50; 

        if (currentContextMenuCard) {
            const cardRect = currentContextMenuCard.getBoundingClientRect();
            if (
                (mouseX >= cardRect.left - distance && mouseX <= cardRect.right + distance &&
                 mouseY >= cardRect.top - distance && mouseY <= cardRect.bottom + distance) ||
                (mouseX >= cmRect.left - distance && mouseX <= cardRect.right + distance &&
                 mouseY >= cmRect.top - distance && mouseY <= cmRect.bottom + distance)
            ) {
                isHovering = true;
            }
        } else {
            const startX = parseFloat(cm.dataset.triggerX);
            const startY = parseFloat(cm.dataset.triggerY);
            
            if (
                (mouseX >= cmRect.left - distance && mouseX <= cmRect.right + distance &&
                 mouseY >= cmRect.top - distance && mouseY <= cmRect.bottom + distance) ||
                (Math.abs(mouseX - startX) <= distance && Math.abs(mouseY - startY) <= distance)
            ) {
                isHovering = true;
            }
        }

        if (!isHovering) {
            hideContextMenu();
        }
    }
});

function hideContextMenu() {
    const cm = document.getElementById('custom-context-menu');
    cm.classList.remove('active');
    setTimeout(() => cm.style.display = 'none', 150);
}

function triggerContextAdd() {
    hideContextMenu();
    if (currentView === 'notes') {
        openEditor();
    } else if (currentView === 'bookmarks') {
        openBookmarkEditor();
    }
}

function triggerContextEdit() {
    hideContextMenu();
    if(contextTarget.type === 'note') {
        openEditor(contextTarget.id);
    } else if (contextTarget.type === 'bookmark') {
        openBookmarkEditor(contextTarget.id);
    }
}

function triggerContextDelete() {
    hideContextMenu();
    if(contextTarget.type === 'note') {
        currentEditingDate = contextTarget.id;
        showDeleteConfirm('note');
    } else if (contextTarget.type === 'bookmark') {
        currentEditingBookmarkId = contextTarget.id;
        showDeleteConfirm('bookmark');
    }
}

function switchView(view) {
    if (currentView === view) {
        if (window.innerWidth <= 768) {
            const sidebar = document.getElementById('sidebar');
            if (sidebar.classList.contains('mobile-open')) {
                toggleSidebar();
            }
        }
        return;
    }

    currentView = view;
    
    document.getElementById('nav-bookmarks').classList.remove('active');
    document.querySelectorAll('.year-item').forEach(el => {
        if (el.id !== 'nav-bookmarks') el.classList.remove('active');
    });
    
    document.querySelector('.sort-wrapper').style.display = 'block';

    if (view === 'bookmarks') {
        document.getElementById('nav-bookmarks').classList.add('active');
        document.querySelector('.sort-wrapper').style.display = 'none'; 
        renderBookmarks();
    }
    if (window.innerWidth <= 768) {
        const sidebar = document.getElementById('sidebar');
        if (sidebar.classList.contains('mobile-open')) {
            toggleSidebar();
        }
    }
}

function selectYear(year) {
    if (currentView === 'notes' && currentYear === year) {
        if (window.innerWidth <= 768) {
            const sidebar = document.getElementById('sidebar');
            if (sidebar.classList.contains('mobile-open')) {
                toggleSidebar();
            }
        }
        return;
    }

    currentView = 'notes';
    currentYear = year;
    
    document.querySelector('.sort-wrapper').style.display = 'block'; 
    document.getElementById('nav-bookmarks').classList.remove('active');
    
    document.querySelectorAll('.year-item').forEach(el => {
        if(el.id !== 'nav-bookmarks') {
            if (el.dataset.year === year) el.classList.add('active');
            else el.classList.remove('active');
        }
    });
    renderNotes();
    if (window.innerWidth <= 768) {
        const sidebar = document.getElementById('sidebar');
        if (sidebar.classList.contains('mobile-open')) {
            toggleSidebar();
        }
    }
}

const folderSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;

function renderSidebar() {
    const yearList = document.getElementById('year-list');
    yearList.innerHTML = '';
    
    const years = new Set();
    Object.keys(notes).forEach(date => years.add(date.split('-')[0]));
    if (years.size === 0) years.add(currentYear);

    const sortedYears = Array.from(years).sort((a, b) => b - a);
    
    if (!years.has(currentYear) && sortedYears.length > 0) {
        currentYear = sortedYears[0];
    }

    sortedYears.forEach(year => {
        const item = document.createElement('div');
        item.className = `year-item ${year === currentYear && currentView === 'notes' ? 'active' : ''}`;
        item.dataset.year = year;
        
        item.addEventListener('click', (e) => {
            selectYear(year);
        });
        
        const icon = document.createElement('span');
        icon.className = 'item-icon';
        icon.innerHTML = folderSvg;
        
        const text = document.createElement('span');
        text.className = 'item-text';
        text.innerText = `${year} 年`;

        const tooltip = document.createElement('div');
        tooltip.className = 'year-tooltip';
        tooltip.innerText = `${year} 年`;

        item.appendChild(icon);
        item.appendChild(text);
        item.appendChild(tooltip);
        yearList.appendChild(item);
    });

    if (currentView === 'notes') {
        renderNotes();
    } else if (currentView === 'bookmarks') {
        renderBookmarks();
    }
}

function handleMainAction() {
    const mainBtn = document.querySelector('.fab-main-btn');
    if (isFabTucked || (mainBtn && mainBtn.classList.contains('tucked'))) {
        isFabTucked = false;
        if (mainBtn) mainBtn.classList.remove('tucked');
        document.querySelectorAll('.fab-scroll-btn').forEach(btn => btn.classList.remove('tucked'));
        resetFabIdleTimer();
        return;
    }
    
    if (currentView === 'notes') {
        openEditor();
    } else if (currentView === 'bookmarks') {
        openBookmarkEditor();
    }
}

function copyNoteContent() {
    const content = document.getElementById('note-content').innerText;
    if (!content) return;
    
    navigator.clipboard.writeText(content).then(() => {
        const btn = document.getElementById('copy-btn');
        btn.classList.add('success');
        setTimeout(() => { btn.classList.remove('success'); }, 1500);
    });
}

function showContextMenu(e, type, id, element) {
    e.preventDefault();
    handleContextMenuTrigger(element, e.pageX, e.pageY);
}

function renderNotes() {
    document.getElementById('current-main-title').innerText = `${currentYear} 年`;
    document.querySelector('.sort-wrapper').style.display = 'block';
    
    const container = document.getElementById('content-container');
    container.innerHTML = '';
    
    const sortedDates = Object.keys(notes)
        .filter(date => date.startsWith(currentYear))
        .sort((a, b) => sortOrder === 'newest' ? new Date(b) - new Date(a) : new Date(a) - new Date(b));
        
    const groupedNotes = {};
    sortedDates.forEach(date => {
        const month = parseInt(date.split('-')[1], 10);
        if (!groupedNotes[month]) groupedNotes[month] = [];
        groupedNotes[month].push(date);
    });
    
    const sortedMonths = Object.keys(groupedNotes).sort((a, b) => sortOrder === 'newest' ? b - a : a - b);

    sortedMonths.forEach(month => {
        const monthTitle = document.createElement('h2');
        monthTitle.className = 'month-title';
        monthTitle.innerText = `${month} 月`;
        container.appendChild(monthTitle);
        
        const grid = document.createElement('div');
        grid.className = 'note-grid';
        
        groupedNotes[month].forEach(date => {
            const noteData = notes[date];
            const isLegacy = typeof noteData === 'string';
            const contentText = isLegacy ? noteData : noteData.content;
            const timeText = isLegacy ? '無時間紀錄' : noteData.timestamp;

            const card = document.createElement('div');
            card.className = 'note-card glass-effect';
            card.dataset.id = date;
            card.onclick = () => openEditor(date);
            
            card.oncontextmenu = (e) => showContextMenu(e, 'note', date, card);
            
            const dateEl = document.createElement('div');
            dateEl.className = 'note-title';
            dateEl.innerText = date;
            
            const contentEl = document.createElement('div');
            contentEl.className = 'note-preview';
            contentEl.innerHTML = contentText;
            
            card.appendChild(dateEl);
            card.appendChild(contentEl);

            const timeEl = document.createElement('div');
            timeEl.className = 'note-timestamp';
            timeEl.innerText = isLegacy ? timeText : `上次編輯：${timeText}`;
            card.appendChild(timeEl);

            grid.appendChild(card);
        });
        
        container.appendChild(grid);
    });
}

function handleCategoryDragStart(e) {
    draggedCategory = this;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => this.classList.add('dragging-category'), 0);
}

function handleCategoryDragEnd(e) {
    this.classList.remove('dragging-category');
    draggedCategory = null;
    saveCategoryOrder();
}

function handleCategoryDragOver(e) {
    if (!draggedCategory) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    
    const container = document.getElementById('content-container');
    const afterElement = getDragAfterCategory(container, e.clientY);
    
    if (afterElement == null) {
        container.appendChild(draggedCategory);
    } else {
        container.insertBefore(draggedCategory, afterElement);
    }
}

function handleCategoryDrop(e) {
    if (!draggedCategory) return;
    e.preventDefault();
    e.stopPropagation();
}

function getDragAfterCategory(container, y) {
    const draggableElements = [...container.querySelectorAll('.category-wrapper:not(.dragging-category)')];
    
    return draggableElements.find(child => {
        const box = child.getBoundingClientRect();
        return y < box.top + box.height / 2;
    });
}

function saveCategoryOrder() {
    const wrappers = document.querySelectorAll('.category-wrapper');
    const order = Array.from(wrappers).map(w => w.dataset.category);
    localStorage.setItem('my_category_order', JSON.stringify(order));
}

function handleDragStart(e) {
    e.stopPropagation(); 
    draggedCard = this;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => this.classList.add('dragging'), 0);
}

function handleDragEnd(e) {
    e.stopPropagation();
    this.classList.remove('dragging');
    draggedCard = null;
    saveBookmarkOrder();
}

function handleDragOver(e) {
    if (!draggedCard) return; 
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    
    const grid = this;
    const afterElement = getDragAfterElement(grid, e.clientX, e.clientY);
    
    if (afterElement == null) {
        grid.appendChild(draggedCard);
    } else {
        grid.insertBefore(draggedCard, afterElement);
    }
}

function handleDrop(e) {
    if (!draggedCard) return;
    e.preventDefault();
    e.stopPropagation();
}

function getDragAfterElement(container, x, y) {
    const draggableElements = [...container.querySelectorAll('.note-card:not(.dragging)')];
    
    return draggableElements.find(child => {
        const box = child.getBoundingClientRect();
        if (y < box.top) return true;
        if (y >= box.top && y <= box.bottom && x < box.left + box.width / 2) return true;
        return false;
    });
}

function saveBookmarkOrder() {
    const grids = document.querySelectorAll('.note-grid');
    let globalOrder = 0;
    
    grids.forEach(grid => {
        const category = grid.dataset.category;
        const cards = grid.querySelectorAll('.note-card');
        cards.forEach(card => {
            const id = card.dataset.id;
            if (bookmarks[id]) {
                bookmarks[id].category = category;
                bookmarks[id].order = globalOrder++;
            }
        });
    });
    
    localStorage.setItem('my_bookmarks', JSON.stringify(bookmarks));
}

function renderBookmarks() {
    document.getElementById('current-main-title').innerText = '網站收藏';
    document.querySelector('.sort-wrapper').style.display = 'none'; 
    
    const container = document.getElementById('content-container');
    container.innerHTML = '';
    
    const groupedBookmarks = {};
    Object.keys(bookmarks).forEach(id => {
        const bm = bookmarks[id];
        const cat = bm.category || '未分類';
        if (!groupedBookmarks[cat]) groupedBookmarks[cat] = [];
        groupedBookmarks[cat].push({ id, ...bm });
    });
    
    let savedCatOrder = JSON.parse(localStorage.getItem('my_category_order')) || [];
    
    const sortedCategories = Object.keys(groupedBookmarks).sort((a, b) => {
        let idxA = savedCatOrder.indexOf(a);
        let idxB = savedCatOrder.indexOf(b);
        if (idxA === -1 && idxB === -1) return a.localeCompare(b);
        if (idxA === -1) return 1;
        if (idxB === -1) return -1;
        return idxA - idxB;
    });

    sortedCategories.forEach(cat => {
        const catWrapper = document.createElement('div');
        catWrapper.className = 'category-wrapper';
        catWrapper.draggable = window.innerWidth > 768; 
        catWrapper.dataset.category = cat;

        catWrapper.addEventListener('dragstart', handleCategoryDragStart);
        catWrapper.addEventListener('dragend', handleCategoryDragEnd);
        catWrapper.addEventListener('dragover', handleCategoryDragOver);
        catWrapper.addEventListener('drop', handleCategoryDrop);

        const catTitle = document.createElement('h2');
        catTitle.className = 'month-title';
        catTitle.innerHTML = `<span style="cursor:grab; margin-right:8px; opacity:0.3; display:inline-flex; align-items:center; transform:translateY(-1px);" title="拖曳排序分類">⣿</span>${cat}`;
        catWrapper.appendChild(catTitle);
        
        const grid = document.createElement('div');
        grid.className = 'note-grid';
        grid.dataset.category = cat;

        grid.addEventListener('dragover', handleDragOver);
        grid.addEventListener('drop', handleDrop);
        
        groupedBookmarks[cat].sort((a, b) => (a.order || 0) - (b.order || 0));

        groupedBookmarks[cat].forEach(bm => {
            const card = document.createElement('div');
            card.className = 'note-card glass-effect';
            card.draggable = window.innerWidth > 768; 
            card.dataset.id = bm.id;
            
            card.addEventListener('dragstart', handleDragStart);
            card.addEventListener('dragend', handleDragEnd);

            card.onclick = (e) => {
                if (card.classList.contains('dragging')) return;
                openBookmarkEditor(bm.id);
            };

            card.oncontextmenu = (e) => showContextMenu(e, 'bookmark', bm.id, card);

            const embed = document.createElement('div');
            embed.className = 'discord-embed';

            const provider = document.createElement('div');
            provider.className = 'embed-provider';
            try {
                const urlObj = new URL(bm.url);
                provider.innerText = urlObj.hostname;
            } catch(e) {
                provider.innerText = '網站連結';
            }

            const titleEl = document.createElement('a');
            titleEl.className = 'embed-title';
            titleEl.href = bm.url;
            titleEl.target = '_blank';
            titleEl.innerText = bm.title || bm.url;
            titleEl.onclick = (e) => e.stopPropagation();

            embed.appendChild(provider);
            embed.appendChild(titleEl);

            if (bm.description) {
                const descEl = document.createElement('div');
                descEl.className = 'embed-desc';
                descEl.innerText = bm.description;
                embed.appendChild(descEl);
            }

            card.appendChild(embed);

            if (bm.timestamp) {
                const timeEl = document.createElement('div');
                timeEl.className = 'note-timestamp';
                timeEl.innerText = `上次編輯：${bm.timestamp}`;
                card.appendChild(timeEl);
            }

            grid.appendChild(card);
        });
        
        catWrapper.appendChild(grid);
        container.appendChild(catWrapper);
    });
}

function renderExistingCategories() {
    const container = document.getElementById('modal-category-list');
    container.innerHTML = '';
    const cats = new Set();
    
    Object.values(bookmarks).forEach(bm => {
        if (bm.category && bm.category.trim() !== '' && bm.category !== '未分類') {
            cats.add(bm.category);
        }
    });
    
    if (cats.size === 0) {
        container.innerHTML = '<div style="color: var(--text-secondary); font-size: 14px; width: 100%; text-align: center; padding: 20px 0;">目前沒有已建立的分類</div>';
        return;
    }

    cats.forEach(cat => {
        const tag = document.createElement('span');
        tag.className = 'cat-tag';
        tag.innerText = cat;
        tag.onclick = () => { 
            document.getElementById('bookmark-category').value = cat; 
            closeCategoryModal();
        };
        container.appendChild(tag);
    });
}

function openCategoryModal() {
    renderExistingCategories();
    const overlay = document.getElementById('confirm-overlay');
    const modal = document.getElementById('category-modal');
    
    overlay.style.zIndex = "10002"; 
    
    overlay.style.display = 'block';
    modal.style.display = 'block';
    
    setTimeout(() => {
        overlay.classList.add('active');
        modal.classList.add('active');
    }, 10);
}

function closeCategoryModal() {
    const overlay = document.getElementById('confirm-overlay');
    const modal = document.getElementById('category-modal');
    
    modal.classList.remove('active');
    overlay.classList.remove('active');
    
    setTimeout(() => {
        modal.style.display = 'none';
        overlay.style.display = 'none';
        overlay.style.zIndex = ""; 
    }, 300);
}

function toggleCalendar() {
    renderCalendar();
    const overlay = document.getElementById('calendar-overlay');
    const modal = document.getElementById('calendar-modal');
    overlay.style.display = 'block';
    modal.style.display = 'block';
    setTimeout(() => {
        overlay.classList.add('active');
        modal.classList.add('active');
    }, 10);
}

function closeCalendar() {
    if (document.activeElement) document.activeElement.blur();
    const overlay = document.getElementById('calendar-overlay');
    const modal = document.getElementById('calendar-modal');
    overlay.classList.remove('active');
    modal.classList.remove('active');
    setTimeout(() => {
        overlay.style.display = 'none';
        modal.style.display = 'none';
    }, 300);
}

function renderCalendar() {
    const year = calDate.getFullYear();
    const month = calDate.getMonth();
    document.getElementById('cal-month-year').innerText = `${year}年 ${month + 1}月`;
    
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysGrid = document.getElementById('cal-days');
    daysGrid.innerHTML = '';
    
    const selectedVal = document.getElementById('note-date-val').value;

    for(let i = 0; i < firstDay; i++) {
        daysGrid.appendChild(document.createElement('div'));
    }

    for(let i = 1; i <= daysInMonth; i++) {
        const dayCell = document.createElement('div');
        dayCell.className = 'cal-day-cell';
        dayCell.innerText = i;
        
        const dStr = String(i).padStart(2, '0');
        const mStr = String(month + 1).padStart(2, '0');
        const cellDateStr = `${year}-${mStr}-${dStr}`;
        
        if (cellDateStr === selectedVal) {
            dayCell.classList.add('selected');
        }

        dayCell.onclick = (e) => {
            e.stopPropagation();
            selectDate(year, month + 1, i);
        };
        daysGrid.appendChild(dayCell);
    }
}

function changeMonth(delta) {
    calDate.setMonth(calDate.getMonth() + delta);
    renderCalendar();
}

function changeYear(delta) {
    calDate.setFullYear(calDate.getFullYear() + delta);
    renderCalendar();
}

function selectDate(year, month, day) {
    const yStr = year;
    const mStr = String(month).padStart(2, '0');
    const dStr = String(day).padStart(2, '0');
    const dateStr = `${yStr}-${mStr}-${dStr}`;
    
    document.getElementById('date-text').innerText = dateStr;
    document.getElementById('note-date-val').value = dateStr;
    
    closeCalendar();
}

function openEditor(existingDate = null) {
    currentEditingDate = existingDate;
    const overlay = document.getElementById('modal-overlay');
    const modal = document.getElementById('editor-modal');
    const dateVal = document.getElementById('note-date-val');
    const dateText = document.getElementById('date-text');
    const contentInput = document.getElementById('note-content');
    const deleteBtn = document.getElementById('btn-delete-note');

    modal.classList.remove('shake-animation'); 

    overlay.style.display = 'block';
    modal.style.display = 'block'; 
    
    setTimeout(() => {
        overlay.classList.add('active');
        modal.classList.add('active');
    }, 10);

    if (existingDate) {
        const noteData = notes[existingDate];
        dateVal.value = existingDate;
        dateText.innerText = existingDate;
        
        let text = typeof noteData === 'string' ? noteData : noteData.content;
        if (!/<[a-z][\s\S]*>/i.test(text)) {
            text = text.replace(/\n/g, '<br>');
        }
        contentInput.innerHTML = text;
        
        deleteBtn.style.display = 'block';
        
        const parts = existingDate.split('-');
        calDate = new Date(parts[0], parseInt(parts[1]) - 1, parts[2]);
    } else {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        const dateString = `${yyyy}-${mm}-${dd}`;
        
        calDate = new Date();
        dateVal.value = dateString;
        dateText.innerText = dateString;
        contentInput.innerHTML = '';
        deleteBtn.style.display = 'none';
    }
}

function openBookmarkEditor(id = null) {
    currentEditingBookmarkId = id;
    const overlay = document.getElementById('modal-overlay');
    const modal = document.getElementById('bookmark-modal');
    
    const idVal = document.getElementById('bookmark-id-val');
    const titleInput = document.getElementById('bookmark-title');
    const urlInput = document.getElementById('bookmark-url');
    const catInput = document.getElementById('bookmark-category');
    const descInput = document.getElementById('bookmark-desc');
    const deleteBtn = document.getElementById('btn-delete-bookmark');

    modal.classList.remove('shake-animation'); 

    overlay.style.display = 'block';
    modal.style.display = 'block'; 
    
    setTimeout(() => {
        overlay.classList.add('active');
        modal.classList.add('active');
    }, 10);

    if (id && bookmarks[id]) {
        const bm = bookmarks[id];
        idVal.value = id;
        titleInput.value = bm.title || '';
        urlInput.value = bm.url || '';
        catInput.value = bm.category === '未分類' ? '' : bm.category;
        descInput.value = bm.description || '';
        deleteBtn.style.display = 'block';
    } else {
        idVal.value = '';
        titleInput.value = '';
        urlInput.value = '';
        catInput.value = '';
        descInput.value = '';
        deleteBtn.style.display = 'none';
    }
}

function closeAllEditors() {
    if (document.activeElement) document.activeElement.blur();
    const overlay = document.getElementById('modal-overlay');
    const modals = [
        document.getElementById('editor-modal'),
        document.getElementById('bookmark-modal')
    ];
    
    overlay.classList.remove('active');
    modals.forEach(m => m.classList.remove('active'));
    closeCalendar();
    
    setTimeout(() => {
        overlay.style.display = 'none';
        modals.forEach(m => m.style.display = 'none');
        currentEditingDate = null;
        currentEditingBookmarkId = null;
    }, 300);
}

function getTimestamp() {
    const now = new Date();
    return `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
}

function saveNote() {
    const date = document.getElementById('note-date-val').value;
    const contentHTML = document.getElementById('note-content').innerHTML;
    const pureText = document.getElementById('note-content').innerText.trim();
    
    if (!date || !pureText) {
        const modal = document.getElementById('editor-modal');
        modal.classList.remove('shake-animation');
        void modal.offsetWidth; 
        modal.classList.add('shake-animation');
        return;
    }

    if (currentEditingDate && currentEditingDate !== date) {
        delete notes[currentEditingDate];
    }

    notes[date] = {
        content: contentHTML,
        timestamp: getTimestamp()
    };
    localStorage.setItem('my_life_notes', JSON.stringify(notes));
    
    currentYear = date.split('-')[0];
    closeAllEditors();
    setTimeout(renderSidebar, 300);
}

function saveBookmark() {
    const title = document.getElementById('bookmark-title').value;
    let url = document.getElementById('bookmark-url').value.trim();
    let category = document.getElementById('bookmark-category').value.trim() || '未分類';
    const desc = document.getElementById('bookmark-desc').value;
    
    if (!url) {
        const modal = document.getElementById('bookmark-modal');
        modal.classList.remove('shake-animation');
        void modal.offsetWidth; 
        modal.classList.add('shake-animation');
        return;
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
    }

    const id = currentEditingBookmarkId || Date.now().toString();
    const order = (bookmarks[id] && bookmarks[id].order !== undefined) ? bookmarks[id].order : Date.now();
    
    bookmarks[id] = {
        title: title,
        url: url,
        category: category,
        description: desc,
        timestamp: getTimestamp(),
        order: order
    };
    
    localStorage.setItem('my_bookmarks', JSON.stringify(bookmarks));
    closeAllEditors();
    setTimeout(renderBookmarks, 300);
}

function showDeleteConfirm(type) {
    deleteTargetType = type;
    const overlay = document.getElementById('confirm-overlay');
    const modal = document.getElementById('confirm-modal');
    overlay.style.display = 'block';
    modal.style.display = 'block';
    setTimeout(() => {
        overlay.classList.add('active');
        modal.classList.add('active');
    }, 10);
}

function closeConfirm() {
    if (document.activeElement) document.activeElement.blur();
    const overlay = document.getElementById('confirm-overlay');
    const modal = document.getElementById('confirm-modal');
    overlay.classList.remove('active');
    modal.classList.remove('active');
    setTimeout(() => {
        overlay.style.display = 'none';
        modal.style.display = 'none';
        deleteTargetType = null;
    }, 300);
}

function closeAllConfirms() {
    if (document.activeElement) document.activeElement.blur();
    closeConfirm();
    closeTitleModal();
    closeCategoryModal();
    closeSettingsModal();
    closeCloudAlert();
}

function confirmDelete() {
    if (deleteTargetType === 'note' && currentEditingDate) {
        delete notes[currentEditingDate];
        localStorage.setItem('my_life_notes', JSON.stringify(notes));
        closeConfirm();
        closeAllEditors();
        setTimeout(renderSidebar, 300);
    } else if (deleteTargetType === 'bookmark' && currentEditingBookmarkId) {
        delete bookmarks[currentEditingBookmarkId];
        localStorage.setItem('my_bookmarks', JSON.stringify(bookmarks));
        closeConfirm();
        closeAllEditors();
        setTimeout(renderBookmarks, 300);
    }
}

let hiddenTime = 0;
const reloadThreshold = 5 * 60 * 1000; 

document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') {
        hiddenTime = Date.now();
    } else if (document.visibilityState === 'visible') {
        if (hiddenTime > 0 && (Date.now() - hiddenTime > reloadThreshold)) {
            location.reload();
        }
        hiddenTime = 0; 
    }
});

function copyBookmarkUrl() {
    const url = document.getElementById('bookmark-url').value;
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
        const btn = document.getElementById('copy-bm-btn');
        btn.classList.add('success');
        setTimeout(() => { btn.classList.remove('success'); }, 1500);
    });
}

const preventDefaultTouch = (e) => {
    e.preventDefault();
};

const overlays = [
    document.getElementById('modal-overlay'),
    document.getElementById('calendar-overlay'),
    document.getElementById('confirm-overlay'),
    document.getElementById('mobile-sidebar-overlay')
];

const toggleScrollLock = (shouldLock) => {
    if (shouldLock) {
        document.body.classList.add('no-scroll');
        overlays.forEach(overlay => {
            if (overlay) overlay.addEventListener('touchmove', preventDefaultTouch, { passive: false });
        });
    } else {
        document.body.classList.remove('no-scroll');
        overlays.forEach(overlay => {
            if (overlay) overlay.removeEventListener('touchmove', preventDefaultTouch, { passive: false });
        });
    }
};

const observer = new MutationObserver(() => {
    if (window.innerWidth <= 768) {
        const anyActive = document.querySelector('.active[id$="-overlay"], #mobile-sidebar-overlay.active');
        toggleScrollLock(!!anyActive);
    }
});

overlays.forEach(overlay => {
    if (overlay) observer.observe(overlay, { attributes: true, attributeFilter: ['class'] });
});

document.addEventListener('DOMContentLoaded', () => {
    const mainFab = document.querySelector('.fab-main-btn');
    const scrollFabs = document.querySelectorAll('.fab-scroll-btn');
    let fabStartX = 0;
    let fabStartY = 0;

    if (mainFab) {
        mainFab.addEventListener('touchstart', (e) => {
            fabStartX = e.touches[0].clientX;
            fabStartY = e.touches[0].clientY;
        }, {passive: true});

        mainFab.addEventListener('touchend', (e) => {
            if (window.innerWidth > 768) return; 

            let fabEndX = e.changedTouches[0].clientX;
            let fabEndY = e.changedTouches[0].clientY;
            let diffX = fabEndX - fabStartX;
            let diffY = Math.abs(fabEndY - fabStartY);

            if (diffY < 30) {
                if (!isFabTucked && diffX > 20) {
                    isFabTucked = true;
                    mainFab.classList.add('tucked');
                    scrollFabs.forEach(btn => btn.classList.add('tucked'));
                } else if (isFabTucked && diffX < -20) {
                    isFabTucked = false;
                    mainFab.classList.remove('tucked');
                    scrollFabs.forEach(btn => btn.classList.remove('tucked'));
                    resetFabIdleTimer();
                }
            }
        }, {passive: true});
    }
});

function openSettingsModal() {
    document.getElementById('setting-github-token').value = localStorage.getItem('github_token') || '';
    document.getElementById('setting-gist-id').value = localStorage.getItem('gist_id') || '';
    
    const overlay = document.getElementById('confirm-overlay'); 
    const modal = document.getElementById('settings-modal');
    
    overlay.style.display = 'block';
    modal.style.display = 'block';
    
    setTimeout(() => {
        overlay.classList.add('active');
        modal.classList.add('active');
        document.getElementById('setting-github-token').focus();
    }, 10);
    
    if (window.innerWidth <= 768) {
        const sidebar = document.getElementById('sidebar');
        if (sidebar.classList.contains('mobile-open')) {
            toggleSidebar();
        }
    }
}

function closeSettingsModal() {
    if (document.activeElement) document.activeElement.blur();
    const overlay = document.getElementById('confirm-overlay');
    const modal = document.getElementById('settings-modal');
    
    modal.classList.remove('active');
    overlay.classList.remove('active');
    
    setTimeout(() => {
        modal.style.display = 'none';
        overlay.style.display = 'none';
    }, 300);
}

function saveSettings() {
    const token = document.getElementById('setting-github-token').value.trim();
    const gistId = document.getElementById('setting-gist-id').value.trim();
    localStorage.setItem('github_token', token);
    localStorage.setItem('gist_id', gistId);
    closeSettingsModal();
    alert('設定已儲存');
}

function openCloudAlert() {
    const overlay = document.getElementById('confirm-overlay');
    const modal = document.getElementById('cloud-alert-modal');
    overlay.style.display = 'block';
    modal.style.display = 'block';
    setTimeout(() => {
        overlay.classList.add('active');
        modal.classList.add('active');
    }, 10);
}

function closeCloudAlert() {
    if (document.activeElement) document.activeElement.blur();
    const overlay = document.getElementById('confirm-overlay');
    const modal = document.getElementById('cloud-alert-modal');
    modal.classList.remove('active');
    overlay.classList.remove('active');
    setTimeout(() => {
        modal.style.display = 'none';
        overlay.style.display = 'none';
    }, 300);
}

function openSettingsFromAlert() {
    closeCloudAlert();
    setTimeout(() => {
        openSettingsModal();
    }, 300);
}

// 輔助函數：測量文字寬度
function getTextWidth(text, font) {
    const canvas = getTextWidth.canvas || (getTextWidth.canvas = document.createElement("canvas"));
    const context = canvas.getContext("2d");
    context.font = font;
    const metrics = context.measureText(text);
    return metrics.width;
}

// 雲端提示動畫圓球函數
function showCloudToast(message) {
    const toast = document.getElementById('cloud-toast');
    const textSpan = document.getElementById('cloud-toast-text');
    
    // 1. 設定文字
    textSpan.innerText = message;

    // 2. 計算需要的總寬度
    const fontStyle = window.getComputedStyle(textSpan).font;
    const textWidth = getTextWidth(message, fontStyle);
    const iconWidth = 54; // 圖標容器寬度
    const padding = 20; // 額外邊距 (文字右側 15px + 其他緩衝)
    const totalWidth = iconWidth + textWidth + padding;
    
    // 3. 開始落下動畫
    toast.classList.add('drop'); 
    
    setTimeout(() => {
        // 4. 設定寬度並展開
        toast.style.width = `${totalWidth}px`;
        toast.classList.add('expand'); // 觸發文字透明度變化
        
        setTimeout(() => {
            // 5. 收縮寬度並隱藏文字
            toast.classList.remove('expand');
            toast.style.width = '54px'; // 回復到圓形寬度
            
            setTimeout(() => {
                // 6. 收回上方
                toast.classList.remove('drop');
                // 動畫結束後清除 inline style，避免影響下次計算
                setTimeout(() => {
                     toast.style.width = '';
                }, 400)
            }, 300); // 等待寬度收縮動畫完成
        }, 2000); // 停留時間
    }, 400); // 等待落下動畫完成
}

async function uploadToGist() {
    const token = localStorage.getItem('github_token');
    const gistId = localStorage.getItem('gist_id');
    
    if (!token || !gistId) {
        openCloudAlert();
        return;
    }

    const data = {
        notes: notes,
        bookmarks: bookmarks,
        category_order: localStorage.getItem('my_category_order'),
        app_title: localStorage.getItem('my_app_title')
    };

    try {
        const response = await fetch(`https://api.github.com/gists/${gistId}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            body: JSON.stringify({
                files: {
                    'my_notes.json': {
                        content: JSON.stringify(data)
                    }
                }
            })
        });
        if (response.ok) {
            closeSettingsMenu();
            showCloudToast('備份成功'); // 使用新動畫提示
        } else {
            alert('上傳失敗，請檢查 Token 權限');
        }
    } catch (error) {
        alert('網路連線錯誤');
    }
}

async function downloadFromGist() {
    const token = localStorage.getItem('github_token');
    const gistId = localStorage.getItem('gist_id');
    
    if (!token || !gistId) {
        openCloudAlert();
        return;
    }

    try {
        const response = await fetch(`https://api.github.com/gists/${gistId}?t=${Date.now()}`, {
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`伺服器連線異常 (狀態碼: ${response.status})`);
        }

        const gist = await response.json();
        
        if (!gist.files || !gist.files['my_notes.json']) {
            throw new Error('雲端沒有找到 my_notes.json 檔案');
        }

        const rawUrl = gist.files['my_notes.json'].raw_url;
        const fileResponse = await fetch(`${rawUrl}?t=${Date.now()}`);
        
        if (!fileResponse.ok) {
            throw new Error('無法讀取雲端真實檔案內容');
        }

        const importedData = await fileResponse.json();
        
        notes = importedData.notes || {};
        bookmarks = importedData.bookmarks || {};
        
        if (importedData.category_order) {
            localStorage.setItem('my_category_order', importedData.category_order);
        }
        if (importedData.app_title) {
            localStorage.setItem('my_app_title', importedData.app_title);
            document.getElementById('app-logo-text').innerText = importedData.app_title;
            document.title = importedData.app_title;
        }

        localStorage.setItem('my_life_notes', JSON.stringify(notes));
        localStorage.setItem('my_bookmarks', JSON.stringify(bookmarks));
        
        renderSidebar();
        if (currentView === 'notes') {
            renderNotes();
        } else {
            renderBookmarks();
        }
        
        closeSettingsMenu();
        showCloudToast('下載成功'); // 使用新動畫提示
        
    } catch (error) {
        console.error(error);
        alert(`下載失敗！\n錯誤資訊：${error.message}\n請檢查 Gist ID 是否正確，或確認網路狀態。`);
    }
}

initApp();
