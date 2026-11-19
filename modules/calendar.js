// @ts-check
// @ts-nocheck
// Inherits the legacy interaction.js type-checking boundary until its separate type pass.
import { state } from '../state.js';
import { getCalendarDateRange, hasModal } from '../domain.js';
import { openModal, closeModal } from './modalManager.js';
import { getLocalDateString, renderCalendar, updateReminderPreviewDisplay } from '../ui.js';
import { closeCalendarTimeBar, enforceSameDayTimeOrder, openCalendarTimeBar, positionCalendarTimeBar, triggerHaptic } from './timeWheel.js';
export function updateCalendarRangeHighlight(start, end) {
    const calDays = document.getElementById('cal-days');
    if (!calDays) return;

    if (!start && !end) {
        calDays.querySelectorAll('.cal-day-cell').forEach(cell => {
            cell.classList.remove('selected', 'range-start', 'range-between', 'range-end', 'range-month-start', 'range-month-end');
        });
        return;
    }

    if (!start) start = end;
    if (!end) end = start;

    const actualStart = start <= end ? start : end;
    const actualEnd = start <= end ? end : start;

    const draft = state.editorDraft;
    const year = draft.calDate.getFullYear();
    const month = draft.calDate.getMonth() + 1;
    const daysInMonth = new Date(year, month, 0).getDate();

    calDays.querySelectorAll('.cal-day-cell').forEach(cell => {
        const dayNum = parseInt(cell.textContent.trim(), 10);
        if (isNaN(dayNum)) {
            cell.classList.remove('selected', 'range-start', 'range-between', 'range-end', 'range-month-start', 'range-month-end');
            return;
        }

        const cellDate = cell.dataset.date || `${year}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
        cell.dataset.date = cellDate;

        cell.classList.remove('selected', 'range-start', 'range-between', 'range-end', 'range-month-start', 'range-month-end');

        if (cellDate === actualStart && cellDate === actualEnd) {
            cell.classList.add('selected', 'range-start', 'range-end');
        } else if (cellDate === actualStart) {
            cell.classList.add('range-start');
        } else if (cellDate === actualEnd) {
            cell.classList.add('range-end');
        } else if (cellDate > actualStart && cellDate < actualEnd) {
            cell.classList.add('range-between');
            if (dayNum === 1) {
                cell.classList.add('range-month-start');
            }
            if (dayNum === daysInMonth) {
                cell.classList.add('range-month-end');
            }
        }
    });
}

function getCellDateFromElement(cell) {
    if (!cell) return '';
    if (cell.dataset.date) return cell.dataset.date;
    const dayNum = parseInt(cell.textContent.trim(), 10);
    if (isNaN(dayNum)) return '';
    const draft = state.editorDraft;
    const year = draft.calDate.getFullYear();
    const month = draft.calDate.getMonth() + 1;
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    cell.dataset.date = dateStr;
    return dateStr;
}

let justFinishedCalendarDrag = false;

export function initCalendarDragInteractions() {
    const calDays = document.getElementById('cal-days');
    if (!calDays) return;

    let isDragCandidate = false;
    let startPointerX = 0;
    let startPointerY = 0;
    let monthSwitchCooldown = false;
    let monthSwitchCooldownTimer = null;
    let autoMonthSwitchTimer = null;
    let pointerAfterMonthSwitch = null;
    let lastPointerX = 0;
    let lastPointerY = 0;

    const applyDraggedDateRange = (hoverDate) => {
        const draft = state.editorDraft;
        draft.calendarDragHoverDate = hoverDate;
        const { start, end } = getCalendarDateRange(draft.calendarDragAnchorDate, hoverDate);
        draft.tempSelectedReminderStartDate = start;
        draft.tempSelectedReminderEndDate = end;
        draft.tempSelectedReminderDate = start;
        enforceSameDayTimeOrder();
        updateCalendarRangeHighlight(start, end);
    };

    const handlePointerDown = (e) => {
        const cell = e.target.closest('.cal-day-cell');
        if (!cell) return;

        const cellDate = getCellDateFromElement(cell);
        if (!cellDate) return;

        const draft = state.editorDraft;
        isDragCandidate = true;
        startPointerX = (e.touches && e.touches.length > 0) ? e.touches[0].clientX : e.clientX;
        startPointerY = (e.touches && e.touches.length > 0) ? e.touches[0].clientY : e.clientY;
        lastPointerX = startPointerX;
        lastPointerY = startPointerY;
        pointerAfterMonthSwitch = null;

        const curStart = draft.tempSelectedReminderStartDate;
        const curEnd = draft.tempSelectedReminderEndDate;
        const hasMultiDayRange = Boolean(curStart && curEnd && curStart !== curEnd);

        if (hasMultiDayRange && (cell.classList.contains('range-end') || cellDate === curEnd)) {
            draft.calendarDragAnchorDate = curStart;
            draft.calendarDragHoverDate = curEnd;
        } else if (hasMultiDayRange && (cell.classList.contains('range-start') || cellDate === curStart)) {
            draft.calendarDragAnchorDate = curEnd;
            draft.calendarDragHoverDate = curStart;
        } else {
            draft.calendarDragAnchorDate = cellDate;
            draft.calendarDragHoverDate = cellDate;
        }
    };

    const handlePointerMove = (e) => {
        if (!isDragCandidate && !state.isCalendarDateDragging) return;

        const draft = state.editorDraft;
        const clientX = (e.touches && e.touches.length > 0) ? e.touches[0].clientX : e.clientX;
        const clientY = (e.touches && e.touches.length > 0) ? e.touches[0].clientY : e.clientY;
        lastPointerX = clientX;
        lastPointerY = clientY;

        if (!state.isCalendarDateDragging) {
            const dist = Math.hypot(clientX - startPointerX, clientY - startPointerY);
            if (dist > 5) {
                state.isCalendarDateDragging = true;
                const calDaysEl = document.getElementById('cal-days');
                if (calDaysEl) calDaysEl.classList.add('is-dragging');
            }
        }

        if (state.isCalendarDateDragging) {
            if (e.cancelable) e.preventDefault();
            const hoverTarget = document.elementFromPoint(clientX, clientY);
            const cell = hoverTarget ? hoverTarget.closest('.cal-day-cell') : null;

            const curYear = draft.calDate.getFullYear();
            const curMonth = draft.calDate.getMonth() + 1;
            const daysInCurMonth = new Date(curYear, curMonth, 0).getDate();
            const lastDayStr = `${curYear}-${String(curMonth).padStart(2, '0')}-${String(daysInCurMonth).padStart(2, '0')}`;
            const firstDayStr = `${curYear}-${String(curMonth).padStart(2, '0')}-01`;

            const triggerDragMonthSwitch = (delta) => {
                if (monthSwitchCooldown) return;
                monthSwitchCooldown = true;
                monthSwitchCooldownTimer = setTimeout(() => {
                    monthSwitchCooldown = false;
                    monthSwitchCooldownTimer = null;
                }, 380);

                changeMonth(delta);

                const newYear = draft.calDate.getFullYear();
                const newMonth = draft.calDate.getMonth() + 1;
                const daysInNewMonth = new Date(newYear, newMonth, 0).getDate();

                const newHoverDate = delta > 0
                    ? `${newYear}-${String(newMonth).padStart(2, '0')}-01`
                    : `${newYear}-${String(newMonth).padStart(2, '0')}-${String(daysInNewMonth).padStart(2, '0')}`;
                applyDraggedDateRange(newHoverDate);
                pointerAfterMonthSwitch = { x: lastPointerX, y: lastPointerY };
                triggerHaptic('light');
            };

            const pointerMovedAfterMonthSwitch = !pointerAfterMonthSwitch ||
                Math.hypot(clientX - pointerAfterMonthSwitch.x, clientY - pointerAfterMonthSwitch.y) > 5;
            if (pointerMovedAfterMonthSwitch) pointerAfterMonthSwitch = null;

            if (cell && pointerMovedAfterMonthSwitch) {
                const hoverDate = getCellDateFromElement(cell);
                if (hoverDate && hoverDate !== draft.calendarDragHoverDate) {
                    applyDraggedDateRange(hoverDate);
                }

                if (hoverDate === lastDayStr) {
                    if (!autoMonthSwitchTimer && !monthSwitchCooldown) {
                        autoMonthSwitchTimer = setTimeout(() => {
                            if (state.isCalendarDateDragging && draft.calendarDragHoverDate === lastDayStr) {
                                triggerDragMonthSwitch(1);
                            }
                            autoMonthSwitchTimer = null;
                        }, 320);
                    }
                } else if (hoverDate === firstDayStr) {
                    if (!autoMonthSwitchTimer && !monthSwitchCooldown) {
                        autoMonthSwitchTimer = setTimeout(() => {
                            if (state.isCalendarDateDragging && draft.calendarDragHoverDate === firstDayStr) {
                                triggerDragMonthSwitch(-1);
                            }
                            autoMonthSwitchTimer = null;
                        }, 320);
                    }
                } else {
                    if (autoMonthSwitchTimer) {
                        clearTimeout(autoMonthSwitchTimer);
                        autoMonthSwitchTimer = null;
                    }
                }
            } else if (!cell && pointerMovedAfterMonthSwitch) {
                const calDaysEl = document.getElementById('cal-days');
                if (calDaysEl) {
                    const rect = calDaysEl.getBoundingClientRect();
                    if (draft.calendarDragHoverDate === lastDayStr && (clientY > rect.bottom - 15 || clientX > rect.right - 25)) {
                        triggerDragMonthSwitch(1);
                    } else if (draft.calendarDragHoverDate === firstDayStr && (clientY < rect.top + 15 || clientX < rect.left + 25)) {
                        triggerDragMonthSwitch(-1);
                    }
                }
            }
        }
    };

    const handlePointerUp = (e) => {
        if (!isDragCandidate && !state.isCalendarDateDragging) return;

        if (autoMonthSwitchTimer) {
            clearTimeout(autoMonthSwitchTimer);
            autoMonthSwitchTimer = null;
        }
        if (monthSwitchCooldownTimer) {
            clearTimeout(monthSwitchCooldownTimer);
            monthSwitchCooldownTimer = null;
            monthSwitchCooldown = false;
        }

        const draft = state.editorDraft;
        const wasDragging = state.isCalendarDateDragging;
        isDragCandidate = false;
        state.isCalendarDateDragging = false;

        const calDaysEl = document.getElementById('cal-days');
        if (calDaysEl) calDaysEl.classList.remove('is-dragging');

        // 僅限透過滑動拖曳（wasDragging === true）產生與保留起訖區間
        if (wasDragging && draft.calendarDragAnchorDate && draft.calendarDragHoverDate) {
            applyDraggedDateRange(draft.calendarDragHoverDate);
            draft.calendarCrossMonthAnchorDate = '';
            triggerHaptic('light');

            justFinishedCalendarDrag = true;
            setTimeout(() => { justFinishedCalendarDrag = false; }, 180);
        }

        draft.calendarDragAnchorDate = '';
        draft.calendarDragHoverDate = '';
        pointerAfterMonthSwitch = null;
    };

    calDays.removeEventListener('mousedown', handlePointerDown);
    calDays.removeEventListener('touchstart', handlePointerDown);
    calDays.addEventListener('mousedown', handlePointerDown);
    calDays.addEventListener('touchstart', handlePointerDown, { passive: true });

    document.removeEventListener('mousemove', handlePointerMove);
    document.removeEventListener('touchmove', handlePointerMove);
    document.addEventListener('mousemove', handlePointerMove, { passive: false });
    document.addEventListener('touchmove', handlePointerMove, { passive: false });

    document.removeEventListener('mouseup', handlePointerUp);
    document.removeEventListener('touchend', handlePointerUp);
    document.removeEventListener('touchcancel', handlePointerUp);
    document.addEventListener('mouseup', handlePointerUp);
    document.addEventListener('touchend', handlePointerUp);
    document.addEventListener('touchcancel', handlePointerUp);
    window.addEventListener('blur', handlePointerUp);
}

export function toggleCalendar() {
    const draft = state.editorDraft;

    if (state.currentUnifiedType === 'reminder') {
        let sDate = (draft.reminderStartDate || '').trim();
        let eDate = (draft.reminderEndDate || '').trim();

        if (!sDate && draft.reminderDate) {
            const raw = draft.reminderDate.trim();
            const dateMatches = raw.match(/\d{4}-\d{2}-\d{2}/g);
            if (dateMatches && dateMatches.length > 0) {
                sDate = dateMatches[0];
                eDate = dateMatches[1] || dateMatches[0];
            }
        }

        if (!sDate) {
            sDate = getLocalDateString();
            eDate = sDate;
        }

        draft.tempSelectedReminderStartDate = sDate;
        draft.tempSelectedReminderEndDate = eDate || sDate;
        draft.tempSelectedReminderDate = sDate;
        draft.calendarCrossMonthAnchorDate = '';

        const parts = sDate.split('-');
        if (parts.length === 3) {
            draft.calDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        }
    } else {
        draft.tempSelectedReminderStartDate = '';
        draft.tempSelectedReminderEndDate = '';
        draft.tempSelectedReminderDate = '';
        draft.calendarCrossMonthAnchorDate = '';
    }

    renderCalendar();
    updateCalendarRangeHighlight(draft.tempSelectedReminderStartDate, draft.tempSelectedReminderEndDate);

    if (state.currentUnifiedType === 'reminder') {
        openCalendarTimeBar();
    } else {
        closeCalendarTimeBar();
    }

    openModal('calendar', {
        onAfterActivate: () => {
            if (state.currentUnifiedType === 'reminder') {
                positionCalendarTimeBar();
            }
        }
    });
}

export function confirmCalendarSelection() {
    const draft = state.editorDraft;
    let startDate = draft.tempSelectedReminderStartDate;
    let endDate = draft.tempSelectedReminderEndDate;

    if (!startDate && !endDate) {
        if (draft.tempSelectedReminderDate) {
            startDate = draft.tempSelectedReminderDate;
            endDate = draft.tempSelectedReminderDate;
        } else {
            if (draft.reminderStartDate) startDate = draft.reminderStartDate.trim();
            if (draft.reminderEndDate) endDate = draft.reminderEndDate.trim();
            if (!startDate && draft.reminderDate) {
                const parts = draft.reminderDate.trim().split(/\s+/);
                startDate = parts[0] || '';
                endDate = startDate;
            }
        }
    }

    if (!startDate && endDate) startDate = endDate;
    if (startDate && !endDate) endDate = startDate;

    if (!startDate && !endDate) {
        const todayStr = getLocalDateString();
        startDate = todayStr;
        endDate = todayStr;
    }

    if (startDate > endDate) {
        endDate = startDate;
    }

    draft.tempSelectedReminderStartDate = startDate;
    draft.tempSelectedReminderEndDate = endDate;
    draft.tempSelectedReminderDate = startDate;

    enforceSameDayTimeOrder();

    const days = ['日', '一', '二', '三', '四', '五', '六'];
    const getWeekday = (dStr) => {
        const parts = dStr.split('-');
        if (parts.length !== 3) return '';
        const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        return isNaN(d.getTime()) ? '' : `(${days[d.getDay()]})`;
    };

    const hasTime = draft.isReminderStartTimeAdjusted || draft.isReminderEndTimeAdjusted;
    const startHH = String(draft.timeWheelStartHour).padStart(2, '0');
    const startMM = String(draft.timeWheelStartMinute).padStart(2, '0');
    const endHH = String(draft.timeWheelEndHour).padStart(2, '0');
    const endMM = String(draft.timeWheelEndMinute).padStart(2, '0');

    let formattedDisplay = '';
    let valString = '';

    if (hasTime) {
        const startW = getWeekday(startDate);
        const endW = getWeekday(endDate);

        if (startDate === endDate) {
            formattedDisplay = `${startDate} ${startW} ${startHH}:${startMM} ~ ${endHH}:${endMM}`.trim();
            valString = formattedDisplay;
        } else {
            formattedDisplay = `${startDate} ${startW} ${startHH}:${startMM} ~ ${endDate} ${endW} ${endHH}:${endMM}`.trim();
            valString = formattedDisplay;
        }
    } else {
        if (startDate === endDate) {
            const startW = getWeekday(startDate);
            formattedDisplay = `${startDate} ${startW}`.trim();
            valString = startDate;
        } else {
            formattedDisplay = `${startDate} ~ ${endDate}`.trim();
            valString = formattedDisplay;
        }
    }

    draft.reminderDate = valString;
    draft.reminderStartDate = startDate;
    draft.reminderEndDate = endDate;

    updateReminderPreviewDisplay();

    closeCalendar(true);
}

export function closeCalendar(committed = false) {
    if (document.activeElement) document.activeElement.blur();
    const draft = state.editorDraft;

    if (!committed) {
        draft.tempSelectedReminderStartDate = '';
        draft.tempSelectedReminderEndDate = '';
        draft.tempSelectedReminderDate = '';
        state.isCalendarDateDragging = false;
        draft.calendarDragAnchorDate = '';
        draft.calendarDragHoverDate = '';
        draft.calendarCrossMonthAnchorDate = '';
    }

    closeCalendarTimeBar();
    closeModal('calendar');
}

export function changeMonth(delta) {
    const draft = state.editorDraft;
    if (draft.tempSelectedReminderStartDate && !draft.calendarCrossMonthAnchorDate) {
        draft.calendarCrossMonthAnchorDate = draft.tempSelectedReminderStartDate;
    }
    draft.calDate.setMonth(draft.calDate.getMonth() + delta);
    renderCalendar();
    updateCalendarRangeHighlight(draft.tempSelectedReminderStartDate, draft.tempSelectedReminderEndDate);
}

export function changeYear(delta) {
    const draft = state.editorDraft;
    if (draft.tempSelectedReminderStartDate && !draft.calendarCrossMonthAnchorDate) {
        draft.calendarCrossMonthAnchorDate = draft.tempSelectedReminderStartDate;
    }
    draft.calDate.setFullYear(draft.calDate.getFullYear() + delta);
    renderCalendar();
    updateCalendarRangeHighlight(draft.tempSelectedReminderStartDate, draft.tempSelectedReminderEndDate);
}

export function selectDate(year, month, day) {
    if (justFinishedCalendarDrag) {
        return;
    }

    const draft = state.editorDraft;
    const yStr = year;
    const mStr = String(month).padStart(2, '0');
    const dStr = String(day).padStart(2, '0');
    const dateStr = `${yStr}-${mStr}-${dStr}`;
    
    const isEditorOpen = hasModal(state, 'editor');

    if (isEditorOpen) {
        // 單擊一律重置為單日，並清除任何多日選取與跨月錨點
        draft.tempSelectedReminderStartDate = dateStr;
        draft.tempSelectedReminderEndDate = dateStr;
        draft.tempSelectedReminderDate = dateStr;
        draft.calendarCrossMonthAnchorDate = '';

        enforceSameDayTimeOrder();

        const currentYear = draft.calDate.getFullYear();
        const currentMonth = draft.calDate.getMonth() + 1;

        if (year !== currentYear || month !== currentMonth) {
            draft.calDate = new Date(year, month - 1, day);
            renderCalendar();
        } else {
            updateCalendarRangeHighlight(dateStr, dateStr);
        }
    } else {
        closeCalendar(false);
    }
}
