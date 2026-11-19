// @ts-check
// @ts-nocheck
// 沿用來源型別檢查範圍；本階段只做機械搬移。

import { state } from '../state.js';

import { safeJSONParse, StorageAPI, notifyCrossTabChange } from '../storage.js';

import { getLocalDateString, showCloudToast, renderSidebar, renderUserProfileUI, renderReminders } from '../ui.js';

import { closeSettingsModal } from './settings.js';

import { sanitizeDatasetPayload, SYNC_CONFIG, recordObservedTimestamp, mergeDatasets, markLocalDataDirty, uploadToDrive } from '../sync.js';

let selectCategory = null;

export function configureDataTransferNavigation(handlers) {
    selectCategory = handlers.selectCategory;
}

export function triggerImportFileInput() {
    const fileInput = document.getElementById('import-file-input');
    if (fileInput) {
        fileInput.click();
    }
}

export function exportLocalData() {
    const data = {
        syncVersion: state.syncVersion || parseInt(localStorage.getItem('sync_version') || '0', 10),
        bookmarks: state.bookmarks,
        reminders: state.reminders,
        userProfile: state.userProfile || { avatarData: '', avatarUpdatedAt: 0, username: '', usernameUpdatedAt: 0 },
        deletedRecords: state.deletedRecords || { bookmarks: {}, reminders: {} },
        deleted_categories: safeJSONParse(localStorage.getItem('my_deleted_categories'), {}),
        category_renames: safeJSONParse(localStorage.getItem('my_category_renames'), {}),
        category_order: localStorage.getItem('my_category_order') || '[]',
        category_order_updatedAt: parseInt(localStorage.getItem('my_category_order_updatedAt') || '0', 10),
        subcategory_order: localStorage.getItem('my_subcategory_order') || '{}',
        subcategory_order_updatedAt: parseInt(localStorage.getItem('my_subcategory_order_updatedAt') || '0', 10),
        subcategory_order_timestamps: localStorage.getItem('my_subcategory_order_timestamps') || '{}',
        empty_categories: localStorage.getItem('my_empty_categories') || '[]',
        empty_categories_updatedAt: parseInt(localStorage.getItem('my_empty_categories_updatedAt') || '0', 10),
        empty_categories_timestamps: localStorage.getItem('my_empty_categories_timestamps') || '{}'
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ru_${getLocalDateString()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    closeSettingsModal();
    showCloudToast('檔案下載完成');
}

export async function importLocalData(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const importedData = JSON.parse(e.target.result);

            // 結構驗證：避免畸形檔案（陣列、字串、null 項目）污染資料庫
            const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
            if (!isPlainObject(importedData)) throw new Error('INVALID_BACKUP_FORMAT');
            const rawBookmarks = importedData.bookmarks ?? {};
            const rawReminders = importedData.reminders ?? {};
            if (!isPlainObject(rawBookmarks) || !isPlainObject(rawReminders)) throw new Error('INVALID_BACKUP_FORMAT');
            importedData.bookmarks = rawBookmarks;
            importedData.reminders = rawReminders;
            // 清除備份檔內可能夾帶的 script / 事件屬性 / javascript: 連結
            sanitizeDatasetPayload(importedData);

            const importedBookmarks = importedData.bookmarks;
            const importedReminders = importedData.reminders;
            const importNow = Date.now();
            const maxAllowedTimestamp = importNow + SYNC_CONFIG.CLOCK_SKEW_TOLERANCE_MS;
            const TOMBSTONE_TTL_MS = SYNC_CONFIG.TOMBSTONE_TTL_MS;

            const updatedDeletedBookmarks = { ...(state.deletedRecords?.bookmarks || {}) };
            const updatedDeletedReminders = { ...(state.deletedRecords?.reminders || {}) };

            // 完整保留備份原始修改時間戳，僅對未來值或缺失值進行安全校正
            for (const id of Object.keys(importedBookmarks)) {
                let rawUpdated = Number(importedBookmarks[id].updatedAt);
                if (!Number.isFinite(rawUpdated) || rawUpdated <= 0) {
                    rawUpdated = importNow;
                } else if (rawUpdated > maxAllowedTimestamp) {
                    rawUpdated = importNow;
                }
                importedBookmarks[id].updatedAt = rawUpdated;
                recordObservedTimestamp(rawUpdated);

                const tombstoneTime = typeof updatedDeletedBookmarks[id] === 'number'
                    ? updatedDeletedBookmarks[id]
                    : (updatedDeletedBookmarks[id]?.deletedAt || 0);

                if (rawUpdated > tombstoneTime) {
                    delete updatedDeletedBookmarks[id];
                    await StorageAPI.deleteItem('deleted_bookmarks', id);
                }
            }

            for (const id of Object.keys(importedReminders)) {
                let rawUpdated = Number(importedReminders[id].updatedAt);
                if (!Number.isFinite(rawUpdated) || rawUpdated <= 0) {
                    rawUpdated = importNow;
                } else if (rawUpdated > maxAllowedTimestamp) {
                    rawUpdated = importNow;
                }
                importedReminders[id].updatedAt = rawUpdated;
                recordObservedTimestamp(rawUpdated);

                const tombstoneTime = typeof updatedDeletedReminders[id] === 'number'
                    ? updatedDeletedReminders[id]
                    : (updatedDeletedReminders[id]?.deletedAt || 0);

                if (rawUpdated > tombstoneTime) {
                    delete updatedDeletedReminders[id];
                    await StorageAPI.deleteItem('deleted_reminders', id);
                }
            }

            // 墓碑型別驗證、極端未來值夾限與過期（30 天）修剪防護
            const sanitizeTombstoneRecordMap = (rawMap) => {
                if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) return {};
                const sanitized = {};
                for (const [id, val] of Object.entries(rawMap)) {
                    if (typeof id !== 'string' || !id.trim()) continue;
                    let t = 0;
                    if (typeof val === 'number') {
                        t = val;
                    } else if (val && typeof val.deletedAt === 'number') {
                        t = val.deletedAt;
                    } else if (typeof val === 'string') {
                        const parsed = Number(val);
                        if (!Number.isNaN(parsed)) t = parsed;
                    }
                    if (!Number.isFinite(t) || t <= 0) continue;
                    if (t > maxAllowedTimestamp) t = importNow;
                    if ((importNow - t) < TOMBSTONE_TTL_MS) {
                        sanitized[id] = t;
                        recordObservedTimestamp(t);
                    }
                }
                return sanitized;
            };

            const rawDeleted = (importedData.deletedRecords && typeof importedData.deletedRecords === 'object' && !Array.isArray(importedData.deletedRecords))
                ? importedData.deletedRecords
                : {};

            const sanitizedImportedDeletedRecords = {
                bookmarks: sanitizeTombstoneRecordMap(rawDeleted.bookmarks),
                reminders: sanitizeTombstoneRecordMap(rawDeleted.reminders)
            };

            // 依真實時間戳比對排除自我衝突：卡片時間較新則解除墓碑；若墓碑較新則排除卡片
            for (const id of Object.keys(importedBookmarks)) {
                const delTime = sanitizedImportedDeletedRecords.bookmarks[id] || 0;
                if (importedBookmarks[id].updatedAt >= delTime) {
                    delete sanitizedImportedDeletedRecords.bookmarks[id];
                } else {
                    delete importedBookmarks[id];
                }
            }
            for (const id of Object.keys(importedReminders)) {
                const delTime = sanitizedImportedDeletedRecords.reminders[id] || 0;
                if (importedReminders[id].updatedAt >= delTime) {
                    delete sanitizedImportedDeletedRecords.reminders[id];
                } else {
                    delete importedReminders[id];
                }
            }

            const localDeletedCategories = sanitizeTombstoneRecordMap(safeJSONParse(localStorage.getItem('my_deleted_categories'), {}));
            const importedDeletedCategories = sanitizeTombstoneRecordMap(importedData.deleted_categories || {});

            const sanitizeCategoryRenames = (rawMap) => {
                if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) return {};
                const sanitized = {};
                for (const [oldCat, record] of Object.entries(rawMap)) {
                    if (typeof oldCat !== 'string' || !oldCat.trim()) continue;
                    if (!record || typeof record !== 'object' || typeof record.to !== 'string' || !record.to.trim()) continue;
                    let t = Number(record.at) || 0;
                    if (t <= 0 || !Number.isFinite(t)) t = importNow;
                    if (t > maxAllowedTimestamp) t = importNow;
                    if ((importNow - t) < TOMBSTONE_TTL_MS) {
                        sanitized[oldCat.trim()] = {
                            to: record.to.trim(),
                            at: t
                        };
                        recordObservedTimestamp(t);
                    }
                }
                return sanitized;
            };

            const localCategoryRenames = sanitizeCategoryRenames(safeJSONParse(localStorage.getItem('my_category_renames'), {}));
            const importedCategoryRenames = sanitizeCategoryRenames(importedData.category_renames || {});

            if (importedData.userProfile && typeof importedData.userProfile === 'object') {
                recordObservedTimestamp(importedData.userProfile.avatarUpdatedAt);
                recordObservedTimestamp(importedData.userProfile.usernameUpdatedAt);
            }
            recordObservedTimestamp(importedData.category_order_updatedAt);
            recordObservedTimestamp(importedData.subcategory_order_updatedAt);
            recordObservedTimestamp(importedData.empty_categories_updatedAt);

            const parsedImportedEmptyTs = typeof importedData.empty_categories_timestamps === 'string'
                ? safeJSONParse(importedData.empty_categories_timestamps, {})
                : (importedData.empty_categories_timestamps || {});
            if (parsedImportedEmptyTs && typeof parsedImportedEmptyTs === 'object') {
                Object.values(parsedImportedEmptyTs).forEach(ts => recordObservedTimestamp(ts));
            }

            // 正確分離本機資料與匯入資料作為 mergeDatasets 的兩端輸入
            const localDataForMerge = {
                syncVersion: state.syncVersion || parseInt(localStorage.getItem('sync_version') || '0', 10),
                bookmarks: state.bookmarks || {},
                reminders: state.reminders || {},
                userProfile: state.userProfile || { avatarData: '', avatarUpdatedAt: 0, username: '', usernameUpdatedAt: 0 },
                deletedRecords: {
                    bookmarks: sanitizeTombstoneRecordMap(updatedDeletedBookmarks),
                    reminders: sanitizeTombstoneRecordMap(updatedDeletedReminders)
                },
                deleted_categories: localDeletedCategories,
                category_renames: localCategoryRenames,
                category_order: localStorage.getItem('my_category_order') || '[]',
                category_order_updatedAt: parseInt(localStorage.getItem('my_category_order_updatedAt') || '0', 10),
                subcategory_order: localStorage.getItem('my_subcategory_order') || '{}',
                subcategory_order_updatedAt: parseInt(localStorage.getItem('my_subcategory_order_updatedAt') || '0', 10),
                subcategory_order_timestamps: localStorage.getItem('my_subcategory_order_timestamps') || '{}',
                empty_categories: localStorage.getItem('my_empty_categories') || '[]',
                empty_categories_updatedAt: parseInt(localStorage.getItem('my_empty_categories_updatedAt') || '0', 10),
                empty_categories_timestamps: localStorage.getItem('my_empty_categories_timestamps') || '{}'
            };

            const importedDataForMerge = {
                syncVersion: Number(importedData.syncVersion) || 0,
                bookmarks: importedBookmarks,
                reminders: importedReminders,
                userProfile: importedData.userProfile || { avatarData: '', avatarUpdatedAt: 0, username: '', usernameUpdatedAt: 0 },
                deletedRecords: sanitizedImportedDeletedRecords,
                deleted_categories: importedDeletedCategories,
                category_renames: importedCategoryRenames,
                category_order: importedData.category_order || '[]',
                category_order_updatedAt: parseInt(importedData.category_order_updatedAt || '0', 10),
                subcategory_order: importedData.subcategory_order || '{}',
                subcategory_order_updatedAt: parseInt(importedData.subcategory_order_updatedAt || '0', 10),
                subcategory_order_timestamps: importedData.subcategory_order_timestamps || '{}',
                empty_categories: importedData.empty_categories || '[]',
                empty_categories_updatedAt: parseInt(importedData.empty_categories_updatedAt || '0', 10),
                empty_categories_timestamps: importedData.empty_categories_timestamps || '{}'
            };

            const finalMergedData = mergeDatasets(localDataForMerge, importedDataForMerge);

            // 版本號遞增，確保高於雲端舊版本
            state.syncVersion = Math.max(state.syncVersion || 0, Number(finalMergedData.syncVersion) || 0) + 1;
            localStorage.setItem('sync_version', state.syncVersion.toString());

            state.bookmarks = finalMergedData.bookmarks;
            state.reminders = finalMergedData.reminders;
            state.deletedRecords = finalMergedData.deletedRecords;
            state.userProfile = finalMergedData.userProfile || { avatarData: '', avatarUpdatedAt: 0, username: '', usernameUpdatedAt: 0 };

            if (finalMergedData.deleted_categories) {
                localStorage.setItem('my_deleted_categories', typeof finalMergedData.deleted_categories === 'string' ? finalMergedData.deleted_categories : JSON.stringify(finalMergedData.deleted_categories));
            }
            if (finalMergedData.category_renames) {
                localStorage.setItem('my_category_renames', typeof finalMergedData.category_renames === 'string' ? finalMergedData.category_renames : JSON.stringify(finalMergedData.category_renames));
            }
            if (finalMergedData.category_order) {
                localStorage.setItem('my_category_order', typeof finalMergedData.category_order === 'string' ? finalMergedData.category_order : JSON.stringify(finalMergedData.category_order));
            }
            if (finalMergedData.category_order_updatedAt) {
                localStorage.setItem('my_category_order_updatedAt', finalMergedData.category_order_updatedAt.toString());
            }
            if (finalMergedData.subcategory_order) {
                localStorage.setItem('my_subcategory_order', typeof finalMergedData.subcategory_order === 'string' ? finalMergedData.subcategory_order : JSON.stringify(finalMergedData.subcategory_order));
            }
            if (finalMergedData.subcategory_order_updatedAt) {
                localStorage.setItem('my_subcategory_order_updatedAt', finalMergedData.subcategory_order_updatedAt.toString());
            }
            if (finalMergedData.subcategory_order_timestamps) {
                localStorage.setItem('my_subcategory_order_timestamps', typeof finalMergedData.subcategory_order_timestamps === 'string' ? finalMergedData.subcategory_order_timestamps : JSON.stringify(finalMergedData.subcategory_order_timestamps));
            }
            if (finalMergedData.empty_categories) {
                localStorage.setItem('my_empty_categories', typeof finalMergedData.empty_categories === 'string' ? finalMergedData.empty_categories : JSON.stringify(finalMergedData.empty_categories));
            }
            if (finalMergedData.empty_categories_updatedAt) {
                localStorage.setItem('my_empty_categories_updatedAt', finalMergedData.empty_categories_updatedAt.toString());
            }
            if (finalMergedData.empty_categories_timestamps) {
                localStorage.setItem('my_empty_categories_timestamps', typeof finalMergedData.empty_categories_timestamps === 'string' ? finalMergedData.empty_categories_timestamps : JSON.stringify(finalMergedData.empty_categories_timestamps));
            }

            const dbReplaced = await StorageAPI.replaceMulti({
                bookmarks: state.bookmarks,
                reminders: state.reminders,
                deleted_bookmarks: state.deletedRecords.bookmarks || {},
                deleted_reminders: state.deletedRecords.reminders || {}
            });
            const profileSaved = await StorageAPI.saveItem('profile', 'current', state.userProfile);
            if (!dbReplaced || !profileSaved) {
                throw new Error('INDEXEDDB_IMPORT_WRITE_FAILED');
            }

            markLocalDataDirty();
            notifyCrossTabChange({ type: 'DATA_CHANGED', syncVersion: state.syncVersion });

            renderSidebar();
            renderUserProfileUI();
            if (state.currentView === 'bookmarks') selectCategory(state.currentCategory);
            else if (state.currentView === 'reminders') renderReminders();

            showCloudToast('檔案匯入合併成功');
            closeSettingsModal();
            uploadToDrive(true);
        } catch (err) {
            alert('檔案解析失敗，請確認上傳的檔案格式是否正確。');
            console.error(err);
        }
        event.target.value = ''; 
    };
    reader.readAsText(file);
}
