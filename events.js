// @ts-check
// events.js
// 職責：提供基於原生 EventTarget 的型別安全事件匯流排，解除業務／同步層與渲染層的反向直接依賴

/**
 * @typedef {import('./types.js').AppEventMap} AppEventMap
 * @typedef {import('./types.js').AppEventName} AppEventName
 */

/**
 * 全域事件名稱常數表
 * @type {Readonly<{
 *   TOAST_SHOW: 'toast:show',
 *   SYNC_STATUS_CHANGED: 'sync:status-changed',
 *   UI_RENDER_REQUESTED: 'ui:render-requested',
 *   UI_SELECT_REMINDERS: 'ui:select-reminders',
 *   MODAL_CLOUD_ALERT: 'modal:cloud-alert',
 *   MODAL_CLOSE_SETTINGS: 'modal:close-settings',
 *   SYNC_FLUSH_PENDING: 'sync:flush-pending',
 *   FAB_IDLE_RESET: 'fab:idle-reset',
 *   CHAPTER_INIT_SPY: 'chapter:init-spy',
 *   CHAPTER_CLEAR_SPY: 'chapter:clear-spy',
 *   SEARCH_CLEAR: 'search:clear',
 *   SEARCH_FILTER: 'search:filter',
 *   CALENDAR_HIGHLIGHT_RANGE: 'calendar:highlight-range'
 * }>}
 */
export const APP_EVENTS = Object.freeze({
    TOAST_SHOW: 'toast:show',
    SYNC_STATUS_CHANGED: 'sync:status-changed',
    UI_RENDER_REQUESTED: 'ui:render-requested',
    UI_SELECT_REMINDERS: 'ui:select-reminders',
    MODAL_CLOUD_ALERT: 'modal:cloud-alert',
    MODAL_CLOSE_SETTINGS: 'modal:close-settings',
    SYNC_FLUSH_PENDING: 'sync:flush-pending',
    FAB_IDLE_RESET: 'fab:idle-reset',
    CHAPTER_INIT_SPY: 'chapter:init-spy',
    CHAPTER_CLEAR_SPY: 'chapter:clear-spy',
    SEARCH_CLEAR: 'search:clear',
    SEARCH_FILTER: 'search:filter',
    CALENDAR_HIGHLIGHT_RANGE: 'calendar:highlight-range'
});

/**
 * 應用程式全域事件匯流排單例
 * @type {EventTarget}
 */
export const appEvents = new EventTarget();

/**
 * 派發具型別檢查的應用程式事件
 * @template {AppEventName} K
 * @param {K} type
 * @param {AppEventMap[K]} [detail]
 * @returns {boolean}
 */
export function emitAppEvent(type, detail) {
    return appEvents.dispatchEvent(new CustomEvent(type, { detail }));
}

/**
 * 訂閱具型別檢查的應用程式事件，並回傳取消訂閱函式（便於未來銜接 React useEffect cleanup）
 * @template {AppEventName} K
 * @param {K} type
 * @param {(detail: AppEventMap[K], event: CustomEvent<AppEventMap[K]>) => void} handler
 * @returns {() => void}
 */
export function onAppEvent(type, handler) {
    /** @param {Event} event */
    const listener = (event) => {
        const customEvent = /** @type {CustomEvent<AppEventMap[K]>} */ (event);
        handler(customEvent.detail, customEvent);
    };
    appEvents.addEventListener(type, listener);
    return () => {
        appEvents.removeEventListener(type, listener);
    };
}