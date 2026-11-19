// @ts-check
// @ts-nocheck
// 沿用原 interaction.js 的檢查狀態；這些函式仍待後續獨立型別化。
import { state } from '../state.js';
import { hasModal, closeModalState } from '../domain.js';
import { onTransitionEnd, openModal } from './modalManager.js';
import { updateBookmarkPreviewDisplay, updateReminderPreviewDisplay } from '../ui.js';
import { stripDangerousHtml } from '../storage.js';
import { positionEditorExternalBars } from './editorLayout.js';
import { insertCleanHtmlAtSelection, textToPasteHtml, notifyEditorContentChanged } from './paste.js';
// ==========================================
// 全畫面編輯器、格式化與日曆
// ==========================================

export function openFullEditor() {
    const draft = state.editorDraft;
    const fullModal = document.getElementById('full-editor-modal');
    const fullContent = document.getElementById('full-note-content');
    const editorModal = document.getElementById('editor-modal');
    const topBar = document.getElementById('editor-external-top-bar');
    const bottomBar = document.getElementById('editor-external-bottom-bar');

    if (state.currentUnifiedType === 'bookmark') return;

    const fullReminderTitleInput = document.getElementById('full-reminder-title-input');
    if (fullReminderTitleInput) fullReminderTitleInput.style.display = 'none';

    if (state.currentUnifiedType === 'note') {
        fullContent.innerHTML = stripDangerousHtml(draft.bookmarkContent || '');
        if (fullReminderTitleInput) {
            fullReminderTitleInput.style.display = 'block';
            fullReminderTitleInput.value = draft.bookmarkTitle || (document.getElementById('bookmark-title') ? document.getElementById('bookmark-title').value : '') || '';
        }
    } else {
        fullContent.innerHTML = stripDangerousHtml(draft.reminderContent || '');
        if (fullReminderTitleInput) {
            fullReminderTitleInput.style.display = 'block';
            fullReminderTitleInput.value = draft.reminderTitle || '';
        }
    }

    openModal('full-editor', {
        onAfterActivate: () => {
            if (fullContent) fullContent.scrollTop = 0;
        }
    });

    if (fullModal) {
        onTransitionEnd(fullModal, 'opacity', 260, () => {
            if (hasModal(state, 'full-editor')) {
                if (editorModal) editorModal.style.visibility = 'hidden';
                if (topBar) topBar.style.visibility = 'hidden';
                if (bottomBar) bottomBar.style.visibility = 'hidden';
                if (fullContent) fullContent.focus({ preventScroll: true });
            }
        });
    }
}

export function closeFullEditor() {
    window.getSelection().removeAllRanges();
    const toolbar = document.getElementById('text-toolbar');
    if (toolbar) toolbar.classList.remove('active');

    const draft = state.editorDraft;
    const fullModal = document.getElementById('full-editor-modal');
    const editorModal = document.getElementById('editor-modal');
    const topBar = document.getElementById('editor-external-top-bar');
    const bottomBar = document.getElementById('editor-external-bottom-bar');
    const content = document.getElementById('full-note-content').innerHTML;
    const fullReminderTitleInput = document.getElementById('full-reminder-title-input');

    if (state.currentUnifiedType === 'note') {
        if (fullReminderTitleInput) {
            draft.bookmarkTitle = fullReminderTitleInput.value.trim();
            const bmTitle = document.getElementById('bookmark-title');
            if (bmTitle) bmTitle.value = draft.bookmarkTitle;
        }
        draft.bookmarkContent = content;
        updateBookmarkPreviewDisplay();
    } else if (state.currentUnifiedType === 'reminder') {
        if (fullReminderTitleInput) {
            draft.reminderTitle = fullReminderTitleInput.value.trim();
        }
        draft.reminderContent = content;
        updateReminderPreviewDisplay();
    }

    closeModalState(state, 'full-editor');
    if (fullModal) fullModal.classList.remove('active');

    if (fullModal) {
        onTransitionEnd(fullModal, 'opacity', 260, () => {
            fullModal.style.display = 'none';

            if (!hasModal(state, 'editor')) return;

            if (editorModal) {
                editorModal.style.visibility = 'visible';
                editorModal.style.display = 'flex';
                editorModal.style.opacity = '';
                editorModal.style.pointerEvents = '';
            }

            if (topBar) {
                topBar.style.visibility = 'visible';
                topBar.style.display = 'flex';
                topBar.style.pointerEvents = '';
            }
            if (bottomBar) {
                bottomBar.style.visibility = 'visible';
                bottomBar.style.display = 'flex';
                bottomBar.style.pointerEvents = '';
            }
            positionEditorExternalBars();

            requestAnimationFrame(() => requestAnimationFrame(() => {
                if (!hasModal(state, 'editor')) return;
                if (editorModal) editorModal.classList.add('active');
                if (topBar) topBar.classList.add('active');
                if (bottomBar) bottomBar.classList.add('active');
            }));
        });
    }
}

export function syncFullEditorContent() {
    const draft = state.editorDraft;
    const content = document.getElementById('full-note-content').innerHTML;
    
    if (state.currentUnifiedType === 'note') {
        const fullReminderTitleInput = document.getElementById('full-reminder-title-input');
        if (fullReminderTitleInput) {
            draft.bookmarkTitle = fullReminderTitleInput.value.trim();
            const bmTitle = document.getElementById('bookmark-title');
            if (bmTitle) bmTitle.value = draft.bookmarkTitle;
        }
        draft.bookmarkContent = content;
        updateBookmarkPreviewDisplay();
        return;
    }

    if (state.currentUnifiedType === 'reminder') {
        const fullReminderTitleInput = document.getElementById('full-reminder-title-input');
        if (fullReminderTitleInput) {
            draft.reminderTitle = fullReminderTitleInput.value.trim();
        }
        draft.reminderContent = content;
        updateReminderPreviewDisplay();
    }
}

export function saveFullEditor() {
    syncFullEditorContent();
    closeFullEditor();
}



export async function handleClipboard(e, action, btn) {
    e.preventDefault();
    const selection = window.getSelection();
    if ((action === 'cut' || action === 'copy') && (!selection || selection.rangeCount === 0 || selection.isCollapsed)) return;

    const isFullEditorOpen = hasModal(state, 'full-editor');
    const editor = isFullEditorOpen ? document.getElementById('full-note-content') : null;
    if (!editor) return;

    let didChange = false;
    if (action === 'cut') {
        document.execCommand('cut', false, null);
        didChange = true;
    }
    else if (action === 'copy') document.execCommand('copy', false, null);
    else if (action === 'paste') {
        try {
            const text = await navigator.clipboard.readText();
            // 過濾掉可能夾帶在文字剪貼簿中的 Base64 圖片與 Data URI
            const cleanText = (text || '')
                .replace(/data:image\/[^;]+;base64,[^\s"']+/gi, '')
                .trim();

            if (cleanText) {
                insertCleanHtmlAtSelection(editor, textToPasteHtml(cleanText));
                didChange = true;
            }
        } catch (err) { console.error('貼上失敗', err); }
    }

    if (didChange) notifyEditorContentChanged(editor);
    if (document.activeElement !== editor) editor.focus();
}

export function handleFormat(e, command, btn) {
    e.preventDefault();
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const isFullEditorOpen = hasModal(state, 'full-editor');
    const activeEditor = isFullEditorOpen ? document.getElementById('full-note-content') : null;
    if (!activeEditor) return;

    if (command === 'bold') document.execCommand('bold', false, null);
    else if (command === 'color') {
        document.execCommand('styleWithCSS', false, true);
        const currentColor = document.queryCommandValue('foreColor').toLowerCase();
        if (currentColor === '#9a871e' || currentColor === 'rgb(154, 135, 30)') {
            document.execCommand('foreColor', false, 'inherit');
            const spans = activeEditor.querySelectorAll('span');
            spans.forEach(span => {
                if (span.style.color === 'inherit') {
                    span.style.color = '';
                    if (span.getAttribute('style') === '') span.removeAttribute('style');
                }
            });
        } else {
            document.execCommand('foreColor', false, '#9a871e');
        }
    }
    if (document.activeElement !== activeEditor) activeEditor.focus();
}
