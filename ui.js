// ui.js
// 職責：處理所有的畫面渲染、DOM 更新與 UI 狀態切換

import { state } from './state.js';
import { safeJSONParse, stripDangerousHtml, sanitizeUrl } from './storage.js';

// ==========================================
// 工具與格式化函式
// ==========================================
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

export function getTextWidth(text, font) {
    const canvas = getTextWidth.canvas || (getTextWidth.canvas = document.createElement("canvas"));
    const context = canvas.getContext("2d");
    context.font = font;
    return context.measureText(text).width;
}

// 純文字（標題等）插入 innerHTML 前的 HTML 跳脫，避免輸入 < > & 造成版面錯亂或注入
function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function updateReminderPreviewDisplay() {
    const rDateText = document.getElementById('reminder-date-text');
    const rDateVal = document.getElementById('reminder-date-val');
    const rStartDateVal = document.getElementById('reminder-start-date-val');
    const rEndDateVal = document.getElementById('reminder-end-date-val');

    if (rDateText) {
        let sDate = (rStartDateVal && rStartDateVal.value.trim()) || state.tempSelectedReminderStartDate;
        let eDate = (rEndDateVal && rEndDateVal.value.trim()) || state.tempSelectedReminderEndDate || sDate;
        const rawDate = rDateVal ? rDateVal.value.trim() : '';

        if (!sDate && rawDate) {
            const dateMatches = rawDate.match(/\d{4}-\d{2}-\d{2}/g);
            if (dateMatches && dateMatches.length > 0) {
                sDate = dateMatches[0];
                eDate = dateMatches[1] || dateMatches[0];
            }
        }

        const days = ['日', '一', '二', '三', '四', '五', '六'];
        const getWeekday = (dStr) => {
            if (!dStr) return '';
            const parts = dStr.split('-');
            if (parts.length !== 3) return '';
            const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
            return isNaN(d.getTime()) ? '' : `(${days[d.getDay()]})`;
        };

        const formatSegmentHtml = (dStr, tStr, wStr) => {
            let html = `<span class="reminder-date-val">${dStr}</span>`;
            if (tStr) html += `<span class="reminder-time-val">${tStr}</span>`;
            if (wStr) html += `<span class="reminder-weekday-val">${wStr}</span>`;
            return html;
        };

        const parseAndFormatFallback = (str) => {
            if (!str) return '';
            const dateMatch = str.match(/\d{4}-\d{2}-\d{2}/);
            const timeMatch = str.match(/\d{1,2}:\d{2}/);
            const weekdayMatch = str.match(/\([日一二三四五六]\)/);
            const d = dateMatch ? dateMatch[0] : str;
            const t = timeMatch ? timeMatch[0] : '';
            const w = weekdayMatch ? weekdayMatch[0] : '';
            return formatSegmentHtml(d, t, w);
        };

        const hasTime = state.isReminderStartTimeAdjusted || state.isReminderEndTimeAdjusted;
        let isRange = false;
        let startText = '';
        let endText = '';
        let singleText = '';

        if (sDate && eDate) {
            const actualStart = sDate <= eDate ? sDate : eDate;
            const actualEnd = sDate <= eDate ? eDate : sDate;
            const startW = getWeekday(actualStart);
            const endW = getWeekday(actualEnd);

            if (hasTime) {
                isRange = true;
                const sh = String(state.timeWheelStartHour).padStart(2, '0');
                const sm = String(state.timeWheelStartMinute).padStart(2, '0');
                const eh = String(state.timeWheelEndHour).padStart(2, '0');
                const em = String(state.timeWheelEndMinute).padStart(2, '0');
                startText = formatSegmentHtml(actualStart, `${sh}:${sm}`, startW);
                endText = formatSegmentHtml(actualEnd, `${eh}:${em}`, endW);
            } else if (actualStart !== actualEnd) {
                isRange = true;
                startText = formatSegmentHtml(actualStart, '', startW);
                endText = formatSegmentHtml(actualEnd, '', endW);
            } else {
                isRange = false;
                singleText = formatSegmentHtml(actualStart, '', startW);
            }
        } else if (rawDate) {
            if (rawDate.includes('~')) {
                isRange = true;
                const sides = rawDate.split('~').map(s => s.trim());
                startText = parseAndFormatFallback(sides[0]);
                let rightSide = sides[1] || '';
                if (rightSide && !rightSide.match(/\d{4}-\d{2}-\d{2}/) && sides[0].match(/\d{4}-\d{2}-\d{2}/)) {
                    const matchDate = sides[0].match(/\d{4}-\d{2}-\d{2}/)[0];
                    rightSide = `${matchDate} ${rightSide}`;
                }
                endText = parseAndFormatFallback(rightSide);
            } else {
                isRange = false;
                singleText = parseAndFormatFallback(rawDate);
            }
        }

        if (isRange && startText && endText) {
            rDateText.innerHTML = `
                <div class="reminder-date-range-container">
                    <div class="reminder-date-row start-row">${startText}</div>
                    <div class="reminder-date-divider"></div>
                    <div class="reminder-date-row end-row">${endText}</div>
                </div>
            `;
        } else if (singleText) {
            rDateText.innerHTML = `<div class="reminder-date-single">${singleText}</div>`;
        } else {
            rDateText.innerHTML = `<div class="reminder-date-single placeholder">選擇提醒日期</div>`;
        }
    }

    const rContent = document.getElementById('reminder-content');
    if (!rContent) return;
    const title = (state.tempReminderTitle || '').trim();
    const content = state.tempReminderContent || '';
    const cleanContent = content.replace(/<br\s*[\/]?>/gi, '').replace(/<div>\s*<\/div>/gi, '').trim();

    const safeContent = stripDangerousHtml(cleanContent ? content : '');
    rContent.innerHTML = `
        <div class="reminder-preview-title ${!title ? 'is-placeholder' : ''}">${escapeHtml(title) || '名稱'}</div>
        <div class="reminder-preview-divider"></div>
        <div class="reminder-preview-body ${!cleanContent ? 'is-placeholder' : ''}">${cleanContent ? safeContent : '輸入提醒事項...'}</div>
    `;
}

export function updateBookmarkPreviewDisplay() {
    const bContent = document.getElementById('bookmark-content');
    if (!bContent) return;
    const title = (state.tempBookmarkTitle || (document.getElementById('bookmark-title') ? document.getElementById('bookmark-title').value : '') || '').trim();
    const content = state.tempBookmarkContent || '';
    const cleanContent = content.replace(/<br\s*[\/]?>/gi, '').replace(/<div>\s*<\/div>/gi, '').trim();

    const safeContent = stripDangerousHtml(cleanContent ? content : '');
    bContent.innerHTML = `
        <div class="reminder-preview-title ${!title ? 'is-placeholder' : ''}">${escapeHtml(title) || '名稱'}</div>
        <div class="reminder-preview-divider"></div>
        <div class="reminder-preview-body ${!cleanContent ? 'is-placeholder' : ''}">${cleanContent ? safeContent : '輸入內容...'}</div>
    `;
}

export function getReminderTargetTimestamp(input) {
    if (!input) return 0;

    let dateStr = '';
    let itemEndDate = '';
    let itemEndTime = '';
    let itemStartDate = '';
    let itemStartTime = '';

    if (typeof input === 'object') {
        dateStr = input.date || '';
        itemEndDate = input.endDate || '';
        itemEndTime = input.endTime || '';
        itemStartDate = input.startDate || '';
        itemStartTime = input.startTime || '';
    } else if (typeof input === 'string') {
        dateStr = input;
    }

    if (itemEndDate) {
        const parts = itemEndDate.split('-');
        if (parts.length === 3) {
            const year = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10) - 1;
            const day = parseInt(parts[2], 10);
            if (itemEndTime && itemEndTime.includes(':')) {
                const [hh, mm] = itemEndTime.split(':').map(n => parseInt(n, 10));
                return new Date(year, month, day, hh || 0, mm || 0, 0, 0).getTime();
            } else if (itemStartTime && itemStartDate === itemEndDate && itemStartTime.includes(':')) {
                const [hh, mm] = itemStartTime.split(':').map(n => parseInt(n, 10));
                return new Date(year, month, day, hh || 0, mm || 0, 0, 0).getTime();
            }
            return new Date(year, month, day, 23, 59, 59, 999).getTime();
        }
    }

    if (!dateStr) return 0;

    const clean = dateStr.replace(/\([日一二三四五六]\)/g, '').trim();

    if (clean.includes('~')) {
        const sides = clean.split('~').map(s => s.trim());
        const left = sides[0] || '';
        const right = sides[1] || '';

        const leftDateMatch = left.match(/(\d{4}-\d{2}-\d{2})/);
        const leftTimeMatch = left.match(/(\d{1,2}:\d{2})/);

        const rightDateMatch = right.match(/(\d{4}-\d{2}-\d{2})/);
        const rightTimeMatch = right.match(/(\d{1,2}:\d{2})/);

        const startDate = leftDateMatch ? leftDateMatch[1] : '';
        const endDate = rightDateMatch ? rightDateMatch[1] : startDate;
        const endTime = rightTimeMatch ? rightTimeMatch[1] : '';

        if (endDate) {
            const parts = endDate.split('-');
            if (parts.length === 3) {
                const y = parseInt(parts[0], 10);
                const m = parseInt(parts[1], 10) - 1;
                const d = parseInt(parts[2], 10);
                if (endTime && endTime.includes(':')) {
                    const [hh, mm] = endTime.split(':').map(n => parseInt(n, 10));
                    return new Date(y, m, d, hh || 0, mm || 0, 0, 0).getTime();
                } else if (!rightTimeMatch && leftTimeMatch && startDate === endDate) {
                    const [hh, mm] = leftTimeMatch[1].split(':').map(n => parseInt(n, 10));
                    return new Date(y, m, d, hh || 0, mm || 0, 0, 0).getTime();
                }
                return new Date(y, m, d, 23, 59, 59, 999).getTime();
            }
        }
    }

    const dateMatch = clean.match(/(\d{4}-\d{2}-\d{2})/);
    const timeMatch = clean.match(/(\d{1,2}:\d{2})/);

    if (dateMatch) {
        const parts = dateMatch[1].split('-');
        if (parts.length === 3) {
            const y = parseInt(parts[0], 10);
            const m = parseInt(parts[1], 10) - 1;
            const d = parseInt(parts[2], 10);
            if (timeMatch && timeMatch[1].includes(':')) {
                const [hh, mm] = timeMatch[1].split(':').map(n => parseInt(n, 10));
                return new Date(y, m, d, hh || 0, mm || 0, 0, 0).getTime();
            }
            return new Date(y, m, d, 23, 59, 59, 999).getTime();
        }
    }

    return 0;
}

export function isTransitionCategory(cat) {
    return cat === '新增內容' || cat === '新增網址' || cat === '新增資料' || cat === '新增分類';
}

export function isReminderCardGlowing(dateStr, isDone = false) {
    if (isDone || !dateStr) return false;
    const targetTime = getReminderTargetTimestamp(dateStr);
    if (!targetTime) return false;

    const now = Date.now();
    const diffMs = targetTime - now;
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;

    return diffMs > 0 && diffMs <= ONE_DAY_MS;
}

// ==========================================
// UI 狀態更新函式
// ==========================================
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

export function updateSelectionBarUI() {
    const bar = document.getElementById('selection-bottom-bar');
    const countEl = document.getElementById('selection-count');
    const deleteBtn = document.getElementById('selection-delete-btn');
    const moveBtn = document.getElementById('selection-move-btn');
    const selectModeBtn = document.getElementById('reminder-select-btn');

    const isBookmarks = state.currentView === 'bookmarks';
    const subCatCount = state.selectedSubCategories ? state.selectedSubCategories.size : 0;
    const bookmarkCardCount = state.selectedBookmarkIds ? state.selectedBookmarkIds.size : 0;
    const reminderCardCount = state.selectedReminderIds ? state.selectedReminderIds.size : 0;

    if (bar) {
        if (state.isSelectionMode) {
            bar.classList.add('active');
        } else {
            bar.classList.remove('active');
        }
    }

    if (countEl) {
        if (isBookmarks) {
            if (subCatCount > 0) {
                countEl.textContent = `已選取 ${subCatCount} 項子分類`;
            } else if (bookmarkCardCount > 0) {
                countEl.textContent = `已選取 ${bookmarkCardCount} 項卡片`;
            } else {
                countEl.textContent = '已選取 0 項';
            }
        } else {
            countEl.textContent = `已選取 ${reminderCardCount} 項`;
        }
    }

    if (deleteBtn) {
        if (isBookmarks) {
            deleteBtn.disabled = bookmarkCardCount === 0 && subCatCount === 0;
        } else {
            deleteBtn.disabled = reminderCardCount === 0;
        }
    }

    if (moveBtn) {
        if (isBookmarks) {
            moveBtn.style.display = 'inline-flex';
            moveBtn.disabled = subCatCount === 0 && bookmarkCardCount === 0;
        } else {
            moveBtn.style.display = 'none';
            moveBtn.disabled = true;
        }
    }

    if (selectModeBtn) {
        selectModeBtn.classList.toggle('active', !!state.isSelectionMode);
    }
}

// 電腦版原版 Toast 動態時序常數
const TOAST_DROP_MS = 400;       // 對應 #cloud-toast 的 transform 下拉過渡
const TOAST_EXPAND_MS = 300;     // 對應 #cloud-toast 的 width 展開過渡
const TOAST_TEXT_FADE_MS = 200;  // 對應 #cloud-toast-text 的 opacity 淡入淡出
const TOAST_HOLD_MS = 2000;      // 停留顯示時長

// 手機版按鈕膠囊動態時序常數
const MOBILE_ICON_ZOOM_OUT_MS = 240; // 加號放大再縮小隱藏耗時
const MOBILE_EXPAND_MS = 320;        // 膠囊寬度展開耗時
const MOBILE_FADE_MS = 180;          // 文字淡出耗時
const MOBILE_ICON_ZOOM_IN_MS = 280;  // 加號放大再縮回原大小耗時

let desktopToastTimers = [];
let mobileToastTimers = [];
let isDesktopToastShowing = false;
let isMobileToastShowing = false;
let isMobileToastDismissing = false;
let currentDesktopClickHandler = null;
let currentMobileClickHandler = null;

function clearDesktopTimers() {
    desktopToastTimers.forEach(clearTimeout);
    desktopToastTimers = [];
}

function clearMobileTimers() {
    mobileToastTimers.forEach(clearTimeout);
    mobileToastTimers = [];
}

export function getToastState() {
    return {
        isToastShowing: isDesktopToastShowing || isMobileToastShowing || isMobileToastDismissing,
        isMobileToastShowing,
        isMobileToastDismissing,
        currentToastClickHandler: currentMobileClickHandler || currentDesktopClickHandler
    };
}

/**
 * 顯示通知膠囊（依螢幕寬度自動分流：電腦版採用原版下拉膠囊，手機版採用按鈕變形）
 */
export function showCloudToast(message, options = {}) {
    const isDesktop = state._cachedInnerWidth > 768;
    const persistent = typeof options === 'object' ? !!options.persistent : false;
    const onClick = typeof options === 'object' && typeof options.onClick === 'function' ? options.onClick : null;

    if (isDesktop) {
        showDesktopOriginalToast(message, persistent, onClick);
    } else {
        showMobileFabToast(message, persistent, onClick);
    }
}

/**
 * 電腦版：完全還原原版右上角圓形下落、展開寬度、文字浮現之經典膠囊
 */
function showDesktopOriginalToast(message, persistent, onClick) {
    const toast = document.getElementById('cloud-toast');
    const textSpan = document.getElementById('cloud-toast-text');
    if (!toast || !textSpan) return;

    const iconWrapper = toast.querySelector('.toast-icon-wrapper');
    if (iconWrapper) iconWrapper.style.display = 'none';

    clearDesktopTimers();

    if (currentDesktopClickHandler) {
        toast.removeEventListener('click', currentDesktopClickHandler);
        currentDesktopClickHandler = null;
    }
    toast.style.cursor = '';

    if (onClick) {
        toast.style.cursor = 'pointer';
        currentDesktopClickHandler = (e) => {
            e.stopPropagation();
            onClick(e);
        };
        toast.addEventListener('click', currentDesktopClickHandler);
    }

    textSpan.style.opacity = '0';

    const expandAndReveal = () => {
        textSpan.innerText = message;
        const computedStyle = window.getComputedStyle(textSpan);
        const fontStyle = computedStyle.font || `${computedStyle.fontWeight} ${computedStyle.fontSize} ${computedStyle.fontFamily}`;
        const textWidth = getTextWidth(message, fontStyle);
        const totalWidth = Math.max(Math.ceil(textWidth) + 48, 52);

        toast.style.width = `${totalWidth}px`;
        toast.classList.add('expand');

        desktopToastTimers.push(setTimeout(() => {
            textSpan.style.opacity = '1';
            if (!persistent) {
                desktopToastTimers.push(setTimeout(hideDesktopToast, TOAST_HOLD_MS));
            }
        }, TOAST_EXPAND_MS));
    };

    if (isDesktopToastShowing) {
        toast.classList.remove('expand');
        toast.style.width = '52px';
        desktopToastTimers.push(setTimeout(expandAndReveal, TOAST_TEXT_FADE_MS));
    } else {
        isDesktopToastShowing = true;
        toast.style.width = '52px';
        toast.classList.add('drop');
        desktopToastTimers.push(setTimeout(expandAndReveal, TOAST_DROP_MS));
    }
}

/**
 * 電腦版：收合並滑出頂部
 */
function hideDesktopToast() {
    const toast = document.getElementById('cloud-toast');
    const textSpan = document.getElementById('cloud-toast-text');
    if (!toast || !textSpan) return;

    clearDesktopTimers();

    if (currentDesktopClickHandler) {
        toast.removeEventListener('click', currentDesktopClickHandler);
        currentDesktopClickHandler = null;
    }
    toast.style.cursor = '';

    textSpan.style.opacity = '0';

    desktopToastTimers.push(setTimeout(() => {
        toast.classList.remove('expand');
        toast.style.width = '52px';

        desktopToastTimers.push(setTimeout(() => {
            toast.classList.remove('drop');

            desktopToastTimers.push(setTimeout(() => {
                toast.style.width = '';
                isDesktopToastShowing = false;
            }, TOAST_DROP_MS));
        }, TOAST_EXPAND_MS));
    }, TOAST_TEXT_FADE_MS));
}

/**
 * 手機版：加號等比放大再縮小隱藏 -> 按鈕展開顯示通知 -> 消失後縮回圓形 -> 加號等比放大再縮回原大小
 */
function showMobileFabToast(message, persistent, onClick) {
    const fabBtn = document.getElementById('fab-main-btn') || document.querySelector('.fab-main-btn');
    const textEl = document.getElementById('fab-toast-text') || (fabBtn ? fabBtn.querySelector('.fab-toast-text') : null);
    if (!fabBtn || !textEl) return;

    clearMobileTimers();

    // 強制重置收合狀態機旗標，徹底杜絕快速打斷或清理時計時器遺留的鎖定
    isMobileToastDismissing = false;

    currentMobileClickHandler = onClick;
    fabBtn.style.cursor = onClick ? 'pointer' : '';

    const computedStyle = window.getComputedStyle(textEl);
    const fontStyle = computedStyle.font || `${computedStyle.fontWeight} ${computedStyle.fontSize} ${computedStyle.fontFamily}`;
    const textWidth = getTextWidth(message, fontStyle);
    const maxAvailableWidth = Math.max(160, state._cachedInnerWidth - 40);
    const targetWidth = Math.min(maxAvailableWidth, Math.max(Math.ceil(textWidth) + 44, 64));

    // 展開按鈕並淡入文字
    const expandAndReveal = () => {
        isMobileToastDismissing = false;
        textEl.textContent = message;
        fabBtn.classList.remove('icon-zoom-out', 'icon-zoom-in');
        fabBtn.classList.add('toast-mode');
        fabBtn.style.width = `${targetWidth}px`;

        mobileToastTimers.push(setTimeout(() => {
            textEl.style.opacity = '1';
            if (!persistent) {
                mobileToastTimers.push(setTimeout(hideMobileFabToast, TOAST_HOLD_MS));
            }
        }, MOBILE_EXPAND_MS));
    };

    if (isMobileToastShowing) {
        isMobileToastDismissing = false;
        textEl.style.opacity = '0';
        mobileToastTimers.push(setTimeout(() => {
            expandAndReveal();
        }, MOBILE_FADE_MS));
        return;
    }

    isMobileToastShowing = true;

    // 若按鈕正處於貼邊收納狀態，先彈回
    clearTimeout(state.fabIdleTimer);
    const wasTucked = state.isFabTucked || fabBtn.classList.contains('tucked');
    if (wasTucked) {
        state.isFabTucked = false;
        fabBtn.classList.remove('tucked');
    }

    // 階段 1：加號在原尺寸圓形中整體等比放大再縮小（按鈕保持正圓形，杜絕拉長變形）
    fabBtn.classList.remove('icon-zoom-in');
    fabBtn.classList.add('icon-zoom-out');

    mobileToastTimers.push(setTimeout(() => {
        expandAndReveal();
    }, MOBILE_ICON_ZOOM_OUT_MS));
}

function hideMobileFabToast(fastDismiss = false) {
    const fabBtn = document.getElementById('fab-main-btn') || document.querySelector('.fab-main-btn');
    const textEl = document.getElementById('fab-toast-text') || (fabBtn ? fabBtn.querySelector('.fab-toast-text') : null);
    if (!fabBtn || !textEl || (!isMobileToastShowing && !isMobileToastDismissing)) {
        isMobileToastShowing = false;
        isMobileToastDismissing = false;
        currentMobileClickHandler = null;
        return;
    }

    clearMobileTimers();
    fabBtn.style.cursor = '';

    if (fastDismiss) {
        fabBtn.style.width = '';
        fabBtn.classList.remove('toast-mode', 'icon-zoom-out', 'icon-zoom-in');
        textEl.style.opacity = '0';
        textEl.textContent = '';
        isMobileToastShowing = false;
        isMobileToastDismissing = false;
        currentMobileClickHandler = null;
        if (typeof window.resetFabIdleTimer === 'function') {
            window.resetFabIdleTimer();
        }
        return;
    }

    isMobileToastShowing = false;
    isMobileToastDismissing = true;

    // 階段 1：文字先淡出
    textEl.style.opacity = '0';

    mobileToastTimers.push(setTimeout(() => {
        // 階段 2：膠囊寬度平滑收回為 64px 圓形
        fabBtn.style.width = '';

        mobileToastTimers.push(setTimeout(() => {
            fabBtn.classList.remove('toast-mode');
            textEl.textContent = '';

            // 階段 3：在按鈕已完全復位為正圓形後，加號才進行整體等比放大並回彈復位
            fabBtn.classList.remove('icon-zoom-out');
            fabBtn.classList.add('icon-zoom-in');

            mobileToastTimers.push(setTimeout(() => {
                fabBtn.classList.remove('icon-zoom-in');
                isMobileToastDismissing = false;
                currentMobileClickHandler = null;
                if (typeof window.resetFabIdleTimer === 'function') {
                    window.resetFabIdleTimer();
                }
            }, MOBILE_ICON_ZOOM_IN_MS));
        }, MOBILE_EXPAND_MS));
    }, MOBILE_FADE_MS));
}

/**
 * 統一收合入口
 */
export function hideToast(fastDismiss = false) {
    hideDesktopToast();
    hideMobileFabToast(fastDismiss);
}

export function getGlobalReminderDelay() {
    const period = 4.2;
    const offset = ((Date.now() / 1000) % period).toFixed(3);
    return `-${offset}s`;
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
                titleEl.innerText = b.title || '未命名網址';
                titleEl.removeAttribute('href');
                titleEl.removeAttribute('target');
                titleEl.removeAttribute('rel');
                titleEl.style.color = 'var(--primary)';
                titleEl.classList.add('custom-record-title');
            } else {
                const safeUrl = sanitizeUrl(b.url);
                if (providerEl) {
                    try { providerEl.innerText = safeUrl ? new URL(safeUrl).hostname : '網站連結'; }
                    catch(e) { providerEl.innerText = '網站連結'; }
                }
                titleEl.innerText = b.title || b.url;
                titleEl.href = safeUrl || '#';
                titleEl.target = '_blank';
                titleEl.rel = 'noopener noreferrer';
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
    const appVersionDisplay = document.getElementById('app-version-display');

    if (appVersionDisplay) {
        appVersionDisplay.textContent = state.appVersion || '20261025';
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
    }

    setInterval(update, 1000);
    update(); 
}

// ==========================================
// 核心畫面渲染函式 (Renders)
// ==========================================
export function renderSidebar() {
    const remindersContainer = document.querySelector('.sidebar-reminders-container');
    if (remindersContainer) {
        remindersContainer.innerHTML = '';
        const reminderItem = document.createElement('div');
        reminderItem.className = `year-item ${state.currentView === 'reminders' ? 'active' : ''}`;
        reminderItem.id = 'nav-reminders-btn';
        reminderItem.onclick = () => {
            if (typeof window.handleSidebarRemindersClick === 'function') {
                window.handleSidebarRemindersClick(reminderItem);
            } else {
                window.selectRemindersView();
            }
        };

        const reminderIconSpan = document.createElement('span');
        reminderIconSpan.className = 'item-icon';
        reminderIconSpan.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="7" y1="9" x2="7" y2="15"></line>
                <line x1="12" y1="4" x2="12" y2="20"></line>
                <line x1="17" y1="7" x2="17" y2="17"></line>
            </svg>
        `;
        reminderItem.appendChild(reminderIconSpan);

        const reminderText = document.createElement('span');
        reminderText.className = 'item-text';
        reminderText.innerText = '提醒';
        reminderItem.appendChild(reminderText);

        remindersContainer.appendChild(reminderItem);
    }

    const categoryList = document.getElementById('category-list');
    if (categoryList) categoryList.innerHTML = '';

    const groupedBookmarks = {};
    Object.keys(state.bookmarks).forEach(id => {
        const bm = state.bookmarks[id];
        const cat = bm.category || '未分類';
        if (isTransitionCategory(cat)) return;
        if (!groupedBookmarks[cat]) groupedBookmarks[cat] = [];
        groupedBookmarks[cat].push({ id, ...bm });
    });

    let savedCatOrder = safeJSONParse(localStorage.getItem('my_category_order'), []);
    const hasUnclassifiedCards = Boolean(groupedBookmarks['未分類'] && groupedBookmarks['未分類'].length > 0);

    const customCategories = Object.keys(groupedBookmarks).filter(c => c !== '未分類' && !isTransitionCategory(c)).sort((a, b) => {
        let idxA = savedCatOrder.indexOf(a);
        let idxB = savedCatOrder.indexOf(b);
        if (idxA === -1 && idxB === -1) return a.localeCompare(b);
        if (idxA === -1) return 1; 
        if (idxB === -1) return -1;
        return idxA - idxB;
    });

    const sortedCategories = hasUnclassifiedCards ? ['未分類', ...customCategories] : [...customCategories];

    sortedCategories.forEach(cat => {
        if (isTransitionCategory(cat)) return;
        const isUnclassified = cat === '未分類';
        const item = document.createElement('div');
        item.className = `year-item ${cat === state.currentCategory && state.currentView === 'bookmarks' ? 'active' : ''}`;
        item.dataset.category = cat;
        item.onclick = (e) => {
            if (item.classList.contains('is-renaming')) {
                if (e.target !== text) {
                    text.focus();
                }
                return;
            }
            if (typeof window.handleSidebarCategoryClick === 'function') {
                window.handleSidebarCategoryClick(cat, item);
            } else {
                window.selectCategory(cat);
            }
        };

        const iconSpan = document.createElement('span');
        iconSpan.className = 'item-icon category-dot';
        iconSpan.innerHTML = '<span class="category-dot-circle"></span>';
        item.appendChild(iconSpan);
        
        const text = document.createElement('span');
        text.className = 'item-text';
        text.innerText = cat;
        item.appendChild(text);

        if (!isUnclassified) {
            const moreBtn = document.createElement('button');
            moreBtn.type = 'button';
            moreBtn.className = 'category-more-btn';
            moreBtn.setAttribute('aria-label', `${cat} 選項`);
            moreBtn.innerHTML = `
                <svg class="dots-vertical-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="5" r="2.2"></circle>
                    <circle cx="12" cy="12" r="2.2"></circle>
                    <circle cx="12" cy="19" r="2.2"></circle>
                </svg>
            `;
            moreBtn.onmousedown = (e) => {
                e.stopPropagation();
            };
            moreBtn.ontouchstart = (e) => {
                e.stopPropagation();
            };
            moreBtn.onclick = (e) => {
                e.stopPropagation();
                if (typeof window.showCategoryPopoverMenu === 'function') {
                    window.showCategoryPopoverMenu(e, cat, text, moreBtn, item);
                }
            };
            item.appendChild(moreBtn);
        }

        categoryList.appendChild(item);
    });

    if (state.currentView === 'bookmarks') {
        if (isTransitionCategory(state.currentCategory)) {
            renderBookmarks();
        } else if (!state.currentCategory || !groupedBookmarks[state.currentCategory]) {
            if (sortedCategories.length > 0) {
                state.currentCategory = sortedCategories[0];
                renderBookmarks();
            } else {
                window.selectRemindersView();
            }
        } else {
            renderBookmarks();
        }
    } else if (state.currentView === 'reminders') {
        renderReminders();
    }

    if (typeof window.updateCollapsedIcons === 'function') {
        window.updateCollapsedIcons(state.currentView);
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

export function updateFloatingCategoryTitle(text = '') {
    const el = document.getElementById('floating-category-title');
    if (!el) return;

    let targetTitle = '';
    if (text && typeof text === 'string') {
        targetTitle = text.trim();
    } else {
        if (state.currentView === 'reminders') {
            const now = Date.now();
            const remindersArr = Object.values(state.reminders || {});
            const hasInProgress = remindersArr.some(r => {
                if (r.isDone) return false;
                const targetTime = getReminderTargetTimestamp(r);
                if (targetTime > 0 && now > targetTime) return false;
                return now >= getReminderStartTimestamp(r);
            });
            const hasNotStarted = remindersArr.some(r => {
                if (r.isDone) return false;
                const targetTime = getReminderTargetTimestamp(r);
                if (targetTime > 0 && now > targetTime) return false;
                return now < getReminderStartTimestamp(r);
            });
            const hasEnded = remindersArr.some(r => {
                if (r.isDone) return true;
                const targetTime = getReminderTargetTimestamp(r);
                return targetTime > 0 && now > targetTime;
            });
            if (hasInProgress) targetTitle = '進行中';
            else if (hasNotStarted) targetTitle = '未開始';
            else if (hasEnded) targetTitle = '已結束';
            else targetTitle = '提醒';
        } else if (state.currentView === 'bookmarks') {
            const categoryBookmarks = Object.values(state.bookmarks || {}).filter(bm => {
                const cat = bm.category || '未分類';
                return cat === state.currentCategory;
            });
            if (categoryBookmarks.length > 0) {
                const firstSub = categoryBookmarks[0].subCategory;
                targetTitle = (firstSub && firstSub.trim() !== '') ? firstSub.trim() : (state.currentCategory || '未分類');
            } else {
                targetTitle = state.currentCategory || '未分類';
            }
        }
    }

    if (el.dataset.titleText !== targetTitle) {
        el.dataset.titleText = targetTitle;
        if (!targetTitle) {
            el.innerHTML = '';
            return;
        }
        // 依數字切段：非數字段一律 escapeHtml，僅純數字段包上 span，
        // 避免先跳脫後 &#39; 內的數字被誤包而破壞實體編碼
        const html = targetTitle
            .split(/(\d+)/)
            .map((part, i) => (i % 2 === 1 ? `<span class="floating-num">${part}</span>` : escapeHtml(part)))
            .join('');
        el.innerHTML = html;
    }
}

export function getViewContainer(viewName) {
    let container = document.getElementById(`${viewName}-view-container`);
    if (!container) {
        const root = document.getElementById('content-container');
        if (root) {
            container = document.createElement('div');
            container.id = `${viewName}-view-container`;
            container.className = 'view-panel';
            if (viewName !== state.currentView) {
                container.style.display = 'none';
            }
            root.appendChild(container);
        }
    }
    return container;
}

export function switchActiveView(viewName) {
    const viewNames = ['bookmarks', 'reminders'];
    viewNames.forEach(name => {
        const panel = document.getElementById(`${name}-view-container`);
        if (panel) {
            panel.style.display = (name === viewName) ? 'block' : 'none';
        }
    });
}

// ==========================================
// 章節導航條（提醒與資料儲存分頁共用）：取代傳統捲軸的月份快速跳轉
// ==========================================
let lastTickCount = 0;
let lastNavSignature = '';

export function updateChapterNav(items) {
    const rail = document.getElementById('chapter-nav-rail');
    const popover = document.getElementById('chapter-popover');
    const ticksContainer = rail ? rail.querySelector('.chapter-nav-ticks') : null;
    
    if (!rail || !popover) return;

    if (!items || items.length === 0) {
        hideChapterNav();
        lastTickCount = 0;
        lastNavSignature = '';
        return;
    }

    rail.style.display = 'flex';

    // 依據標籤與分組計算簽名，若內容結構無任何實質變更，跳過 DOM 摧毀與縮放動畫以消除閃爍
    const currentSignature = items.map(it => `${it.label}::${it.group || ''}`).join('||');
    const isUnchanged = (currentSignature === lastNavSignature) && ticksContainer && ticksContainer.children.length > 0;

    if (isUnchanged) {
        // 更新 Popover 中各項目的事件參照，確保 targetDOM 指向最新元素
        const popoverItems = popover.querySelectorAll('.chapter-item');
        popoverItems.forEach((pItem, idx) => {
            if (items[idx]) {
                pItem.onclick = (e) => {
                    e.stopPropagation();
                    window.scrollToChapterTarget(items[idx].targetDOM);
                };
            }
        });
        if (window.initChapterScrollSpy) {
            window.initChapterScrollSpy(items);
        }
        return;
    }

    lastNavSignature = currentSignature;
    popover.innerHTML = '';
    
    // 動態密度控制：最多顯示 20 個刻度，避免刻度線黏在一起
    const maxTicks = 20;
    const step = items.length > maxTicks ? Math.ceil(items.length / maxTicks) : 1;

    let newTickCount = 0;
    if (ticksContainer) {
        ticksContainer.innerHTML = '';
        items.forEach((item, index) => {
            if (index % step === 0 || index === items.length - 1) {
                const tick = document.createElement('span');
                tick.className = 'chapter-tick';
                tick.dataset.index = index;
                ticksContainer.appendChild(tick);
                newTickCount++;
            }
        });

        // 僅在刻度數量發生實質增減時才觸發展開或縮小動畫
        if (lastTickCount > 0 && newTickCount !== lastTickCount) {
            ticksContainer.classList.remove('anim-expand', 'anim-contract');
            void ticksContainer.offsetWidth;
            if (newTickCount > lastTickCount) {
                ticksContainer.classList.add('anim-expand');
            } else {
                ticksContainer.classList.add('anim-contract');
            }
        } else if (lastTickCount === 0) {
            ticksContainer.classList.remove('anim-expand', 'anim-contract');
            void ticksContainer.offsetWidth;
            ticksContainer.classList.add('anim-expand');
        }
        lastTickCount = newTickCount;
    }

    let lastGroup = null;
    items.forEach((item, index) => {
        if (item.group && item.group !== lastGroup) {
            lastGroup = item.group;
            const headerItem = document.createElement('div');
            headerItem.className = 'chapter-popover-header';
            headerItem.innerHTML = `<span class="chapter-header-text">${escapeHtml(item.group)}</span>`;
            if (item.groupDOM) {
                headerItem.onclick = (e) => {
                    e.stopPropagation();
                    window.scrollToChapterTarget(item.groupDOM);
                };
            }
            popover.appendChild(headerItem);
        }

        const popoverItem = document.createElement('div');
        popoverItem.className = `chapter-item ${item.group ? 'indented' : ''}`;
        popoverItem.dataset.index = index;
        popoverItem.onclick = (e) => {
            e.stopPropagation();
            window.scrollToChapterTarget(item.targetDOM);
        };

        const textSpan = document.createElement('span');
        textSpan.className = 'chapter-item-text';
        textSpan.textContent = item.label;
        popoverItem.appendChild(textSpan);

        popover.appendChild(popoverItem);
    });

    const tickCount = newTickCount || items.length;
    rail.classList.toggle('two-ticks', tickCount === 2);

    if (items.length === 1 && ticksContainer && ticksContainer.firstElementChild && popover.firstElementChild) {
        ticksContainer.firstElementChild.classList.add('active');
        popover.firstElementChild.classList.add('active');
    }

    if (window.initChapterScrollSpy) {
        window.initChapterScrollSpy(items);
    }
}

export function hideChapterNav() {
    const rail = document.getElementById('chapter-nav-rail');
    const popover = document.getElementById('chapter-popover');
    if (rail) { rail.style.display = 'none'; rail.classList.remove('active'); }
    if (popover) { popover.classList.remove('active'); popover.innerHTML = ''; }
    lastTickCount = 0;
    lastNavSignature = '';
    if (typeof window.clearChapterScrollSpy === 'function') {
        window.clearChapterScrollSpy();
    }
}

export function renderBookmarks() {
    if (!state.currentCategory) return;

    const titleEl = document.getElementById('current-main-title');
    titleEl.innerText = state.currentCategory;
    titleEl.style.cursor = '';
    titleEl.onclick = null;
    
    const selectionWrapper = document.getElementById('selection-wrapper') || document.querySelector('.sort-wrapper');
    if (selectionWrapper) selectionWrapper.style.display = 'block'; 
    
    updateSelectionBarUI();

    const container = getViewContainer('bookmarks');
    switchActiveView('bookmarks');
    
    const categoryBookmarks = [];
    Object.keys(state.bookmarks).forEach(id => {
        const bm = state.bookmarks[id];
        const cat = bm.category || '未分類';
        if (cat === state.currentCategory) categoryBookmarks.push({ id, ...bm });
    });
    
    if (categoryBookmarks.length === 0) {
        if (state.isSelectionMode) {
            if (state.selectedBookmarkIds) state.selectedBookmarkIds.clear();
            if (state.selectedSubCategories) state.selectedSubCategories.clear();
            updateSelectionBarUI();
        }
        container.replaceChildren(createEmptyStateDOM());
        updateChapterNav([]);
        updateFloatingCategoryTitle(state.currentCategory || '未分類');
        if (typeof window.clearSearch === 'function') window.clearSearch();
        return;
    }

    if (state.isSelectionMode) {
        if (state.selectedBookmarkIds && state.selectedBookmarkIds.size > 0) {
            for (const id of Array.from(state.selectedBookmarkIds)) {
                const bm = state.bookmarks[id];
                if (!bm || (bm.category || '未分類') !== state.currentCategory) {
                    state.selectedBookmarkIds.delete(id);
                }
            }
        }
        if (state.selectedSubCategories && state.selectedSubCategories.size > 0) {
            const existingSubCats = new Set(
                categoryBookmarks.map(bm => (bm.subCategory && bm.subCategory.trim() !== '') ? bm.subCategory.trim() : '未分類')
            );
            for (const sub of Array.from(state.selectedSubCategories)) {
                if (!existingSubCats.has(sub)) {
                    state.selectedSubCategories.delete(sub);
                }
            }
        }
        updateSelectionBarUI();
    }

    // 清除舊有的空狀態節點
    const legacyElements = container.querySelectorAll('.empty-state-view');
    legacyElements.forEach(el => el.remove());

    const groupedBySubCategory = {};
    categoryBookmarks.forEach(bm => {
        const subCat = (bm.subCategory && bm.subCategory.trim() !== '') ? bm.subCategory.trim() : '未分類';
        if (!groupedBySubCategory[subCat]) groupedBySubCategory[subCat] = [];
        groupedBySubCategory[subCat].push(bm);
    });

    const subcategoryOrdersMap = safeJSONParse(localStorage.getItem('my_subcategory_order'), {});
    const currentCategorySubOrder = Array.isArray(subcategoryOrdersMap[state.currentCategory]) 
        ? subcategoryOrdersMap[state.currentCategory] 
        : [];

    const sortedSubCategories = Object.keys(groupedBySubCategory).sort((a, b) => {
        const idxA = currentCategorySubOrder.indexOf(a);
        const idxB = currentCategorySubOrder.indexOf(b);

        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;

        if (a === '未分類') return 1;
        if (b === '未分類') return -1;
        return a.localeCompare(b);
    });

    const activeSubCatSet = new Set(sortedSubCategories);
    container.querySelectorAll('.category-wrapper[data-bookmark-category]').forEach(w => {
        if (w.dataset.bookmarkCategory !== state.currentCategory || !activeSubCatSet.has(w.dataset.subcategory)) {
            w.remove();
        }
    });

    const isCardSelectedAny = Boolean(state.selectedBookmarkIds && state.selectedBookmarkIds.size > 0);
    const isSubCatSelectedAny = Boolean(state.selectedSubCategories && state.selectedSubCategories.size > 0);

    const navItems = [];
    let nextWrapperChild = container.firstElementChild;

    sortedSubCategories.forEach(subCatName => {
        let wrapper = container.querySelector(`.category-wrapper[data-bookmark-category="${CSS.escape(state.currentCategory)}"][data-subcategory="${CSS.escape(subCatName)}"]`);
        let subTitle = null;
        let grid = null;

        if (!wrapper) {
            wrapper = document.createElement('div');
            wrapper.className = 'category-wrapper';
            wrapper.dataset.bookmarkCategory = state.currentCategory;
            wrapper.dataset.subcategory = subCatName;

            subTitle = document.createElement('h2');
            subTitle.className = 'month-title';
            subTitle.dataset.bookmarkTitle = subCatName;

            const titleText = document.createElement('span');
            titleText.className = 'subcategory-title-text';
            titleText.innerText = subCatName;
            subTitle.appendChild(titleText);

            const checkbox = document.createElement('button');
            checkbox.type = 'button';
            checkbox.className = 'subcategory-select-checkbox';
            checkbox.setAttribute('aria-label', `選取子分類 ${subCatName}`);
            checkbox.innerHTML = `
                <svg class="icon-unchecked" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="3" ry="3"></rect>
                </svg>
                <svg class="icon-checked" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="9 11 12 14 22 4"></polyline>
                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
                </svg>
            `;
            const isSubCatSelected = Boolean(state.selectedSubCategories && state.selectedSubCategories.has(subCatName));
            checkbox.classList.toggle('checked', isSubCatSelected);
            checkbox.classList.toggle('disabled', isCardSelectedAny);
            checkbox.onclick = (e) => {
                e.stopPropagation();
                if (state.selectedBookmarkIds && state.selectedBookmarkIds.size > 0) return;
                if (typeof window.toggleSubCategorySelection === 'function') {
                    window.toggleSubCategorySelection(subCatName, e);
                }
            };
            subTitle.appendChild(checkbox);

            wrapper.appendChild(subTitle);

            grid = document.createElement('div');
            grid.className = 'note-grid';
            grid.dataset.category = state.currentCategory;
            grid.dataset.subCategory = subCatName;
            wrapper.appendChild(grid);

            container.insertBefore(wrapper, nextWrapperChild);
        } else {
            if (wrapper !== nextWrapperChild) {
                container.insertBefore(wrapper, nextWrapperChild);
            }
            subTitle = wrapper.querySelector('.month-title');
            if (subTitle) {
                let titleText = subTitle.querySelector('.subcategory-title-text');
                let checkbox = subTitle.querySelector('.subcategory-select-checkbox');

                if (!titleText) {
                    titleText = document.createElement('span');
                    titleText.className = 'subcategory-title-text';
                    titleText.innerText = subCatName;
                    subTitle.prepend(titleText);
                } else if (titleText.innerText !== subCatName) {
                    titleText.innerText = subCatName;
                }

                if (!checkbox) {
                    checkbox = document.createElement('button');
                    checkbox.type = 'button';
                    checkbox.className = 'subcategory-select-checkbox';
                    checkbox.setAttribute('aria-label', `選取子分類 ${subCatName}`);
                    checkbox.innerHTML = `
                        <svg class="icon-unchecked" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="3" ry="3"></rect>
                        </svg>
                        <svg class="icon-checked" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="9 11 12 14 22 4"></polyline>
                            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
                        </svg>
                    `;
                    subTitle.appendChild(checkbox);
                } else if (checkbox.previousElementSibling !== titleText) {
                    subTitle.appendChild(checkbox);
                }

                const isSubCatSelected = Boolean(state.selectedSubCategories && state.selectedSubCategories.has(subCatName));
                checkbox.classList.toggle('checked', isSubCatSelected);
                checkbox.classList.toggle('disabled', isCardSelectedAny);
                checkbox.onclick = (e) => {
                    e.stopPropagation();
                    if (state.selectedBookmarkIds && state.selectedBookmarkIds.size > 0) return;
                    if (typeof window.toggleSubCategorySelection === 'function') {
                        window.toggleSubCategorySelection(subCatName, e);
                    }
                };
            }
            grid = wrapper.querySelector('.note-grid');
        }
        nextWrapperChild = wrapper.nextElementSibling;

        navItems.push({ label: subCatName, targetDOM: subTitle });

        const items = groupedBySubCategory[subCatName];
        items.sort((a, b) => (a.order || 0) - (b.order || 0));

        const currentItemIdsSet = new Set(items.map(bm => bm.id));
        Array.from(grid.querySelectorAll('.note-card[data-id]')).forEach(cardEl => {
            if (!currentItemIdsSet.has(cardEl.dataset.id)) {
                cardEl.remove();
            }
        });

        let nextCardChild = grid.firstElementChild;

        items.forEach(bm => {
            const isCustom = !!bm.isCustomRecord || (!bm.url && !!bm.content);
            let card = grid.querySelector(`.note-card[data-id="${bm.id}"]`);

            if (card) {
                if (card !== nextCardChild) {
                    grid.insertBefore(card, nextCardChild);
                }

                const titleEl = card.querySelector('.embed-title');
                let providerEl = card.querySelector('.embed-provider');
                const descEl = card.querySelector('.card-description');
                const timeEl = card.querySelector('.note-timestamp');

                if (titleEl) {
                    const embedContainer = card.querySelector('.discord-embed');
                    if (!providerEl && embedContainer) {
                        providerEl = document.createElement('div');
                        providerEl.className = 'embed-provider';
                        embedContainer.insertBefore(providerEl, titleEl);
                    }

                    if (isCustom) {
                        if (providerEl) providerEl.innerText = bm.category || '未分類';
                        if (titleEl.innerText !== (bm.title || '未命名網址')) {
                            titleEl.innerText = bm.title || '未命名網址';
                        }
                        titleEl.removeAttribute('href');
                        titleEl.removeAttribute('target');
                        titleEl.style.color = 'var(--primary)';
                        titleEl.classList.add('custom-record-title');
                    } else {
                        if (providerEl) {
                            try { providerEl.innerText = new URL(bm.url).hostname; }
                            catch(e) { providerEl.innerText = '網站連結'; }
                        }
                        const targetTitle = bm.title || bm.url;
                        if (titleEl.innerText !== targetTitle) {
                            titleEl.innerText = targetTitle;
                        }
                        titleEl.href = bm.url;
                        titleEl.target = '_blank';
                        titleEl.style.color = '';
                        titleEl.classList.remove('custom-record-title');
                    }
                }

                if (descEl) {
                    if (bm.description && bm.description.trim() !== '') {
                        if (descEl.innerText !== bm.description) descEl.innerText = bm.description;
                        descEl.style.opacity = '';
                    } else {
                        if (descEl.innerText !== '無備註') descEl.innerText = '無備註';
                        descEl.style.opacity = '0.4';
                    }
                }

                if (timeEl) {
                    const targetTime = `上次編輯：${formatTimeWithDay(bm.timestamp)}`;
                    if (timeEl.innerText !== targetTime) timeEl.innerText = targetTime;
                }

                const isSelected = state.isSelectionMode && state.selectedBookmarkIds && state.selectedBookmarkIds.has(bm.id);
                card.classList.toggle('is-selected', isSelected);
                card.classList.toggle('in-selection-mode', !!state.isSelectionMode);
                card.classList.toggle('selection-disabled', isSubCatSelectedAny);

                if (state.isSelectionMode) {
                    card.onclick = (e) => {
                        if (state.selectedSubCategories && state.selectedSubCategories.size > 0) return;
                        window.toggleBookmarkCardSelection(bm.id, e);
                    };
                } else {
                    card.onclick = () => window.openBookmarkEditor(bm.id);
                }
                card.oncontextmenu = (e) => window.showContextMenu(e, 'bookmark', bm.id, card);
            } else {
                const isSelected = state.isSelectionMode && state.selectedBookmarkIds && state.selectedBookmarkIds.has(bm.id);
                card = document.createElement('div');
                card.className = `note-card glass-effect ${isSelected ? 'is-selected' : ''} ${state.isSelectionMode ? 'in-selection-mode' : ''} ${isSubCatSelectedAny ? 'selection-disabled' : ''}`;
                card.dataset.id = bm.id;

                if (state.isSelectionMode) {
                    card.onclick = (e) => {
                        if (state.selectedSubCategories && state.selectedSubCategories.size > 0) return;
                        window.toggleBookmarkCardSelection(bm.id, e);
                    };
                } else {
                    card.onclick = () => window.openBookmarkEditor(bm.id);
                }
                card.oncontextmenu = (e) => window.showContextMenu(e, 'bookmark', bm.id, card);

                const embed = document.createElement('div');
                embed.className = 'discord-embed';

                if (!isCustom && bm.url) {
                    const provider = document.createElement('div');
                    provider.className = 'embed-provider';
                    const safeUrl = sanitizeUrl(bm.url);
                    try {
                        provider.innerText = safeUrl ? new URL(safeUrl).hostname : '網站連結';
                    } catch(e) {
                        provider.innerText = '網站連結';
                    }
                    embed.appendChild(provider);

                    const titleEl = document.createElement('a');
                    titleEl.className = 'embed-title';
                    titleEl.href = safeUrl || '#';
                    titleEl.target = '_blank';
                    titleEl.rel = 'noopener noreferrer';
                    titleEl.innerText = bm.title || bm.url;
                    titleEl.onclick = (e) => {
                        if (state.isSelectionMode || !safeUrl) {
                            e.preventDefault();
                            if (state.isSelectionMode) {
                                if (state.selectedSubCategories && state.selectedSubCategories.size > 0) return;
                                window.toggleBookmarkCardSelection(bm.id, e);
                            }
                        } else {
                            e.stopPropagation();
                        }
                    };
                    embed.appendChild(titleEl);
                } else {
                    const provider = document.createElement('div');
                    provider.className = 'embed-provider';
                    provider.innerText = bm.category || '未分類';
                    embed.appendChild(provider);

                    const titleEl = document.createElement('div');
                    titleEl.className = 'embed-title custom-record-title';
                    titleEl.style.color = 'var(--primary)';
                    titleEl.innerText = bm.title || '未命名網址';
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

                grid.insertBefore(card, nextCardChild);
                observeCardEntrance(card);
            }

            nextCardChild = card.nextElementSibling;
        });
    });

    updateChapterNav(navItems);
    if (navItems.length > 0) {
        updateFloatingCategoryTitle(navItems[0].label);
    } else {
        updateFloatingCategoryTitle(state.currentCategory || '未分類');
    }
    if (typeof window.clearSearch === 'function') window.clearSearch();
}

let reminderCountdownTimer = null;

export function updateCountdownBadge(badge, dateStr) {
    if (!badge || !dateStr) return;
    const targetTime = getReminderTargetTimestamp(dateStr);
    if (!targetTime) return;

    const now = Date.now();
    const diffMs = targetTime - now;

    let text = '';
    let className = 'reminder-countdown';

    if (diffMs <= 0) {
        text = '已逾期';
        className += ' overdue';
    } else if (diffMs >= 24 * 60 * 60 * 1000) {
        const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
        text = `${days}天`;
    } else {
        const hours = Math.floor(diffMs / (60 * 60 * 1000));
        const minutes = Math.floor((diffMs % (60 * 60 * 1000)) / (60 * 1000));
        const seconds = Math.floor((diffMs % (60 * 1000)) / 1000);
        text = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        className += ' urgent';
    }

    if (badge.textContent !== text) {
        badge.textContent = text;
    }
    if (badge.className !== className) {
        badge.className = className;
    }
}

export function startReminderCountdownTimer() {
    stopReminderCountdownTimer();

    const updateAllBadges = () => {
        if (state.currentView !== 'reminders') {
            stopReminderCountdownTimer();
            return;
        }
        const badges = document.querySelectorAll('.reminder-countdown[data-target-date]');
        if (badges.length === 0) {
            stopReminderCountdownTimer();
            return;
        }
        badges.forEach(badge => {
            const targetDate = badge.dataset.targetDate;
            updateCountdownBadge(badge, targetDate);

            const card = badge.closest('.reminder-card');
            if (card && card.classList.contains('reminder-glowing')) {
                const isGlowing = isReminderCardGlowing(targetDate, card.classList.contains('is-done'));
                if (!isGlowing) {
                    card.classList.remove('reminder-glowing');
                    card.style.removeProperty('--reminder-delay');
                }
            }
        });
    };

    updateAllBadges();
    reminderCountdownTimer = setInterval(updateAllBadges, 1000);
}

export function stopReminderCountdownTimer() {
    if (reminderCountdownTimer) {
        clearInterval(reminderCountdownTimer);
        reminderCountdownTimer = null;
    }
}

export function getReminderStartEndDisplay(r, fallbackDateStr = '') {
    const days = ['日', '一', '二', '三', '四', '五', '六'];
    const getWeekday = (dStr) => {
        if (!dStr) return '';
        const parts = dStr.split('-');
        if (parts.length !== 3) return '';
        const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        return isNaN(d.getTime()) ? '' : `(${days[d.getDay()]})`;
    };

    let sDate = r.startDate || '';
    let eDate = r.endDate || '';
    let sTime = r.startTime || '';
    let eTime = r.endTime || '';

    if (!sDate && r.date) {
        const raw = r.date.trim();
        if (raw.includes('~')) {
            const sides = raw.split('~').map(s => s.trim());
            const leftMatch = sides[0].match(/(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?/);
            if (leftMatch) {
                sDate = leftMatch[1];
                if (leftMatch[2]) sTime = leftMatch[2];
            }
            const rightMatch = sides[1].match(/(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?/);
            if (rightMatch) {
                eDate = rightMatch[1];
                if (rightMatch[2]) eTime = rightMatch[2];
            } else {
                const timeOnlyMatch = sides[1].match(/(\d{1,2}:\d{2})/);
                if (timeOnlyMatch) {
                    eDate = sDate;
                    eTime = timeOnlyMatch[1];
                }
            }
        } else {
            const singleMatch = raw.match(/(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?/);
            if (singleMatch) {
                sDate = singleMatch[1];
                eDate = singleMatch[1];
                if (singleMatch[2]) sTime = singleMatch[2];
            }
        }
    }

    if (!sDate) sDate = fallbackDateStr || '';
    if (!eDate) eDate = sDate;

    const sW = getWeekday(sDate);
    const eW = getWeekday(eDate);

    const startDisplay = `${sDate}${sTime ? ' ' + sTime : ''}${sW ? ' ' + sW : ''}`.trim();
    const endDisplay = `${eDate}${eTime ? ' ' + eTime : ''}${eW ? ' ' + eW : ''}`.trim();

    return { startDisplay, endDisplay };
}

export function renderReminders() {
    const titleEl = document.getElementById('current-main-title');
    titleEl.innerText = '提醒';
    titleEl.style.cursor = '';
    titleEl.onclick = null;
    
    const selectionWrapper = document.getElementById('selection-wrapper') || document.getElementById('sort-wrapper');
    if (selectionWrapper) selectionWrapper.style.display = 'block';
    updateSelectionBarUI();

    const container = getViewContainer('reminders');
    switchActiveView('reminders');

    const remindersArr = Object.keys(state.reminders || {}).map(id => ({ id, ...state.reminders[id] }));

    if (remindersArr.length === 0) {
        stopReminderCountdownTimer();
        container.replaceChildren(createEmptyStateDOM());
        updateChapterNav([]);
        updateFloatingCategoryTitle('提醒');
        if (typeof window.clearSearch === 'function') window.clearSearch();
        updateSelectionBarUI();
        return;
    }

    const legacyElements = container.querySelectorAll('.empty-state-view');
    legacyElements.forEach(el => el.remove());

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const now = Date.now();

    // 重新定義三分類狀態：進行中 (now >= startTime 且未逾期)、未開始 (now < startTime 且未逾期)、已結束 (isDone 或已逾期)
    const inProgress = [];
    const notStarted = [];
    const ended = [];

    remindersArr.forEach(r => {
        const targetTime = getReminderTargetTimestamp(r);
        const isOverdue = targetTime > 0 && now > targetTime;

        if (r.isDone || isOverdue) {
            ended.push(r);
        } else {
            const startTimestamp = getReminderStartTimestamp(r);
            if (now < startTimestamp) {
                notStarted.push(r);
            } else {
                inProgress.push(r);
            }
        }
    });

    const getTargetTimestamp = (item) => {
        if (!item) return Infinity;
        const t = getReminderTargetTimestamp(item);
        return t || Infinity;
    };

    // 排序規則：快結束日期的越上面（結束時間升冪排序，若相同則比對結束日期字串，最後比對最近更新）
    const sortByNearestEnd = (a, b) => {
        const timeA = getTargetTimestamp(a);
        const timeB = getTargetTimestamp(b);
        if (timeA !== timeB) return timeA - timeB;

        const dateA = a.endDate || a.date || '9999-12-31';
        const dateB = b.endDate || b.date || '9999-12-31';
        if (dateA !== dateB) return dateA.localeCompare(dateB);

        return (b.updatedAt || 0) - (a.updatedAt || 0);
    };

    inProgress.sort((a, b) => {
        const aGlowing = isReminderCardGlowing(a, a.isDone);
        const bGlowing = isReminderCardGlowing(b, b.isDone);

        if (aGlowing && !bGlowing) return -1;
        if (!aGlowing && bGlowing) return 1;

        return sortByNearestEnd(a, b);
    });

    notStarted.sort(sortByNearestEnd);
    ended.sort(sortByNearestEnd);

    const groups = [
        { key: 'in-progress', title: '進行中', items: inProgress },
        { key: 'not-started', title: '未開始', items: notStarted },
        { key: 'ended', title: '已結束', items: ended }
    ];

    const activeGroups = groups.filter(g => g.items.length > 0);
    const activeGroupKeys = new Set(activeGroups.map(g => g.key));

    container.querySelectorAll('.category-wrapper[data-reminder-group]').forEach(wrapperEl => {
        if (!activeGroupKeys.has(wrapperEl.dataset.reminderGroup)) {
            wrapperEl.remove();
        }
    });

    const navItems = [];
    let nextWrapperChild = container.firstElementChild;

    activeGroups.forEach(group => {
        let wrapper = container.querySelector(`.category-wrapper[data-reminder-group="${group.key}"]`);
        let subTitle = null;
        let grid = null;

        if (!wrapper) {
            wrapper = document.createElement('div');
            wrapper.className = 'category-wrapper';
            wrapper.dataset.reminderGroup = group.key;

            subTitle = document.createElement('h2');
            subTitle.className = 'month-title';
            subTitle.dataset.reminderGroupTitle = group.key;
            subTitle.innerText = group.title;
            wrapper.appendChild(subTitle);

            grid = document.createElement('div');
            grid.className = 'reminders-masonry';
            wrapper.appendChild(grid);

            container.insertBefore(wrapper, nextWrapperChild);
        } else {
            if (wrapper !== nextWrapperChild) {
                container.insertBefore(wrapper, nextWrapperChild);
            }
            subTitle = wrapper.querySelector('.month-title');
            if (subTitle && subTitle.innerText !== group.title) {
                subTitle.innerText = group.title;
            }
            grid = wrapper.querySelector('.reminders-masonry');
        }
        nextWrapperChild = wrapper.nextElementSibling;

        // 章節導航條僅顯示分類標題，完全比照資料儲存分頁
        navItems.push({ label: group.title, targetDOM: subTitle });

        const currentGroupKeysSet = new Set(group.items.map(r => r.id));

        Array.from(grid.querySelectorAll('.reminder-card[data-id]')).forEach(cardEl => {
            if (!currentGroupKeysSet.has(cardEl.dataset.id)) {
                cardEl.remove();
            }
        });

        let nextCardChild = grid.firstElementChild;

        group.items.forEach(r => {
            const id = r.id;
            const isDone = !!r.isDone;
            const targetDate = r.date || r.startDate || todayStr;
            const isGlowing = isReminderCardGlowing(r, isDone);
            const { startDisplay, endDisplay } = getReminderStartEndDisplay(r, targetDate);
            const isSelected = state.isSelectionMode && state.selectedReminderIds && state.selectedReminderIds.has(id);

            let card = grid.querySelector(`.reminder-card[data-id="${id}"]`);

            if (card) {
                if (card !== nextCardChild) {
                    grid.insertBefore(card, nextCardChild);
                }

                card.classList.toggle('is-done', isDone);
                card.classList.toggle('is-selected', isSelected);
                card.classList.toggle('in-selection-mode', !!state.isSelectionMode);

                if (isDone) {
                    const existingCountdown = card.querySelector('.reminder-countdown');
                    if (existingCountdown) existingCountdown.remove();

                    let checkbox = card.querySelector('.reminder-checkbox');
                    if (!checkbox) {
                        checkbox = document.createElement('div');
                        checkbox.className = 'reminder-checkbox checked';
                        checkbox.innerHTML = `
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                        `;
                        card.appendChild(checkbox);
                    } else {
                        checkbox.className = 'reminder-checkbox checked';
                        checkbox.style.display = '';
                    }
                    checkbox.onclick = null;
                } else {
                    const existingCheckbox = card.querySelector('.reminder-checkbox');
                    if (existingCheckbox) existingCheckbox.remove();

                    let countdownBadge = card.querySelector('.reminder-countdown');
                    if (!countdownBadge) {
                        countdownBadge = document.createElement('div');
                        countdownBadge.className = 'reminder-countdown';
                        card.appendChild(countdownBadge);
                    } else {
                        countdownBadge.style.display = '';
                    }
                    countdownBadge.dataset.targetDate = targetDate;
                    updateCountdownBadge(countdownBadge, targetDate);
                    countdownBadge.onclick = null;
                }

                let cardTitle = card.querySelector('.reminder-card-title');
                if (!cardTitle) {
                    cardTitle = document.createElement('div');
                    cardTitle.className = 'reminder-card-title';
                    card.appendChild(cardTitle);
                }
                const targetTitleText = (r.title && r.title.trim() !== '') ? r.title.trim() : (r.content ? r.content.replace(/<[^>]*>/g, '').trim() : '未命名提醒');
                if (cardTitle.textContent !== targetTitleText) {
                    cardTitle.textContent = targetTitleText;
                }

                let footer = card.querySelector('.footer');
                if (!footer) {
                    footer = document.createElement('div');
                    footer.className = 'footer';
                    card.appendChild(footer);
                }

                let startDateEl = footer.querySelector('.reminder-start-date');
                if (!startDateEl) {
                    footer.innerHTML = '';
                    startDateEl = document.createElement('span');
                    startDateEl.className = 'reminder-start-date';
                    footer.appendChild(startDateEl);
                }
                const targetStartText = `開始日期：${startDisplay}`;
                if (startDateEl.textContent !== targetStartText) {
                    startDateEl.textContent = targetStartText;
                }

                let endDateEl = footer.querySelector('.reminder-end-date');
                if (!endDateEl) {
                    endDateEl = document.createElement('span');
                    endDateEl.className = 'reminder-end-date';
                    footer.appendChild(endDateEl);
                }
                const targetEndText = `結束日期：${endDisplay}`;
                if (endDateEl.textContent !== targetEndText) {
                    endDateEl.textContent = targetEndText;
                }

                let timestamp = card.querySelector('.note-timestamp');
                if (!timestamp) {
                    timestamp = document.createElement('div');
                    timestamp.className = 'note-timestamp';
                    card.appendChild(timestamp);
                }
                const targetTimeText = `上次編輯：${formatTimeWithDay(r.timestamp)}`;
                if (timestamp.textContent !== targetTimeText) {
                    timestamp.textContent = targetTimeText;
                }

                const currentlyGlowing = card.classList.contains('reminder-glowing');
                if (currentlyGlowing !== isGlowing) {
                    if (isGlowing) {
                        card.style.setProperty('--reminder-delay', getGlobalReminderDelay());
                        card.classList.add('reminder-glowing');
                    } else {
                        card.classList.remove('reminder-glowing');
                        card.style.removeProperty('--reminder-delay');
                    }
                }

                if (state.isSelectionMode) {
                    card.onclick = (e) => window.toggleReminderCardSelection(id, e);
                } else {
                    card.onclick = () => window.openReminderEditor(id);
                }
                card.oncontextmenu = (e) => window.showContextMenu(e, 'reminder', id, card);
            } else {
                card = document.createElement('div');
                card.className = `reminder-card glass-effect ${isDone ? 'is-done' : ''} ${isSelected ? 'is-selected' : ''} ${state.isSelectionMode ? 'in-selection-mode' : ''}`;
                card.dataset.id = id;

                if (state.isSelectionMode) {
                    card.onclick = (e) => window.toggleReminderCardSelection(id, e);
                } else {
                    card.onclick = () => window.openReminderEditor(id);
                }
                card.oncontextmenu = (e) => window.showContextMenu(e, 'reminder', id, card);

                if (isDone) {
                    const checkbox = document.createElement('div');
                    checkbox.className = 'reminder-checkbox checked';
                    checkbox.innerHTML = `
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                    `;
                    card.appendChild(checkbox);
                } else {
                    const countdownBadge = document.createElement('div');
                    countdownBadge.className = 'reminder-countdown';
                    countdownBadge.dataset.targetDate = targetDate;
                    updateCountdownBadge(countdownBadge, targetDate);
                    card.appendChild(countdownBadge);
                }

                const cardTitle = document.createElement('div');
                cardTitle.className = 'reminder-card-title';
                cardTitle.textContent = (r.title && r.title.trim() !== '') ? r.title.trim() : (r.content ? r.content.replace(/<[^>]*>/g, '').trim() : '未命名提醒');
                card.appendChild(cardTitle);

                const footer = document.createElement('div');
                footer.className = 'footer';

                const startDateSpan = document.createElement('span');
                startDateSpan.className = 'reminder-start-date';
                startDateSpan.textContent = `開始日期：${startDisplay}`;
                footer.appendChild(startDateSpan);

                const endDateSpan = document.createElement('span');
                endDateSpan.className = 'reminder-end-date';
                endDateSpan.textContent = `結束日期：${endDisplay}`;
                footer.appendChild(endDateSpan);

                card.appendChild(footer);

                const timestamp = document.createElement('div');
                timestamp.className = 'note-timestamp';
                timestamp.textContent = `上次編輯：${formatTimeWithDay(r.timestamp)}`;
                card.appendChild(timestamp);

                if (isGlowing) {
                    card.style.setProperty('--reminder-delay', getGlobalReminderDelay());
                    card.classList.add('reminder-glowing');
                }

                grid.insertBefore(card, nextCardChild);
                observeCardEntrance(card);
            }

            nextCardChild = card.nextElementSibling;
        });
    });

    updateChapterNav(navItems);
    if (navItems.length > 0) {
        updateFloatingCategoryTitle(navItems[0].label);
    } else {
        updateFloatingCategoryTitle('提醒');
    }

    startReminderCountdownTimer();
    updateSelectionBarUI();

    const searchInput = document.getElementById('main-search-input');
    if (searchInput && searchInput.value && typeof window.handleSearch === 'function') {
        window.handleSearch();
    }
}

let cardEntranceObserver = null;

export function observeCardEntrance(card) {
    if (!card) return;
    if (card.dataset.entranceDone === 'true' || card.classList.contains('card-entrance')) return;

    const isModalOpen = Boolean(
        document.getElementById('editor-modal')?.classList.contains('active') ||
        document.getElementById('full-editor-modal')?.classList.contains('active')
    );
    if (isModalOpen) {
        card.dataset.entranceDone = 'true';
        return;
    }

    card.classList.add('card-pending');

    if (!cardEntranceObserver) {
        cardEntranceObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const target = entry.target;
                    cardEntranceObserver.unobserve(target);
                    target.classList.remove('card-pending');

                    if (document.body.classList.contains('is-chapter-scrolling')) {
                        target.dataset.entranceDone = 'true';
                        return;
                    }

                    target.classList.add('card-entrance');
                    target.dataset.entranceDone = 'true';

                    const cleanUp = (e) => {
                        if (!e || e.animationName === 'cardEntrance') {
                            target.classList.remove('card-entrance');
                            target.removeEventListener('animationend', cleanUp);
                        }
                    };
                    target.addEventListener('animationend', cleanUp);
                    setTimeout(cleanUp, 450);
                }
            });
        }, {
            root: document.querySelector('main'),
            rootMargin: '0px 0px -10px 0px',
            threshold: 0.02
        });
    }

    cardEntranceObserver.observe(card);
}

export function updateBookmarkCategoryDisplayUI(category, subCategory) {
    const displayTextEl = document.getElementById('bookmark-category-display-text');
    const catValInput = document.getElementById('bookmark-category');
    const subCatValInput = document.getElementById('bookmark-sub-category');

    const cat = (category !== undefined ? category : (catValInput ? catValInput.value : '')).trim();
    const sub = (subCategory !== undefined ? subCategory : (subCatValInput ? subCatValInput.value : '')).trim();

    if (catValInput && category !== undefined) catValInput.value = cat;
    if (subCatValInput && subCategory !== undefined) subCatValInput.value = sub;

    if (!displayTextEl) return;

    if (cat && sub) {
        displayTextEl.textContent = `${cat} - ${sub}`;
        displayTextEl.classList.remove('placeholder');
    } else if (cat) {
        displayTextEl.textContent = cat;
        displayTextEl.classList.remove('placeholder');
    } else {
        displayTextEl.textContent = '選擇分類-子分類';
        displayTextEl.classList.add('placeholder');
    }
}

export function positionCategoryConfirmBtn() {
    const btn = document.getElementById('category-confirm-btn');
    const topBar = document.getElementById('category-external-top-bar');
    const modal = document.getElementById('category-modal');
    if (!modal) return;

    const isMobile = window.innerWidth <= 768;
    const modalWidth = modal.offsetWidth || (isMobile ? Math.min(440, window.innerWidth * 0.9) : 400);
    const modalHeight = modal.offsetHeight || 536;
    const btnHeight = isMobile ? 52 : 60;
    const btnWidth = isMobile ? 52 : 60;
    const gap = 12;

    const leftX = Math.round((window.innerWidth - modalWidth) / 2);
    const rightX = Math.round((window.innerWidth + modalWidth) / 2);
    const topY = Math.round((window.innerHeight - modalHeight) / 2 - btnHeight - gap);
    const finalTop = Math.max(12, topY);

    if (btn) {
        btn.style.left = `${rightX - btnWidth}px`;
        btn.style.top = `${finalTop}px`;
    }

    if (topBar) {
        topBar.style.left = `${leftX}px`;
        topBar.style.top = `${finalTop}px`;
    }
}

export function positionSortConfirmBtn() {
    const btn = document.getElementById('sort-confirm-btn');
    const topBar = document.getElementById('sort-external-top-bar');
    const modal = document.getElementById('sort-modal');
    if (!modal) return;

    const isMobile = window.innerWidth <= 768;
    const modalWidth = modal.offsetWidth || (isMobile ? Math.min(440, window.innerWidth * 0.9) : 400);
    const modalHeight = modal.offsetHeight || 536;
    const btnHeight = isMobile ? 52 : 60;
    const btnWidth = isMobile ? 52 : 60;
    const gap = 12;

    const leftX = Math.round((window.innerWidth - modalWidth) / 2);
    const rightX = Math.round((window.innerWidth + modalWidth) / 2);
    const topY = Math.round((window.innerHeight - modalHeight) / 2 - btnHeight - gap);
    const finalTop = Math.max(12, topY);

    if (btn) {
        btn.style.left = `${rightX - btnWidth}px`;
        btn.style.top = `${finalTop}px`;
    }

    if (topBar) {
        topBar.style.left = `${leftX}px`;
        topBar.style.top = `${finalTop}px`;
    }
}

export function renderCategoryModalColumns() {
    const leftList = document.getElementById('modal-category-column-list');
    const rightList = document.getElementById('modal-subcategory-column-list');
    const addBtn = document.getElementById('btn-add-category-item');
    const backBtn = document.getElementById('btn-category-back');
    const confirmBtn = document.getElementById('category-confirm-btn');
    const splitContainer = document.getElementById('category-split-container');

    if (!leftList || !rightList) return;

    const isMoveCategoryOnly = Boolean(state.isMoveSelectionActive && state.moveTargetType === 'subcategory');
    const hasSubCategoryView = !isMoveCategoryOnly && Boolean(state.tempModalCategory && state.categoryModalStep >= 2);

    if (splitContainer) {
        splitContainer.classList.toggle('has-subcategory', hasSubCategoryView);
    }

    if (addBtn) {
        addBtn.textContent = hasSubCategoryView ? '新增子分類' : '新增分類';
    }

    if (backBtn) {
        const canGoBack = state.isAddingCategoryInline || state.isAddingSubCategoryInline || (!isMoveCategoryOnly && state.categoryModalStep > 1);
        backBtn.classList.toggle('disabled', !canGoBack);
        backBtn.disabled = !canGoBack;
    }

    if (confirmBtn) {
        if (state.isMoveSelectionActive) {
            let isValidMove = false;
            if (state.moveTargetType === 'subcategory') {
                isValidMove = Boolean(state.tempModalCategory && state.tempModalCategory !== state.currentCategory);
            } else if (state.moveTargetType === 'card') {
                let targetCat = '';
                let targetSubCat = '';
                if (state.categoryModalStep === 4) {
                    targetCat = state.tempModalCategory;
                    targetSubCat = state.tempModalSubCategory;
                } else if (state.categoryModalStep >= 2) {
                    targetCat = state.tempModalCategory;
                    targetSubCat = '';
                }

                if (targetCat) {
                    const normalizedTargetCat = targetCat.trim() || '未分類';
                    const normalizedTargetSub = targetSubCat.trim();
                    const cardIdsToMove = Array.from(state.selectedBookmarkIds || [])
                        .filter(id => !!state.bookmarks[id]);
                    const isAllSameDestination = cardIdsToMove.length > 0 && cardIdsToMove.every(id => {
                        const bm = state.bookmarks[id];
                        if (!bm) return false;
                        const currentBmCat = (bm.category && bm.category.trim() !== '') ? bm.category.trim() : '未分類';
                        const currentBmSub = (bm.subCategory && bm.subCategory.trim() !== '') ? bm.subCategory.trim() : '';
                        return currentBmCat === normalizedTargetCat && currentBmSub === normalizedTargetSub;
                    });
                    isValidMove = !isAllSameDestination;
                }
            }
            confirmBtn.classList.toggle('active', isValidMove);
        } else {
            confirmBtn.classList.add('active');
        }
    }

    leftList.innerHTML = '';
    rightList.innerHTML = '';

    const cats = new Set();
    Object.values(state.bookmarks || {}).forEach(bm => {
        if (bm && bm.category && bm.category.trim() !== '' && bm.category !== '未分類' && !isTransitionCategory(bm.category)) {
            cats.add(bm.category.trim());
        }
    });
    if (state.tempModalCategory && state.tempModalCategory.trim() !== '' && state.tempModalCategory !== '未分類' && !isTransitionCategory(state.tempModalCategory)) {
        cats.add(state.tempModalCategory.trim());
    }

    let savedCatOrder = safeJSONParse(localStorage.getItem('my_category_order'), []);
    const sortedCats = Array.from(cats).filter(c => !isTransitionCategory(c)).sort((a, b) => {
        let idxA = savedCatOrder.indexOf(a);
        let idxB = savedCatOrder.indexOf(b);
        if (idxA === -1 && idxB === -1) return a.localeCompare(b);
        if (idxA === -1) return 1;
        if (idxB === -1) return -1;
        return idxA - idxB;
    });

    if (state.isAddingCategoryInline) {
        const inputWrap = document.createElement('div');
        inputWrap.className = 'category-inline-input-wrapper';

        const iconSpan = document.createElement('span');
        iconSpan.className = 'item-icon category-dot';
        iconSpan.innerHTML = '<span class="category-dot-circle"></span>';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'category-inline-input';
        input.placeholder = '輸入分類名稱...';

        const commitAdd = () => {
            const val = input.value.trim();
            state.isAddingCategoryInline = false;
            if (val && val !== '未分類' && !isTransitionCategory(val)) {
                state.tempModalCategory = val;
                state.tempModalSubCategory = '';
                state.categoryModalStep = isMoveCategoryOnly ? 1 : 2;

                let currentOrder = safeJSONParse(localStorage.getItem('my_category_order'), []);
                currentOrder = [val, ...currentOrder.filter(c => c !== val)];
                localStorage.setItem('my_category_order', JSON.stringify(currentOrder));
                localStorage.setItem('my_category_order_updatedAt', Date.now().toString());
            }
            renderCategoryModalColumns();
        };

        input.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                commitAdd();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                state.isAddingCategoryInline = false;
                renderCategoryModalColumns();
            }
        };

        input.onblur = () => {
            if (state.isAddingCategoryInline) {
                commitAdd();
            }
        };

        inputWrap.appendChild(iconSpan);
        inputWrap.appendChild(input);
        leftList.appendChild(inputWrap);
        requestAnimationFrame(() => input.focus());
    }

    if (sortedCats.length === 0 && !state.isAddingCategoryInline) {
        const emptyLeft = document.createElement('div');
        emptyLeft.className = 'category-empty-hint';
        emptyLeft.textContent = '尚無分類';
        leftList.appendChild(emptyLeft);
    } else {
        sortedCats.forEach(cat => {
            const item = document.createElement('div');
            item.className = 'category-modal-item';
            if (cat === state.tempModalCategory) {
                item.classList.add('active');
            }

            const iconSpan = document.createElement('span');
            iconSpan.className = 'item-icon category-dot';
            iconSpan.innerHTML = '<span class="category-dot-circle"></span>';

            const textSpan = document.createElement('span');
            textSpan.className = 'category-modal-item-text';
            textSpan.textContent = cat;

            item.appendChild(iconSpan);
            item.appendChild(textSpan);

            item.onclick = () => {
                if (typeof window.handleSelectModalCategory === 'function') {
                    window.handleSelectModalCategory(cat);
                }
            };

            leftList.appendChild(item);
        });
    }

    if (!hasSubCategoryView) {
        positionCategoryConfirmBtn();
        return;
    }

    const currentCat = state.tempModalCategory;
    const subCats = new Set();
    Object.values(state.bookmarks || {}).forEach(bm => {
        const bmCat = (bm.category && bm.category.trim() !== '') ? bm.category.trim() : '未分類';
        if (bmCat === currentCat && bm.subCategory && bm.subCategory.trim() !== '' && bm.subCategory.trim() !== '未分類') {
            subCats.add(bm.subCategory.trim());
        }
    });
    if (state.tempModalSubCategory && state.tempModalSubCategory.trim() !== '' && state.tempModalSubCategory !== '未分類') {
        subCats.add(state.tempModalSubCategory.trim());
    }

    const subOrdersMap = safeJSONParse(localStorage.getItem('my_subcategory_order'), {});
    const currentSubOrder = Array.isArray(subOrdersMap[currentCat]) ? subOrdersMap[currentCat] : [];

    const sortedSubCats = Array.from(subCats).sort((a, b) => {
        const idxA = currentSubOrder.indexOf(a);
        const idxB = currentSubOrder.indexOf(b);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.localeCompare(b);
    });

    if (state.isAddingSubCategoryInline) {
        const inputWrap = document.createElement('div');
        inputWrap.className = 'category-inline-input-wrapper';

        const iconSpan = document.createElement('span');
        iconSpan.className = 'item-icon category-dot';
        iconSpan.innerHTML = '<span class="category-dot-circle"></span>';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'category-inline-input';
        input.placeholder = '輸入子分類名稱...';

        const commitSubAdd = () => {
            const val = input.value.trim();
            state.isAddingSubCategoryInline = false;
            if (val && val !== '未分類') {
                state.tempModalSubCategory = val;
                state.categoryModalStep = 4;

                const subOrders = safeJSONParse(localStorage.getItem('my_subcategory_order'), {});
                let targetSubOrder = Array.isArray(subOrders[currentCat]) ? subOrders[currentCat] : [];
                targetSubOrder = [val, ...targetSubOrder.filter(s => s !== val)];
                subOrders[currentCat] = targetSubOrder;
                localStorage.setItem('my_subcategory_order', JSON.stringify(subOrders));
                localStorage.setItem('my_subcategory_order_updatedAt', Date.now().toString());
            }
            renderCategoryModalColumns();
        };

        input.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                commitSubAdd();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                state.isAddingSubCategoryInline = false;
                renderCategoryModalColumns();
            }
        };

        input.onblur = () => {
            if (state.isAddingSubCategoryInline) {
                commitSubAdd();
            }
        };

        inputWrap.appendChild(iconSpan);
        inputWrap.appendChild(input);
        rightList.appendChild(inputWrap);
        requestAnimationFrame(() => input.focus());
    }

    if (sortedSubCats.length === 0 && !state.isAddingSubCategoryInline) {
        const emptyRight = document.createElement('div');
        emptyRight.className = 'category-empty-hint';
        emptyRight.textContent = '尚無子分類';
        rightList.appendChild(emptyRight);
    } else {
        sortedSubCats.forEach(sub => {
            const item = document.createElement('div');
            item.className = 'category-modal-item';
            if (sub === state.tempModalSubCategory && state.categoryModalStep === 4) {
                item.classList.add('active');
            }

            const iconSpan = document.createElement('span');
            iconSpan.className = 'item-icon category-dot';
            iconSpan.innerHTML = '<span class="category-dot-circle"></span>';

            const textSpan = document.createElement('span');
            textSpan.className = 'category-modal-item-text';
            textSpan.textContent = sub;

            item.appendChild(iconSpan);
            item.appendChild(textSpan);

            item.onclick = () => {
                if (typeof window.handleSelectModalSubCategory === 'function') {
                    window.handleSelectModalSubCategory(sub);
                }
            };

            rightList.appendChild(item);
        });
    }

    positionCategoryConfirmBtn();
}

export function renderCalendar() {
    const year = state.calDate.getFullYear();
    const month = state.calDate.getMonth();
    document.getElementById('cal-month-year').innerText = `${year}年 ${month + 1}月`;
    
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysGrid = document.getElementById('cal-days');
    daysGrid.innerHTML = '';
    
    let startDate = state.tempSelectedReminderStartDate || '';
    let endDate = state.tempSelectedReminderEndDate || '';

    if (!startDate && !endDate) {
        if (state.tempSelectedReminderDate) {
            startDate = state.tempSelectedReminderDate;
            endDate = state.tempSelectedReminderDate;
        } else if (state.currentUnifiedType === 'reminder') {
            const rStartVal = document.getElementById('reminder-start-date-val');
            const rEndVal = document.getElementById('reminder-end-date-val');
            const reminderDateEl = document.getElementById('reminder-date-val');
            if (rStartVal && rStartVal.value) startDate = rStartVal.value.trim();
            if (rEndVal && rEndVal.value) endDate = rEndVal.value.trim();
            if (!startDate && reminderDateEl && reminderDateEl.value) {
                const dateMatches = reminderDateEl.value.match(/\d{4}-\d{2}-\d{2}/g);
                if (dateMatches && dateMatches.length > 0) {
                    startDate = dateMatches[0];
                    endDate = dateMatches[1] || dateMatches[0];
                }
            }
        }
    }

    if (!startDate && endDate) startDate = endDate;
    if (startDate && !endDate) endDate = startDate;

    const actualStart = (startDate && endDate) ? (startDate <= endDate ? startDate : endDate) : '';
    const actualEnd = (startDate && endDate) ? (startDate <= endDate ? endDate : startDate) : '';

    for (let i = 0; i < firstDay; i++) {
        daysGrid.appendChild(document.createElement('div'));
    }

    for (let i = 1; i <= daysInMonth; i++) {
        const dayCell = document.createElement('div');
        dayCell.className = 'cal-day-cell';
        dayCell.innerText = i;
        
        const cellDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        dayCell.dataset.date = cellDateStr;

        if (actualStart && actualEnd) {
            if (cellDateStr === actualStart && cellDateStr === actualEnd) {
                dayCell.classList.add('selected', 'range-start', 'range-end');
            } else if (cellDateStr === actualStart) {
                dayCell.classList.add('range-start');
            } else if (cellDateStr === actualEnd) {
                dayCell.classList.add('range-end');
            } else if (cellDateStr > actualStart && cellDateStr < actualEnd) {
                dayCell.classList.add('range-between');
                if (i === 1) {
                    dayCell.classList.add('range-month-start');
                }
                if (i === daysInMonth) {
                    dayCell.classList.add('range-month-end');
                }
            }
        }

        dayCell.onclick = (e) => {
            e.stopPropagation();
            window.selectDate(year, month + 1, i);
        };
        daysGrid.appendChild(dayCell);
    }

    if (typeof window.updateCalendarRangeHighlight === 'function' && actualStart && actualEnd) {
        window.updateCalendarRangeHighlight(actualStart, actualEnd);
    }
}

export function getReminderStartTimestamp(input) {
    if (!input) return 0;

    let sDate = '';
    let sTime = '';

    if (typeof input === 'object') {
        sDate = input.startDate || '';
        sTime = input.startTime || '';
        if (!sDate && input.date) {
            const raw = input.date.trim();
            if (raw.includes('~')) {
                const sides = raw.split('~').map(s => s.trim());
                const leftMatch = sides[0].match(/(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?/);
                if (leftMatch) {
                    sDate = leftMatch[1];
                    if (leftMatch[2]) sTime = leftMatch[2];
                }
            } else {
                const singleMatch = raw.match(/(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?/);
                if (singleMatch) {
                    sDate = singleMatch[1];
                    if (singleMatch[2]) sTime = singleMatch[2];
                }
            }
        }
    } else if (typeof input === 'string') {
        const raw = input.trim();
        if (raw.includes('~')) {
            const sides = raw.split('~').map(s => s.trim());
            const leftMatch = sides[0].match(/(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?/);
            if (leftMatch) {
                sDate = leftMatch[1];
                if (leftMatch[2]) sTime = leftMatch[2];
            }
        } else {
            const singleMatch = raw.match(/(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?/);
            if (singleMatch) {
                sDate = singleMatch[1];
                if (singleMatch[2]) sTime = singleMatch[2];
            }
        }
    }

    if (sDate) {
        const parts = sDate.split('-');
        if (parts.length === 3) {
            const year = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10) - 1;
            const day = parseInt(parts[2], 10);
            if (sTime && sTime.includes(':')) {
                const [hh, mm] = sTime.split(':').map(n => parseInt(n, 10));
                return new Date(year, month, day, hh || 0, mm || 0, 0, 0).getTime();
            }
            return new Date(year, month, day, 0, 0, 0, 0).getTime();
        }
    }

    return 0;
}

export function renderSortModalColumns() {
    const catList = document.getElementById('modal-sort-category-column-list');
    const subCatList = document.getElementById('modal-sort-subcategory-column-list');
    const cardList = document.getElementById('modal-sort-card-column-list');
    const backBtn = document.getElementById('btn-sort-back');
    const splitContainer = document.getElementById('sort-split-container');

    if (!catList || !subCatList || !cardList) return;

    const step = state.sortModalStep || 1;
    if (splitContainer) {
        splitContainer.setAttribute('data-step', String(step));
    }

    if (backBtn) {
        const canGoBack = step > 1;
        backBtn.classList.toggle('disabled', !canGoBack);
        backBtn.disabled = !canGoBack;
    }

    catList.innerHTML = '';
    subCatList.innerHTML = '';
    cardList.innerHTML = '';

    // 1. 分類清單初始化與渲染
    const existingCats = new Set();
    Object.values(state.bookmarks || {}).forEach(bm => {
        if (bm && bm.category && bm.category.trim() !== '' && bm.category !== '未分類' && !isTransitionCategory(bm.category)) {
            existingCats.add(bm.category.trim());
        }
    });

    if (!Array.isArray(state.tempSortCategoryOrder) || state.tempSortCategoryOrder.length === 0) {
        const savedCatOrder = safeJSONParse(localStorage.getItem('my_category_order'), []);
        const sorted = Array.from(existingCats).sort((a, b) => {
            let idxA = savedCatOrder.indexOf(a);
            let idxB = savedCatOrder.indexOf(b);
            if (idxA === -1 && idxB === -1) return a.localeCompare(b);
            if (idxA === -1) return 1;
            if (idxB === -1) return -1;
            return idxA - idxB;
        });
        state.tempSortCategoryOrder = sorted;
    } else {
        existingCats.forEach(c => {
            if (!state.tempSortCategoryOrder.includes(c)) {
                state.tempSortCategoryOrder.push(c);
            }
        });
        state.tempSortCategoryOrder = state.tempSortCategoryOrder.filter(c => existingCats.has(c));
    }

    if (state.tempSortCategoryOrder.length === 0) {
        const emptyEl = document.createElement('div');
        emptyEl.className = 'category-empty-hint';
        emptyEl.textContent = '尚無分類可排序';
        catList.appendChild(emptyEl);
    } else {
        state.tempSortCategoryOrder.forEach(cat => {
            const item = document.createElement('div');
            item.className = 'sort-modal-item';
            item.dataset.sortType = 'category';
            item.dataset.category = cat;
            if (cat === state.tempSortCategory && step >= 2) {
                item.classList.add('active');
            }

            const iconSpan = document.createElement('span');
            iconSpan.className = 'item-icon category-dot';
            iconSpan.innerHTML = '<span class="category-dot-circle"></span>';

            const textSpan = document.createElement('span');
            textSpan.className = 'sort-modal-item-text';
            textSpan.textContent = cat;

            item.appendChild(iconSpan);
            item.appendChild(textSpan);

            item.onclick = () => {
                if (window.justFinishedSortDrag) return;
                if (typeof window.handleSelectSortCategory === 'function') {
                    window.handleSelectSortCategory(cat);
                }
            };

            catList.appendChild(item);
        });
    }

    // 2. 子分類清單渲染 (step 2 或 step 3)
    if (step >= 2 && state.tempSortCategory) {
        const currentCat = state.tempSortCategory;
        const existingSubCats = new Set();
        Object.values(state.bookmarks || {}).forEach(bm => {
            const bmCat = (bm.category && bm.category.trim() !== '') ? bm.category.trim() : '未分類';
            if (bmCat === currentCat && bm.subCategory && bm.subCategory.trim() !== '' && bm.subCategory.trim() !== '未分類') {
                existingSubCats.add(bm.subCategory.trim());
            }
        });

        if (!state.tempSortSubCategoryOrders) state.tempSortSubCategoryOrders = {};
        if (!Array.isArray(state.tempSortSubCategoryOrders[currentCat])) {
            const subOrdersMap = safeJSONParse(localStorage.getItem('my_subcategory_order'), {});
            const currentSubOrder = Array.isArray(subOrdersMap[currentCat]) ? subOrdersMap[currentCat] : [];
            const sortedSubs = Array.from(existingSubCats).sort((a, b) => {
                const idxA = currentSubOrder.indexOf(a);
                const idxB = currentSubOrder.indexOf(b);
                if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                if (idxA !== -1) return -1;
                if (idxB !== -1) return 1;
                return a.localeCompare(b);
            });
            state.tempSortSubCategoryOrders[currentCat] = sortedSubs;
        } else {
            existingSubCats.forEach(s => {
                if (!state.tempSortSubCategoryOrders[currentCat].includes(s)) {
                    state.tempSortSubCategoryOrders[currentCat].push(s);
                }
            });
            state.tempSortSubCategoryOrders[currentCat] = state.tempSortSubCategoryOrders[currentCat].filter(s => existingSubCats.has(s));
        }

        const currentSubList = state.tempSortSubCategoryOrders[currentCat] || [];
        if (currentSubList.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'category-empty-hint';
            emptyEl.textContent = '尚無子分類可排序';
            subCatList.appendChild(emptyEl);
        } else {
            currentSubList.forEach(sub => {
                const item = document.createElement('div');
                item.className = 'sort-modal-item';
                item.dataset.sortType = 'subcategory';
                item.dataset.category = currentCat;
                item.dataset.subcategory = sub;
                if (sub === state.tempSortSubCategory && step === 3) {
                    item.classList.add('active');
                }

                const iconSpan = document.createElement('span');
                iconSpan.className = 'item-icon category-dot';
                iconSpan.innerHTML = '<span class="category-dot-circle"></span>';

                const textSpan = document.createElement('span');
                textSpan.className = 'sort-modal-item-text';
                textSpan.textContent = sub;

                item.appendChild(iconSpan);
                item.appendChild(textSpan);

                item.onclick = () => {
                    if (window.justFinishedSortDrag) return;
                    if (typeof window.handleSelectSortSubCategory === 'function') {
                        window.handleSelectSortSubCategory(sub);
                    }
                };

                subCatList.appendChild(item);
            });
        }
    }

    // 3. 卡片清單渲染 (step 3)
    if (step === 3 && state.tempSortCategory && state.tempSortSubCategory) {
        const currentCat = state.tempSortCategory;
        const currentSub = state.tempSortSubCategory;
        const cardKey = `${currentCat}:::${currentSub}`;

        if (!state.tempSortCardOrders) state.tempSortCardOrders = {};
        if (!Array.isArray(state.tempSortCardOrders[cardKey])) {
            const matchedCards = [];
            Object.keys(state.bookmarks || {}).forEach(id => {
                const bm = state.bookmarks[id];
                const bmCat = (bm.category && bm.category.trim() !== '') ? bm.category.trim() : '未分類';
                const bmSub = (bm.subCategory && bm.subCategory.trim() !== '') ? bm.subCategory.trim() : '未分類';
                if (bmCat === currentCat && bmSub === currentSub) {
                    matchedCards.push({ id, ...bm });
                }
            });
            matchedCards.sort((a, b) => (a.order || 0) - (b.order || 0));
            state.tempSortCardOrders[cardKey] = matchedCards.map(c => c.id);
        }

        const currentCardIds = (state.tempSortCardOrders[cardKey] || []).filter(id => !!state.bookmarks[id]);
        state.tempSortCardOrders[cardKey] = currentCardIds;

        if (currentCardIds.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'category-empty-hint';
            emptyEl.textContent = '尚無卡片可排序';
            cardList.appendChild(emptyEl);
        } else {
            currentCardIds.forEach(id => {
                const bm = state.bookmarks[id];
                if (!bm) return;

                const item = document.createElement('div');
                item.className = 'sort-modal-item';
                item.dataset.sortType = 'card';
                item.dataset.id = id;
                item.dataset.category = currentCat;
                item.dataset.subcategory = currentSub;

                const iconSpan = document.createElement('span');
                iconSpan.className = 'item-icon category-dot';
                iconSpan.innerHTML = '<span class="category-dot-circle"></span>';

                const textSpan = document.createElement('span');
                textSpan.className = 'sort-modal-item-text';
                textSpan.textContent = bm.title || bm.url || '未命名項目';

                item.appendChild(iconSpan);
                item.appendChild(textSpan);

                cardList.appendChild(item);
            });
        }
    }

    positionSortConfirmBtn();
}

export const renderBookmarkSortLists = renderSortModalColumns;