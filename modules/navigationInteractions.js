// @ts-check
// @ts-nocheck
// 沿用來源型別檢查範圍；本階段只做機械搬移。

import { state } from '../state.js';

import { toggleSidebar, closeFloatingAvatarPopover, closeChapterPopover } from './navigation.js';

import { setFabTucked } from './editor.js';

export function initSidebarEdgeSwipe() {
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

}

export function initMainScrollInteractions() {
    const mainContainer = document.querySelector('main');
    let isScrollingTimer = null;
    let lastMainScrollTop = 0;

    const updateMobileFloatingNav = () => {
        const floatingNav = document.getElementById('mobile-floating-nav');
        if (!floatingNav || !mainContainer) return;

        if (state._cachedInnerWidth > 768) {
            floatingNav.classList.remove('visible');
            closeFloatingAvatarPopover();
            return;
        }

        const currentScroll = mainContainer.scrollTop;
        const avatarPopover = document.getElementById('floating-avatar-popover');
        if (avatarPopover && avatarPopover.classList.contains('active')) {
            if (Math.abs(currentScroll - state.floatingAvatarOpenScrollTop) > 24) {
                closeFloatingAvatarPopover();
            }
        }

        if (currentScroll > 60) {
            floatingNav.classList.add('visible');
        } else if (currentScroll < 30) {
            floatingNav.classList.remove('visible');
        }
    };

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
                    updateMobileFloatingNav();

                    if (state._cachedInnerWidth <= 768 && !state.isSelectionMode) {
                        const currentScroll = mainContainer.scrollTop;
                        const scrollDiff = currentScroll - lastMainScrollTop;
                        if (currentScroll <= 30) {
                            setFabTucked(false);
                        } else if (scrollDiff > 8) {
                            setFabTucked(true);
                        } else if (scrollDiff < -8) {
                            setFabTucked(false);
                        }
                        lastMainScrollTop = currentScroll;
                    }
                });
            }
            if (isScrollingTimer) clearTimeout(isScrollingTimer);
            isScrollingTimer = setTimeout(clearScrollingState, 120);
        }, { passive: true });
    }

    window.addEventListener('resize', updateMobileFloatingNav, { passive: true });

}

export function initChapterHoverBridge() {
    // 建立局部 Popover 懸浮橋接監聽器（完全消除全域 mousemove 與 Layout Thrashing）
    const bindPopoverHoverBridge = (triggerEl, popoverEl, closeFn, delay = 180) => {
        if (!triggerEl || !popoverEl) return;
        let leaveTimer = null;

        const cancelScheduledClose = () => {
            if (leaveTimer) {
                clearTimeout(leaveTimer);
                leaveTimer = null;
            }
        };

        const handlePointerLeave = (e) => {
            if (state._cachedInnerWidth <= 768) return;
            const nextTarget = e.relatedTarget;
            if (nextTarget && (triggerEl.contains(nextTarget) || popoverEl.contains(nextTarget))) {
                return;
            }
            cancelScheduledClose();
            leaveTimer = setTimeout(() => {
                if (popoverEl.classList.contains('active')) {
                    closeFn();
                }
                leaveTimer = null;
            }, delay);
        };

        const handlePointerEnter = () => {
            if (state._cachedInnerWidth <= 768) return;
            cancelScheduledClose();
        };

        triggerEl.addEventListener('mouseenter', handlePointerEnter);
        triggerEl.addEventListener('mouseleave', handlePointerLeave);

        popoverEl.addEventListener('mouseenter', handlePointerEnter);
        popoverEl.addEventListener('mouseleave', handlePointerLeave);
    };

    const rail = document.getElementById('chapter-nav-rail');
    const chapterPopover = document.getElementById('chapter-popover');
    bindPopoverHoverBridge(rail, chapterPopover, closeChapterPopover, 180);

}
