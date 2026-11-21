// @ts-check
// @ts-nocheck
// 沿用原 interaction.js 型別檢查狀態；這些函式仍待後續獨立型別化。
import { state } from '../state.js';
import { isTransitionCategory, hasModal } from '../domain.js';
import { openModal, closeModal, onTransitionEnd } from './modalManager.js';
import { safeJSONParse } from '../storage.js';
import { renderSidebar, positionCategoryConfirmBtn, updateCategoryPathHeader, scrollToCategorySlide, renderCategoryModalColumns } from '../ui.js';

export function openCategorySubCategoryModal() {
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
    }

    const draft = state.editorDraft;
    const curCat = (draft.bookmarkCategory || '').trim();
    const curSubCat = (draft.bookmarkSubCategory || '').trim();

    state.tempModalCategory = curCat || ((state.currentCategory && !isTransitionCategory(state.currentCategory) && state.currentCategory !== '未分類') ? state.currentCategory : '');
    state.tempModalSubCategory = curSubCat || '';

    if (state.tempModalCategory && state.tempModalSubCategory) {
        state.categoryModalStep = 3;
    } else if (state.tempModalCategory) {
        state.categoryModalStep = 2;
    } else {
        state.categoryModalStep = 1;
    }

    state.isAddingCategoryInline = false;
    state.isAddingSubCategoryInline = false;
    state.tempCategoryModalCategoryOrder = safeJSONParse(localStorage.getItem('my_category_order'), []);
    state.tempCategoryModalSubCategoryOrders = safeJSONParse(localStorage.getItem('my_subcategory_order'), {});
    state.tempCategoryModalCardOrders = {};

    renderCategoryModalColumns({ animate: false });

    const modal = document.getElementById('category-modal');
    const initialSlide = Math.max(0, Math.min(2, (state.categoryModalStep || 1) - 1));

    openModal('category', {
        onBeforeActivate: () => positionCategoryConfirmBtn(),
        onAfterActivate: () => {
            positionCategoryConfirmBtn();
            scrollToCategorySlide(initialSlide, false);
            const leftList = document.getElementById('modal-category-column-list');
            const rightList = document.getElementById('modal-subcategory-column-list');
            const cardList = document.getElementById('modal-category-card-column-list');
            if (leftList) leftList.scrollTop = 0;
            if (rightList) rightList.scrollTop = 0;
            if (cardList) cardList.scrollTop = 0;
            if (modal) {
                modal.scrollTop = 0;
                onTransitionEnd(modal, 'opacity', 300, () => {
                    if (hasModal(state, 'category')) {
                        positionCategoryConfirmBtn();
                        scrollToCategorySlide(Math.max(0, Math.min(2, (state.categoryModalStep || 1) - 1)), false);
                    }
                });
            }
        }
    });
}

export function openMoveModal() {
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
    }

    state.tempModalCategory = '';
    state.tempModalSubCategory = '';
    state.categoryModalStep = 1;
    state.isAddingCategoryInline = false;
    state.isAddingSubCategoryInline = false;
    state.tempCategoryModalCategoryOrder = safeJSONParse(localStorage.getItem('my_category_order'), []);
    state.tempCategoryModalSubCategoryOrders = safeJSONParse(localStorage.getItem('my_subcategory_order'), {});
    state.tempCategoryModalCardOrders = {};

    renderCategoryModalColumns({ animate: false });

    const modal = document.getElementById('category-modal');

    openModal('category', {
        onBeforeActivate: () => positionCategoryConfirmBtn(),
        onAfterActivate: () => {
            positionCategoryConfirmBtn();
            scrollToCategorySlide(0, false);
            const leftList = document.getElementById('modal-category-column-list');
            const rightList = document.getElementById('modal-subcategory-column-list');
            const cardList = document.getElementById('modal-category-card-column-list');
            if (leftList) leftList.scrollTop = 0;
            if (rightList) rightList.scrollTop = 0;
            if (cardList) cardList.scrollTop = 0;
            if (modal) {
                modal.scrollTop = 0;
                onTransitionEnd(modal, 'opacity', 300, () => {
                    if (hasModal(state, 'category')) {
                        positionCategoryConfirmBtn();
                        scrollToCategorySlide(Math.max(0, Math.min(2, (state.categoryModalStep || 1) - 1)), false);
                    }
                });
            }
        }
    });
}

export function handleCategoryPathClick(targetLevel) {
    const level = Number(targetLevel) || 1;
    const currentStep = state.categoryModalStep || 1;

    state.isAddingCategoryInline = false;
    state.isAddingSubCategoryInline = false;

    if (level === 1 && currentStep !== 1) {
        state.categoryModalStep = 1;
        renderCategoryModalColumns({ animate: true });
    } else if (level === 2 && currentStep !== 2 && state.tempModalCategory) {
        state.categoryModalStep = 2;
        renderCategoryModalColumns({ animate: true });
    } else if (level === 3 && currentStep !== 3 && state.tempModalCategory && state.tempModalSubCategory) {
        state.categoryModalStep = 3;
        renderCategoryModalColumns({ animate: true });
    }
}

export function handleSelectModalCategory(cat) {
    if (state.justFinishedCategoryDrag || state.justFinishedCategoryCarouselDrag) return;

    if (state.tempModalCategory === cat) {
        state.tempModalCategory = '';
        state.tempModalSubCategory = '';
        state.categoryModalStep = 1;
    } else {
        state.tempModalCategory = cat;
        state.tempModalSubCategory = '';
        state.categoryModalStep = 2;
    }
    state.isAddingCategoryInline = false;
    state.isAddingSubCategoryInline = false;
    renderCategoryModalColumns({ animate: true });

    requestAnimationFrame(() => {
        const rightList = document.getElementById('modal-subcategory-column-list');
        if (rightList) rightList.scrollTop = 0;
    });
}

export function handleSelectModalSubCategory(sub) {
    if (state.justFinishedCategoryDrag || state.justFinishedCategoryCarouselDrag) return;

    if (state.tempModalSubCategory === sub && state.categoryModalStep === 3) {
        state.tempModalSubCategory = '';
        state.categoryModalStep = 2;
    } else {
        state.tempModalSubCategory = sub;
        state.categoryModalStep = 3;
    }
    state.isAddingCategoryInline = false;
    state.isAddingSubCategoryInline = false;
    renderCategoryModalColumns({ animate: true });

    requestAnimationFrame(() => {
        const cardList = document.getElementById('modal-category-card-column-list');
        if (cardList) cardList.scrollTop = 0;
    });
}

export function triggerAddNewCategoryOrSubCategory() {
    const step = state.categoryModalStep || 1;

    if (step >= 3 || (step === 2 && !state.tempModalCategory)) {
        return;
    }

    if (step === 2 && state.tempModalCategory) {
        state.isAddingSubCategoryInline = true;
        state.isAddingCategoryInline = false;
    } else {
        state.isAddingCategoryInline = true;
        state.isAddingSubCategoryInline = false;
    }

    renderCategoryModalColumns({ animate: false });

    requestAnimationFrame(() => {
        const targetList = state.isAddingSubCategoryInline
            ? document.getElementById('modal-subcategory-column-list')
            : document.getElementById('modal-category-column-list');
        if (targetList) targetList.scrollTop = 0;
    });
}

export function closeCategoryModal() {
    state.categoryModalStep = 1;
    state.isAddingCategoryInline = false;
    state.isAddingSubCategoryInline = false;
    state.isMoveSelectionActive = false;
    state.moveTargetType = null;
    state.isCategoryCarouselSwiping = false;
    state.justFinishedCategoryCarouselDrag = false;
    state.justFinishedCategoryDrag = false;
    justFinishedCategoryDrag = false;
    state.tempCategoryModalCategoryOrder = [];
    state.tempCategoryModalSubCategoryOrders = {};
    state.tempCategoryModalCardOrders = {};

    closeModal('category', {
        afterClose: () => {
            document.querySelector('#modal-category-card-column-list .category-modal-draft')?.remove();
            if (state.hasPendingSyncRender) {
                state.hasPendingSyncRender = false;
                renderSidebar();
            }
        }
    });
}

export let justFinishedCategoryDrag = false;

const CATEGORY_CAROUSEL_GAP = 32;

export function initCategoryCarousel() {
    const carousel = document.getElementById('category-carousel');
    if (!carousel || carousel.dataset.carouselBound === 'true') return;
    carousel.dataset.carouselBound = 'true';

    let isPointerDown = false;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let currentDx = 0;
    let dragStartTime = 0;

    const getStepWidth = () => {
        const slideWidth = carousel.offsetWidth || carousel.clientWidth || 0;
        return slideWidth + CATEGORY_CAROUSEL_GAP;
    };

    const getMaxAllowedSlideIndex = () => {
        if (state.tempModalCategory && state.tempModalSubCategory) return 2;
        if (state.tempModalCategory) return 1;
        return 0;
    };

    const getCurrentSlideIndex = () => {
        return Math.max(0, Math.min(2, (state.categoryModalStep || 1) - 1));
    };

    const handlePointerDown = (clientX, clientY, target) => {
        if (state.isCategoryDragging) return;
        if (target && target.closest('.category-inline-input-wrapper')) return;
        isPointerDown = true;
        isDragging = false;
        state.isCategoryCarouselSwiping = false;
        startX = clientX;
        startY = clientY;
        currentDx = 0;
        dragStartTime = performance.now();
    };

    const handlePointerMove = (clientX, clientY, event) => {
        if (!isPointerDown || state.isCategoryDragging) return;

        const dx = clientX - startX;
        const dy = clientY - startY;

        if (!isDragging) {
            if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
            if (Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) {
                isDragging = true;
                state.isCategoryCarouselSwiping = true;
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
        const currentSlideIndex = getCurrentSlideIndex();
        const maxSlideIndex = getMaxAllowedSlideIndex();
        const stepWidth = getStepWidth();
        const baseOffset = -currentSlideIndex * stepWidth;
        const rawOffset = baseOffset + dx;
        const minOffset = -maxSlideIndex * stepWidth;
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
            state.isCategoryCarouselSwiping = false;
            return;
        }

        isDragging = false;
        state.isCategoryCarouselSwiping = false;
        state.justFinishedCategoryCarouselDrag = true;
        setTimeout(() => {
            state.justFinishedCategoryCarouselDrag = false;
        }, 120);

        const slideWidth = carousel.offsetWidth || carousel.clientWidth || 0;
        const elapsed = Math.max(1, performance.now() - dragStartTime);
        const velocityX = currentDx / elapsed;
        const distanceThreshold = Math.max(36, slideWidth * 0.22);

        const currentSlideIndex = getCurrentSlideIndex();
        const maxSlideIndex = getMaxAllowedSlideIndex();

        let nextIndex = currentSlideIndex;
        if ((currentDx < -distanceThreshold || velocityX < -0.35) && currentSlideIndex < maxSlideIndex) {
            nextIndex = currentSlideIndex + 1;
        } else if ((currentDx > distanceThreshold || velocityX > 0.35) && currentSlideIndex > 0) {
            nextIndex = currentSlideIndex - 1;
        }

        currentDx = 0;
        state.categoryModalStep = nextIndex + 1;

        const addBtn = document.getElementById('btn-add-category-item');
        if (addBtn) {
            const step = state.categoryModalStep || 1;
            addBtn.disabled = Boolean(
                step >= 3 ||
                (step === 2 && !state.tempModalCategory)
            );
        }

        updateCategoryPathHeader();
        scrollToCategorySlide(nextIndex, true);
    };

    carousel.addEventListener('click', (e) => {
        if (state.justFinishedCategoryCarouselDrag) {
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

    window.addEventListener('blur', () => {
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

    const handleCategoryViewportChange = () => {
        if (hasModal(state, 'category')) {
            positionCategoryConfirmBtn();
            scrollToCategorySlide(getCurrentSlideIndex(), false);
        }
    };

    window.addEventListener('resize', handleCategoryViewportChange, { passive: true });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', handleCategoryViewportChange, { passive: true });
        window.visualViewport.addEventListener('scroll', handleCategoryViewportChange, { passive: true });
    }
}

export function initCategoryModalDrag() {
    const modal = document.getElementById('category-modal');
    if (!modal) return;

    let isDragCandidate = false;
    let isDragging = false;
    let draggingItem = null;
    let dragGhost = null;
    let placeholder = null;
    let longPressTimer = null;
    let startPointerX = 0;
    let startPointerY = 0;
    let lastPointerY = 0;
    let autoScrollRAF = null;
    let activeList = null;
    let dragType = '';
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    const animateItemsFlip = (visibleItems, firstTops) => {
        if (document.body.hasAttribute('data-no-glass')) return;
        visibleItems.forEach(item => {
            const prevTop = firstTops.get(item);
            if (prevTop === undefined) return;
            const nextTop = item.getBoundingClientRect().top;
            const deltaY = prevTop - nextTop;
            if (Math.abs(deltaY) < 0.5) return;

            if (item._flipTimer) {
                clearTimeout(item._flipTimer);
                item._flipTimer = null;
            }
            item.style.transition = 'none';
            item.style.transform = `translateY(${deltaY}px) translateZ(0)`;
            void item.offsetHeight;
            item.style.transition = 'transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)';
            item.style.transform = '';
            item._flipTimer = setTimeout(() => {
                item.style.transition = '';
                item._flipTimer = null;
            }, 230);
        });
    };

    const checkCategorySwap = (clientY) => {
        if (!isDragging || !placeholder || !activeList) return;

        const visibleItems = Array.from(
            activeList.querySelectorAll('.category-modal-item:not(.placeholder):not(.is-drag-origin)')
        );
        if (visibleItems.length === 0) return;

        let insertBeforeItem = null;
        for (let i = 0; i < visibleItems.length; i++) {
            const rect = visibleItems[i].getBoundingClientRect();
            const itemCenterY = rect.top + (rect.height / 2);
            if (clientY < itemCenterY) {
                insertBeforeItem = visibleItems[i];
                break;
            }
        }

        if (insertBeforeItem) {
            if (insertBeforeItem.previousElementSibling === placeholder) return;
        } else {
            const lastItem = visibleItems[visibleItems.length - 1];
            if (lastItem.nextElementSibling === placeholder) return;
        }

        const firstTops = new Map();
        visibleItems.forEach(item => {
            firstTops.set(item, item.getBoundingClientRect().top);
        });

        if (insertBeforeItem) {
            insertBeforeItem.before(placeholder);
        } else {
            visibleItems[visibleItems.length - 1].after(placeholder);
        }

        animateItemsFlip(visibleItems, firstTops);
        if (navigator.vibrate) navigator.vibrate(10);
    };

    const stopAutoScroll = () => {
        if (autoScrollRAF) {
            cancelAnimationFrame(autoScrollRAF);
            autoScrollRAF = null;
        }
    };

    const startAutoScroll = () => {
        stopAutoScroll();
        const step = () => {
            if (!isDragging || !activeList) {
                autoScrollRAF = null;
                return;
            }
            const listRect = activeList.getBoundingClientRect();
            const edgeThreshold = 48;
            let scrollDelta = 0;

            if (lastPointerY < listRect.top + edgeThreshold && activeList.scrollTop > 0) {
                const ratio = Math.min(1, (listRect.top + edgeThreshold - lastPointerY) / edgeThreshold);
                scrollDelta = -Math.ceil(ratio * 9);
            } else if (
                lastPointerY > listRect.bottom - edgeThreshold &&
                activeList.scrollTop + activeList.clientHeight < activeList.scrollHeight
            ) {
                const ratio = Math.min(1, (lastPointerY - (listRect.bottom - edgeThreshold)) / edgeThreshold);
                scrollDelta = Math.ceil(ratio * 9);
            }

            if (scrollDelta !== 0) {
                activeList.scrollTop += scrollDelta;
                checkCategorySwap(lastPointerY);
            }

            autoScrollRAF = requestAnimationFrame(step);
        };
        autoScrollRAF = requestAnimationFrame(step);
    };

    const startDrag = (item, clientX, clientY) => {
        isDragging = true;
        state.isCategoryDragging = true;
        draggingItem = item;
        activeList = item.closest('.category-column-list');
        dragType = item.dataset.categoryType || (
            activeList && activeList.id === 'modal-category-column-list'
                ? 'category'
                : (activeList && activeList.id === 'modal-subcategory-column-list' ? 'subcategory' : 'card')
        );
        lastPointerY = clientY;

        const rect = item.getBoundingClientRect();
        dragOffsetX = clientX - rect.left;
        dragOffsetY = clientY - rect.top;

        placeholder = document.createElement('div');
        placeholder.className = 'category-modal-item placeholder';
        placeholder.style.height = `${rect.height}px`;
        placeholder.style.minHeight = `${rect.height}px`;
        item.before(placeholder);

        item.classList.add('is-drag-origin');

        dragGhost = document.createElement('div');
        dragGhost.className = 'sort-drag-ghost';
        dragGhost.style.width = `${rect.width}px`;
        dragGhost.style.height = `${rect.height}px`;
        const dotIcon = document.createElement('span');
        dotIcon.className = 'item-icon category-dot';
        dotIcon.innerHTML = '<span class="category-dot-circle"></span>';
        const ghostText = document.createElement('span');
        ghostText.className = 'sort-modal-item-text';
        ghostText.textContent = item.querySelector('.category-modal-item-text')?.innerText || '';
        dragGhost.appendChild(dotIcon);
        dragGhost.appendChild(ghostText);

        if (item.querySelector('.category-move-label')) {
            const moveTag = document.createElement('span');
            moveTag.className = 'category-draft-label category-move-label';
            moveTag.textContent = '搬移';
            dragGhost.appendChild(moveTag);
        }

        dragGhost.style.left = `${clientX - dragOffsetX}px`;
        dragGhost.style.top = `${clientY - dragOffsetY}px`;

        window.getSelection()?.removeAllRanges();
        document.body.appendChild(dragGhost);
        document.body.classList.add('no-scroll', 'is-dragging-item');
        startAutoScroll();
    };

    const handlePointerDown = (e) => {
        if (state.isCategoryCarouselSwiping) return;
        const item = e.target.closest('.category-modal-item');
        if (!item || item.classList.contains('placeholder') || e.target.closest('.category-inline-input-wrapper')) return;

        isDragCandidate = true;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        startPointerX = clientX;
        startPointerY = clientY;
        lastPointerY = clientY;

        longPressTimer = setTimeout(() => {
            if (state.isCategoryCarouselSwiping) return;
            if (navigator.vibrate) navigator.vibrate(30);
            startDrag(item, clientX, clientY);
        }, 280);
    };

    const handlePointerMove = (e) => {
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        lastPointerY = clientY;

        if (isDragCandidate && !isDragging) {
            if (state.isCategoryCarouselSwiping || Math.hypot(clientX - startPointerX, clientY - startPointerY) > 8) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
                isDragCandidate = false;
            }
        }

        if (isDragging && dragGhost) {
            if (e.cancelable) e.preventDefault();
            dragGhost.style.left = `${clientX - dragOffsetX}px`;
            dragGhost.style.top = `${clientY - dragOffsetY}px`;
            checkCategorySwap(clientY);
        }
    };

    const handlePointerUp = () => {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
        isDragCandidate = false;

        if (!isDragging) return;
        isDragging = false;
        state.isCategoryDragging = false;
        stopAutoScroll();

        if (dragGhost && dragGhost.parentNode) {
            dragGhost.parentNode.removeChild(dragGhost);
        }
        dragGhost = null;

        document.body.classList.remove('no-scroll', 'is-dragging-item');

        if (activeList) {
            activeList.querySelectorAll('.category-modal-item').forEach(el => {
                if (el._flipTimer) {
                    clearTimeout(el._flipTimer);
                    el._flipTimer = null;
                }
                el.style.transition = '';
                el.style.transform = '';
            });
        }

        if (draggingItem) {
            draggingItem.classList.remove('is-drag-origin');
            if (placeholder && placeholder.parentNode) {
                placeholder.replaceWith(draggingItem);
            }
        }

        justFinishedCategoryDrag = true;
        state.justFinishedCategoryDrag = true;
        setTimeout(() => {
            justFinishedCategoryDrag = false;
            state.justFinishedCategoryDrag = false;
        }, 150);

        if (activeList) {
            const currentItems = Array.from(activeList.querySelectorAll('.category-modal-item:not(.placeholder)'));
            if (dragType === 'category') {
                const newOrder = currentItems.map(el => el.dataset.category || el.querySelector('.category-modal-item-text')?.innerText?.trim()).filter(Boolean);
                if (newOrder.length > 0) {
                    state.tempCategoryModalCategoryOrder = newOrder;
                }
            } else if (dragType === 'subcategory') {
                const currentCat = state.tempModalCategory;
                if (currentCat) {
                    const newSubOrder = currentItems.map(el => el.dataset.subcategory || el.querySelector('.category-modal-item-text')?.innerText?.trim()).filter(Boolean);
                    if (!state.tempCategoryModalSubCategoryOrders) state.tempCategoryModalSubCategoryOrders = {};
                    state.tempCategoryModalSubCategoryOrders[currentCat] = newSubOrder;
                }
            } else if (dragType === 'card') {
                const currentCat = state.tempModalCategory;
                const currentSub = state.tempModalSubCategory;
                if (currentCat && currentSub) {
                    const cardKey = `${currentCat}:::${currentSub}`;
                    if (!state.tempCategoryModalCardOrders) state.tempCategoryModalCardOrders = {};
                    state.tempCategoryModalCardOrders[cardKey] = currentItems.map(el => el.dataset.id ?? null);
                }
            }
        }

        draggingItem = null;
        placeholder = null;
        activeList = null;
        dragType = '';
    };

    modal.addEventListener('mousedown', handlePointerDown);
    modal.addEventListener('touchstart', handlePointerDown, { passive: true });

    document.addEventListener('mousemove', handlePointerMove, { passive: false });
    document.addEventListener('touchmove', handlePointerMove, { passive: false });

    document.addEventListener('mouseup', handlePointerUp);
    document.addEventListener('touchend', handlePointerUp);
    document.addEventListener('touchcancel', handlePointerUp);
    window.addEventListener('blur', handlePointerUp);
}
