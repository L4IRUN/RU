// @ts-check
// types.js
// 職責：集中定義應用程式核心資料結構、IndexedDB (Dexie v5) 資料列型別、雲端同步 Payload 與全域狀態 AppState

/**
 * 新增／編輯視窗目前操作之資料型別
 * - 'reminder': 提醒事項（獨立儲存於 reminders 表）
 * - 'note': 自訂純文字內容（與 bookmark 共用 bookmarks 表，以 isCustomRecord 區分）
 * - 'bookmark': 網址書籤（儲存於 bookmarks 表）
 * @typedef {'reminder' | 'note' | 'bookmark'} UnifiedRecordType
 */

/**
 * 主畫面目前視圖類型
 * @typedef {'reminders' | 'bookmarks'} AppViewType
 */

/**
 * 刪除確認對話框之目標類型
 * @typedef {'bookmark' | 'reminder' | 'batch-reminders' | 'batch-bookmarks' | 'batch-subcategories' | 'user-avatar'} DeleteTargetType
 */

/**
 * 批次搬移之目標層級
 * @typedef {'subcategory' | 'card'} MoveTargetType
 */

/**
 * 右鍵選單目標資料類型
 * @typedef {'bookmark' | 'reminder'} ContextTargetType
 */

/**
 * 右鍵選單鎖定目標
 * @typedef {Object} ContextTarget
 * @property {ContextTargetType | null} type
 * @property {string | null} id
 */

/**
 * 書籤／自訂內容資料結構（對應 bookmarks 資料表與 state.bookmarks[id]）
 * 注意：note 與 bookmark 共用此結構；判斷是否為自訂內容的後備邏輯為：
 * `!!bm.isCustomRecord || (!bm.url && !!bm.content)`（相容早期無 isCustomRecord 旗標的舊資料）
 * @typedef {Object} Bookmark
 * @property {string} [id] 紀錄唯一識別碼（UUID；舊版資料可能僅存在於外層鍵值）
 * @property {string} title 標題（網址名稱或內容標題）
 * @property {string} url 網址連結（純內容紀錄時通常為空字串，若由網址轉型編輯則可能保留原網址）
 * @property {string} category 主分類名稱（預設 '未分類'）
 * @property {string} [subCategory] 子分類名稱（無子分類時為空字串）
 * @property {string} [description] 備註說明
 * @property {string} [content] 富文本 HTML 內容（經 stripDangerousHtml 淨化，僅自訂內容使用）
 * @property {boolean} [isCustomRecord] 是否為自訂內容（true = 內容 note；false / undefined = 網址 bookmark）
 * @property {string} timestamp 人類可讀的最後編輯時間字串（例如 '2026/11/14 (六) 12:00'）
 * @property {number} updatedAt 最後更新時間戳（Unix 毫秒，用於 LWW 衝突合併）
 * @property {number} order 排序權重數值（越小越靠前，新增時預設為 -Date.now()）
 */

/**
 * 提醒事項資料結構（對應 reminders 資料表與 state.reminders[id]）
 * 注意：saveReminder() 寫入時不包含 id 欄位（id 僅作為 state.reminders 的鍵值）；
 * 另外由 Dexie v3 從舊版 quotes 表遷移的歷史資料僅含 content, date, isDone, timestamp, updatedAt, order，
 * 因此 title, startDate, endDate, startTime, endTime 皆標記為選填。
 * @typedef {Object} Reminder
 * @property {string} [id] 紀錄唯一識別碼（由外層鍵值水合時附加）
 * @property {string} [title] 提醒標題（v3 舊語錄遷移資料可能缺失此欄位）
 * @property {string} content 提醒詳細富文本內容（經 stripDangerousHtml 淨化）
 * @property {string} date 日期或起訖區間顯示字串（例如 '2026-11-14' 或 '2026-11-14 (六) 12:00 ~ 18:00'）
 * @property {string} [startDate] 開始日期（YYYY-MM-DD）
 * @property {string} [endDate] 結束日期（YYYY-MM-DD）
 * @property {string} [startTime] 開始時間（HH:mm，未設定時間時為空字串）
 * @property {string} [endTime] 結束時間（HH:mm，未設定時間時為空字串）
 * @property {boolean} isDone 是否已完成
 * @property {string} timestamp 人類可讀的最後編輯時間字串
 * @property {number} updatedAt 最後更新時間戳（Unix 毫秒，用於 LWW 衝突合併）
 * @property {number} order 排序權重數值
 */

/**
 * 個人頭像與使用者名稱設定（對應 profile 資料表鍵值 'current' 與 state.userProfile）
 * @typedef {Object} UserProfile
 * @property {string} avatarData 頭像 Data URL（image/webp 或 image/jpeg，無頭像時為空字串）
 * @property {number} avatarUpdatedAt 頭像最後更新時間戳（Unix 毫秒）
 * @property {string} username 使用者名稱（預設顯示 'RU'）
 * @property {number} usernameUpdatedAt 使用者名稱最後更新時間戳（Unix 毫秒）
 */

/**
 * 刪除墓碑時間戳映射表（key: 紀錄 ID 或分類名稱 -> value: 刪除時間 Unix 毫秒，TTL 30 天）
 * @typedef {Record<string, number>} TombstoneMap
 */

/**
 * 刪除墓碑追蹤集合（對應 deleted_bookmarks、deleted_reminders 與分類墓碑）
 * @typedef {Object} DeletedRecords
 * @property {TombstoneMap} bookmarks 已刪除書籤／內容墓碑
 * @property {TombstoneMap} reminders 已刪除提醒事項墓碑
 * @property {TombstoneMap} [categories] 已刪除分類墓碑（同步合併時產生）
 */

/**
 * 分類重新命名追蹤紀錄
 * @typedef {Object} CategoryRenameRecord
 * @property {string} to 重新命名後的新分類名稱
 * @property {number} at 重新命名發生時間戳（Unix 毫秒）
 */

/**
 * 分類重新命名映射表（key: 舊分類名稱 -> value: CategoryRenameRecord）
 * @typedef {Record<string, CategoryRenameRecord>} CategoryRenameMap
 */

/**
 * 編輯期間遠端書籤衝突暫存項目
 * @typedef {Object} PendingSyncBookmark
 * @property {string} id
 * @property {Bookmark | null} data
 * @property {boolean} isDeleted
 * @property {number} deletedAt
 */

/**
 * 編輯期間遠端提醒衝突暫存項目
 * @typedef {Object} PendingSyncReminder
 * @property {string} id
 * @property {Reminder | null} data
 * @property {boolean} isDeleted
 * @property {number} deletedAt
 */

/**
 * 編輯視窗開啟期間攔截到的遠端／跨分頁變更暫存區（關閉編輯器後才落地）
 * @typedef {Object} PendingSyncItems
 * @property {PendingSyncBookmark} [bookmark]
 * @property {PendingSyncReminder} [reminder]
 */

/**
 * Dexie v5 `bookmarks` 資料表儲存列結構
 * IndexedDB 索引欄位：僅 `id`（主鍵，無其他次要索引）
 * @typedef {Object} DexieBookmarkRow
 * @property {string} id 主鍵（Dexie 唯一索引欄位）
 * @property {Bookmark} data
 */

/**
 * Dexie v5 `reminders` 資料表儲存列結構
 * IndexedDB 索引欄位：僅 `id`（主鍵，無其他次要索引）
 * @typedef {Object} DexieReminderRow
 * @property {string} id 主鍵（Dexie 唯一索引欄位）
 * @property {Reminder} data
 */

/**
 * Dexie v5 `deleted_bookmarks` / `deleted_reminders` 資料表儲存列結構
 * IndexedDB 索引欄位：僅 `id`（主鍵，無其他次要索引）
 * @typedef {Object} DexieTombstoneRow
 * @property {string} id 主鍵（Dexie 唯一索引欄位）
 * @property {number} data 刪除時間戳（Unix 毫秒）
 */

/**
 * Dexie v5 `profile` 資料表儲存列結構
 * IndexedDB 索引欄位：僅 `id`（主鍵，固定寫入 `'current'`）
 * @typedef {Object} DexieProfileRow
 * @property {string} id 主鍵（Dexie 唯一索引欄位，固定為 'current'）
 * @property {UserProfile} data
 */

/**
 * Google Drive AppData (`ru_sync_data.json`) 與本機匯出／匯入 JSON Payload 結構
 * 注意：陣列與字典類的排序／空分類欄位在匯出時為 JSON 字串，合併運算時相容物件／陣列或 JSON 字串
 * @typedef {Object} SyncPayload
 * @property {number} syncVersion 樂觀鎖同步基準版本號
 * @property {string} [syncNonce] 單次上傳防並行覆蓋驗證隨機碼
 * @property {Record<string, Bookmark>} bookmarks 書籤與自訂內容集合
 * @property {Record<string, Reminder>} reminders 提醒事項集合
 * @property {UserProfile} userProfile 使用者頭像與名稱資料
 * @property {DeletedRecords} deletedRecords 刪除墓碑集合
 * @property {TombstoneMap} [deleted_categories] 已刪除空分類墓碑
 * @property {CategoryRenameMap} [category_renames] 分類改名追蹤表
 * @property {string | string[]} [category_order] 主分類排序（JSON 字串或字串陣列）
 * @property {number} [category_order_updatedAt] 主分類排序更新時間戳
 * @property {string | Record<string, string[]>} [subcategory_order] 各分類下子分類排序（JSON 字串或映射物件）
 * @property {number} [subcategory_order_updatedAt] 子分類排序全域更新時間戳
 * @property {string | Record<string, number>} [subcategory_order_timestamps] 各分類子分類排序獨立時間戳
 * @property {string | string[]} [empty_categories] 空分類清單（JSON 字串或字串陣列）
 * @property {number} [empty_categories_updatedAt] 空分類清單全域更新時間戳
 * @property {string | Record<string, number>} [empty_categories_timestamps] 各空分類建立時間戳
 */

/**
 * 頭像與帳號連線狀態
 * @typedef {'disconnected' | 'expired' | 'connected'} AuthAvatarStatus
 */

/**
 * Toast 點擊內建動作識別碼
 * @typedef {'open-settings' | 'google-auth'} ToastActionType
 */

/**
 * 應用程式事件名稱與對應 Payload 型別映射表
 * @typedef {Object} AppEventMap
 * @property {{ message: string, persistent?: boolean, action?: ToastActionType, onClick?: () => void }} toast:show
 * @property {{ status: AuthAvatarStatus, isError: boolean }} sync:status-changed
 * @property {{ renderSidebar?: boolean, renderUserProfile?: boolean }} ui:render-requested
 * @property {undefined} ui:select-reminders
 * @property {undefined} modal:cloud-alert
 * @property {undefined} modal:close-settings
 * @property {undefined} sync:flush-pending
 * @property {undefined} fab:idle-reset
 * @property {{ items: Array<{ label: string, group?: string, groupDOM?: HTMLElement | null, targetDOM: HTMLElement | null }> }} chapter:init-spy
 * @property {undefined} chapter:clear-spy
 * @property {undefined} search:clear
 * @property {undefined} search:filter
 * @property {{ start: string, end: string }} calendar:highlight-range
 */

/**
 * 應用程式事件名稱聯合型別
 * @typedef {keyof AppEventMap} AppEventName
 */

/**
 * 彈窗唯一識別碼（由 state.activeModals 堆疊陣列統一管理開啟狀態與 Esc 逐層關閉順序）
 * @typedef {'editor' | 'full-editor' | 'calendar' | 'confirm' | 'category' | 'sort' | 'settings' | 'cloud-alert'} ModalId
 */

/**
 * 編輯器草稿單一真相來源結構（收編所有表單欄位、隱藏欄位替代狀態、日曆與時間滾輪暫存）
 * @typedef {Object} EditorDraft
 * @property {string | null} editingBookmarkId 目前正在編輯的書籤／內容 ID（新增時為 null）
 * @property {string | null} editingReminderId 目前正在編輯的提醒 ID（新增時為 null）
 * @property {string} bookmarkTitle 網址／內容標題
 * @property {string} bookmarkUrl 網址 URL
 * @property {string} bookmarkCategory 主分類名稱（空字串代表未選擇／未分類）
 * @property {string} bookmarkSubCategory 子分類名稱
 * @property {{category: string, subCategory: string, beforeId: string | null, afterId: string | null} | null} bookmarkInsertion 草稿確認的卡片位置
 * @property {string} bookmarkDesc 備註說明
 * @property {string} bookmarkContent 自訂內容富文本 HTML
 * @property {string} reminderTitle 提醒事項標題
 * @property {string} reminderContent 提醒事項富文本 HTML
 * @property {boolean} reminderIsDone 提醒事項完成狀態
 * @property {string} reminderDate 已確認的提醒日期或區間顯示字串
 * @property {string} reminderStartDate 已確認的提醒開始日期（YYYY-MM-DD）
 * @property {string} reminderEndDate 已確認的提醒結束日期（YYYY-MM-DD）
 * @property {Date} calDate 日曆元件目前顯示的年月基準 Date 物件
 * @property {string} tempSelectedReminderDate 日曆暫存單選日期（YYYY-MM-DD）
 * @property {string} tempSelectedReminderStartDate 日曆區間拖曳暫存開始日期（YYYY-MM-DD）
 * @property {string} tempSelectedReminderEndDate 日曆區間拖曳暫存結束日期（YYYY-MM-DD）
 * @property {string} calendarDragAnchorDate 日曆滑動選取的起始錨點日期
 * @property {string} calendarDragHoverDate 日曆滑動選取目前停留的日期
 * @property {string} calendarCrossMonthAnchorDate 日曆跨月切換時的起始錨點日期
 * @property {number} timeWheelStartHour 開始時間滾輪目前小時（0-23）
 * @property {number} timeWheelStartMinute 開始時間滾輪目前分鐘（0-59）
 * @property {number} timeWheelEndHour 結束時間滾輪目前小時（0-23）
 * @property {number} timeWheelEndMinute 結束時間滾輪目前分鐘（0-59）
 * @property {number} initialWheelStartHour 開啟時間滾輪時的初始開始小時（0-23）
 * @property {number} initialWheelStartMinute 開啟時間滾輪時的初始開始分鐘（0-59）
 * @property {number} initialWheelEndHour 開啟時間滾輪時的初始結束小時（0-23）
 * @property {number} initialWheelEndMinute 開啟時間滾輪時的初始結束分鐘（0-59）
 * @property {boolean} isReminderStartTimeAdjusted 使用者是否已手動調整開始時間滾輪
 * @property {boolean} isReminderEndTimeAdjusted 使用者是否已手動調整結束時間滾輪
 */

/**
 * 全域應用程式狀態結構（對應 state.js 匯出的 state 單例）
 * @typedef {Object} AppState
 * @property {string} appVersion 應用程式版本號
 * @property {number} syncVersion 雲端同步基準版本號（樂觀鎖）
 * @property {number} _cachedInnerWidth 快取之視窗寬度（px）
 * @property {number} _cachedInnerHeight 快取之視窗高度（px）
 * @property {UnifiedRecordType} currentUnifiedType 新增／編輯視窗目前的資料型別
 * @property {string | null} currentCategory 目前選取的主分類名稱
 * @property {AppViewType | null} currentView 目前主畫面視圖
 * @property {boolean} isFabTucked 手機版右下角 FAB 按鈕是否處於收起隱藏狀態
 * @property {ReturnType<typeof setTimeout> | null} fabIdleTimer FAB 閒置計時器 ID
 * @property {Record<string, Bookmark>} bookmarks 書籤與自訂內容記憶體快取
 * @property {Record<string, Reminder>} reminders 提醒事項記憶體快取
 * @property {DeletedRecords} deletedRecords 刪除墓碑記憶體快取
 * @property {UserProfile} userProfile 使用者個人資料記憶體快取
 * @property {string | null} previousCategory 進入過渡新增分類前的來源分類
 * @property {AppViewType | null} previousView 開啟新增視窗前的來源視圖
 * @property {ModalId[]} activeModals 目前開啟中的彈窗去重堆疊陣列（由底層至頂層排序）
 * @property {EditorDraft} editorDraft 編輯器單一真相來源草稿物件
 * @property {boolean} isEditing 主編輯器或全畫面編輯器是否開啟中（與 activeModals 同步維護）
 * @property {number} editingBaselineUpdatedAt 開啟編輯視窗當下的基準更新時間戳
 * @property {boolean} hasEditConflict 編輯期間是否偵測到雲端或跨分頁新版本衝突
 * @property {PendingSyncItems | null} pendingSyncItems 編輯期間暫存的遠端／跨分頁更新項目
 * @property {boolean} hasPendingSyncRender 是否有被編輯器／拖曳／多選模式延後的側邊欄重繪任務
 * @property {DeleteTargetType | null} deleteTargetType 刪除確認視窗目前的刪除目標類型
 * @property {ContextTarget} contextTarget 右鍵選單目前鎖定的卡片目標
 * @property {boolean} isSelectionMode 是否處於批次多選模式
 * @property {Set<string>} selectedReminderIds 多選模式下已勾選的提醒 ID 集合
 * @property {Set<string>} selectedBookmarkIds 多選模式下已勾選的書籤／內容 ID 集合
 * @property {Set<string>} selectedSubCategories 多選模式下已勾選的子分類名稱集合
 * @property {boolean} isMoveSelectionActive 是否正在執行批次搬移選擇流程
 * @property {MoveTargetType | null} moveTargetType 批次搬移的目標層級
 * @property {boolean} isCategoryModalOpen 分類與子分類選擇視窗是否開啟中（與 activeModals 同步維護）
 * @property {string} tempModalCategory 分類選擇視窗暫存選取的主分類
 * @property {string} tempModalSubCategory 分類選擇視窗暫存選取的子分類
 * @property {number} categoryModalStep 分類選擇視窗目前步驟（1: 分類, 2: 子分類, 3: 卡片）
 * @property {boolean} isAddingCategoryInline 分類選擇視窗是否正在行內新增主分類
 * @property {boolean} isAddingSubCategoryInline 分類選擇視窗是否正在行內新增子分類
 * @property {string[]} tempCategoryModalCategoryOrder 分類選擇視窗暫存主分類排序
 * @property {Record<string, string[]>} tempCategoryModalSubCategoryOrders 分類選擇視窗暫存子分類排序
 * @property {Record<string, (string | null)[]>} tempCategoryModalCardOrders 分類選擇視窗暫存卡片排序，null 代表草稿
 * @property {boolean} isSortModalOpen 排序視窗是否開啟中（與 activeModals 同步維護）
 * @property {string} tempSortCategory 排序視窗暫存選取的主分類
 * @property {string} tempSortSubCategory 排序視窗暫存選取的子分類
 * @property {number} sortModalStep 排序視窗目前步驟（1: 分類, 2: 子分類, 3: 卡片）
 * @property {string[]} tempSortCategoryOrder 排序視窗暫存主分類排序
 * @property {Record<string, string[]>} tempSortSubCategoryOrders 排序視窗暫存子分類排序
 * @property {Record<string, string[]>} tempSortCardOrders 排序視窗暫存卡片排序
 * @property {boolean} isCalendarDateDragging 是否正在日曆上滑動選取日期區間
 * @property {boolean} isSortDragging 是否正在排序視窗中長按拖曳項目
 * @property {boolean} isCategoryDragging 是否正在分類選擇視窗中長按拖曳項目
 * @property {boolean} isCategoryCarouselSwiping 是否正在分類選擇視窗的三層輪播滑動中
 * @property {boolean} justFinishedCategoryCarouselDrag 是否剛結束分類選擇視窗的輪播滑動（防誤觸 click）
 * @property {boolean} justFinishedCategoryDrag 是否剛結束分類選擇視窗的長按拖曳排序（防誤觸 click）
 * @property {boolean} isSortCarouselSwiping 是否正在排序視窗的三層輪播滑動中
 * @property {boolean} justFinishedSortCarouselDrag 是否剛結束排序視窗的輪播滑動（防誤觸 click）
 * @property {boolean} justFinishedSortDrag 是否剛結束排序視窗的長按拖曳排序（防誤觸 click）
 * @property {boolean} isRenamingMainCategory 側邊欄是否正在行內重新命名主分類
 * @property {boolean} isAddingMainCategory 側邊欄是否正在行內新增主分類
 * @property {number} floatingAvatarOpenScrollTop 手機版開啟懸浮頭像氣泡當下的 main 捲動高度（px）
 */

export {};
