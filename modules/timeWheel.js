// @ts-check
// @ts-nocheck
// Inherits the legacy interaction.js type-checking boundary until its separate type pass.
import { state } from '../state.js';
export let timeWheelSelectedHour = 12;

export let timeWheelSelectedMinute = 0;

let isCalendarTimeWheelInitialized = false;

const TIME_WHEEL_ITEM_HEIGHT = 30;

const TIME_WHEEL_CENTER_OFFSET = 15;

function getTimeWheelCenterOffset() {
    return (window.innerWidth <= 768 ? 13 : TIME_WHEEL_CENTER_OFFSET);
}

export function triggerHaptic(type = 'light') {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try {
            if (type === 'light') {
                navigator.vibrate(8);
            } else if (type === 'heavy') {
                navigator.vibrate(22);
            }
        } catch (e) {
            // 靜默略過未支援震動或限制環境
        }
    }
}

export function updateTimeBarAdjustedUI() {
    const draft = state.editorDraft;
    const startBar = document.getElementById('calendar-start-time-bar') || document.getElementById('calendar-time-bar');
    const endBar = document.getElementById('calendar-end-time-bar');
    const confirmBtn = document.getElementById('calendar-confirm-btn');

    if (startBar) {
        if (draft.isReminderStartTimeAdjusted) {
            startBar.classList.remove('unadjusted-time');
            startBar.classList.add('adjusted-time');
        } else {
            startBar.classList.remove('adjusted-time');
            startBar.classList.add('unadjusted-time');
        }
    }

    if (endBar) {
        if (draft.isReminderEndTimeAdjusted) {
            endBar.classList.remove('unadjusted-time');
            endBar.classList.add('adjusted-time');
        } else {
            endBar.classList.remove('adjusted-time');
            endBar.classList.add('unadjusted-time');
        }
    }

    const anyAdjusted = draft.isReminderStartTimeAdjusted || draft.isReminderEndTimeAdjusted;

    if (confirmBtn) {
        confirmBtn.classList.toggle('adjusted', anyAdjusted);
    }
}

export function positionCalendarTimeBar() {
    const topBar = document.getElementById('calendar-top-bar');
    const calModal = document.getElementById('calendar-modal');
    if (!topBar || !calModal) return;

    const isMobile = window.innerWidth <= 768;
    const barHeight = topBar.offsetHeight || (isMobile ? 52 : 60);
    const gap = 12;
    const modalHeight = calModal.offsetHeight || 380;
    const topPos = Math.max(12, Math.round((window.innerHeight / 2) - (modalHeight / 2) - barHeight - gap));

    topBar.style.top = `${topPos}px`;
    topBar.style.left = '50%';
}

export function openCalendarTimeBar() {
    const topBar = document.getElementById('calendar-top-bar');
    if (!topBar) return;

    const draft = state.editorDraft;
    initCalendarTimeWheelDOM();

    if (!topBar.classList.contains('active')) {
        let sHour = 12;
        let sMinute = 0;
        let eHour = 18;
        let eMinute = 0;

        if (draft.editingReminderId && state.reminders[draft.editingReminderId]) {
            const r = state.reminders[draft.editingReminderId];
            if (r.startTime) {
                const [sh, sm] = r.startTime.split(':').map(n => parseInt(n, 10));
                if (!isNaN(sh)) sHour = sh;
                if (!isNaN(sm)) sMinute = sm;
                draft.isReminderStartTimeAdjusted = true;
            } else {
                draft.isReminderStartTimeAdjusted = false;
            }
            if (r.endTime) {
                const [eh, em] = r.endTime.split(':').map(n => parseInt(n, 10));
                if (!isNaN(eh)) eHour = eh;
                if (!isNaN(em)) eMinute = em;
                draft.isReminderEndTimeAdjusted = true;
            } else {
                draft.isReminderEndTimeAdjusted = false;
            }
        } else {
            if (draft.reminderDate) {
                const val = draft.reminderDate.trim();
                const timeMatches = val.match(/\b(\d{1,2}):(\d{2})\b/g);
                if (timeMatches && timeMatches.length > 0) {
                    const [sh, sm] = timeMatches[0].split(':').map(Number);
                    sHour = sh; sMinute = sm;
                    draft.isReminderStartTimeAdjusted = true;
                    if (timeMatches.length > 1) {
                        const [eh, em] = timeMatches[1].split(':').map(Number);
                        eHour = eh; eMinute = em;
                        draft.isReminderEndTimeAdjusted = true;
                    }
                } else {
                    const now = new Date();
                    sHour = now.getHours();
                    sMinute = now.getMinutes();
                    eHour = Math.min(23, sHour + 1);
                    eMinute = sMinute;
                    draft.isReminderStartTimeAdjusted = false;
                    draft.isReminderEndTimeAdjusted = false;
                }
            } else {
                const now = new Date();
                sHour = now.getHours();
                sMinute = now.getMinutes();
                eHour = Math.min(23, sHour + 1);
                eMinute = sMinute;
                draft.isReminderStartTimeAdjusted = false;
                draft.isReminderEndTimeAdjusted = false;
            }
        }

        draft.timeWheelStartHour = Math.max(0, Math.min(23, sHour));
        draft.timeWheelStartMinute = Math.max(0, Math.min(59, sMinute));
        draft.timeWheelEndHour = Math.max(0, Math.min(23, eHour));
        draft.timeWheelEndMinute = Math.max(0, Math.min(59, eMinute));

        const sDate = draft.tempSelectedReminderStartDate;
        const eDate = draft.tempSelectedReminderEndDate;
        if (!sDate || !eDate || sDate === eDate) {
            const startTotal = draft.timeWheelStartHour * 60 + draft.timeWheelStartMinute;
            const endTotal = draft.timeWheelEndHour * 60 + draft.timeWheelEndMinute;
            if (startTotal > endTotal) {
                draft.timeWheelEndHour = draft.timeWheelStartHour;
                draft.timeWheelEndMinute = draft.timeWheelStartMinute;
            }
        }

        timeWheelSelectedHour = draft.timeWheelStartHour;
        timeWheelSelectedMinute = draft.timeWheelStartMinute;

        draft.initialWheelStartHour = draft.timeWheelStartHour;
        draft.initialWheelStartMinute = draft.timeWheelStartMinute;
        draft.initialWheelEndHour = draft.timeWheelEndHour;
        draft.initialWheelEndMinute = draft.timeWheelEndMinute;
    }

    updateTimeBarAdjustedUI();

    topBar.style.display = 'flex';
    requestAnimationFrame(() => {
        positionCalendarTimeBar();
        topBar.classList.add('active');
        setTimeWheelIndex('start-hours', draft.timeWheelStartHour, false);
        setTimeWheelIndex('start-minutes', draft.timeWheelStartMinute, false);
        setTimeWheelIndex('end-hours', draft.timeWheelEndHour, false);
        setTimeWheelIndex('end-minutes', draft.timeWheelEndMinute, false);
    });
}

export function closeCalendarTimeBar() {
    const topBar = document.getElementById('calendar-top-bar');
    if (!topBar) return;
    topBar.classList.remove('active');
    setTimeout(() => {
        if (!topBar.classList.contains('active')) {
            topBar.style.display = 'none';
        }
    }, 250);
}

function initCalendarTimeWheelDOM() {
    if (isCalendarTimeWheelInitialized) return;
    isCalendarTimeWheelInitialized = true;

    const wheelUnits = [
        { colId: 'time-col-start-hours', trackId: 'time-track-start-hours', unit: 'start-hours', count: 24 },
        { colId: 'time-col-start-minutes', trackId: 'time-track-start-minutes', unit: 'start-minutes', count: 60 },
        { colId: 'time-col-end-hours', trackId: 'time-track-end-hours', unit: 'end-hours', count: 24 },
        { colId: 'time-col-end-minutes', trackId: 'time-track-end-minutes', unit: 'end-minutes', count: 60 }
    ];

    wheelUnits.forEach(({ colId, trackId, unit, count }) => {
        const track = document.getElementById(trackId);
        if (track) {
            track.innerHTML = '';
            for (let i = 0; i < count; i++) {
                const item = document.createElement('div');
                item.className = 'calendar-time-item';
                item.dataset.value = i;
                item.textContent = String(i).padStart(2, '0');
                track.appendChild(item);
            }
            setupElasticPhysicsWheel(colId, trackId, unit, count);
        }
    });

    const repositionTimeBar = () => {
        if (document.getElementById('calendar-top-bar')?.classList.contains('active')) {
            positionCalendarTimeBar();
        }
    };
    window.addEventListener('resize', repositionTimeBar, { passive: true });
    const calendarModal = document.getElementById('calendar-modal');
    if (calendarModal && typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(repositionTimeBar).observe(calendarModal);
    }
}

function getTrackByUnit(unit) {
    if (unit === 'start-hours') return document.getElementById('time-track-start-hours');
    if (unit === 'start-minutes') return document.getElementById('time-track-start-minutes');
    if (unit === 'end-hours') return document.getElementById('time-track-end-hours');
    if (unit === 'end-minutes') return document.getElementById('time-track-end-minutes');
    return null;
}

function setTimeWheelIndex(unit, index, animate = true) {
    const track = getTrackByUnit(unit);
    if (!track) return;

    const centerOffset = getTimeWheelCenterOffset();
    const targetY = centerOffset - (index * TIME_WHEEL_ITEM_HEIGHT);
    if (!animate) {
        track.style.transition = 'none';
        track.style.transform = `translateY(${targetY}px)`;
        track._currentY = targetY;
        updateTimeWheelActiveState(unit, index, false);
    } else {
        animateSpringSnap(track, unit, targetY, index);
    }
}

let isEnforcingTimeOrder = false;

export function enforceSameDayTimeOrder(sourceUnit = null) {
    if (isEnforcingTimeOrder) return;

    const draft = state.editorDraft;
    const sDate = draft.tempSelectedReminderStartDate;
    const eDate = draft.tempSelectedReminderEndDate;
    const isSameDay = !sDate || !eDate || sDate === eDate;
    if (!isSameDay) return;

    const startTotal = draft.timeWheelStartHour * 60 + draft.timeWheelStartMinute;
    const endTotal = draft.timeWheelEndHour * 60 + draft.timeWheelEndMinute;

    if (startTotal <= endTotal) return;

    isEnforcingTimeOrder = true;
    try {
        if (sourceUnit === 'end-hours' || sourceUnit === 'end-minutes') {
            draft.timeWheelStartHour = draft.timeWheelEndHour;
            draft.timeWheelStartMinute = draft.timeWheelEndMinute;
            timeWheelSelectedHour = draft.timeWheelStartHour;
            timeWheelSelectedMinute = draft.timeWheelStartMinute;
            setTimeWheelIndex('start-hours', draft.timeWheelStartHour, false);
            setTimeWheelIndex('start-minutes', draft.timeWheelStartMinute, false);
        } else {
            draft.timeWheelEndHour = draft.timeWheelStartHour;
            draft.timeWheelEndMinute = draft.timeWheelStartMinute;
            setTimeWheelIndex('end-hours', draft.timeWheelEndHour, false);
            setTimeWheelIndex('end-minutes', draft.timeWheelEndMinute, false);
        }
    } finally {
        isEnforcingTimeOrder = false;
    }
}

function updateTimeWheelActiveState(unit, activeIndex, triggerHapticFeedback = true) {
    const track = getTrackByUnit(unit);
    if (!track) return;
    const items = track.querySelectorAll('.calendar-time-item');
    items.forEach((item, idx) => {
        item.classList.toggle('active', idx === activeIndex);
    });

    const draft = state.editorDraft;
    let previousValue = 0;
    if (unit === 'start-hours') {
        previousValue = draft.timeWheelStartHour;
        draft.timeWheelStartHour = activeIndex;
        timeWheelSelectedHour = activeIndex;
        if (!draft.isReminderStartTimeAdjusted && activeIndex !== draft.initialWheelStartHour) {
            draft.isReminderStartTimeAdjusted = true;
        }
    } else if (unit === 'start-minutes') {
        previousValue = draft.timeWheelStartMinute;
        draft.timeWheelStartMinute = activeIndex;
        timeWheelSelectedMinute = activeIndex;
        if (!draft.isReminderStartTimeAdjusted && activeIndex !== draft.initialWheelStartMinute) {
            draft.isReminderStartTimeAdjusted = true;
        }
    } else if (unit === 'end-hours') {
        previousValue = draft.timeWheelEndHour;
        draft.timeWheelEndHour = activeIndex;
        if (!draft.isReminderEndTimeAdjusted && activeIndex !== draft.initialWheelEndHour) {
            draft.isReminderEndTimeAdjusted = true;
        }
    } else if (unit === 'end-minutes') {
        previousValue = draft.timeWheelEndMinute;
        draft.timeWheelEndMinute = activeIndex;
        if (!draft.isReminderEndTimeAdjusted && activeIndex !== draft.initialWheelEndMinute) {
            draft.isReminderEndTimeAdjusted = true;
        }
    }

    if (triggerHapticFeedback && previousValue !== activeIndex) {
        triggerHaptic('light');
    }

    enforceSameDayTimeOrder(unit);
    updateTimeBarAdjustedUI();
}

function animateSpringSnap(track, unit, targetY, targetIndex) {
    if (track._springRAF) cancelAnimationFrame(track._springRAF);

    let currentY = track._currentY || getTimeWheelCenterOffset();
    let velocity = track._velocity || 0;
    const stiffness = 0.18;
    const damping = 0.72;
    const maxIndex = (unit === 'start-hours' || unit === 'end-hours') ? 23 : 59;

    const step = () => {
        const force = (targetY - currentY) * stiffness;
        velocity = (velocity + force) * damping;
        currentY += velocity;

        track.style.transition = 'none';
        track.style.transform = `translateY(${currentY}px)`;
        track._currentY = currentY;

        const centerOffset = getTimeWheelCenterOffset();
        const liveIndex = Math.max(0, Math.min(maxIndex, Math.round((centerOffset - currentY) / TIME_WHEEL_ITEM_HEIGHT)));
        updateTimeWheelActiveState(unit, liveIndex, true);

        if (Math.abs(targetY - currentY) < 0.2 && Math.abs(velocity) < 0.2) {
            track.style.transform = `translateY(${targetY}px)`;
            track._currentY = targetY;
            track._velocity = 0;
            track._springRAF = null;
            updateTimeWheelActiveState(unit, targetIndex, false);
            triggerHaptic('heavy');
            return;
        }

        track._springRAF = requestAnimationFrame(step);
    };

    track._springRAF = requestAnimationFrame(step);
}

function setupElasticPhysicsWheel(colId, trackId, unit, totalCount) {
    const col = document.getElementById(colId);
    const track = document.getElementById(trackId);
    if (!col || !track) return;

    track._currentY = getTimeWheelCenterOffset();
    track._velocity = 0;

    let isTouching = false;
    let startPointerY = 0;
    let startTrackY = 0;
    let lastPointerY = 0;
    let lastTime = 0;
    let pointerVelocity = 0;

    const onPointerDown = (e) => {
        isTouching = true;
        if (track._springRAF) cancelAnimationFrame(track._springRAF);

        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        startPointerY = clientY;
        lastPointerY = clientY;
        startTrackY = track._currentY;
        lastTime = performance.now();
        pointerVelocity = 0;
    };

    const onPointerMove = (e) => {
        if (!isTouching) return;
        if (e.cancelable) e.preventDefault();

        const centerOffset = getTimeWheelCenterOffset();
        const maxY = centerOffset;
        const minY = centerOffset - ((totalCount - 1) * TIME_WHEEL_ITEM_HEIGHT);

        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const now = performance.now();
        const deltaY = clientY - startPointerY;
        let nextY = startTrackY + deltaY;

        if (nextY > maxY) {
            const overflow = nextY - maxY;
            nextY = maxY + (overflow * 0.35);
        } else if (nextY < minY) {
            const overflow = minY - nextY;
            nextY = minY - (overflow * 0.35);
        }

        const dt = now - lastTime;
        if (dt > 10) {
            pointerVelocity = (clientY - lastPointerY) / dt * 16;
            lastPointerY = clientY;
            lastTime = now;
        }

        track.style.transition = 'none';
        track.style.transform = `translateY(${nextY}px)`;
        track._currentY = nextY;

        const liveIndex = Math.max(0, Math.min(totalCount - 1, Math.round((centerOffset - nextY) / TIME_WHEEL_ITEM_HEIGHT)));
        updateTimeWheelActiveState(unit, liveIndex, true);
    };

    const onPointerUp = () => {
        if (!isTouching) return;
        isTouching = false;

        const centerOffset = getTimeWheelCenterOffset();
        let projectedY = track._currentY + (pointerVelocity * 4);
        let targetIndex = Math.round((centerOffset - projectedY) / TIME_WHEEL_ITEM_HEIGHT);
        targetIndex = Math.max(0, Math.min(totalCount - 1, targetIndex));

        const targetY = centerOffset - (targetIndex * TIME_WHEEL_ITEM_HEIGHT);
        track._velocity = pointerVelocity;
        animateSpringSnap(track, unit, targetY, targetIndex);
    };

    const onWheel = (e) => {
        e.preventDefault();
        if (track._springRAF) cancelAnimationFrame(track._springRAF);

        const centerOffset = getTimeWheelCenterOffset();
        const maxY = centerOffset;
        const minY = centerOffset - ((totalCount - 1) * TIME_WHEEL_ITEM_HEIGHT);

        const delta = -e.deltaY * 0.45;
        let nextY = track._currentY + delta;

        if (nextY > maxY) nextY = maxY + (nextY - maxY) * 0.2;
        if (nextY < minY) nextY = minY - (minY - nextY) * 0.2;

        track.style.transition = 'none';
        track.style.transform = `translateY(${nextY}px)`;
        track._currentY = nextY;

        let targetIndex = Math.round((centerOffset - nextY) / TIME_WHEEL_ITEM_HEIGHT);
        targetIndex = Math.max(0, Math.min(totalCount - 1, targetIndex));
        updateTimeWheelActiveState(unit, targetIndex, true);

        clearTimeout(track._wheelSnapTimer);
        track._wheelSnapTimer = setTimeout(() => {
            const targetY = centerOffset - (targetIndex * TIME_WHEEL_ITEM_HEIGHT);
            animateSpringSnap(track, unit, targetY, targetIndex);
        }, 80);
    };

    col.addEventListener('mousedown', onPointerDown);
    col.addEventListener('touchstart', onPointerDown, { passive: false });
    col.addEventListener('wheel', onWheel, { passive: false });

    window.addEventListener('mousemove', onPointerMove, { passive: false });
    window.addEventListener('touchmove', onPointerMove, { passive: false });
    window.addEventListener('mouseup', onPointerUp);
    window.addEventListener('touchend', onPointerUp);
    window.addEventListener('touchcancel', onPointerUp);
}
