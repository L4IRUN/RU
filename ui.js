// ui.js
// 職責：處理所有的畫面渲染、DOM 更新與 UI 狀態切換

import { state } from './state.js';
import { safeJSONParse } from './storage.js';

// ==========================================
// 工具與格式化函式
// ==========================================
export function getWordCount(html) {
    if (!html) return 0;
    const temp = document.createElement('div');
    temp.innerHTML = html;
    return (temp.innerText || '').replace(/[\n\r\s]+/g, '').length;
}

export function formatTimeWithDay(timeStr) {
    if (!timeStr || timeStr === '無時間紀錄') return '無時間紀錄';
    if (timeStr.includes('(')) return timeStr; 
    const match = timeStr.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (match) {
        const dateObj = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
        if (!isNaN(dateObj.getTime())) {
            const days = ['日', '一', '二', '三', '四', '五', '六'];
            const dayStr = `(${days[dateObj.getDay()]})`;
            if (timeStr.includes(' ')) return timeStr.replace(' ', ` ${dayStr} `);
            else return `${timeStr} ${dayStr}`;
        }
    }
    return timeStr;
}

export function getTimestamp() {
    const now = new Date();
    const days = ['日', '一', '二', '三', '四', '五', '六'];
    const dayStr = `(${days[now.getDay()]})`;
    return `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${dayStr} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
}

export function formatDateForDisplay(dateStr, forceIncludeWeekday = null) {
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const d = new Date(parts[0], parseInt(parts[1]) - 1, parts[2]);
    if (isNaN(d.getTime())) return dateStr;
    const shouldInclude = forceIncludeWeekday !== null ? forceIncludeWeekday : (state._cachedInnerWidth > 768);
    if (!shouldInclude) return dateStr;
    const days = ['日', '一', '二', '三', '四', '五', '六'];
    return `${dateStr} (${days[d.getDay()]})`;
}

export function getTextWidth(text, font) {
    const canvas = getTextWidth.canvas || (getTextWidth.canvas = document.createElement("canvas"));
    const context = canvas.getContext("2d");
    context.font = font;
    return context.measureText(text).width;
}

export function getReminderLabel(key) {
    const map = {
        'none': '無',
        '1h': '1小時前',
        '2h': '2小時前',
        '1d': '1天前',
        '2d': '2天前',
        '1w': '1週前'
    };
    return map[key] || '無';
}

export function isNoteReminderActive(note) {
    if (!note || !note.reminder || note.reminder === 'none') return false;
    const noteDate = note.date;
    if (!noteDate) return false;
    const parts = noteDate.split('-');
    if (parts.length !== 3) return false;
    
    // 設定當天開始時間 (00:00:00) 與當天結束時間 (23:59:59)
    const targetStartTime = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 0, 0, 0).getTime();
    const targetEndTime = targetStartTime + (24 * 60 * 60 * 1000);
    
    const offsetMap = {
        '1h': 1 * 60 * 60 * 1000,
        '2h': 2 * 60 * 60 * 1000,
        '1d': 24 * 60 * 60 * 1000,
        '2d': 48 * 60 * 60 * 1000,
        '1w': 7 * 24 * 60 * 60 * 1000
    };
    const offset = offsetMap[note.reminder] || 0;
    const triggerTime = targetStartTime - offset;
    const now = Date.now();

    // 介於提醒觸發時間與該事項當日結束之間才顯示呼吸燈
    return now >= triggerTime && now <= targetEndTime;
}

// ==========================================
// UI 狀態更新函式
// ==========================================
export function setIndicatorState(status) {
    const wrapper = document.getElementById('save-indicator-wrapper');
    const fullDot = document.querySelector('.full-save-dot');
    if (wrapper) wrapper.classList.remove('unsaved', 'saved');
    
    if (status === 'unsaved') {
        if (wrapper) wrapper.classList.add('unsaved');
        if (fullDot) {
            fullDot.style.opacity = '1';
            fullDot.style.transform = 'scale(1)';
            fullDot.style.right = '56px';
        }
    } else if (status === 'saved' || status === '') {
        if (wrapper && status === 'saved') wrapper.classList.add('saved');
        if (fullDot) {
            fullDot.style.opacity = '0';
            fullDot.style.transform = 'scale(0)';
            fullDot.style.right = '17px';
        }
        setTimeout(() => {
            if (!state.isNoteUnsaved && wrapper) wrapper.classList.remove('saved');
        }, 2000);
    }
}

export function updateWordCount() {
    const fullContent = document.getElementById('full-note-content');
    const wordCountDisplay = document.getElementById('full-word-count');
    
    if (fullContent && wordCountDisplay) {
        const currentText = fullContent.innerText || '';
        const currentCount = currentText.replace(/[\n\r\s]+/g, '').length;
        
        const mCount = state.currentTimeTab === 'morning' ? currentCount : getWordCount(state.tempNoteData.morning);
        const aCount = state.currentTimeTab === 'afternoon' ? currentCount : getWordCount(state.tempNoteData.afternoon);
        const eCount = state.currentTimeTab === 'evening' ? currentCount : getWordCount(state.tempNoteData.evening);
        const totalCount = mCount + aCount + eCount;
        
        let periodName = '上午';
        if (state.currentTimeTab === 'afternoon') periodName = '下午';
        else if (state.currentTimeTab === 'evening') periodName = '晚上';
        
        wordCountDisplay.innerHTML = `
            <div style="line-height: 1.4;">${periodName}：${currentCount} 字</div>
            <div style="line-height: 1.4;">總字數：${totalCount} 字</div>
        `;
    }
}

// 同步「深色模式」分段控制的視覺狀態。
// 不帶參數時，自動依目前 <body data-theme="dark"> 判斷（用於開啟設定選單時的防呆同步）。
export function updateThemeSegment(isDark) {
    if (typeof isDark !== 'boolean') {
        isDark = document.body.getAttribute('data-theme') === 'dark';
    }
    const segment = document.getElementById('dark-mode-segment');
    const lightBtn = document.getElementById('seg-theme-light');
    const darkBtn = document.getElementById('seg-theme-dark');
    if (segment) segment.setAttribute('data-active', isDark ? '2' : '1');
    if (lightBtn) lightBtn.classList.toggle('active', !isDark);
    if (darkBtn) darkBtn.classList.toggle('active', isDark);
}

// 同步「視覺效果」分段控制的視覺狀態（正向邏輯：isOn = true 代表已開啟毛玻璃特效）。
// 不帶參數時，自動依 localStorage 的 visual_effects 判斷；未設定過時預設視為開啟。
export function updateVisualEffectsSegment(isOn) {
    if (typeof isOn !== 'boolean') {
        const stored = localStorage.getItem('visual_effects');
        isOn = stored === null ? true : stored === 'true';
    }
    const segment = document.getElementById('visual-effects-segment');
    const onBtn = document.getElementById('seg-visual-on');
    const offBtn = document.getElementById('seg-visual-off');
    // 左關右開：關閉對應左側滑塊 data-active="1"，開啟對應右側滑塊 data-active="2"
    if (segment) segment.setAttribute('data-active', isOn ? '2' : '1');
    if (onBtn) onBtn.classList.toggle('active', isOn);
    if (offBtn) offBtn.classList.toggle('active', !isOn);
}

export function updateSortIcon() {
    const upArrow = document.getElementById('sort-up-arrow');
    const downArrow = document.getElementById('sort-down-arrow');
    if (upArrow && downArrow) {
        if (state.sortOrder === 'newest') {
            upArrow.style.opacity = '0.3';
            downArrow.style.opacity = '1';
        } else {
            upArrow.style.opacity = '1';
            downArrow.style.opacity = '0.3';
        }
    }
}

// 下列四個時長務必與 style.css 中 #cloud-toast / #cloud-toast-text 的
// transition 時長逐一對應，動畫的每個階段（下拉 → 展開 → 文字淡入
// / 文字淡出 → 收合 → 滑出）才不會卡頓或提早露出文字：
const TOAST_DROP_MS = 400;       // 對應 #cloud-toast 的 transform 過渡
const TOAST_EXPAND_MS = 300;     // 對應 #cloud-toast 的 width 過渡
const TOAST_TEXT_FADE_MS = 200;  // 對應 #cloud-toast-text 的 opacity 過渡
const TOAST_HOLD_MS = 2000;      // 文字完全顯示後的停留時間

let toastTimers = [];
let isToastShowing = false;
let currentToastClickHandler = null;

function clearToastTimers() {
    toastTimers.forEach(clearTimeout);
    toastTimers = [];
}

function scheduleToast(fn, delay) {
    toastTimers.push(setTimeout(fn, delay));
}

/**
 * 顯示雲端提示膠囊（支援常駐 persistent 與點擊事件 onClick）
 */
export function showCloudToast(message, options = {}) {
    const toast = document.getElementById('cloud-toast');
    const textSpan = document.getElementById('cloud-toast-text');
    const iconWrapper = toast.querySelector('.toast-icon-wrapper');

    if (iconWrapper) iconWrapper.style.display = 'none';

    clearToastTimers();

    // 清理前次綁定的點擊事件
    if (currentToastClickHandler) {
        toast.removeEventListener('click', currentToastClickHandler);
        currentToastClickHandler = null;
    }
    toast.style.cursor = '';

    const persistent = typeof options === 'object' ? !!options.persistent : false;
    const onClick = typeof options === 'object' && typeof options.onClick === 'function' ? options.onClick : null;

    if (onClick) {
        toast.style.cursor = 'pointer';
        currentToastClickHandler = (e) => {
            e.stopPropagation();
            onClick(e);
        };
        toast.addEventListener('click', currentToastClickHandler);
    }

    // 無論打斷在哪個階段，先確保文字是隱藏的：
    // 避免上一個 Toast 的淡出動畫被新訊息打斷時，文字提早露出。
    textSpan.style.opacity = '0';

    // Step2 + Step3：寬度展開到內容所需寬度，展開動畫「完成後」文字才淡入
    const expandAndReveal = () => {
        textSpan.innerText = message;
        const computedStyle = window.getComputedStyle(textSpan);
        const fontStyle = computedStyle.font || `${computedStyle.fontWeight} ${computedStyle.fontSize} ${computedStyle.fontFamily}`;
        const textWidth = getTextWidth(message, fontStyle);
        const totalWidth = Math.max(Math.ceil(textWidth) + 48, 52);

        toast.style.width = `${totalWidth}px`;
        toast.classList.add('expand');

        scheduleToast(() => {
            textSpan.style.opacity = '1'; // 展開完成，文字淡入
            if (!persistent) {
                scheduleToast(hideToast, TOAST_HOLD_MS);
            }
        }, TOAST_EXPAND_MS);
    };

    if (isToastShowing) {
        // 已經顯示中被連續呼叫：先收回成圓形，再重新展開顯示新訊息，
        // 避免新舊兩段文字在同一個寬度動畫中互相打架。
        toast.classList.remove('expand');
        toast.style.width = '52px';
        scheduleToast(expandAndReveal, TOAST_TEXT_FADE_MS);
    } else {
        isToastShowing = true;
        // Step1：先以圓形尺寸從畫面頂端下拉
        toast.style.width = '52px';
        toast.classList.add('drop');
        scheduleToast(expandAndReveal, TOAST_DROP_MS);
    }
}

function hideToast() {
    const toast = document.getElementById('cloud-toast');
    const textSpan = document.getElementById('cloud-toast-text');

    if (currentToastClickHandler) {
        toast.removeEventListener('click', currentToastClickHandler);
        currentToastClickHandler = null;
    }
    toast.style.cursor = '';

    // Step1：文字先完全淡出
    textSpan.style.opacity = '0';

    scheduleToast(() => {
        // Step2：等文字完全消失後，才收回寬度回到圓形/膠囊狀
        toast.classList.remove('expand');
        toast.style.width = '52px';

        scheduleToast(() => {
            // Step3：寬度收回完畢後，才向上滑出畫面
            toast.classList.remove('drop');

            scheduleToast(() => {
                toast.style.width = '';
                isToastShowing = false;
            }, TOAST_DROP_MS);
        }, TOAST_EXPAND_MS);
    }, TOAST_TEXT_FADE_MS);
}

export function updateNoteDOM(date) {
    const existingCard = document.querySelector(`.note-card[data-id="${date}"]`);
    if (existingCard) {
        const timeEl = existingCard.querySelector('.note-timestamp');
        const n = state.notes[date];
        if (timeEl && n) {
            const targetTimeText = `上次編輯：${formatTimeWithDay(n.timestamp)}`;
            if (timeEl.innerText !== targetTimeText) {
                timeEl.innerText = targetTimeText;
            }
        }

        const noteDate = n?.date || date.split('_')[0];
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const isGlowing = (noteDate === todayStr) || isNoteReminderActive(n);

        const currentlyGlowing = existingCard.classList.contains('reminder-glowing');
        if (currentlyGlowing !== isGlowing) {
            if (isGlowing) {
                const period = 4.2;
                const offset = ((Date.now() / 1000) % period).toFixed(3);
                existingCard.style.animationDelay = `-${offset}s`;
                existingCard.classList.add('reminder-glowing');
            } else {
                existingCard.classList.remove('reminder-glowing');
                existingCard.style.animationDelay = '';
            }
        }
    }
}

export function updateBookmarkDOM(id) {
    const existingCard = document.querySelector(`.note-card[data-id="${id}"]`);
    if (existingCard) {
        const b = state.bookmarks[id];
        if (!b) return;
        const isCustom = !!b.isCustomRecord || (!b.url && !!b.content);
        const titleEl = existingCard.querySelector('.embed-title');
        let providerEl = existingCard.querySelector('.embed-provider');
        const descEl = existingCard.querySelector('.card-description');
        const timeEl = existingCard.querySelector('.note-timestamp');
        
        if (titleEl) {
            const embedContainer = existingCard.querySelector('.discord-embed');
            if (!providerEl && embedContainer) {
                providerEl = document.createElement('div');
                providerEl.className = 'embed-provider';
                embedContainer.insertBefore(providerEl, titleEl);
            }

            if (isCustom) {
                if (providerEl) {
                    providerEl.innerText = b.category || '未分類';
                }
                titleEl.innerText = b.title || '未命名資料';
                titleEl.removeAttribute('href');
                titleEl.removeAttribute('target');
                titleEl.style.color = 'var(--primary)';
                titleEl.classList.add('custom-record-title');
            } else {
                if (providerEl) {
                    try { providerEl.innerText = new URL(b.url).hostname; }
                    catch(e) { providerEl.innerText = '網站連結'; }
                }
                titleEl.innerText = b.title || b.url;
                titleEl.href = b.url;
                titleEl.target = '_blank';
                titleEl.style.color = '';
                titleEl.classList.remove('custom-record-title');
            }
        }
        
        if (descEl) {
            if (b.description && b.description.trim() !== '') {
                descEl.innerText = b.description;
                descEl.style.opacity = '';
            } else {
                descEl.innerText = '無備註';
                descEl.style.opacity = '0.4';
            }
        }
        if (timeEl) timeEl.innerText = `上次編輯：${formatTimeWithDay(b.timestamp)}`;
    }
}

// ==========================================
// 時間顯示功能 (System Clock & Session Timer)
// ==========================================
let sessionStartTime = Date.now(); 

export function initClocks() {
    const systemClock = document.getElementById('system-clock');
    const sessionClock = document.getElementById('session-clock');
    const lastSyncClock = document.getElementById('last-sync-clock');
    const appVersionDisplay = document.getElementById('app-version-display');

    if (appVersionDisplay) {
        appVersionDisplay.textContent = state.appVersion || '20260906';
    }

    function update() {
        const now = new Date();
        
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        const s = String(now.getSeconds()).padStart(2, '0');
        if (systemClock) systemClock.textContent = `${h}:${m}:${s}`;

        const diffSecs = Math.floor((Date.now() - sessionStartTime) / 1000);
        const sh = String(Math.floor(diffSecs / 3600)).padStart(2, '0');
        const sm = String(Math.floor((diffSecs % 3600) / 60)).padStart(2, '0');
        const ss = String(diffSecs % 60).padStart(2, '0');
        if (sessionClock) sessionClock.textContent = `${sh}:${sm}:${ss}`;

        if (lastSyncClock) {
            const lastSync = localStorage.getItem('last_sync_time');
            if (lastSync) {
                const syncDate = new Date(parseInt(lastSync, 10));
                const mo = String(syncDate.getMonth() + 1).padStart(2, '0');
                const da = String(syncDate.getDate()).padStart(2, '0');
                const hr = String(syncDate.getHours()).padStart(2, '0');
                const mi = String(syncDate.getMinutes()).padStart(2, '0');
                const sc = String(syncDate.getSeconds()).padStart(2, '0');
                lastSyncClock.textContent = `${mo}/${da} ${hr}:${mi}:${sc}`;
            } else {
                lastSyncClock.textContent = '--/-- --:--:--';
            }
        }
    }

    setInterval(update, 1000);
    update(); 
}

// ==========================================
// 核心畫面渲染函式 (Renders)
// ==========================================
export function renderSidebar() {
    hideChapterNav(); // 重置章節導航條，實際顯示與否交由下方對應的 render 函式精確控制

    const yearList = document.getElementById('year-list');
    yearList.innerHTML = '';
    
    const years = new Set();
    Object.keys(state.notes).forEach(date => years.add(date.split('-')[0]));
    if (years.size === 0) years.add(state.currentYear);

    const sortedYears = Array.from(years).sort((a, b) => b - a);
    if (!years.has(state.currentYear) && sortedYears.length > 0) state.currentYear = sortedYears[0];

    const item = document.createElement('div');
    item.id = 'nav-notes-btn';
    item.className = `year-item ${state.currentView === 'notes' ? 'active' : ''}`;
    item.onclick = () => window.selectYear(state.currentYear);

    const iconSpan = document.createElement('span');
    iconSpan.className = 'item-icon';
    iconSpan.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="5" y="3" width="15" height="18" rx="2" ry="2"></rect>
            <line x1="2" y1="8" x2="8" y2="8"></line>
            <line x1="2" y1="12" x2="8" y2="12"></line>
            <line x1="2" y1="16" x2="8" y2="16"></line>
        </svg>
    `;
    item.appendChild(iconSpan);
    
    const text = document.createElement('span');
    text.className = 'item-text';
    text.innerText = '筆記';
    item.appendChild(text);
    yearList.appendChild(item);

    const categoryList = document.getElementById('category-list');
    if (categoryList) categoryList.innerHTML = '';

    const groupedBookmarks = {};
    Object.keys(state.bookmarks).forEach(id => {
        const bm = state.bookmarks[id];
        const cat = bm.category || '未分類';
        if (!groupedBookmarks[cat]) groupedBookmarks[cat] = [];
        groupedBookmarks[cat].push({ id, ...bm });
    });

    let savedCatOrder = safeJSONParse(localStorage.getItem('my_category_order'), []);
    const sortedCategories = Object.keys(groupedBookmarks).sort((a, b) => {
        if (a === '未分類') return -1; 
        if (b === '未分類') return 1;
        let idxA = savedCatOrder.indexOf(a);
        let idxB = savedCatOrder.indexOf(b);
        if (idxA === -1 && idxB === -1) return a.localeCompare(b);
        if (idxA === -1) return -1; 
        if (idxB === -1) return 1;
        return idxA - idxB;
    });

    sortedCategories.forEach(cat => {
        const item = document.createElement('div');
        item.className = `year-item ${cat === state.currentCategory && state.currentView === 'bookmarks' ? 'active' : ''}`;
        item.dataset.category = cat;
        item.onclick = () => window.selectCategory(cat);

        const iconSpan = document.createElement('span');
        iconSpan.className = 'item-icon category-dot';
        iconSpan.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <circle cx="12" cy="12" r="8"></circle>
            </svg>
        `;
        item.appendChild(iconSpan);
        
        const text = document.createElement('span');
        text.className = 'item-text';
        text.innerText = cat;
        item.appendChild(text);
        categoryList.appendChild(item);
    });

    if (state.currentView === 'bookmarks') {
        if (!state.currentCategory || !groupedBookmarks[state.currentCategory]) {
            if (sortedCategories.length > 0) {
                state.currentCategory = sortedCategories[0];
                renderBookmarks();
            } else {
                window.selectYear(state.currentYear);
            }
        } else {
            renderBookmarks();
        }
    } else if (state.currentView === 'quotes') {
        renderQuotes();
    } else {
        renderNotes();
    }
}

export function createEmptyStateDOM() {
    const wrapper = document.createElement('div');
    wrapper.className = 'empty-state-view';

    const text = document.createElement('span');
    text.innerText = '未新增任何卡片';

    wrapper.appendChild(text);
    return wrapper;
}

export function renderNotes() {
    const titleEl = document.getElementById('current-main-title');
    titleEl.innerText = `${state.currentYear} 年`;
    titleEl.style.cursor = '';
    titleEl.onclick = null;
    
    // 顯示年份選擇按鈕
    const yearBtn = document.getElementById('year-select-btn');
    if (yearBtn) yearBtn.style.display = 'flex';
    
    document.querySelector('.sort-wrapper').style.display = 'block';
    const renameBtn1 = document.getElementById('rename-category-btn');
    if (renameBtn1) renameBtn1.style.display = 'none';
    
    const container = document.getElementById('content-container');
    
    const sortedKeys = Object.keys(state.notes)
        .filter(key => {
            const noteDate = state.notes[key]?.date || key.split('_')[0];
            return noteDate.startsWith(state.currentYear);
        })
        .sort((a, b) => {
            const dateA = state.notes[a]?.date || a.split('_')[0];
            const dateB = state.notes[b]?.date || b.split('_')[0];
            if (dateA !== dateB) {
                return state.sortOrder === 'newest' ? new Date(dateB) - new Date(dateA) : new Date(dateA) - new Date(dateB);
            }
            const timeA = state.notes[a]?.updatedAt || 0;
            const timeB = state.notes[b]?.updatedAt || 0;
            return state.sortOrder === 'newest' ? timeB - timeA : timeA - timeB;
        });
        
    if (sortedKeys.length === 0) {
        container.replaceChildren(createEmptyStateDOM());
        updateChapterNav([]);
        const searchInput = document.getElementById('main-search-input');
        if (searchInput && searchInput.value) window.clearSearch();
        return;
    }

    // 清理非筆記檢視殘留之結構（語錄瀑布流、空狀態、資料儲存分類網格及非月份網格/標題）
    const legacyElements = container.querySelectorAll('.quotes-masonry, .empty-state-view, .note-grid[data-category], .note-grid:not([data-month]), .month-title:not([data-month])');
    legacyElements.forEach(el => el.remove());

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const groupedNotes = {};
    sortedKeys.forEach(key => {
        const noteDate = state.notes[key]?.date || key.split('_')[0];
        const month = parseInt(noteDate.split('-')[1], 10);
        if (!groupedNotes[month]) groupedNotes[month] = [];
        groupedNotes[month].push(key);
    });
    
    const sortedMonths = Object.keys(groupedNotes).sort((a, b) => state.sortOrder === 'newest' ? b - a : a - b);
    const navItems = [];
    const activeMonthSet = new Set(sortedMonths.map(String));

    // 1. 清除已不在當前年份範圍的舊月份標題與舊網格
    Array.from(container.querySelectorAll('.month-title[data-month], .note-grid[data-month]')).forEach(el => {
        if (!activeMonthSet.has(el.dataset.month)) {
            el.remove();
        }
    });

    // 2. 嚴格就地比對與更新（保持節點持續處於 active document 樹中，杜絕動畫重置）
    let nextContainerChild = container.firstElementChild;

    sortedMonths.forEach(month => {
        const monthStr = String(month);

        // 檢查並就地復用或建立月份標題
        let monthTitle = container.querySelector(`.month-title[data-month="${monthStr}"]`);
        if (!monthTitle) {
            monthTitle = document.createElement('h2');
            monthTitle.className = 'month-title';
            monthTitle.dataset.month = monthStr;
            monthTitle.innerHTML = `<span style="font-size: 1.15em; margin-right: 4px;">${month}</span> 月`;
            container.insertBefore(monthTitle, nextContainerChild);
        } else if (monthTitle !== nextContainerChild) {
            container.insertBefore(monthTitle, nextContainerChild);
        }
        nextContainerChild = monthTitle.nextElementSibling;
        navItems.push({ label: `${month} 月`, targetDOM: monthTitle });

        // 檢查並就地復用或建立對應月份的 note-grid
        let grid = container.querySelector(`.note-grid[data-month="${monthStr}"]`);
        if (!grid) {
            grid = document.createElement('div');
            grid.className = 'note-grid';
            grid.dataset.month = monthStr;
            container.insertBefore(grid, nextContainerChild);
        } else if (grid !== nextContainerChild) {
            container.insertBefore(grid, nextContainerChild);
        }
        nextContainerChild = grid.nextElementSibling;

        // 處理該月份內的卡片
        const currentMonthKeys = groupedNotes[month];
        const currentMonthKeysSet = new Set(currentMonthKeys);

        // 移除不再屬於此月份的卡片節點
        Array.from(grid.querySelectorAll('.note-card[data-id]')).forEach(cardEl => {
            if (!currentMonthKeysSet.has(cardEl.dataset.id)) {
                cardEl.remove();
            }
        });

        let nextCardChild = grid.firstElementChild;

        currentMonthKeys.forEach(key => {
            const noteData = state.notes[key] || {};
            const noteDate = noteData.date || key.split('_')[0];
            const timeText = noteData.timestamp || '無時間紀錄';
            const isToday = noteDate === todayStr;
            const isGlowing = isToday || isNoteReminderActive(noteData);

            let card = grid.querySelector(`.note-card[data-id="${key}"]`);

            if (card) {
                // 卡片已存在且若順序不符才進行調整；順序相符時完全不觸動 DOM 結構
                if (card !== nextCardChild) {
                    grid.insertBefore(card, nextCardChild);
                }

                // 標題文字增量比對
                let cardTitle = card.querySelector('.note-title');
                if (!cardTitle) {
                    cardTitle = document.createElement('div');
                    cardTitle.className = 'note-title';
                    card.prepend(cardTitle);
                }
                const targetTitleText = noteData.isThemed ? (noteData.title || '未命名主題') : noteDate;
                if (cardTitle.innerText !== targetTitleText) {
                    cardTitle.innerText = targetTitleText;
                }

                // 時間戳記文字增量比對
                let cardTime = card.querySelector('.note-timestamp');
                if (!cardTime) {
                    cardTime = document.createElement('div');
                    cardTime.className = 'note-timestamp';
                    card.appendChild(cardTime);
                }
                const targetTimeText = `上次編輯：${formatTimeWithDay(timeText)}`;
                if (cardTime.innerText !== targetTimeText) {
                    cardTime.innerText = targetTimeText;
                }

                // 核心發光邏輯：狀態未變更時絕對不觸動 classList 與 animation-delay
                const currentlyGlowing = card.classList.contains('reminder-glowing');
                if (currentlyGlowing !== isGlowing) {
                    if (isGlowing) {
                        const period = 4.2;
                        const offset = ((Date.now() / 1000) % period).toFixed(3);
                        card.style.animationDelay = `-${offset}s`;
                        card.classList.add('reminder-glowing');
                    } else {
                        card.classList.remove('reminder-glowing');
                        card.style.animationDelay = '';
                    }
                }

                card.onclick = () => window.openEditor(key);
                card.oncontextmenu = (e) => window.showContextMenu(e, 'note', key, card);
            } else {
                // 僅在卡片節點不存在時進行首次建立
                card = document.createElement('div');
                card.className = 'note-card glass-effect';
                card.dataset.id = key;
                card.onclick = () => window.openEditor(key);
                card.oncontextmenu = (e) => window.showContextMenu(e, 'note', key, card);

                const titleElement = document.createElement('div');
                titleElement.className = 'note-title';
                titleElement.innerText = noteData.isThemed ? (noteData.title || '未命名主題') : noteDate;
                card.appendChild(titleElement);

                const timeElement = document.createElement('div');
                timeElement.className = 'note-timestamp';
                timeElement.innerText = `上次編輯：${formatTimeWithDay(timeText)}`;
                card.appendChild(timeElement);

                if (isGlowing) {
                    const period = 4.2;
                    const offset = ((Date.now() / 1000) % period).toFixed(3);
                    card.style.animationDelay = `-${offset}s`;
                    card.classList.add('reminder-glowing');
                }

                grid.insertBefore(card, nextCardChild);
            }

            nextCardChild = card.nextElementSibling;
        });
    });

    updateChapterNav(navItems);

    const searchInput = document.getElementById('main-search-input');
    if (searchInput && searchInput.value && typeof window.handleSearch === 'function') {
        window.handleSearch();
    }
}

// ==========================================
// 章節導航條（筆記分頁專用）：取代傳統捲軸的月份快速跳轉
// ==========================================
export function updateChapterNav(items) {
    const rail = document.getElementById('chapter-nav-rail');
    const popover = document.getElementById('chapter-popover');
    const ticksContainer = rail ? rail.querySelector('.chapter-nav-ticks') : null;
    
    if (!rail || !popover) return;

    if (!items || items.length === 0) {
        hideChapterNav();
        return;
    }

    rail.style.display = 'flex';
    popover.innerHTML = '';
    
    if (ticksContainer) ticksContainer.innerHTML = '';

    // 動態密度控制：最多顯示 20 個刻度，避免刻度線黏在一起
    const maxTicks = 20;
    const step = items.length > maxTicks ? Math.ceil(items.length / maxTicks) : 1;

    items.forEach((item, index) => {
        if (ticksContainer && (index % step === 0 || index === items.length - 1)) {
            const tick = document.createElement('span');
            tick.className = 'chapter-tick';
            tick.dataset.index = index;
            ticksContainer.appendChild(tick);
        }

        const popoverItem = document.createElement('div');
        popoverItem.className = 'chapter-item';
        popoverItem.innerText = item.label;
        popoverItem.dataset.index = index;
        popoverItem.onclick = (e) => {
            e.stopPropagation();
            window.scrollToChapterTarget(item.targetDOM);
        };
        popover.appendChild(popoverItem);
    });

    if (window.initChapterScrollSpy) {
        window.initChapterScrollSpy(items);
    }
}

export function hideChapterNav() {
    const rail = document.getElementById('chapter-nav-rail');
    const popover = document.getElementById('chapter-popover');
    if (rail) { rail.style.display = 'none'; rail.classList.remove('active'); }
    if (popover) { popover.classList.remove('active'); popover.innerHTML = ''; }
}

export function renderBookmarks() {
    if (!state.currentCategory) return;
    hideChapterNav();

    const titleEl = document.getElementById('current-main-title');
    titleEl.innerText = state.currentCategory;
    titleEl.style.cursor = '';
    titleEl.onclick = null;
    
    // 隱藏年份選擇按鈕
    const yearBtn = document.getElementById('year-select-btn');
    if (yearBtn) yearBtn.style.display = 'none';
    
    document.querySelector('.sort-wrapper').style.display = 'none'; 
    
    const renameBtn = document.getElementById('rename-category-btn');
    if (renameBtn) {
        renameBtn.style.display = state.currentCategory !== '未分類' ? 'flex' : 'none';
    }
    
    const container = document.getElementById('content-container');
    container.innerHTML = '';
    
    const categoryBookmarks = [];
    Object.keys(state.bookmarks).forEach(id => {
        const bm = state.bookmarks[id];
        const cat = bm.category || '未分類';
        if (cat === state.currentCategory) categoryBookmarks.push({ id, ...bm });
    });
    
    if (categoryBookmarks.length === 0) {
        container.appendChild(createEmptyStateDOM());
        updateChapterNav([]);
        window.clearSearch();
        return;
    }

    const grid = document.createElement('div');
    grid.className = 'note-grid';
    grid.dataset.category = state.currentCategory;
    categoryBookmarks.sort((a, b) => (a.order || 0) - (b.order || 0));

    // [修正] 預先宣告 navItems 陣列
    const navItems = [];

    categoryBookmarks.forEach(bm => {
        const card = document.createElement('div');
        card.className = 'note-card glass-effect';
        card.dataset.id = bm.id;
        card.onclick = () => window.openBookmarkEditor(bm.id);
        card.oncontextmenu = (e) => window.showContextMenu(e, 'bookmark', bm.id, card);

        const isCustom = !!bm.isCustomRecord || (!bm.url && !!bm.content);

        const embed = document.createElement('div');
        embed.className = 'discord-embed';

        if (!isCustom && bm.url) {
            const provider = document.createElement('div');
            provider.className = 'embed-provider';
            try {
                provider.innerText = new URL(bm.url).hostname;
            } catch(e) {
                provider.innerText = '網站連結';
            }
            embed.appendChild(provider);

            const titleEl = document.createElement('a');
            titleEl.className = 'embed-title';
            titleEl.href = bm.url;
            titleEl.target = '_blank';
            titleEl.innerText = bm.title || bm.url;
            titleEl.onclick = (e) => e.stopPropagation();
            embed.appendChild(titleEl);
        } else {
            const provider = document.createElement('div');
            provider.className = 'embed-provider';
            provider.innerText = bm.category || '未分類';
            embed.appendChild(provider);

            const titleEl = document.createElement('div');
            titleEl.className = 'embed-title custom-record-title';
            titleEl.style.color = 'var(--primary)';
            titleEl.innerText = bm.title || '未命名資料';
            embed.appendChild(titleEl);
        }

        const descEl = document.createElement('div');
        descEl.className = 'card-description';
        if (bm.description && bm.description.trim() !== '') {
            descEl.innerText = bm.description;
            descEl.style.opacity = '';
        } else {
            descEl.innerText = '無備註';
            descEl.style.opacity = '0.4';
        }
        embed.appendChild(descEl);
        card.appendChild(embed);

        if (bm.timestamp) {
            const timeEl = document.createElement('div');
            timeEl.className = 'note-timestamp';
            timeEl.innerText = `上次編輯：${formatTimeWithDay(bm.timestamp)}`;
            card.appendChild(timeEl);
        }
        grid.appendChild(card);
        
        navItems.push({ label: bm.title || bm.url || '資料', targetDOM: card });
    });
    container.appendChild(grid);
    // [修正] 移除 Array.from 邏輯，改直接傳入組裝好的 navItems
    updateChapterNav(navItems);
    window.clearSearch();
}

export function renderQuotes() {
    hideChapterNav();
    const titleEl = document.getElementById('current-main-title');
    titleEl.innerText = '語錄';
    titleEl.style.cursor = '';
    titleEl.onclick = null;
    
    // 隱藏年份選擇按鈕
    const yearBtn = document.getElementById('year-select-btn');
    if (yearBtn) yearBtn.style.display = 'none';
    
    const renameBtn2 = document.getElementById('rename-category-btn');
    if (renameBtn2) renameBtn2.style.display = 'none';

    const container = document.getElementById('content-container');
    container.innerHTML = '';

    const quotesArr = Object.keys(state.quotes).map(id => ({ id, ...state.quotes[id] }));
    
    if (quotesArr.length === 0) {
        container.appendChild(createEmptyStateDOM());
        updateChapterNav([]);
        window.clearSearch();
        return;
    }

    container.innerHTML = '<div class="quotes-masonry" id="quotes-grid"></div>';
    const grid = document.getElementById('quotes-grid');
    
    quotesArr.sort((a, b) => {
        if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
        return b.id - a.id;
    });
    
    // [修正] 預先宣告 navItems 陣列
    const navItems = [];

    quotesArr.forEach(q => {
        const id = q.id;
        const card = document.createElement('div');
        card.className = 'quote-card glass-effect';
        card.dataset.id = id;
        card.onclick = () => window.openQuoteEditor(id);
        card.oncontextmenu = (e) => window.showContextMenu(e, 'quote', id, card);
        
        const mainText = document.createElement('div');
        mainText.className = 'main-text';
        mainText.textContent = q.text; 

        const footer = document.createElement('div');
        footer.className = 'footer';
        const authorSpan = document.createElement('span');
        authorSpan.textContent = `— ${q.sub || '佚名'}`; 
        footer.appendChild(authorSpan);

        const timestamp = document.createElement('div');
        timestamp.className = 'note-timestamp';
        timestamp.textContent = `上次編輯：${formatTimeWithDay(q.timestamp)}`; 

        card.appendChild(mainText);
        card.appendChild(footer);
        card.appendChild(timestamp);
        grid.appendChild(card);
        
        // [修正] 直接從資料物件的 text 讀取，避免依靠 DOM innerText
        navItems.push({ label: q.text || '語錄', targetDOM: card });
    });
    // [修正] 移除 Array.from 邏輯，改直接傳入組裝好的 navItems
    updateChapterNav(navItems);
    window.clearSearch();
}

export function renderExistingCategories() {
    const container = document.getElementById('modal-category-list');
    container.innerHTML = '';
    const cats = new Set();
    
    Object.values(state.bookmarks).forEach(bm => {
        if (bm.category && bm.category.trim() !== '' && bm.category !== '未分類') cats.add(bm.category);
    });
    
    if (cats.size === 0) {
        container.innerHTML = '<div style="color: var(--text-secondary); font-size: 14px; width: 100%; text-align: center; padding: 20px 0;">目前沒有已建立的分類</div>';
        return;
    }

    let savedCatOrder = safeJSONParse(localStorage.getItem('my_category_order'), []);
    const sortedCats = Array.from(cats).sort((a, b) => {
        let idxA = savedCatOrder.indexOf(a);
        let idxB = savedCatOrder.indexOf(b);
        if (idxA === -1 && idxB === -1) return a.localeCompare(b);
        if (idxA === -1) return 1; 
        if (idxB === -1) return -1;
        return idxA - idxB;
    });

    sortedCats.forEach(cat => {
        const item = document.createElement('div');
        item.className = 'chapter-item';
        if (cat === state.currentCategory) item.classList.add('active');
        item.style.textAlign = 'center';
        item.innerText = cat;
        item.onclick = () => { 
            document.getElementById('bookmark-category').value = cat; 
            window.closeCategoryModal();
        };
        container.appendChild(item);
    });
}

export function renderCalendar() {
    const year = state.calDate.getFullYear();
    const month = state.calDate.getMonth();
    document.getElementById('cal-month-year').innerText = `${year}年 ${month + 1}月`;
    
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysGrid = document.getElementById('cal-days');
    daysGrid.innerHTML = '';
    
    const selectedVal = document.getElementById('note-date-val').value;
    for(let i = 0; i < firstDay; i++) daysGrid.appendChild(document.createElement('div'));

    for(let i = 1; i <= daysInMonth; i++) {
        const dayCell = document.createElement('div');
        dayCell.className = 'cal-day-cell';
        dayCell.innerText = i;
        
        const cellDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        if (cellDateStr === selectedVal) dayCell.classList.add('selected');

        dayCell.onclick = (e) => {
            e.stopPropagation();
            window.selectDate(year, month + 1, i);
        };
        daysGrid.appendChild(dayCell);
    }
}

export function renderQuoteSortList() {
    const cardContainer = document.getElementById('sort-card-container');
    cardContainer.innerHTML = '';
    const dragIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>`;

    const quotesArr = Object.keys(state.quotes).map(id => ({ id, ...state.quotes[id] }));
    quotesArr.sort((a, b) => {
        if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
        return b.id - a.id;
    }).forEach(q => {
        const item = document.createElement('div');
        item.className = 'sort-list-item';
        item.dataset.id = q.id;

        const dragHandle = document.createElement('span');
        dragHandle.className = 'drag-handle';
        dragHandle.innerHTML = dragIcon; 

        const infoDiv = document.createElement('div');
        infoDiv.style.display = 'flex';
        infoDiv.style.flexDirection = 'column';
        infoDiv.style.overflow = 'hidden';

        const titleSpan = document.createElement('span');
        titleSpan.style.whiteSpace = 'nowrap';
        titleSpan.style.overflow = 'hidden';
        titleSpan.style.textOverflow = 'ellipsis';
        titleSpan.style.fontWeight = '600';
        titleSpan.textContent = q.text;

        const subSpan = document.createElement('span');
        subSpan.style.fontSize = '12px';
        subSpan.style.opacity = '0.6';
        subSpan.textContent = q.sub || '佚名';

        infoDiv.appendChild(titleSpan);
        infoDiv.appendChild(subSpan);
        item.appendChild(dragHandle);
        item.appendChild(infoDiv);
        cardContainer.appendChild(item);
    });
}

export function renderBookmarkSortLists() {
    const catContainer = document.getElementById('sort-category-container');
    const cardContainer = document.getElementById('sort-card-container');
    catContainer.innerHTML = '';
    cardContainer.innerHTML = '';
    
    const dragIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>`;
    
    const groupedBookmarks = {};
    Object.keys(state.bookmarks).forEach(id => {
        const bm = state.bookmarks[id];
        const cat = bm.category || '未分類';
        if (!groupedBookmarks[cat]) groupedBookmarks[cat] = [];
        groupedBookmarks[cat].push({ id, ...bm });
    });
    
    let savedCatOrder = safeJSONParse(localStorage.getItem('my_category_order'), []);
    const sortedCategories = Object.keys(groupedBookmarks).sort((a, b) => {
        if (a === '未分類') return -1;
        if (b === '未分類') return 1;
        let idxA = savedCatOrder.indexOf(a);
        let idxB = savedCatOrder.indexOf(b);
        if (idxA === -1 && idxB === -1) return a.localeCompare(b);
        if (idxA === -1) return -1; 
        if (idxB === -1) return 1;
        return idxA - idxB;
    });
    
    sortedCategories.forEach(cat => {
        if (cat === '未分類') return; 
        const item = document.createElement('div');
        item.className = 'sort-list-item';
        item.dataset.category = cat;

        const dragHandle = document.createElement('span');
        dragHandle.className = 'drag-handle';
        dragHandle.innerHTML = dragIcon;

        const catSpan = document.createElement('span');
        catSpan.style.fontWeight = '600';
        catSpan.textContent = cat;

        item.appendChild(dragHandle);
        item.appendChild(catSpan);
        catContainer.appendChild(item);
    });
    
    sortedCategories.forEach(cat => {
        if (cat !== state.currentCategory) return; 

        groupedBookmarks[cat].sort((a, b) => (a.order || 0) - (b.order || 0)).forEach(card => {
            const item = document.createElement('div');
            item.className = 'sort-list-item';
            item.dataset.id = card.id || Date.now().toString();
            item.dataset.category = cat; 

            const dragHandle = document.createElement('span');
            dragHandle.className = 'drag-handle';
            dragHandle.innerHTML = dragIcon;

            const titleSpan = document.createElement('span');
            titleSpan.style.whiteSpace = 'nowrap';
            titleSpan.style.overflow = 'hidden';
            titleSpan.style.textOverflow = 'ellipsis';
            titleSpan.style.fontWeight = '600';
            titleSpan.textContent = card.title || card.url;

            item.appendChild(dragHandle);
            item.appendChild(titleSpan);
            cardContainer.appendChild(item);
        });
    });
}
