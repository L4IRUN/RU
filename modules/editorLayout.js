// @ts-check

let restingViewportHeight = 0;
let restingViewportWidth = 0;
/** @type {{ field: Element, width: number, top: number, height: number, held: boolean } | null} */
let keyboardBox = null;

export function positionEditorExternalBars() {
    const topBar = document.getElementById('editor-external-top-bar');
    const bottomBar = document.getElementById('editor-external-bottom-bar');
    const modal = document.getElementById('editor-modal');
    if (!modal) return;

    const vv = window.visualViewport;
    const vpWidth = vv ? vv.width : window.innerWidth;
    const vpHeight = vv ? Math.floor(vv.height) : window.innerHeight;
    const vpOffsetLeft = vv ? vv.offsetLeft : 0;
    const vpOffsetTop = vv ? Math.round(vv.offsetTop) : 0;

    const layoutWidth = window.innerWidth;
    const isMobile = layoutWidth <= 768;
    const hasKeyboard = topBar?.classList.contains('keyboard-hidden');
    const field = document.activeElement;
    const isTyping = Boolean(field && modal.contains(field) &&
        field.matches('input:not(:read-only), textarea:not(:read-only), [contenteditable="true"]'));
    const viewportHeightAtLayoutScale = vpHeight * (vv?.scale || 1);
    // 部分鍵盤會同時縮小 layout viewport，須保留輸入前的高度作為基準。
    if ((!hasKeyboard && !isTyping) || restingViewportWidth !== layoutWidth) {
        restingViewportHeight = 0;
        restingViewportWidth = layoutWidth;
    }
    restingViewportHeight = Math.max(restingViewportHeight, window.innerHeight, viewportHeightAtLayoutScale);

    // 鍵盤收合途中仍維持隱藏，等可視高度接近恢復後才讓操作列彈回。
    const keyboardThreshold = hasKeyboard ? 48 : 150;
    const lostHeight = restingViewportHeight - viewportHeightAtLayoutScale;
    const trackingKeyboard = isMobile && (isTyping || Boolean(hasKeyboard));
    const keyboardOpen = trackingKeyboard && lostHeight >= keyboardThreshold;
    if (keyboardOpen) {
        document.body.style.setProperty('--editor-rest-height', `${restingViewportHeight}px`);
    } else {
        document.body.style.removeProperty('--editor-rest-height');
    }
    const modalWidth = Math.min(400, Math.round(vpWidth * 0.9));
    // 隨鍵盤位移逐步釋放操作列空間，避免跨過顯示門檻時表單反向跳高。
    const releasedHeight = trackingKeyboard ? Math.min(144, Math.max(0, lostHeight - 48)) : 0;
    const reservedHeight = isMobile ? 168 - releasedHeight : 190;
    const minModalHeight = isMobile ? 80 : 220;
    let modalHeight = Math.max(minModalHeight, Math.min(536, vpHeight - reservedHeight));
    let modalTop = (vpHeight - modalHeight) / 2;
    if (keyboardOpen && (isTyping || keyboardBox)) {
        if (keyboardBox && keyboardBox.width === layoutWidth) {
            // 切換輸入框時直接鎖定先前的 top 與 height，絕不隨切換重新跳動
            modalTop = keyboardBox.top;
            modalHeight = keyboardBox.height;
        } else {
            keyboardBox = { field: field || modal, width: layoutWidth, top: modalTop, height: modalHeight, held: true };
        }
    } else if (!keyboardOpen) {
        keyboardBox = null;
    }
    const topBarHeight = isMobile ? 64 : 74;
    const bottomBarHeight = isMobile ? 52 : 60;
    const gap = 12;

    const centerX = Math.round(vpOffsetLeft + vpWidth / 2);
    const centerY = Math.round(vpOffsetTop + modalTop + modalHeight / 2);
    const leftX = Math.round(centerX - modalWidth / 2);
    const topY = Math.max(
        Math.round(vpOffsetTop + 12),
        Math.round(centerY - modalHeight / 2 - topBarHeight - gap)
    );
    const bottomY = Math.min(
        Math.round(vpOffsetTop + vpHeight - bottomBarHeight - 12),
        Math.round(centerY + modalHeight / 2 + gap)
    );

    const shrinksWhileTyping = keyboardOpen && isTyping && modalHeight < parseFloat(modal.style.height);
    modal.style.left = `${centerX}px`;
    modal.style.top = `${centerY}px`;
    modal.style.width = `${modalWidth}px`;
    modal.style.height = `${modalHeight}px`;
    modal.style.maxHeight = `${modalHeight}px`;
    if (shrinksWhileTyping && field) {
        const box = modal.getBoundingClientRect();
        const input = field.getBoundingClientRect();
        if (input.bottom > box.bottom - 4) modal.scrollTop += input.bottom - box.bottom + 4;
        else if (input.top < box.top + 4) modal.scrollTop += input.top - box.top - 4;
    }

    if (topBar) {
        topBar.classList.toggle('keyboard-hidden', keyboardOpen);
        topBar.inert = keyboardOpen;
        topBar.style.left = `${leftX}px`;
        topBar.style.top = `${topY}px`;
        topBar.style.width = `${modalWidth}px`;
    }

    if (bottomBar) {
        bottomBar.classList.toggle('keyboard-hidden', keyboardOpen);
        bottomBar.inert = keyboardOpen;
        bottomBar.style.left = `${leftX}px`;
        bottomBar.style.top = `${bottomY}px`;
        bottomBar.style.width = `${modalWidth}px`;
    }
}
