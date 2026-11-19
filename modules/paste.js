// @ts-check

const PASTE_BLOCK_TAGS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'FIGCAPTION', 'FIGURE',
    'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'LI', 'MAIN',
    'NAV', 'OL', 'P', 'PRE', 'SECTION', 'UL'
]);

/** @type {any} */
const PASTE_INLINE_TAGS = new Map([
    ['B', 'strong'],
    ['STRONG', 'strong'],
    ['I', 'em'],
    ['EM', 'em'],
    ['U', 'u'],
    ['S', 's'],
    ['STRIKE', 's'],
    ['DEL', 's'],
    ['CODE', 'code']
]);

const PASTE_SKIP_TAGS = new Set([
    'BASE', 'IFRAME', 'LINK', 'META', 'NOSCRIPT', 'OBJECT', 'SCRIPT', 'STYLE', 'SVG', 'TEMPLATE',
    'IMAGE', 'PICTURE', 'CANVAS', 'VIDEO', 'AUDIO', 'SOURCE'
]);

/**
 * @param {Node} sourceNode
 * @param {Node} targetNode
 */
function appendSanitizedPasteChildren(sourceNode, targetNode) {
    sourceNode.childNodes.forEach(child => {
        const cleanChild = sanitizePasteNode(child);
        if (cleanChild) targetNode.appendChild(cleanChild);
    });
}

/** @param {any} node */
function sanitizePasteNode(node) {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.nodeValue);
    if (node.nodeType !== Node.ELEMENT_NODE) return document.createDocumentFragment();

    const tagName = node.tagName;
    if (PASTE_SKIP_TAGS.has(tagName)) return document.createDocumentFragment();
    if (tagName === 'BR') return document.createElement('br');

    if (tagName === 'IMG') {
        const rawSrc = (node.getAttribute('src') || '').trim();
        if (/^https:\/\/[^\s"']+/i.test(rawSrc)) {
            const cleanImg = document.createElement('img');
            cleanImg.setAttribute('src', rawSrc);
            if (node.hasAttribute('alt')) cleanImg.setAttribute('alt', node.getAttribute('alt'));
            if (node.hasAttribute('title')) cleanImg.setAttribute('title', node.getAttribute('title'));
            return cleanImg;
        }
        return document.createDocumentFragment();
    }

    if (PASTE_INLINE_TAGS.has(tagName)) {
        const cleanElement = document.createElement(PASTE_INLINE_TAGS.get(tagName));
        appendSanitizedPasteChildren(node, cleanElement);
        return cleanElement;
    }

    if (PASTE_BLOCK_TAGS.has(tagName)) {
        const cleanBlock = document.createElement('div');
        appendSanitizedPasteChildren(node, cleanBlock);
        if (!cleanBlock.childNodes.length) cleanBlock.appendChild(document.createElement('br'));
        return cleanBlock;
    }

    const fragment = document.createDocumentFragment();
    appendSanitizedPasteChildren(node, fragment);
    return fragment;
}

/** @param {string} html */
function normalizeSanitizedPasteHtml(html) {
    const template = document.createElement('template');
    template.innerHTML = html;

    const fragment = document.createDocumentFragment();
    appendSanitizedPasteChildren(template.content, fragment);

    const output = document.createElement('div');
    output.appendChild(fragment);
    return output.innerHTML
        .replace(/(?:<div><br><\/div>)+$/g, '')
        .trim();
}

/** @param {string} text */
export function textToPasteHtml(text) {
    if (!text) return '';
    const normalizedText = text.replace(/\r\n?/g, '\n');
    if (!normalizedText.includes('\n')) {
        const inlineText = document.createElement('span');
        inlineText.textContent = normalizedText;
        return inlineText.innerHTML;
    }

    const lines = normalizedText.split('\n');
    return lines.map(line => {
        const div = document.createElement('div');
        if (line) div.textContent = line;
        else div.appendChild(document.createElement('br'));
        return div.outerHTML;
    }).join('');
}

/** @param {DataTransfer | null} dataTransfer */
function getCleanPasteHtml(dataTransfer) {
    const html = dataTransfer ? dataTransfer.getData('text/html') : '';
    const text = dataTransfer ? dataTransfer.getData('text/plain') : '';
    if (html) {
        const cleanHtml = normalizeSanitizedPasteHtml(html);
        if (cleanHtml) return cleanHtml;
    }
    return textToPasteHtml(text);
}

/**
 * @param {Selection | null} selection
 * @param {HTMLElement} editor
 */
function selectionBelongsToEditor(selection, editor) {
    if (!selection || selection.rangeCount === 0) return false;
    const { anchorNode, focusNode } = selection;
    return (!anchorNode || editor.contains(anchorNode) || anchorNode === editor) &&
           (!focusNode || editor.contains(focusNode) || focusNode === editor);
}

/**
 * @param {HTMLElement} editor
 * @param {string} html
 */
export function insertCleanHtmlAtSelection(editor, html) {
    if (!html) return;

    editor.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (!selection || !selectionBelongsToEditor(selection, editor)) {
        editor.insertAdjacentHTML('beforeend', html);
        return;
    }

    const range = selection.getRangeAt(0);
    range.deleteContents();

    const template = document.createElement('template');
    template.innerHTML = html;
    const fragment = template.content;
    const childNodes = Array.from(fragment.childNodes);
    if (childNodes.length === 0) return;

    const lastNode = childNodes[childNodes.length - 1];
    range.insertNode(fragment);

    if (lastNode && lastNode.parentNode) {
        const newRange = document.createRange();
        newRange.setStartAfter(lastNode);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);
    }
}

/** @param {HTMLElement} editor */
export function notifyEditorContentChanged(editor) {
    const inputEvent = typeof InputEvent === 'function'
        ? new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' })
        : new Event('input', { bubbles: true });
    editor.dispatchEvent(inputEvent);
}

/** @param {any} e */
function handleCleanNotePaste(e) {
    const editor = e.currentTarget;
    if (!editor || !editor.matches('#full-note-content, #bookmark-content, #reminder-content')) return;

    // 先行強制終止瀏覽器預設貼上行為，防止原生 contenteditable 自動插入 Base64 圖片
    e.preventDefault();

    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    // 嚴格攔截剪貼簿檔案清單中的圖片
    if (clipboardData.files && clipboardData.files.length > 0) {
        for (let i = 0; i < clipboardData.files.length; i++) {
            if (clipboardData.files[i].type && clipboardData.files[i].type.startsWith('image/')) {
                return;
            }
        }
    }

    // 嚴格攔截剪貼簿 DataTransferItems 中的圖片
    if (clipboardData.items && clipboardData.items.length > 0) {
        for (let i = 0; i < clipboardData.items.length; i++) {
            if (clipboardData.items[i].type && clipboardData.items[i].type.startsWith('image/')) {
                return;
            }
        }
    }

    const cleanHtml = getCleanPasteHtml(clipboardData);
    if (!cleanHtml) return;

    // 二次過濾殘餘的 Base64 內嵌圖片標籤與 Base64 字串屬性，保留外部 HTTPS 圖片標籤
    const finalCleanHtml = cleanHtml
        .replace(/<img\b[^>]*?\bsrc\s*=\s*["']?\s*data:image\/[^"'>\s]+["']?[^>]*>/gi, '')
        .replace(/data:image\/[^;]+;base64,[^\s"']+/gi, '');

    if (!finalCleanHtml.trim()) return;

    insertCleanHtmlAtSelection(editor, finalCleanHtml);
    notifyEditorContentChanged(editor);
}

/** @param {any} e */
function preventEditorDragDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'none';
    }
}

export function initCleanPasteHandling() {
    // 全域攔截檔案拖放，防止拖入視窗邊界導致瀏覽器跳頁離開 SPA
    window.removeEventListener('dragover', preventEditorDragDrop);
    window.addEventListener('dragover', preventEditorDragDrop, false);

    window.removeEventListener('drop', preventEditorDragDrop);
    window.addEventListener('drop', preventEditorDragDrop, false);

    const editors = document.querySelectorAll('#full-note-content, #bookmark-content, #reminder-content');
    editors.forEach(editor => {
        editor.removeEventListener('paste', handleCleanNotePaste);
        editor.addEventListener('paste', handleCleanNotePaste);

        editor.removeEventListener('dragover', preventEditorDragDrop);
        editor.addEventListener('dragover', preventEditorDragDrop);

        editor.removeEventListener('drop', preventEditorDragDrop);
        editor.addEventListener('drop', preventEditorDragDrop);
    });
}
