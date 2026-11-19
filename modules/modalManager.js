// @ts-check
// modules/modalManager.js
// 職責：統一管理所有彈窗（state.activeModals）的開啟／關閉動畫時序、過渡結束監聽與「關閉全部視窗」入口

import { state } from '../state.js';
import { hasModal, getTopModal, openModalState, closeModalState } from '../domain.js';

/**
 * @typedef {import('../types.js').ModalId} ModalId
 */

/**
 * @typedef {Object} ModalLifecycleHandler
 * @property {() => void} [close]
 * @property {() => void} [onEsc]
 */

/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const modalCloseTimers = new Map();

/** @type {Map<ModalId, ModalLifecycleHandler>} */
const modalHandlers = new Map();

/** @type {Map<string, () => void>} */
const popoverClosers = new Map();

const POPOVER_IDS = [
    'category-popover-menu',
    'header-popover-menu',
    'sidebar-profile-popover',
    'sidebar-collapsed-menu',
    'floating-avatar-popover',
    'custom-context-menu',
    'chapter-popover'
];

/**
 * 註冊特定彈窗的關閉與 Esc 鍵自訂處理器（由各功能模組在初始化時呼叫，避免反向循環依賴）
 * @param {ModalId} modalId
 * @param {ModalLifecycleHandler} handler
 */
export function registerModalHandler(modalId, handler) {
    modalHandlers.set(modalId, handler);
}

/**
 * 註冊浮動氣泡選單的關閉函式
 * @param {string} popoverId
 * @param {() => void} closeFn
 */
export function registerPopoverCloser(popoverId, closeFn) {
    popoverClosers.set(popoverId, closeFn);
}

/**
 * @param {string} key
 */
export function cancelModalCloseTimer(key) {
    const timer = modalCloseTimers.get(key);
    if (timer) {
        clearTimeout(timer);
        modalCloseTimers.delete(key);
    }
}

/**
 * @param {string} key
 * @param {Array<{ el: HTMLElement | null, checkActive?: boolean }>} elements
 * @param {number} [delayMs]
 * @param {(() => void) | null} [afterHide]
 */
export function scheduleModalHide(key, elements, delayMs = 250, afterHide = null) {
    cancelModalCloseTimer(key);
    const timer = setTimeout(() => {
        modalCloseTimers.delete(key);
        elements.forEach(({ el, checkActive }) => {
            if (!el) return;
            if (!checkActive || !el.classList.contains('active')) {
                el.style.display = 'none';
            }
        });
        if (typeof afterHide === 'function') afterHide();
    }, delayMs);
    modalCloseTimers.set(key, timer);
}

/**
 * 監聽 CSS transition 結束並附帶超時保底回呼
 * @param {HTMLElement | null} el
 * @param {string} propName
 * @param {number} fallbackMs
 * @param {() => void} callback
 */
export function onTransitionEnd(el, propName, fallbackMs, callback) {
    if (!el) {
        callback();
        return;
    }
    let done = false;
    const finish = () => {
        if (done) return;
        done = true;
        el.removeEventListener('transitionend', handler);
        clearTimeout(fallbackTimer);
        callback();
    };
    /** @param {Event} e */
    const handler = (e) => {
        const te = /** @type {TransitionEvent} */ (e);
        if (te.target === el && te.propertyName === propName) finish();
    };
    el.addEventListener('transitionend', handler);
    const fallbackTimer = setTimeout(finish, fallbackMs);
}

/**
 * 統一開啟指定彈窗（更新 state.activeModals 並同步 DOM 顯示與雙重 rAF .active 動畫）
 * @param {ModalId} modalId
 * @param {{ onBeforeActivate?: () => void, onAfterActivate?: () => void }} [hooks]
 */
export function openModal(modalId, hooks = {}) {
    openModalState(state, modalId);

    if (modalId === 'editor') {
        cancelModalCloseTimer('editor');
        const overlay = document.getElementById('modal-overlay');
        const modal = document.getElementById('editor-modal');
        const topBar = document.getElementById('editor-external-top-bar');
        const bottomBar = document.getElementById('editor-external-bottom-bar');

        if (modal) {
            modal.classList.remove('shake-animation');
            modal.style.visibility = 'visible';
            modal.style.pointerEvents = '';
            modal.style.display = 'flex';
        }
        if (overlay) overlay.style.display = 'block';
        if (topBar) {
            topBar.style.visibility = 'visible';
            topBar.style.pointerEvents = '';
            topBar.style.display = 'flex';
        }
        if (bottomBar) {
            bottomBar.style.visibility = 'visible';
            bottomBar.style.pointerEvents = '';
            bottomBar.style.display = 'flex';
        }
        if (typeof hooks.onBeforeActivate === 'function') hooks.onBeforeActivate();

        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (!hasModal(state, 'editor')) return;
            if (overlay) overlay.classList.add('active');
            if (modal) modal.classList.add('active');
            if (typeof hooks.onAfterActivate === 'function') hooks.onAfterActivate();
            if (topBar) topBar.classList.add('active');
            if (bottomBar) bottomBar.classList.add('active');
        }));
        return;
    }

    if (modalId === 'full-editor') {
        cancelModalCloseTimer('full-editor');
        const fullModal = document.getElementById('full-editor-modal');
        const editorModal = document.getElementById('editor-modal');
        const topBar = document.getElementById('editor-external-top-bar');
        const bottomBar = document.getElementById('editor-external-bottom-bar');

        if (fullModal) fullModal.style.display = 'flex';
        if (editorModal) {
            editorModal.classList.remove('active');
            editorModal.style.pointerEvents = 'none';
        }
        if (topBar) {
            topBar.classList.remove('active');
            topBar.style.pointerEvents = 'none';
        }
        if (bottomBar) {
            bottomBar.classList.remove('active');
            bottomBar.style.pointerEvents = 'none';
        }
        if (typeof hooks.onBeforeActivate === 'function') hooks.onBeforeActivate();

        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (!hasModal(state, 'full-editor')) return;
            if (fullModal) fullModal.classList.add('active');
            if (typeof hooks.onAfterActivate === 'function') hooks.onAfterActivate();
        }));
        return;
    }

    if (modalId === 'calendar') {
        cancelModalCloseTimer('calendar');
        const overlay = document.getElementById('calendar-overlay');
        const modal = document.getElementById('calendar-modal');
        if (overlay) overlay.style.display = 'block';
        if (modal) modal.style.display = 'block';
        if (typeof hooks.onBeforeActivate === 'function') hooks.onBeforeActivate();

        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (!hasModal(state, 'calendar')) return;
            if (overlay) overlay.classList.add('active');
            if (modal) modal.classList.add('active');
            if (typeof hooks.onAfterActivate === 'function') hooks.onAfterActivate();
        }));
        return;
    }

    if (modalId === 'category') {
        cancelModalCloseTimer('category');
        const overlay = document.getElementById('confirm-overlay');
        const modal = document.getElementById('category-modal');
        const topBar = document.getElementById('category-external-top-bar');
        const bottomBar = document.getElementById('category-external-bottom-bar');

        if (overlay) {
            overlay.style.zIndex = '10002';
            overlay.style.display = 'block';
        }
        if (topBar) topBar.style.display = 'flex';
        if (bottomBar) bottomBar.style.display = 'flex';
        if (modal) modal.style.display = 'flex';
        if (typeof hooks.onBeforeActivate === 'function') hooks.onBeforeActivate();

        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (!hasModal(state, 'category')) return;
            if (overlay) overlay.classList.add('active');
            if (modal) modal.classList.add('active');
            if (typeof hooks.onAfterActivate === 'function') hooks.onAfterActivate();
            if (topBar) topBar.classList.add('active');
            if (bottomBar) bottomBar.classList.add('active');
        }));
        return;
    }

    if (modalId === 'sort') {
        cancelModalCloseTimer('sort');
        const overlay = document.getElementById('modal-overlay');
        const modal = document.getElementById('sort-modal');
        const topBar = document.getElementById('sort-external-top-bar');
        const bottomBar = document.getElementById('sort-external-bottom-bar');

        if (overlay) {
            overlay.style.display = 'block';
            overlay.classList.add('active');
        }
        if (topBar) topBar.style.display = 'flex';
        if (bottomBar) bottomBar.style.display = 'flex';
        if (modal) {
            modal.style.display = 'flex';
            if (typeof hooks.onBeforeActivate === 'function') hooks.onBeforeActivate();
            requestAnimationFrame(() => requestAnimationFrame(() => {
                if (!hasModal(state, 'sort')) return;
                modal.classList.add('active');
                if (typeof hooks.onAfterActivate === 'function') hooks.onAfterActivate();
                if (topBar) topBar.classList.add('active');
                if (bottomBar) bottomBar.classList.add('active');
            }));
        }
        return;
    }

    if (modalId === 'confirm' || modalId === 'settings' || modalId === 'cloud-alert') {
        cancelModalCloseTimer(modalId);
        const overlay = document.getElementById('confirm-overlay');
        const targetId = modalId === 'confirm'
            ? 'confirm-modal'
            : (modalId === 'settings' ? 'settings-modal' : 'cloud-alert-modal');
        const modal = document.getElementById(targetId);

        if (overlay) overlay.style.display = 'block';
        if (modal) modal.style.display = 'block';
        if (typeof hooks.onBeforeActivate === 'function') hooks.onBeforeActivate();

        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (!hasModal(state, modalId)) return;
            if (typeof hooks.onAfterActivate === 'function') hooks.onAfterActivate();
            if (overlay) overlay.classList.add('active');
            if (modal) modal.classList.add('active');
        }));
    }
}

/**
 * 統一關閉指定彈窗（更新 state.activeModals 並同步移除 .active 與延遲隱藏 DOM）
 * @param {ModalId} modalId
 * @param {{ afterClose?: () => void }} [hooks]
 */
export function closeModal(modalId, hooks = {}) {
    closeModalState(state, modalId);

    if (modalId === 'editor') {
        const overlay = document.getElementById('modal-overlay');
        const modal = document.getElementById('editor-modal');
        const topBar = document.getElementById('editor-external-top-bar');
        const bottomBar = document.getElementById('editor-external-bottom-bar');

        if (overlay && !hasModal(state, 'sort')) overlay.classList.remove('active');
        if (topBar) {
            topBar.classList.remove('active');
            topBar.style.pointerEvents = '';
        }
        if (bottomBar) {
            bottomBar.classList.remove('active');
            bottomBar.style.pointerEvents = '';
        }
        if (modal) {
            modal.classList.remove('active');
            modal.style.opacity = '';
            modal.style.pointerEvents = '';
        }

        scheduleModalHide(
            'editor',
            [
                { el: overlay, checkActive: true },
                { el: topBar, checkActive: true },
                { el: bottomBar, checkActive: true },
                { el: modal, checkActive: true }
            ],
            250,
            hooks.afterClose || null
        );
        return;
    }

    if (modalId === 'full-editor') {
        const fullModal = document.getElementById('full-editor-modal');
        if (fullModal) fullModal.classList.remove('active');
        scheduleModalHide(
            'full-editor',
            [{ el: fullModal, checkActive: true }],
            260,
            hooks.afterClose || null
        );
        return;
    }

    if (modalId === 'calendar') {
        const overlay = document.getElementById('calendar-overlay');
        const modal = document.getElementById('calendar-modal');
        if (overlay) overlay.classList.remove('active');
        if (modal) modal.classList.remove('active');

        scheduleModalHide(
            'calendar',
            [
                { el: overlay, checkActive: true },
                { el: modal, checkActive: true }
            ],
            250,
            hooks.afterClose || null
        );
        return;
    }

    if (modalId === 'category') {
        const overlay = document.getElementById('confirm-overlay');
        const modal = document.getElementById('category-modal');
        const topBar = document.getElementById('category-external-top-bar');
        const bottomBar = document.getElementById('category-external-bottom-bar');

        if (topBar) topBar.classList.remove('active');
        if (bottomBar) bottomBar.classList.remove('active');
        if (modal) modal.classList.remove('active');
        const hasOtherConfirmOverlayModal = hasModal(state, 'confirm') || hasModal(state, 'settings') || hasModal(state, 'cloud-alert');
        if (overlay && !hasOtherConfirmOverlayModal) overlay.classList.remove('active');

        scheduleModalHide(
            'category',
            [
                { el: modal, checkActive: true },
                { el: overlay, checkActive: true },
                { el: topBar, checkActive: true },
                { el: bottomBar, checkActive: true }
            ],
            260,
            () => {
                if (overlay && !hasModal(state, 'category')) overlay.style.zIndex = '';
                if (typeof hooks.afterClose === 'function') hooks.afterClose();
            }
        );
        return;
    }

    if (modalId === 'sort') {
        const overlay = document.getElementById('modal-overlay');
        const modal = document.getElementById('sort-modal');
        const topBar = document.getElementById('sort-external-top-bar');
        const bottomBar = document.getElementById('sort-external-bottom-bar');

        if (overlay && !hasModal(state, 'editor')) overlay.classList.remove('active');
        if (topBar) topBar.classList.remove('active');
        if (bottomBar) bottomBar.classList.remove('active');
        if (modal) modal.classList.remove('active');

        scheduleModalHide(
            'sort',
            [
                { el: overlay, checkActive: true },
                { el: modal, checkActive: true },
                { el: topBar, checkActive: true },
                { el: bottomBar, checkActive: true }
            ],
            260,
            hooks.afterClose || null
        );
        return;
    }

    if (modalId === 'confirm' || modalId === 'settings' || modalId === 'cloud-alert') {
        const overlay = document.getElementById('confirm-overlay');
        const targetId = modalId === 'confirm'
            ? 'confirm-modal'
            : (modalId === 'settings' ? 'settings-modal' : 'cloud-alert-modal');
        const modal = document.getElementById(targetId);

        if (modal) modal.classList.remove('active');
        const hasOtherConfirmOverlayModal = hasModal(state, 'confirm') || hasModal(state, 'settings') || hasModal(state, 'cloud-alert') || hasModal(state, 'category');
        if (overlay && !hasOtherConfirmOverlayModal) overlay.classList.remove('active');

        scheduleModalHide(
            modalId,
            [
                { el: modal, checkActive: true },
                { el: overlay, checkActive: true }
            ],
            250,
            hooks.afterClose || null
        );
    }
}

/**
 * 統一彈窗與浮動選單關閉入口（建立於 state.activeModals 堆疊之上）
 * @param {{
 *   mode?: 'top' | 'all',
 *   exclude?: ModalId[],
 *   closePopovers?: boolean
 * }} [options]
 * @returns {boolean} 是否實際關閉了任一浮動選單或彈窗
 */
export function closeAllModals(options = {}) {
    const mode = options.mode || 'top';
    const excludeSet = new Set(options.exclude || []);
    const shouldClosePopovers = options.closePopovers !== false;
    let didCloseAny = false;

    if (shouldClosePopovers) {
        for (const popoverId of POPOVER_IDS) {
            const el = document.getElementById(popoverId);
            if (!el || !el.classList.contains('active')) continue;

            const closer = popoverClosers.get(popoverId);
            if (typeof closer === 'function') {
                closer();
            } else {
                el.classList.remove('active');
                if (popoverId === 'chapter-popover') {
                    const rail = document.getElementById('chapter-nav-rail');
                    if (rail) rail.classList.remove('active');
                }
            }
            didCloseAny = true;
            if (mode === 'top') return true;
        }
    }

    if (mode === 'top') {
        const topModal = getTopModal(state);
        if (!topModal || excludeSet.has(topModal)) {
            return didCloseAny;
        }
        const handler = modalHandlers.get(topModal);
        if (handler && typeof handler.onEsc === 'function') {
            handler.onEsc();
        } else if (handler && typeof handler.close === 'function') {
            handler.close();
        } else {
            closeModal(topModal);
        }
        return true;
    }

    if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
    }

    const snapshot = [...(state.activeModals || [])].reverse();
    for (const modalId of snapshot) {
        if (excludeSet.has(modalId)) continue;
        if (!hasModal(state, modalId)) continue;

        const handler = modalHandlers.get(modalId);
        if (handler && typeof handler.close === 'function') {
            handler.close();
        } else {
            closeModal(modalId);
        }
        didCloseAny = true;
    }

    return didCloseAny;
}
