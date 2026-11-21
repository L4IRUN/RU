// @ts-check
// @ts-nocheck
// 沿用 interaction.js 的型別檢查範圍；本階段只搬移函式，型別化另行處理。
// 章節導覽、側邊欄與頭像選單

import { state } from '../state.js';
import { hasModal } from '../domain.js';
import { isGoogleLinked } from '../sync.js';
import { renderUserProfileUI, updateFloatingCategoryTitle } from '../ui.js';
import { hideCategoryPopoverMenu, hideHeaderPopoverMenu } from './categoryMenu.js';
import { handleGoogleSignOutClick, openSettingsModal, requestManualSync } from './settings.js';

let currentChapterItems = [];

let chapterScrollListener = null;

let isClickScrolling = false;

let clickScrollTimer = null;

let smoothScrollRAF = null;

function getChapterReferenceOffset() {
    return state._cachedInnerWidth <= 768 ? 100 : 120;
}

function getChapterDesiredTop(targetDOM, targetHeight, mainClientHeight) {
    const isMobile = state._cachedInnerWidth <= 768;
    const topOffset = isMobile ? 74 : 20;
    if (targetDOM.classList.contains('reminder-card') || targetDOM.classList.contains('note-card')) {
        return Math.max(topOffset, (mainClientHeight / 2) - (targetHeight / 2));
    }
    return topOffset;
}

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
    return true;
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
        if (document.body.hasAttribute('data-no-glass')) return;
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
    if (state._cachedInnerWidth <= 768) {
        toggleSidebar(); 
    }
}

export function syncSidebarActiveState() {
    const isReminders = state.currentView === 'reminders';
    const reminderBtn = document.getElementById('nav-reminders-btn');
    if (reminderBtn) {
        reminderBtn.classList.toggle('active', isReminders);
    }
    document.querySelectorAll('.year-item').forEach(el => {
        if (el.dataset.category) {
            el.classList.toggle('active', !isReminders && el.dataset.category === state.currentCategory);
        }
    });
}

export function toggleSidebar(e) {
    if (e && typeof e.stopPropagation === 'function') {
        e.stopPropagation();
    }
    const sidebar = document.getElementById('sidebar');
    const mobileOverlay = document.getElementById('mobile-sidebar-overlay');
    
    if (state._cachedInnerWidth <= 768) {
        hideCategoryPopoverMenu(true);
        hideSidebarProfilePopover(true);
        hideSidebarCollapsedMenu(true);
        closeFloatingAvatarPopover();
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

export function hideSidebarProfilePopover(immediate = false) {
    const popover = document.getElementById('sidebar-profile-popover');
    const trigger = document.getElementById('sidebar-profile-trigger');
    if (trigger) trigger.classList.remove('active');
    if (!popover) return;

    if (!popover.classList.contains('active')) {
        if (immediate) popover.style.display = 'none';
        return;
    }

    popover.classList.remove('active');
    popover.setAttribute('aria-hidden', 'true');
    if (immediate) {
        popover.style.display = 'none';
    } else {
        setTimeout(() => {
            if (!popover.classList.contains('active')) {
                popover.style.display = 'none';
            }
        }, 200);
    }
}

export function hideSidebarCollapsedMenu(immediate = false) {
    const menu = document.getElementById('sidebar-collapsed-menu');
    const trigger = document.getElementById('sidebar-profile-trigger');
    if (trigger) trigger.classList.remove('menu-open');
    if (!menu) return;

    if (!menu.classList.contains('active')) {
        if (immediate) menu.style.display = 'none';
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
        }, 160);
    }
}

export function handleSidebarProfileClick(e) {
    if (e) {
        e.stopPropagation();
        e.preventDefault();
    }

    const sidebar = document.getElementById('sidebar');
    const trigger = document.getElementById('sidebar-profile-trigger');
    if (!sidebar || !trigger) return;

    const isCollapsed = sidebar.classList.contains('collapsed') && state._cachedInnerWidth > 768;

    hideCategoryPopoverMenu(true);
    hideHeaderPopoverMenu(true);
    closeFloatingAvatarPopover();

    if (isCollapsed) {
        hideSidebarProfilePopover(true);
        const menu = document.getElementById('sidebar-collapsed-menu');
        if (!menu) return;

        if (menu.classList.contains('active')) {
            hideSidebarCollapsedMenu();
            return;
        }

        const logoutItem = document.getElementById('sidebar-collapsed-logout-item');
        if (logoutItem) {
            logoutItem.style.display = isGoogleLinked() ? 'flex' : 'none';
        }

        menu.style.display = 'block';
        const sidebarRect = sidebar.getBoundingClientRect();
        const triggerRect = trigger.getBoundingClientRect();
        const menuWidth = menu.offsetWidth || 156;
        const menuHeight = menu.offsetHeight || 128;

        let left = sidebarRect.right + 12;
        let top = triggerRect.bottom - menuHeight;

        if (left + menuWidth > window.innerWidth - 10) {
            left = window.innerWidth - menuWidth - 10;
        }
        if (top < 10) top = 10;
        if (top + menuHeight > window.innerHeight - 10) {
            top = window.innerHeight - menuHeight - 10;
        }

        menu.style.left = `${Math.round(left)}px`;
        menu.style.top = `${Math.round(top)}px`;
        trigger.classList.add('menu-open');

        requestAnimationFrame(() => {
            menu.classList.add('active');
        });
    } else {
        hideSidebarCollapsedMenu(true);
        const popover = document.getElementById('sidebar-profile-popover');
        if (!popover) return;

        if (popover.classList.contains('active')) {
            hideSidebarProfilePopover();
            return;
        }

        renderUserProfileUI();

        const section = sidebar.querySelector('.sidebar-settings-section') || trigger;
        const sectionRect = section.getBoundingClientRect();
        const left = Math.round(sectionRect.left + 10);
        const width = Math.max(200, Math.round(sectionRect.width - 20));
        const bottom = Math.max(12, Math.round(window.innerHeight - sectionRect.top + 8));

        popover.style.left = `${left}px`;
        popover.style.width = `${width}px`;
        popover.style.bottom = `${bottom}px`;
        popover.style.display = 'block';
        popover.setAttribute('aria-hidden', 'false');
        trigger.classList.add('active');

        requestAnimationFrame(() => {
            popover.classList.add('active');
        });
    }
}

export function triggerCollapsedMenuSettings(e) {
    if (e) {
        e.stopPropagation();
        e.preventDefault();
    }
    hideSidebarCollapsedMenu(true);
    openSettingsModal();
}

export async function triggerCollapsedMenuSync(e) {
    if (e) {
        e.stopPropagation();
        e.preventDefault();
    }
    hideSidebarCollapsedMenu(true);
    await requestManualSync();
}

export async function triggerCollapsedMenuLogout(e) {
    if (e) {
        e.stopPropagation();
        e.preventDefault();
    }
    hideSidebarCollapsedMenu(true);
    await handleGoogleSignOutClick();
}

export function toggleFloatingAvatarPopover(e) {
    if (e) {
        e.stopPropagation();
        e.preventDefault();
    }
    const popover = document.getElementById('floating-avatar-popover');
    const avatarBtn = document.getElementById('floating-avatar-btn');
    const avatarGroup = document.getElementById('floating-avatar-group');
    if (!popover) return;

    if (popover.classList.contains('active')) {
        closeFloatingAvatarPopover();
        return;
    }

    hideCategoryPopoverMenu(true);
    hideHeaderPopoverMenu(true);
    hideSidebarProfilePopover(true);
    hideSidebarCollapsedMenu(true);
    if (typeof closeChapterPopover === 'function') closeChapterPopover();

    renderUserProfileUI();

    const logoutBtn = document.getElementById('floating-logout-btn');
    if (logoutBtn) {
        logoutBtn.style.display = isGoogleLinked() ? 'flex' : 'none';
    }

    const mainEl = document.querySelector('main');
    state.floatingAvatarOpenScrollTop = mainEl ? mainEl.scrollTop : 0;
    state.floatingAvatarOpenedAt = Date.now();

    popover.classList.add('active');
    if (avatarGroup) avatarGroup.classList.add('is-open');
}

export function closeFloatingAvatarPopover() {
    const popover = document.getElementById('floating-avatar-popover');
    const avatarBtn = document.getElementById('floating-avatar-btn');
    const avatarGroup = document.getElementById('floating-avatar-group');
    if (popover) {
        popover.classList.remove('active');
    }
    if (avatarBtn) {
        avatarBtn.classList.remove('is-enlarged');
    }
    if (avatarGroup) {
        avatarGroup.classList.remove('is-open');
    }
}

export async function handleFloatingManualSync(e) {
    if (e) {
        e.stopPropagation();
        e.preventDefault();
    }
    const focused = document.activeElement;
    if (document.getElementById('floating-avatar-popover')?.contains(focused)) {
        document.getElementById('floating-avatar-btn')?.focus({ preventScroll: true });
    }
    closeFloatingAvatarPopover();
    await requestManualSync();
}

export const handleFloatingReconnect = handleFloatingManualSync;

export async function handleFloatingSignOut(e) {
    if (e) {
        e.stopPropagation();
        e.preventDefault();
    }
    closeFloatingAvatarPopover();
    await handleGoogleSignOutClick();
}
