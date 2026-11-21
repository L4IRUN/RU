// @ts-check
// @ts-nocheck
// 沿用原 interaction.js 型別檢查狀態；這些函式仍待後續獨立型別化。
import { state } from '../state.js';
import { isTransitionCategory, hasModal } from '../domain.js';
import { openModal, closeModal } from './modalManager.js';
import { safeJSONParse } from '../storage.js';
import { renderSidebar, renderSortModalColumns, positionSortExternalBars, updateSortPathHeader, scrollToSortSlide } from '../ui.js';

export let justFinishedSortDrag = false;

const SORT_CAROUSEL_GAP = 32;

export function openSortModal(options = {}) {
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
    }

    const autoLocate = Boolean(options && options.autoLocate);
    const curCat = state.currentCategory;
    let shouldLocate = false;

    const sidebarSortBtn = document.getElementById('sidebar-sort-btn');
    const headerSortBtn = document.getElementById('header-sort-btn');
    if (sidebarSortBtn) sidebarSortBtn.classList.add('active');
    if (headerSortBtn) headerSortBtn.classList.add('active');

    if (autoLocate && curCat && curCat !== '未分類' && !isTransitionCategory(curCat)) {
        const trimmedCurCat = curCat.trim();
        const hasCategoryInBookmarks = Object.values(state.bookmarks || {}).some(
            bm => bm && typeof bm.category === 'string' && bm.category.trim() === trimmedCurCat
        );
        const emptyCats = safeJSONParse(localStorage.getItem('my_empty_categories'), []);
        const hasCategoryInEmpty = Array.isArray(emptyCats) && emptyCats.some(
            c => typeof c === 'string' && c.trim() === trimmedCurCat
        );
        if (hasCategoryInBookmarks || hasCategoryInEmpty) {
            shouldLocate = true;
        }
    }

    if (shouldLocate) {
        state.sortModalStep = 2;
        state.tempSortCategory = curCat.trim();
        state.tempSortSubCategory = '';
    } else {
        state.sortModalStep = 1;
        state.tempSortCategory = '';
        state.tempSortSubCategory = '';
    }

    state.tempSortCategoryOrder = [];
    state.tempSortSubCategoryOrders = {};
    state.tempSortCardOrders = {};

    renderSortModalColumns({ animate: false });

    const modal = document.getElementById('sort-modal');

    openModal('sort', {
        onAfterActivate: () => {
            positionSortExternalBars();
            scrollToSortSlide((state.sortModalStep || 1) - 1, false);

            if (modal) {
                const colLists = modal.querySelectorAll('.sort-column-list');
                colLists.forEach(el => { el.scrollTop = 0; });
                modal.scrollTop = 0;

                if (shouldLocate) {
                    const catItems = modal.querySelectorAll('.sort-modal-item[data-sort-type="category"]');
                    const targetItem = Array.from(catItems).find(el => el.dataset.category === state.tempSortCategory);
                    if (targetItem) {
                        targetItem.scrollIntoView({ block: 'nearest' });
                    }
                }
            }
        }
    });
}

export function closeSortModal() {
    const sidebarSortBtn = document.getElementById('sidebar-sort-btn');
    const headerSortBtn = document.getElementById('header-sort-btn');

    if (sidebarSortBtn) sidebarSortBtn.classList.remove('active');
    if (headerSortBtn) headerSortBtn.classList.remove('active');

    state.tempSortCategory = '';
    state.tempSortSubCategory = '';
    state.sortModalStep = 1;
    state.isSortCarouselSwiping = false;
    state.justFinishedSortCarouselDrag = false;
    state.justFinishedSortDrag = false;
    justFinishedSortDrag = false;

    closeModal('sort', {
        afterClose: () => {
            if (state.hasPendingSyncRender) {
                state.hasPendingSyncRender = false;
                renderSidebar();
            }
        }
    });
}

export function handleSortPathClick(targetLevel) {
    const level = Number(targetLevel) || 1;
    const currentStep = state.sortModalStep || 1;

    if (level === 1 && currentStep > 1) {
        state.sortModalStep = 1;
        renderSortModalColumns({ animate: true });
    } else if (level === 2 && currentStep > 2 && state.tempSortCategory) {
        state.sortModalStep = 2;
        renderSortModalColumns({ animate: true });
    }
}

export function handleSelectSortCategory(cat) {
    if (state.justFinishedSortDrag || state.justFinishedSortCarouselDrag) return;

    if (state.tempSortCategory === cat) {
        state.tempSortCategory = '';
        state.tempSortSubCategory = '';
        state.sortModalStep = 1;
    } else {
        state.tempSortCategory = cat;
        state.tempSortSubCategory = '';
        state.sortModalStep = 2;
    }
    renderSortModalColumns({ animate: true });

    requestAnimationFrame(() => {
        const subCatList = document.getElementById('modal-sort-subcategory-column-list');
        if (subCatList) subCatList.scrollTop = 0;
    });
}

export function handleSelectSortSubCategory(sub) {
    if (state.justFinishedSortDrag || state.justFinishedSortCarouselDrag) return;

    if (state.tempSortSubCategory === sub) {
        state.tempSortSubCategory = '';
        state.sortModalStep = 2;
    } else {
        state.tempSortSubCategory = sub;
        state.sortModalStep = 3;
    }
    renderSortModalColumns({ animate: true });

    requestAnimationFrame(() => {
        const cardList = document.getElementById('modal-sort-card-column-list');
        if (cardList) cardList.scrollTop = 0;
    });
}

export function initSortCarousel() {
    const carousel = document.getElementById('sort-carousel');
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
        return slideWidth + SORT_CAROUSEL_GAP;
    };

    const getMaxAllowedSlideIndex = () => {
        if (state.tempSortCategory && state.tempSortSubCategory) return 2;
        if (state.tempSortCategory) return 1;
        return 0;
    };

    const handlePointerDown = (clientX, clientY) => {
        if (state.isSortDragging) return;
        isPointerDown = true;
        isDragging = false;
        state.isSortCarouselSwiping = false;
        startX = clientX;
        startY = clientY;
        currentDx = 0;
        dragStartTime = performance.now();
    };

    const handlePointerMove = (clientX, clientY, event) => {
        if (!isPointerDown || state.isSortDragging) return;

        const dx = clientX - startX;
        const dy = clientY - startY;

        if (!isDragging) {
            if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
            if (Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) {
                isDragging = true;
                state.isSortCarouselSwiping = true;
                carousel.classList.add('is-dragging');
            } else {
                isPointerDown = false;
                return;
            }
        }

        if (event && event.cancelable) {
            event.preventDefault();
        }

        currentDx = dx;
        const currentSlideIndex = Math.max(0, Math.min(2, (state.sortModalStep || 1) - 1));
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
            state.isSortCarouselSwiping = false;
            return;
        }

        isDragging = false;
        state.isSortCarouselSwiping = false;
        state.justFinishedSortCarouselDrag = true;
        setTimeout(() => {
            state.justFinishedSortCarouselDrag = false;
        }, 120);

        const slideWidth = carousel.offsetWidth || carousel.clientWidth || 0;
        const elapsed = Math.max(1, performance.now() - dragStartTime);
        const velocityX = currentDx / elapsed;
        const distanceThreshold = Math.max(36, slideWidth * 0.22);

        const currentSlideIndex = Math.max(0, Math.min(2, (state.sortModalStep || 1) - 1));
        const maxSlideIndex = getMaxAllowedSlideIndex();

        let nextIndex = currentSlideIndex;
        if ((currentDx < -distanceThreshold || velocityX < -0.35) && currentSlideIndex < maxSlideIndex) {
            nextIndex = currentSlideIndex + 1;
        } else if ((currentDx > distanceThreshold || velocityX > 0.35) && currentSlideIndex > 0) {
            nextIndex = currentSlideIndex - 1;
        }

        currentDx = 0;
        state.sortModalStep = nextIndex + 1;
        updateSortPathHeader();
        scrollToSortSlide(nextIndex, true);
    };

    carousel.addEventListener('click', (e) => {
        if (state.justFinishedSortCarouselDrag) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);

    carousel.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        handlePointerDown(e.clientX, e.clientY);
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
        handlePointerDown(touch.clientX, touch.clientY);
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

    const handleSortViewportChange = () => {
        if (hasModal(state, 'sort')) {
            positionSortExternalBars();
            scrollToSortSlide((state.sortModalStep || 1) - 1, false);
        }
    };

    window.addEventListener('resize', handleSortViewportChange, { passive: true });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', handleSortViewportChange, { passive: true });
        window.visualViewport.addEventListener('scroll', handleSortViewportChange, { passive: true });
    }
}

export function initSortModalDrag() {
    const modal = document.getElementById('sort-modal');
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
    let sortType = '';
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

    const checkSortSwap = (clientY) => {
        if (!isDragging || !placeholder || !activeList) return;

        const visibleItems = Array.from(
            activeList.querySelectorAll('.sort-modal-item:not(.placeholder):not(.is-drag-origin)')
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
                checkSortSwap(lastPointerY);
            }

            autoScrollRAF = requestAnimationFrame(step);
        };
        autoScrollRAF = requestAnimationFrame(step);
    };

    const startDrag = (item, clientX, clientY) => {
        isDragging = true;
        state.isSortDragging = true;
        draggingItem = item;
        sortType = item.dataset.sortType || '';
        activeList = item.closest('.sort-column-list');
        lastPointerY = clientY;

        const rect = item.getBoundingClientRect();
        const itemWidth = item.offsetWidth || rect.width;
        const itemHeight = item.offsetHeight || rect.height;
        const itemCenterX = rect.left + (rect.width / 2);
        const itemCenterY = rect.top + (rect.height / 2);
        const unscaledLeft = itemCenterX - (itemWidth / 2);
        const unscaledTop = itemCenterY - (itemHeight / 2);

        dragOffsetX = clientX - unscaledLeft;
        dragOffsetY = clientY - unscaledTop;

        placeholder = document.createElement('div');
        placeholder.className = 'sort-modal-item placeholder';
        placeholder.style.height = `${itemHeight}px`;
        placeholder.style.minHeight = `${itemHeight}px`;
        item.before(placeholder);

        item.classList.add('is-drag-origin');

        dragGhost = document.createElement('div');
        dragGhost.className = 'sort-drag-ghost';
        dragGhost.style.width = `${itemWidth}px`;
        dragGhost.style.height = `${itemHeight}px`;
        dragGhost.innerHTML = `
            <span class="item-icon category-dot">
                <span class="category-dot-circle"></span>
            </span>
        `;
        const label = document.createElement('span');
        label.className = 'sort-modal-item-text';
        label.textContent = item.querySelector('.sort-modal-item-text')?.innerText || '';
        dragGhost.appendChild(label);
        dragGhost.style.left = `${clientX - dragOffsetX}px`;
        dragGhost.style.top = `${clientY - dragOffsetY}px`;

        window.getSelection()?.removeAllRanges();
        document.body.appendChild(dragGhost);
        document.body.classList.add('no-scroll', 'is-dragging-item');
        startAutoScroll();
    };

    const handlePointerDown = (e) => {
        if (state.isSortCarouselSwiping) return;
        const item = e.target.closest('.sort-modal-item');
        if (!item) return;

        isDragCandidate = true;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        startPointerX = clientX;
        startPointerY = clientY;
        lastPointerY = clientY;

        longPressTimer = setTimeout(() => {
            if (state.isSortCarouselSwiping) return;
            if (navigator.vibrate) navigator.vibrate(30);
            startDrag(item, clientX, clientY);
        }, 280);
    };

    const handlePointerMove = (e) => {
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        lastPointerY = clientY;

        if (isDragCandidate && !isDragging) {
            if (state.isSortCarouselSwiping || Math.hypot(clientX - startPointerX, clientY - startPointerY) > 8) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
                isDragCandidate = false;
            }
        }

        if (isDragging && dragGhost) {
            if (e.cancelable) e.preventDefault();
            dragGhost.style.left = `${clientX - dragOffsetX}px`;
            dragGhost.style.top = `${clientY - dragOffsetY}px`;
            checkSortSwap(clientY);
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
        state.isSortDragging = false;
        stopAutoScroll();

        if (dragGhost && dragGhost.parentNode) {
            dragGhost.parentNode.removeChild(dragGhost);
        }
        dragGhost = null;

        document.body.classList.remove('no-scroll', 'is-dragging-item');

        if (activeList) {
            activeList.querySelectorAll('.sort-modal-item').forEach(el => {
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

        justFinishedSortDrag = true;
        state.justFinishedSortDrag = true;
        setTimeout(() => {
            justFinishedSortDrag = false;
            state.justFinishedSortDrag = false;
        }, 150);

        if (activeList) {
            const currentItems = Array.from(activeList.querySelectorAll('.sort-modal-item:not(.placeholder)'));
            if (sortType === 'category') {
                state.tempSortCategoryOrder = currentItems.map(el => el.dataset.category).filter(Boolean);
            } else if (sortType === 'subcategory') {
                const currentCat = state.tempSortCategory;
                if (!state.tempSortSubCategoryOrders) state.tempSortSubCategoryOrders = {};
                state.tempSortSubCategoryOrders[currentCat] = currentItems.map(el => el.dataset.subcategory).filter(Boolean);
            } else if (sortType === 'card') {
                const currentCat = state.tempSortCategory;
                const currentSub = state.tempSortSubCategory;
                const cardKey = `${currentCat}:::${currentSub}`;
                if (!state.tempSortCardOrders) state.tempSortCardOrders = {};
                state.tempSortCardOrders[cardKey] = currentItems.map(el => el.dataset.id).filter(Boolean);
            }
        }

        draggingItem = null;
        placeholder = null;
        activeList = null;
        sortType = '';
    };

    modal.addEventListener('mousedown', handlePointerDown);
    modal.addEventListener('touchstart', handlePointerDown, { passive: true });

    document.addEventListener('mousemove', handlePointerMove, { passive: false });
    document.addEventListener('touchmove', handlePointerMove, { passive: false });

    document.addEventListener('mouseup', handlePointerUp);
    document.addEventListener('touchend', handlePointerUp);
    document.addEventListener('touchcancel', handlePointerUp);
}
