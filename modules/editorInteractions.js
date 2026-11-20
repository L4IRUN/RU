// @ts-check
// @ts-nocheck
// 沿用來源型別檢查範圍；本階段只做機械搬移。

import { state } from '../state.js';

import { setFabTucked, resetFabIdleTimer } from './editor.js';

import { hasModal } from '../domain.js';

import { positionEditorExternalBars } from './editorLayout.js';

export function initEditorCaretScrolling() {
    const fullNoteContent = document.getElementById('full-note-content');
    if (fullNoteContent) {
        let _scrollCaretRAF = null;
        const scrollToCaretThrottled = () => {
            if (_scrollCaretRAF) return;
            _scrollCaretRAF = requestAnimationFrame(() => {
                _scrollCaretRAF = null;
                if (state._cachedInnerWidth > 768) return;
                const selection = window.getSelection();
                if (!selection || selection.rangeCount === 0) return;
                const range = selection.getRangeAt(0);
                let rect = range.getBoundingClientRect();
                if (rect.x === 0 && rect.y === 0) {
                    const node = selection.anchorNode;
                    if (node && node.nodeType === 1) rect = node.getBoundingClientRect();
                    else if (node && node.parentElement) rect = node.parentElement.getBoundingClientRect();
                }
                const container = document.getElementById('full-note-content');
                if (!container) return;
                const containerRect = container.getBoundingClientRect();
                if (rect.bottom > containerRect.bottom - 40) container.scrollTop += (rect.bottom - containerRect.bottom + 40);
                else if (rect.top < containerRect.top + 40) container.scrollTop -= (containerRect.top - rect.top + 40);
            });
        };
        fullNoteContent.addEventListener('input', scrollToCaretThrottled, { passive: true });
        fullNoteContent.addEventListener('keyup', scrollToCaretThrottled, { passive: true });
        fullNoteContent.addEventListener('click', scrollToCaretThrottled, { passive: true });
    }

}

export function initFabInteractions() {
    const mainFab = document.querySelector('.fab-main-btn');
    let fabStartX = 0, fabStartY = 0;
    // 只有「確實從按鈕上開始」的操作才會在結束時被判定為滑動；
    // 否則 document 上任何一次點擊（含觸控後瀏覽器補發的 mouseup）都會拿舊的起點座標去算，
    // 造成按鈕隨機收起或隨機彈出
    let fabInteractionActive = false;
    let lastFabTouchAt = 0;
    if (mainFab) {
        const startFabInteraction = (clientX, clientY) => {
            fabStartX = clientX;
            fabStartY = clientY;
            fabInteractionActive = true;
        };
        const cancelFabInteraction = () => { fabInteractionActive = false; };
        const endFabInteraction = (clientX, clientY) => {
            if (!fabInteractionActive) return;
            fabInteractionActive = false;
            if (mainFab.classList.contains('toast-mode') || state.isSelectionMode) return;
            if (state._cachedInnerWidth <= 768 && clientX !== undefined && clientY !== undefined) {
                let diffY = clientY - fabStartY;
                if (diffY > 20) {
                    setFabTucked(true);
                } else if (diffY < -20) {
                    setFabTucked(false);
                }
            }
        };
        mainFab.addEventListener('mousedown', (e) => {
            // 忽略觸控後瀏覽器補發的模擬滑鼠事件
            if (Date.now() - lastFabTouchAt < 800) return;
            startFabInteraction(e.clientX, e.clientY);
        });
        document.addEventListener('mouseup', (e) => {
            if (Date.now() - lastFabTouchAt < 800) { fabInteractionActive = false; return; }
            endFabInteraction(e.clientX, e.clientY);
        });
        mainFab.addEventListener('touchstart', (e) => {
            lastFabTouchAt = Date.now();
            startFabInteraction(e.touches[0].clientX, e.touches[0].clientY);
        }, { passive: true });
        mainFab.addEventListener('touchend', (e) => {
            lastFabTouchAt = Date.now();
            if (e.changedTouches.length > 0) endFabInteraction(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
            else cancelFabInteraction();
        }, { passive: true });
        mainFab.addEventListener('touchcancel', () => {
            lastFabTouchAt = Date.now();
            cancelFabInteraction();
        }, { passive: true });
    }

    // 視窗尺寸變更（旋轉、桌面/手機寬度切換）或頁面從背景／快取回來時，重新校正按鈕狀態
    const reconcileFab = () => {
        if (state._cachedInnerWidth > 768) {
            clearTimeout(state.fabIdleTimer);
            setFabTucked(false);
        } else {
            resetFabIdleTimer();
        }
    };
    window.addEventListener('resize', reconcileFab, { passive: true });
    window.addEventListener('pageshow', reconcileFab);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reconcileFab();
    });

}

export function initEditorViewportInteractions() {
    const viewport = window.visualViewport;
    const updateEditorViewport = () => {
        if (viewport) {
            const isZoomed = Math.abs((viewport.scale || 1) - 1) > 0.05;
            const style = document.documentElement.style;
            style.setProperty('--vv-height', `${Math.floor(viewport.height)}px`);
            style.setProperty('--vv-top', `${isZoomed ? Math.round(viewport.offsetTop) : 0}px`);
        }
        if (hasModal(state, 'editor')) positionEditorExternalBars();
    };

    const preventWindowScroll = () => {
        if ((hasModal(state, 'editor') || hasModal(state, 'full-editor')) && (window.scrollY !== 0 || window.scrollX !== 0)) {
            window.scrollTo(0, 0);
        }
    };

    window.addEventListener('resize', updateEditorViewport, { passive: true });
    viewport?.addEventListener('resize', updateEditorViewport, { passive: true });
    window.addEventListener('scroll', preventWindowScroll, { passive: true });
    viewport?.addEventListener('scroll', () => {
        preventWindowScroll();
        updateEditorViewport();
    }, { passive: true });

    const editor = document.getElementById('editor-modal');
    editor?.addEventListener('focusin', (e) => {
        preventWindowScroll();
        const target = e.target;
        if (target && editor.contains(target) && target.matches('input, textarea, [contenteditable="true"]')) {
            const box = editor.getBoundingClientRect();
            const input = target.getBoundingClientRect();
            const pad = 14;
            if (input.bottom > box.bottom - pad) {
                editor.scrollTop += Math.round(input.bottom - box.bottom + pad);
            } else if (input.top < box.top + pad) {
                editor.scrollTop -= Math.round(box.top - input.top + pad);
            }
        }
        updateEditorViewport();
    });

    const fullEditor = document.getElementById('full-editor-modal');
    fullEditor?.addEventListener('focusin', () => {
        preventWindowScroll();
    });

    if (viewport) updateEditorViewport();
}

export function initTextSelectionInteractions() {
    let textSelectionTimer = null;
    let isPointerSelectingText = false;
    let selectionStartedInEditor = false;

    const getActiveTextEditor = () => {
        return hasModal(state, 'full-editor') ? document.getElementById('full-note-content') : null;
    };

    const nodeIsInside = (container, node) => {
        return !!(container && node && (node === container || container.contains(node)));
    };

    const getSelectionBounds = (selection) => {
        if (!selection || selection.rangeCount === 0) return null;
        const range = selection.getRangeAt(0);
        const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0);

        if (rects.length > 0) {
            return rects.reduce((bounds, rect) => ({
                left: Math.min(bounds.left, rect.left),
                top: Math.min(bounds.top, rect.top),
                right: Math.max(bounds.right, rect.right),
                bottom: Math.max(bounds.bottom, rect.bottom),
                width: Math.max(bounds.right, rect.right) - Math.min(bounds.left, rect.left),
                height: Math.max(bounds.bottom, rect.bottom) - Math.min(bounds.top, rect.top)
            }), {
                left: rects[0].left,
                top: rects[0].top,
                right: rects[0].right,
                bottom: rects[0].bottom,
                width: rects[0].width,
                height: rects[0].height
            });
        }

        const rect = range.getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0) return rect;

        const node = selection.anchorNode;
        if (node && node.nodeType === 1) return node.getBoundingClientRect();
        if (node && node.parentElement) return node.parentElement.getBoundingClientRect();
        return null;
    };

    const hideTextToolbar = () => {
        clearTimeout(textSelectionTimer);
        const toolbar = document.getElementById('text-toolbar');
        if (toolbar) toolbar.classList.remove('active');
    };

    const positionTextToolbar = (toolbar, selectionRect) => {
        const toolbarWidth = toolbar.offsetWidth || 240;
        const toolbarHeight = toolbar.offsetHeight || 48;
        const gap = 14;
        const edgeGap = 8;
        const viewport = window.visualViewport;
        const viewportLeft = viewport ? viewport.offsetLeft : 0;
        const viewportTop = viewport ? viewport.offsetTop : 0;
        const viewportWidth = viewport ? viewport.width : window.innerWidth;
        const viewportHeight = viewport ? viewport.height : window.innerHeight;
        const viewportRight = viewportLeft + viewportWidth;
        const viewportBottom = viewportTop + viewportHeight;
        const unclampedLeft = selectionRect.left + selectionRect.width / 2;
        const minLeft = viewportLeft + edgeGap + toolbarWidth / 2;
        const maxLeft = viewportRight - edgeGap - toolbarWidth / 2;
        const left = Math.min(Math.max(unclampedLeft, minLeft), maxLeft);
        const topAbove = selectionRect.top - toolbarHeight - gap;
        const topBelow = selectionRect.bottom + gap;
        const canFitAbove = topAbove >= viewportTop + edgeGap;
        const canFitBelow = topBelow + toolbarHeight <= viewportBottom - edgeGap;
        const placeAbove = canFitAbove || !canFitBelow;
        const unclampedTop = placeAbove ? topAbove : topBelow;
        const top = Math.min(Math.max(unclampedTop, viewportTop + edgeGap), viewportBottom - toolbarHeight - edgeGap);

        toolbar.dataset.placement = placeAbove ? 'above' : 'below';
        toolbar.style.left = `${left}px`;
        toolbar.style.top = `${top}px`;
    };

    const showTextToolbar = () => {
        const selection = window.getSelection();
        const toolbar = document.getElementById('text-toolbar');
        if (!toolbar) return;

        if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !selection.toString().trim()) {
            toolbar.classList.remove('active');
            return;
        }

        const activeEditor = getActiveTextEditor();
        if (!activeEditor || document.activeElement !== activeEditor) {
            toolbar.classList.remove('active');
            return;
        }

        if (!nodeIsInside(activeEditor, selection.anchorNode) || !nodeIsInside(activeEditor, selection.focusNode)) {
            toolbar.classList.remove('active');
            return;
        }

        const selectionRect = getSelectionBounds(selection);
        if (!selectionRect || (selectionRect.left === 0 && selectionRect.top === 0 && selectionRect.width === 0 && selectionRect.height === 0)) {
            toolbar.classList.remove('active');
            return;
        }

        toolbar.classList.remove('active');
        positionTextToolbar(toolbar, selectionRect);
        requestAnimationFrame(() => toolbar.classList.add('active'));
    };

    const queueTextToolbar = (delay = 220) => {
        clearTimeout(textSelectionTimer);
        if (isPointerSelectingText) {
            const toolbar = document.getElementById('text-toolbar');
            if (toolbar) toolbar.classList.remove('active');
            return;
        }
        textSelectionTimer = setTimeout(showTextToolbar, delay);
    };

    const handleSelectionPointerStart = (e) => {
        const target = e.target;
        if (!target || !target.closest) return;
        if (target.closest('#text-toolbar')) return;
        const editor = target.closest('#full-note-content');
        isPointerSelectingText = !!editor;
        selectionStartedInEditor = !!editor;
        hideTextToolbar();
    };

    const handleSelectionPointerMove = () => {
        if (isPointerSelectingText) hideTextToolbar();
    };

    const handleSelectionPointerEnd = () => {
        const shouldShowAfterSelection = isPointerSelectingText && selectionStartedInEditor;
        isPointerSelectingText = false;
        selectionStartedInEditor = false;
        if (shouldShowAfterSelection) queueTextToolbar(260);
    };

    document.addEventListener('mousedown', handleSelectionPointerStart, true);
    document.addEventListener('mousemove', handleSelectionPointerMove, true);
    document.addEventListener('mouseup', handleSelectionPointerEnd, true);
    document.addEventListener('touchstart', handleSelectionPointerStart, true);
    document.addEventListener('touchmove', handleSelectionPointerMove, true);
    document.addEventListener('touchend', handleSelectionPointerEnd, true);
    document.addEventListener('touchcancel', handleSelectionPointerEnd, true);
    document.addEventListener('keyup', () => queueTextToolbar(140));
    document.addEventListener('selectionchange', () => queueTextToolbar());
}
