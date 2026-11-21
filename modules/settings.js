// @ts-check
// @ts-nocheck
// 沿用 interaction.js 的型別檢查範圍；本階段只搬移函式，型別化另行處理。
// 設定、帳號驗證與個人資料操作

import { state } from '../state.js';
import { closeModalState, hasModal } from '../domain.js';
import { closeModal, openModal } from './modalManager.js';
import { closeFloatingAvatarPopover } from './navigation.js';
import { renderBookmarks, renderReminders, renderSidebar, renderUserProfileUI, showCloudToast, updateAvatarAuthStatusUI, updateVisualEffectsSegment } from '../ui.js';
import { downloadFromDrive, getMonotonicTimestamp, isGoogleLinked, isTokenValid, markLocalDataDirty, requestGoogleAuth, signOutGoogle, uploadToDrive } from '../sync.js';
import { StorageAPI, notifyCrossTabChange, stripDangerousHtml } from '../storage.js';

export function setVisualEffects(isOn) {
    const body = document.body;
    const isEnabled = Boolean(isOn);

    if (isEnabled) {
        body.removeAttribute('data-no-glass');
        localStorage.setItem('visual_effects', 'true');
    } else {
        body.setAttribute('data-no-glass', 'true');
        localStorage.setItem('visual_effects', 'false');
    }
    updateVisualEffectsSegment(isEnabled);
}

let usernameSaveDebounceTimer = null;

let currentSettingsSlideIndex = 0;

let justDraggedCarousel = false;

const SETTINGS_CAROUSEL_GAP = 32;

function updateSettingsCarouselDots(activeIndex = 0) {
    const dotsContainer = document.getElementById('settings-carousel-dots');
    if (!dotsContainer) return;
    const dots = dotsContainer.querySelectorAll('.settings-carousel-dot, .carousel-dot');
    dots.forEach((dot, idx) => {
        const slideAttr = dot.getAttribute('data-slide');
        const dotIndex = slideAttr !== null ? parseInt(slideAttr, 10) : idx;
        dot.classList.toggle('active', dotIndex === activeIndex);
    });
}

export function scrollToSettingsSlide(index = 0, animate = true) {
    const carousel = document.getElementById('settings-account-carousel');
    if (!carousel) return;
    const targetIndex = Math.max(0, Math.min(1, Number(index) || 0));
    currentSettingsSlideIndex = targetIndex;

    const slideWidth = carousel.offsetWidth || carousel.clientWidth || 0;
    const targetOffset = -targetIndex * (slideWidth + SETTINGS_CAROUSEL_GAP);

    if (!animate) {
        carousel.classList.add('is-dragging');
        carousel.style.transform = `translateX(${targetOffset}px)`;
        void carousel.offsetWidth;
        carousel.classList.remove('is-dragging');
    } else {
        carousel.classList.remove('is-dragging');
        carousel.style.transform = `translateX(${targetOffset}px)`;
    }

    updateSettingsCarouselDots(targetIndex);
}

export function initSettingsCarousel() {
    const carousel = document.getElementById('settings-account-carousel');
    if (!carousel || carousel.dataset.carouselBound === 'true') return;
    carousel.dataset.carouselBound = 'true';

    let isPointerDown = false;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let currentDx = 0;
    let dragStartTime = 0;
    let startedOnFocusedInput = false;

    const getStepWidth = () => {
        const slideWidth = carousel.offsetWidth || carousel.clientWidth || 0;
        return slideWidth + SETTINGS_CAROUSEL_GAP;
    };

    const handlePointerDown = (clientX, clientY, target) => {
        if (!target) return;
        const inputEl = target.closest('input');
        startedOnFocusedInput = Boolean(inputEl && document.activeElement === inputEl);
        if (startedOnFocusedInput) return;

        isPointerDown = true;
        isDragging = false;
        startX = clientX;
        startY = clientY;
        currentDx = 0;
        dragStartTime = performance.now();
    };

    const handlePointerMove = (clientX, clientY, event) => {
        if (!isPointerDown) return;

        const dx = clientX - startX;
        const dy = clientY - startY;

        if (!isDragging) {
            if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
            if (Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) {
                isDragging = true;
                carousel.classList.add('is-dragging');
                if (document.activeElement && carousel.contains(document.activeElement)) {
                    document.activeElement.blur();
                }
            } else {
                isPointerDown = false;
                return;
            }
        }

        if (event && event.cancelable) {
            event.preventDefault();
        }

        currentDx = dx;
        const stepWidth = getStepWidth();
        const baseOffset = -currentSettingsSlideIndex * stepWidth;
        const rawOffset = baseOffset + dx;
        const minOffset = -stepWidth;
        const maxOffset = 0;

        let dampedOffset = rawOffset;
        if (rawOffset > maxOffset) {
            dampedOffset = maxOffset + (rawOffset - maxOffset) * 0.28;
        } else if (rawOffset < minOffset) {
            dampedOffset = minOffset + (rawOffset - minOffset) * 0.28;
        }

        carousel.style.transform = `translateX(${dampedOffset}px)`;
    };

    const handlePointerUp = () => {
        if (!isPointerDown) return;
        isPointerDown = false;

        if (!isDragging) {
            currentDx = 0;
            return;
        }

        isDragging = false;
        justDraggedCarousel = true;
        setTimeout(() => {
            justDraggedCarousel = false;
        }, 120);

        const slideWidth = carousel.offsetWidth || carousel.clientWidth || 0;
        const elapsed = Math.max(1, performance.now() - dragStartTime);
        const velocityX = currentDx / elapsed;
        const distanceThreshold = Math.max(36, slideWidth * 0.22);

        let nextIndex = currentSettingsSlideIndex;
        if ((currentDx < -distanceThreshold || velocityX < -0.35) && currentSettingsSlideIndex < 1) {
            nextIndex = 1;
        } else if ((currentDx > distanceThreshold || velocityX > 0.35) && currentSettingsSlideIndex > 0) {
            nextIndex = 0;
        }

        currentDx = 0;
        scrollToSettingsSlide(nextIndex, true);
    };

    carousel.addEventListener('click', (e) => {
        if (justDraggedCarousel) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);

    carousel.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        handlePointerDown(e.clientX, e.clientY, e.target);
    });

    window.addEventListener('mousemove', (e) => {
        if (!isPointerDown) return;
        handlePointerMove(e.clientX, e.clientY, e);
    }, { passive: false });

    window.addEventListener('mouseup', () => {
        handlePointerUp();
    });

    carousel.addEventListener('touchstart', (e) => {
        if (!e.touches || e.touches.length !== 1) return;
        const touch = e.touches[0];
        handlePointerDown(touch.clientX, touch.clientY, e.target);
    }, { passive: true });

    carousel.addEventListener('touchmove', (e) => {
        if (!isPointerDown || !e.touches || e.touches.length !== 1) return;
        const touch = e.touches[0];
        handlePointerMove(touch.clientX, touch.clientY, e);
    }, { passive: false });

    carousel.addEventListener('touchend', () => {
        handlePointerUp();
    }, { passive: true });

    carousel.addEventListener('touchcancel', () => {
        handlePointerUp();
    }, { passive: true });

    window.addEventListener('resize', () => {
        if (hasModal(state, 'settings')) {
            scrollToSettingsSlide(currentSettingsSlideIndex, false);
        }
    }, { passive: true });
}

async function commitProfileUsername(rawValue) {
    clearTimeout(usernameSaveDebounceTimer);
    usernameSaveDebounceTimer = null;

    const cleanUsername = stripDangerousHtml(String(rawValue ?? ''))
        .replace(/<[^>]*>/g, '')
        .trim()
        .slice(0, 9);

    if (!state.userProfile || typeof state.userProfile !== 'object') {
        state.userProfile = { avatarData: '', avatarUpdatedAt: 0, username: '', usernameUpdatedAt: 0 };
    }

    const prevUsername = typeof state.userProfile.username === 'string' ? state.userProfile.username : '';
    if (cleanUsername === prevUsername) return;

    state.userProfile.username = cleanUsername;
    state.userProfile.usernameUpdatedAt = getMonotonicTimestamp(state.userProfile.usernameUpdatedAt || 0);

    await StorageAPI.saveItem('profile', 'current', state.userProfile);
    markLocalDataDirty();
    notifyCrossTabChange({ type: 'DATA_CHANGED' });
    uploadToDrive(true);
}

export function initProfileUsernameInput() {
    const input = document.getElementById('profile-username-input');
    if (!input || input.dataset.usernameBound === 'true') return;
    input.dataset.usernameBound = 'true';

    input.addEventListener('input', () => {
        if (input.value.length > 9) {
            input.value = input.value.slice(0, 9);
        }
        clearTimeout(usernameSaveDebounceTimer);
        usernameSaveDebounceTimer = setTimeout(() => {
            commitProfileUsername(input.value);
        }, 800);
    });

    input.addEventListener('blur', () => {
        commitProfileUsername(input.value);
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            input.blur();
        }
    });
}

function compressAvatarImageToDataUrl(file, targetSize = 160) {
    return new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(file);
        const img = new Image();

        img.onload = () => {
            try {
                const srcWidth = img.naturalWidth || img.width;
                const srcHeight = img.naturalHeight || img.height;
                if (!srcWidth || !srcHeight) {
                    URL.revokeObjectURL(objectUrl);
                    reject(new Error('INVALID_IMAGE_DIMENSIONS'));
                    return;
                }

                const cropSize = Math.min(srcWidth, srcHeight);
                const sx = Math.floor((srcWidth - cropSize) / 2);
                const sy = Math.floor((srcHeight - cropSize) / 2);

                const canvas = document.createElement('canvas');
                canvas.width = targetSize;
                canvas.height = targetSize;

                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    URL.revokeObjectURL(objectUrl);
                    reject(new Error('CANVAS_CONTEXT_UNAVAILABLE'));
                    return;
                }

                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, sx, sy, cropSize, cropSize, 0, 0, targetSize, targetSize);

                let dataUrl = canvas.toDataURL('image/webp', 0.82);
                if (!dataUrl || !dataUrl.startsWith('data:image/webp')) {
                    dataUrl = canvas.toDataURL('image/jpeg', 0.82);
                }

                URL.revokeObjectURL(objectUrl);
                resolve(dataUrl);
            } catch (err) {
                URL.revokeObjectURL(objectUrl);
                reject(err);
            }
        };

        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('IMAGE_LOAD_FAILED'));
        };

        img.src = objectUrl;
    });
}

export async function handleAvatarUpload(event) {
    const input = event && event.target;
    const file = input && input.files ? input.files[0] : null;
    if (!file) return;

    try {
        if (!file.type || !file.type.startsWith('image/')) {
            showCloudToast('請選擇圖片檔案');
            return;
        }

        const dataUrl = await compressAvatarImageToDataUrl(file, 160);
        if (!dataUrl || dataUrl.length > 150000) {
            showCloudToast('圖片檔案過大，請更換其他圖片');
            return;
        }

        if (!state.userProfile || typeof state.userProfile !== 'object') {
            state.userProfile = { avatarData: '', avatarUpdatedAt: 0, username: '', usernameUpdatedAt: 0 };
        }

        state.userProfile.avatarData = dataUrl;
        state.userProfile.avatarUpdatedAt = getMonotonicTimestamp(state.userProfile.avatarUpdatedAt || 0);

        const saved = await StorageAPI.saveItem('profile', 'current', state.userProfile);
        if (!saved) {
            showCloudToast('頭像儲存失敗，請重試');
            return;
        }

        markLocalDataDirty();
        renderUserProfileUI();
        notifyCrossTabChange({ type: 'DATA_CHANGED' });
        showCloudToast('頭像已更新');
        uploadToDrive(true);
    } catch (err) {
        console.error('頭像上傳處理失敗:', err);
        showCloudToast('頭像處理失敗，請重試');
    } finally {
        if (input) input.value = '';
    }
}

export function triggerDeleteAvatarConfirm() {
    if (!state.userProfile || !state.userProfile.avatarData) return;
    state.deleteTargetType = 'user-avatar';
    document.body.classList.add('avatar-delete-confirm');

    const modal = document.getElementById('confirm-modal');
    const titleEl = modal ? modal.querySelector('h2') : null;
    const descEl = modal ? modal.querySelector('p') : null;

    if (titleEl) titleEl.innerText = '確定要刪除？';
    if (descEl) descEl.innerText = '刪除後將無法復原資料。';

    openModal('confirm');
}

export function handleAvatarCircleClick(e) {
    if (e) e.stopPropagation();
    if (justDraggedCarousel) return;
    const fileInput = document.getElementById('avatar-file-input');
    if (fileInput) {
        fileInput.click();
    }
}

export function openSettingsModal() {
    updateVisualEffectsSegment();
    updateGoogleAccountUIState();

    if (!state.userProfile || typeof state.userProfile !== 'object') {
        state.userProfile = { avatarData: '', avatarUpdatedAt: 0, username: '', usernameUpdatedAt: 0 };
    }
    renderUserProfileUI();

    if (!state.userProfile.avatarData && !state.userProfile.username && typeof StorageAPI.loadProfile === 'function') {
        StorageAPI.loadProfile().then((storedProfile) => {
            if (storedProfile && (storedProfile.avatarData || storedProfile.username)) {
                state.userProfile = storedProfile;
                renderUserProfileUI();
            }
        }).catch(() => {});
    }

    currentSettingsSlideIndex = 0;
    scrollToSettingsSlide(0, false);

    openModal('settings', {
        onAfterActivate: () => scrollToSettingsSlide(0, false)
    });
}

export function closeSettingsModal() {
    const usernameInput = document.getElementById('profile-username-input');
    if (usernameInput) {
        commitProfileUsername(usernameInput.value);
    }
    if (document.activeElement) document.activeElement.blur();
    document.body.classList.remove('avatar-delete-confirm');

    closeModal('settings', {
        afterClose: () => {
            renderSidebar();
            if (state.currentView === 'bookmarks') {
                renderBookmarks();
            } else if (state.currentView === 'reminders') {
                renderReminders();
            }
        }
    });
}

export function updateGoogleAccountUIState() {
    const isLinked = isGoogleLinked();
    const isValid = isTokenValid();
    const statusText = document.getElementById('google-auth-status-text');
    const loginBtnText = document.getElementById('google-login-btn-text');
    const logoutBtn = document.getElementById('google-logout-btn');

    if (isLinked && isValid) {
        // 狀態 1：已連線（Connected）
        if (statusText) {
            statusText.textContent = '已連接';
            statusText.className = 'google-auth-status-badge connected';
        }
        if (loginBtnText) {
            loginBtnText.textContent = '切換 Google 帳號';
        }
        if (logoutBtn) {
            logoutBtn.textContent = '登出';
            logoutBtn.style.display = 'inline-flex';
        }
        updateAvatarAuthStatusUI('connected');
    } else if (isLinked && !isValid) {
        // 狀態 2：授權已過期 / 需重新驗證（Expired / Needs Reauth）
        if (statusText) {
            statusText.textContent = '授權已過期';
            statusText.className = 'google-auth-status-badge expired';
        }
        if (loginBtnText) {
            loginBtnText.textContent = '重新驗證 Google 帳號';
        }
        if (logoutBtn) {
            logoutBtn.textContent = '登出';
            logoutBtn.style.display = 'inline-flex';
        }
        updateAvatarAuthStatusUI('expired');
    } else {
        // 狀態 3：未連接（Disconnected）
        if (statusText) {
            statusText.textContent = '未連接';
            statusText.className = 'google-auth-status-badge';
        }
        if (loginBtnText) {
            loginBtnText.textContent = '登入 Google 帳號';
        }
        if (logoutBtn) {
            logoutBtn.style.display = 'none';
        }
        updateAvatarAuthStatusUI('disconnected');
    }
}

export function openCloudAlert() {
    const settingsModal = document.getElementById('settings-modal');
    if (hasModal(state, 'settings') || (settingsModal && settingsModal.classList.contains('active'))) {
        closeModalState(state, 'settings');
        if (settingsModal) {
            settingsModal.classList.remove('active');
            settingsModal.style.display = 'none';
        }
    }
    openModal('cloud-alert');
}

export function closeCloudAlert() {
    if (document.activeElement) document.activeElement.blur();
    closeModal('cloud-alert');
}

export function returnFromCloudAlert() {
    closeModalState(state, 'cloud-alert');
    const alertModal = document.getElementById('cloud-alert-modal');
    if (alertModal) alertModal.classList.remove('active');
    setTimeout(() => {
        if (alertModal && !hasModal(state, 'cloud-alert')) alertModal.style.display = 'none';
        openSettingsModal();
    }, 250);
}

export async function handleGoogleAuthClick() {
    closeFloatingAvatarPopover();
    await requestGoogleAuth();
    updateGoogleAccountUIState();
    renderSidebar();
    if (state.currentView === 'bookmarks') {
        renderBookmarks();
    } else if (state.currentView === 'reminders') {
        renderReminders();
    }
}

export async function handleGoogleSignOutClick() {
    closeFloatingAvatarPopover();
    await signOutGoogle();
    updateGoogleAccountUIState();
    renderSidebar();
    if (state.currentView === 'bookmarks') {
        renderBookmarks();
    } else if (state.currentView === 'reminders') {
        renderReminders();
    }
}

export function openSyncSettingsFromAlert() {
    closeModalState(state, 'cloud-alert');
    const alertModal = document.getElementById('cloud-alert-modal');
    if (alertModal) alertModal.classList.remove('active');
    setTimeout(() => {
        if (alertModal && !hasModal(state, 'cloud-alert')) alertModal.style.display = 'none';
        openSettingsModal();
    }, 250);
}

export function forceDownload() {
    closeSettingsModal();
    return requestManualSync();
}

export function requestManualSync() {
    if (!navigator.onLine) {
        window.alert('請先連線網路，再手動同步。');
        return;
    }
    return downloadFromDrive(false);
}
