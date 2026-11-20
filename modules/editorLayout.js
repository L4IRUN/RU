// @ts-check

let restingViewportHeight = 0;
let restingViewportWidth = 0;
/** @type {{
 *   field: Element,
 *   width: number,
 *   lostHeight: number,
 *   top: number,
 *   height: number,
 *   widthPx: number,
 *   centerX: number,
 *   centerY: number,
 *   leftX: number,
 *   topY: number,
 *   bottomY: number,
 *   held: boolean
 * } | null} */
let keyboardBox = null;

export function positionEditorExternalBars() {
    const topBar = document.getElementById('editor-external-top-bar');
    const bottomBar = document.getElementById('editor-external-bottom-bar');
    const modal = document.getElementById('editor-modal');
    if (!modal) return;

    const vv = window.visualViewport;
    const isZoomed = Boolean(vv && Math.abs((vv.scale || 1) - 1) > 0.05);
    const vpWidth = vv ? vv.width : window.innerWidth;
    const vpHeight = vv ? Math.floor(vv.height) : window.innerHeight;
    const vpOffsetLeft = (vv && isZoomed) ? vv.offsetLeft : 0;
    const vpOffsetTop = (vv && isZoomed) ? Math.round(vv.offsetTop) : 0;

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

    const topBarHeight = isMobile ? 64 : 74;
    const bottomBarHeight = isMobile ? 52 : 60;
    const gap = 12;

    let modalWidth = Math.min(400, Math.round(vpWidth * 0.9));
    // 隨鍵盤位移逐步釋放操作列空間，避免跨過顯示門檻時表單反向跳高。
    const releasedHeight = trackingKeyboard ? Math.min(144, Math.max(0, lostHeight - 48)) : 0;
    const reservedHeight = isMobile ? 168 - releasedHeight : 190;
    const minModalHeight = isMobile ? 80 : 220;
    let modalHeight = Math.max(minModalHeight, Math.min(536, vpHeight - reservedHeight));
    let modalTop = (vpHeight - modalHeight) / 2;

    let centerX = Math.round(vpOffsetLeft + vpWidth / 2);
    let centerY = Math.round(vpOffsetTop + modalTop + modalHeight / 2);
    let leftX = Math.round(centerX - modalWidth / 2);
    let topY = Math.max(
        Math.round(vpOffsetTop + 12),
        Math.round(centerY - modalHeight / 2 - topBarHeight - gap)
    );
    let bottomY = Math.min(
        Math.round(vpOffsetTop + vpHeight - bottomBarHeight - 12),
        Math.round(centerY + modalHeight / 2 + gap)
    );

    if (keyboardOpen && (isTyping || keyboardBox)) {
        if (keyboardBox && keyboardBox.width === layoutWidth) {
            // 切換輸入框時直接鎖定先前的完整位置與大小，絕不隨切換重新跳動
            modalWidth = keyboardBox.widthPx;
            modalHeight = keyboardBox.height;
            modalTop = keyboardBox.top;
            centerX = keyboardBox.centerX;
            centerY = keyboardBox.centerY;
            leftX = keyboardBox.leftX;
            topY = keyboardBox.topY;
            bottomY = keyboardBox.bottomY;
        } else {
            keyboardBox = {
                field: field || modal,
                width: layoutWidth,
                lostHeight,
                top: modalTop,
                height: modalHeight,
                widthPx: modalWidth,
                centerX,
                centerY,
                leftX,
                topY,
                bottomY,
                held: true
            };
        }
    } else if (!keyboardOpen) {
        keyboardBox = null;
    }

    modal.style.left = `${centerX}px`;
    modal.style.top = `${centerY}px`;
    modal.style.width = `${modalWidth}px`;
    modal.style.height = `${modalHeight}px`;
    modal.style.maxHeight = `${modalHeight}px`;

    // 視窗內輸入中或切換輸入框時，確保輸入框完全露出於視窗內，不讓瀏覽器外推視窗
    if (isTyping && field && modal.contains(field)) {
        const box = modal.getBoundingClientRect();
        const input = field.getBoundingClientRect();
        const pad = 14;
        if (input.bottom > box.bottom - pad) {
            modal.scrollTop += Math.round(input.bottom - box.bottom + pad);
        } else if (input.top < box.top + pad) {
            modal.scrollTop -= Math.round(box.top - input.top + pad);
        }
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
