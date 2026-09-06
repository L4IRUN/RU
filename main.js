// main.js
// 職責：應用程式入口，負責啟動系統、載入資料（含墓碑紀錄）、初始化設定、背景輪詢啟動與串接所有模組

import { state } from './state.js';
import { 
    renderSidebar, 
    updateThemeSegment, 
    updateVisualEffectsSegment,
    updateSortIcon,
    initClocks 
} from './ui.js';
import { 
    initGlobalInteractions, 
    initSortableLists, 
    selectYear, 
    selectCategory,
    switchTimeTab,
    getDefaultTimeTab,
    resetFabIdleTimer
} from './interaction.js';
import { StorageAPI, safeJSONParse } from './storage.js';
import { downloadFromGist, startCloudPolling } from './sync.js'; 

async function initApp() {
    const savedDarkMode = localStorage.getItem('dark_mode');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDarkMode = savedDarkMode !== null ? savedDarkMode === 'true' : prefersDark;

    const themeMeta = document.getElementById('theme-color-meta');
    if (isDarkMode) {
        document.body.setAttribute('data-theme', 'dark');
        if (themeMeta) themeMeta.setAttribute('content', '#121212');
    } else {
        document.body.removeAttribute('data-theme');
        if (themeMeta) themeMeta.setAttribute('content', '#F7F3E8');
    }

    if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            if (localStorage.getItem('dark_mode') === null) {
                const currentSystemDark = e.matches;
                const meta = document.getElementById('theme-color-meta');
                if (currentSystemDark) {
                    document.body.setAttribute('data-theme', 'dark');
                    if (meta) meta.setAttribute('content', '#121212');
                } else {
                    document.body.removeAttribute('data-theme');
                    if (meta) meta.setAttribute('content', '#F7F3E8');
                }
                updateThemeSegment(currentSystemDark);
            }
        });
    }

    // 視覺效果開關：改為正向邏輯儲存於 localStorage（visual_effects: 'true'/'false'），
    // 未曾設定過時預設為開啟（true）。若偵測到舊版的 no_glass 設定，
    // 自動轉換一次並移除舊 key，避免既有使用者的設定被重置。
    if (localStorage.getItem('visual_effects') === null && localStorage.getItem('no_glass') !== null) {
        const wasGlassOff = localStorage.getItem('no_glass') === 'true';
        localStorage.setItem('visual_effects', wasGlassOff ? 'false' : 'true');
        localStorage.removeItem('no_glass');
    }
    const storedVisualEffects = localStorage.getItem('visual_effects');
    const isVisualEffectsOn = storedVisualEffects === null ? true : storedVisualEffects === 'true';
    if (!isVisualEffectsOn) {
        document.body.setAttribute('data-no-glass', 'true');
    }

    // 載入筆記排序偏好設定
    const savedSortOrder = localStorage.getItem('note_sort_order');
    if (savedSortOrder === 'oldest' || savedSortOrder === 'newest') {
        state.sortOrder = savedSortOrder;
    }

    updateThemeSegment(isDarkMode);
    updateVisualEffectsSegment(isVisualEffectsOn);
    updateSortIcon();

    try {
        state.notes = await StorageAPI.loadAll('notes', 'my_notes') || {};
        state.bookmarks = await StorageAPI.loadAll('bookmarks', 'my_bookmarks') || {};
        state.quotes = await StorageAPI.loadAll('quotes', 'my_quotes') || {};

        // 載入本地刪除墓碑追蹤紀錄（Tombstones）
        state.deletedRecords = {
            notes: await StorageAPI.loadAll('deleted_notes') || {},
            bookmarks: await StorageAPI.loadAll('deleted_bookmarks') || {},
            quotes: await StorageAPI.loadAll('deleted_quotes') || {}
        };
    } catch (error) {
        console.error('資料庫載入失敗:', error);
    }

    switchTimeTab(getDefaultTimeTab(), true);
    
    const years = new Set();
    Object.keys(state.notes).forEach(date => years.add(date.split('-')[0]));
    const sortedYears = Array.from(years).sort((a, b) => b - a);
    
    if (sortedYears.length > 0 && !years.has(state.currentYear)) {
        state.currentYear = sortedYears[0];
    }
    
    const cats = new Set();
    Object.values(state.bookmarks).forEach(bm => {
        if (bm.category && bm.category !== '未分類') cats.add(bm.category);
    });

    if (cats.size > 0 && !state.currentCategory) {
        let savedCatOrder = safeJSONParse(localStorage.getItem('my_category_order'), []);
        const sortedCats = Array.from(cats).sort((a, b) => {
            let idxA = savedCatOrder.indexOf(a);
            let idxB = savedCatOrder.indexOf(b);
            if (idxA === -1 && idxB === -1) return a.localeCompare(b);
            if (idxA === -1) return 1;
            if (idxB === -1) return -1;
            return idxA - idxB;
        });
        state.currentCategory = sortedCats[0];
    } else if (!state.currentCategory) {
        state.currentCategory = '未分類';
    }

    renderSidebar();
    
    if (state.currentView === 'notes') {
        selectYear(state.currentYear);
    } else if (state.currentView === 'bookmarks') {
        selectCategory(state.currentCategory);
    }

    initGlobalInteractions();
    initSortableLists();
    resetFabIdleTimer(); // 啟動 FAB 閒置計時器

    initClocks(); // 啟動右上角時鐘與連線時間計時

    if (localStorage.getItem('github_token') && localStorage.getItem('gist_id')) {
        downloadFromGist(true);
        startCloudPolling(); // 啟動背景輕量輪詢與可見度監聽
    } else {
        // 未設定 Token 或 Gist ID，即刻點亮紅色警示燈，消滅「未配置卻顯示正常綠燈」的認知漏洞
        const statusDot = document.querySelector('.system-time-container .time-row .status-dot');
        if (statusDot) {
            statusDot.classList.remove('primary');
            statusDot.classList.add('red');
        }
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}