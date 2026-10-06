const AVAILABLE_TAGS = [
    "💻 新規開発", "🔧 追加実装", "🐛 バグ修正", "🔬 実験・検証",
    "📝 論文・資料", "🎤 学会・発表", "🤝 打ち合わせ", "💡 アイデア"
];
const VALID_STATUSES = ["未着手", "進行中", "完了"];
const STORAGE_KEYS = {
    tasks: "tasks_v10",
    legacyTasks: "tasks_v9",
    preferences: "progress_hub_preferences_v11",
    reportDraft: "progress_hub_report_draft_v11"
};
const REPORT_FIELD_IDS = [
    "repName", "repDate", "repTheme", "repPages", "extStartDate", "extEndDate",
    "repActualWork", "repDeliverables", "repFindings", "repIncomplete", "repIssues",
    "repTodayWork", "repNextHighest", "repNextThen", "repNextOptional", "repNextShow",
    "repEvents", "repPrerequisites", "repConsultTeacher", "repConsultPeers",
    "repTodayResults", "repNotes"
];

let tasks = loadTasks();
let preferences = loadJson(STORAGE_KEYS.preferences, {
    activeTab: "dashboard",
    viewMode: "list",
    pinImportant: true
});
let editingSubtasks = [];
let lastDeletedTask = null;
let statusChartInstance = null;
let tagChartInstance = null;
let notifyInterval = null;
let reportSaveTimer = null;

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

document.addEventListener("DOMContentLoaded", init);

function init() {
    initializeDates();
    hydrateTagSelectors();
    restoreReportDraft();
    bindEvents();
    updateTodayLabel();
    switchTab(preferences.activeTab || "dashboard", false);
    setViewMode(preferences.viewMode || "list", false);
    $("#pinImportantToggle").checked = preferences.pinImportant !== false;
    checkNotificationStatus();
    renderAll();
    generateScrapboxReport();
}

function bindEvents() {
    $$(".tab").forEach(button => button.addEventListener("click", () => switchTab(button.dataset.tab)));
    $$("[data-go-tab]").forEach(button => button.addEventListener("click", () => {
        switchTab(button.dataset.goTab);
        if (button.dataset.focus) requestAnimationFrame(() => $(button.dataset.focus)?.focus());
    }));

    $("#addTaskButton").addEventListener("click", addTask);
    $("#taskName").addEventListener("keydown", event => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            addTask();
        }
    });

    $$("#newTagSelector .tag-btn").forEach(button => button.addEventListener("click", () => button.classList.toggle("selected")));
    ["searchActive", "filterStatusActive", "filterTagActive", "sortActive"].forEach(id => {
        $("#" + id).addEventListener(id === "searchActive" ? "input" : "change", renderActiveTasks);
    });
    $("#pinImportantToggle").addEventListener("change", event => {
        preferences.pinImportant = event.target.checked;
        savePreferences();
        renderActiveTasks();
    });
    $$("[data-view-mode]").forEach(button => button.addEventListener("click", () => setViewMode(button.dataset.viewMode)));

    ["searchCompleted", "filterTagCompleted", "sortCompleted"].forEach(id => {
        $("#" + id).addEventListener(id === "searchCompleted" ? "input" : "change", renderCompletedTasks);
    });

    document.body.addEventListener("click", handleActionClick);
    document.body.addEventListener("input", handleDelegatedInput);
    document.body.addEventListener("change", handleDelegatedChange);

    $$(".kanban-column").forEach(column => {
        column.addEventListener("dragover", event => {
            event.preventDefault();
            column.classList.add("drag-over");
        });
        column.addEventListener("dragleave", () => column.classList.remove("drag-over"));
        column.addEventListener("drop", event => {
            event.preventDefault();
            column.classList.remove("drag-over");
            const id = Number(event.dataTransfer.getData("text/plain"));
            if (id) updateTaskStatus(id, column.dataset.status);
        });
    });

    REPORT_FIELD_IDS.forEach(id => {
        $("#" + id).addEventListener("input", scheduleReportUpdate);
        $("#" + id).addEventListener("change", scheduleReportUpdate);
    });
    $("#copyReportButton").addEventListener("click", copyReport);
    $("#resetReportButton").addEventListener("click", resetReportDraft);

    $("#exportButton").addEventListener("click", exportJSON);
    $("#importFile").addEventListener("change", importJSON);
    $("#notifyButton").addEventListener("click", requestNotificationPermission);
    $("#clearDataButton").addEventListener("click", clearAllData);

    $("#editModalClose").addEventListener("click", closeEditModal);
    $("#editCancelButton").addEventListener("click", closeEditModal);
    $("#editSaveButton").addEventListener("click", saveEditTask);
    $("#editProgress").addEventListener("input", event => { $("#editProgressValue").value = `${event.target.value}%`; });
    $("#addEditSubtaskButton").addEventListener("click", addEditSubtask);
    $("#editSubtaskInput").addEventListener("keydown", event => {
        if (event.key === "Enter") { event.preventDefault(); addEditSubtask(); }
    });
    $("#editModal").addEventListener("click", event => { if (event.target === event.currentTarget) closeEditModal(); });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape") closeEditModal();
        if (event.key.toLowerCase() === "n" && !isTypingTarget(event.target)) {
            event.preventDefault();
            switchTab("active");
            $("#taskName").focus();
        }
        if (event.key === "/" && !isTypingTarget(event.target)) {
            event.preventDefault();
            switchTab("active");
            $("#searchActive").focus();
        }
    });
}

function isTypingTarget(target) {
    return ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName) || target?.isContentEditable;
}

function initializeDates() {
    const today = new Date();
    const todayValue = toYMD(today);
    const weekAgo = new Date(today);
    weekAgo.setDate(today.getDate() - 7);
    $("#repDate").value = todayValue;
    $("#extEndDate").value = todayValue;
    $("#extStartDate").value = toYMD(weekAgo);
}

function updateTodayLabel() {
    const now = new Date();
    $("#todayLabel").textContent = new Intl.DateTimeFormat("ja-JP", {
        month: "long", day: "numeric", weekday: "short"
    }).format(now);
    const hour = now.getHours();
    $("#greeting").textContent = hour < 11 ? "おはようございます" : hour < 18 ? "こんにちは" : "おつかれさまです";
}

function switchTab(tabName, persist = true) {
    const valid = ["dashboard", "active", "completed", "report", "settings"];
    const nextTab = valid.includes(tabName) ? tabName : "dashboard";
    $$(".tab-content").forEach(section => section.classList.toggle("active", section.id === `tab-${nextTab}`));
    $$(".tab").forEach(button => {
        const active = button.dataset.tab === nextTab;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", String(active));
    });
    preferences.activeTab = nextTab;
    if (persist) savePreferences();
    if (nextTab === "dashboard") renderDashboard();
    if (nextTab === "report") generateScrapboxReport();
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function setViewMode(mode, persist = true) {
    preferences.viewMode = mode === "kanban" ? "kanban" : "list";
    $$("[data-view-mode]").forEach(button => button.classList.toggle("active", button.dataset.viewMode === preferences.viewMode));
    $("#taskList").classList.toggle("hidden", preferences.viewMode !== "list");
    $("#kanbanBoard").classList.toggle("active", preferences.viewMode === "kanban");
    if (persist) savePreferences();
    renderActiveTasks();
}

function hydrateTagSelectors() {
    const newSelector = $("#newTagSelector");
    newSelector.innerHTML = AVAILABLE_TAGS.map(tag => `<button type="button" class="tag-btn">${escapeHtml(tag)}</button>`).join("");
    const activeFilter = $("#filterTagActive");
    const completedFilter = $("#filterTagCompleted");
    AVAILABLE_TAGS.forEach(tag => {
        activeFilter.add(new Option(tag, tag));
        completedFilter.add(new Option(tag, tag));
    });
}

function loadTasks() {
    let raw = loadJson(STORAGE_KEYS.tasks, null);
    if (!Array.isArray(raw)) raw = loadJson(STORAGE_KEYS.legacyTasks, []);
    const normalized = Array.isArray(raw) ? raw.map(normalizeTask) : [];
    if (normalized.length && !localStorage.getItem(STORAGE_KEYS.tasks)) {
        localStorage.setItem(STORAGE_KEYS.tasks, JSON.stringify(normalized));
    }
    return normalized;
}

function normalizeTask(task, index = 0) {
    const now = Date.now() + index;
    const status = VALID_STATUSES.includes(task?.status) ? task.status : "未着手";
    const progress = status === "完了" ? 100 : clamp(Number(task?.progress) || 0, 0, 99);
    return {
        id: Number(task?.id) || now,
        name: String(task?.name || "名称未設定"),
        note: String(task?.note || task?.description || ""),
        deadlineDate: String(task?.deadlineDate || ""),
        deadlineTime: String(task?.deadlineTime || ""),
        isImportant: Boolean(task?.isImportant),
        tags: Array.isArray(task?.tags) ? task.tags.filter(Boolean).map(String) : [],
        status,
        progress,
        subtasks: Array.isArray(task?.subtasks) ? task.subtasks.map((subtask, subIndex) => ({
            id: Number(subtask?.id) || now + subIndex + 1,
            name: String(subtask?.name || "サブタスク"),
            completed: Boolean(subtask?.completed)
        })) : [],
        createdAt: Number(task?.createdAt) || now,
        updatedAt: Number(task?.updatedAt) || now,
        completedAt: status === "完了" ? (Number(task?.completedAt) || now) : null,
        notified_24h: Boolean(task?.notified_24h)
    };
}

function loadJson(key, fallback) {
    try {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : fallback;
    } catch (error) {
        console.warn(`Failed to load ${key}`, error);
        return fallback;
    }
}

function saveData() {
    localStorage.setItem(STORAGE_KEYS.tasks, JSON.stringify(tasks));
    updateStorageUsage();
}

function savePreferences() {
    localStorage.setItem(STORAGE_KEYS.preferences, JSON.stringify(preferences));
}

function saveAndRender(message) {
    saveData();
    renderAll();
    if (message) showToast(message);
}

function addTask() {
    const nameInput = $("#taskName");
    const name = nameInput.value.trim();
    if (!name) {
        showToast("タスク名を入力してください");
        nameInput.focus();
        return;
    }
    const deadlineDate = $("#taskDeadlineDate").value;
    const deadlineTime = deadlineDate ? ($("#taskDeadlineTime").value || "23:59") : "";
    const status = $("#taskInitialStatus").value;
    const now = Date.now();
    const selectedTags = $$("#newTagSelector .tag-btn.selected").map(button => button.textContent.trim());
    tasks.unshift(normalizeTask({
        id: now,
        name,
        note: $("#taskNote").value.trim(),
        deadlineDate,
        deadlineTime,
        isImportant: $("#taskImportant").checked,
        tags: selectedTags,
        status,
        progress: status === "進行中" ? 10 : 0,
        createdAt: now,
        updatedAt: now,
        completedAt: status === "完了" ? now : null
    }));
    nameInput.value = "";
    $("#taskNote").value = "";
    $("#taskDeadlineDate").value = "";
    $("#taskDeadlineTime").value = "";
    $("#taskInitialStatus").value = "未着手";
    $("#taskImportant").checked = false;
    $$("#newTagSelector .tag-btn.selected").forEach(button => button.classList.remove("selected"));
    saveAndRender(`「${name}」を追加しました`);
    nameInput.focus();
}

function openEditModal(id) {
    const task = findTask(id);
    if (!task) return;
    $("#editTaskId").value = task.id;
    $("#editTaskName").value = task.name;
    $("#editTaskNote").value = task.note || "";
    $("#editTaskDate").value = task.deadlineDate || "";
    $("#editTaskTime").value = task.deadlineTime || "";
    $("#editTaskStatus").value = task.status;
    $("#editProgress").value = task.progress;
    $("#editProgressValue").value = `${task.progress}%`;
    $("#editTaskImportant").checked = task.isImportant;
    editingSubtasks = task.subtasks.map(subtask => ({ ...subtask }));
    $("#editTagSelector").innerHTML = AVAILABLE_TAGS.map(tag => (
        `<button type="button" class="tag-btn${task.tags.includes(tag) ? " selected" : ""}" data-action="toggle-tag">${escapeHtml(tag)}</button>`
    )).join("");
    renderEditSubtasks();
    $("#editModal").classList.add("active");
    $("#editModal").setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => $("#editTaskName").focus());
}

function closeEditModal() {
    $("#editModal")?.classList.remove("active");
    $("#editModal")?.setAttribute("aria-hidden", "true");
}

function saveEditTask() {
    const task = findTask(Number($("#editTaskId").value));
    const name = $("#editTaskName").value.trim();
    if (!task || !name) {
        showToast("タスク名を入力してください");
        return;
    }
    const requestedStatus = $("#editTaskStatus").value;
    const requestedProgress = clamp(Number($("#editProgress").value), 0, 100);
    const status = requestedStatus === "完了" || requestedProgress === 100
        ? "完了"
        : requestedStatus === "未着手" && requestedProgress > 0
            ? "進行中"
            : requestedStatus;
    const previousStatus = task.status;
    task.name = name;
    task.note = $("#editTaskNote").value.trim();
    task.deadlineDate = $("#editTaskDate").value;
    task.deadlineTime = task.deadlineDate ? ($("#editTaskTime").value || "23:59") : "";
    task.status = status;
    task.progress = status === "完了" ? 100 : status === "進行中" && requestedProgress === 0 ? 10 : requestedProgress;
    task.isImportant = $("#editTaskImportant").checked;
    task.tags = $$("#editTagSelector .tag-btn.selected").map(button => button.textContent.trim());
    task.subtasks = editingSubtasks.map(subtask => ({ ...subtask }));
    task.updatedAt = Date.now();
    task.notified_24h = false;
    if (status === "完了") {
        task.completedAt = previousStatus === "完了" && task.completedAt ? task.completedAt : Date.now();
        task.subtasks.forEach(subtask => { subtask.completed = true; });
    } else {
        task.completedAt = null;
    }
    closeEditModal();
    saveAndRender("タスクを更新しました");
}

function renderEditSubtasks() {
    const container = $("#editSubtasks");
    container.innerHTML = editingSubtasks.length ? editingSubtasks.map(subtask => `
        <div class="edit-subtask-row">
            <input type="checkbox" data-edit-subtask-check="${subtask.id}" ${subtask.completed ? "checked" : ""} aria-label="完了">
            <input type="text" data-edit-subtask-name="${subtask.id}" value="${escapeHtml(subtask.name)}">
            <button type="button" class="btn btn-ghost btn-icon" data-action="remove-edit-subtask" data-subtask-id="${subtask.id}" aria-label="サブタスクを削除">×</button>
        </div>
    `).join("") : `<p class="field-hint">サブタスクはまだありません。</p>`;
}

function addEditSubtask() {
    const input = $("#editSubtaskInput");
    const name = input.value.trim();
    if (!name) return;
    editingSubtasks.push({ id: Date.now(), name, completed: false });
    input.value = "";
    renderEditSubtasks();
    input.focus();
}

function handleActionClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    const id = Number(button.dataset.taskId);
    if (action === "toggle-important") toggleImportant(id);
    if (action === "edit-task") openEditModal(id);
    if (action === "complete-task") updateTaskStatus(id, "完了");
    if (action === "restore-task") updateTaskStatus(id, "進行中");
    if (action === "delete-task") deleteTask(id);
    if (action === "add-subtask") addSubtask(id);
    if (action === "edit-subtask") editSubtaskName(id, Number(button.dataset.subtaskId));
    if (action === "toggle-tag") button.classList.toggle("selected");
    if (action === "remove-edit-subtask") {
        editingSubtasks = editingSubtasks.filter(subtask => subtask.id !== Number(button.dataset.subtaskId));
        renderEditSubtasks();
    }
}

function handleDelegatedInput(event) {
    if (event.target.matches('[data-action="progress-task"]')) {
        const card = event.target.closest(".task-card");
        card?.querySelector(".progress-fill")?.style.setProperty("width", `${event.target.value}%`);
        const value = card?.querySelector("[data-progress-value]");
        if (value) value.textContent = `${event.target.value}%`;
    }
    if (event.target.matches("[data-edit-subtask-name]")) {
        const subtask = editingSubtasks.find(item => item.id === Number(event.target.dataset.editSubtaskName));
        if (subtask) subtask.name = event.target.value;
    }
}

function handleDelegatedChange(event) {
    if (event.target.matches('[data-action="progress-task"]')) updateProgress(Number(event.target.dataset.taskId), event.target.value);
    if (event.target.matches('[data-action="toggle-subtask"]')) toggleSubtask(Number(event.target.dataset.taskId), Number(event.target.dataset.subtaskId));
    if (event.target.matches("[data-edit-subtask-check]")) {
        const subtask = editingSubtasks.find(item => item.id === Number(event.target.dataset.editSubtaskCheck));
        if (subtask) subtask.completed = event.target.checked;
    }
}

function findTask(id) { return tasks.find(task => task.id === Number(id)); }

function toggleImportant(id) {
    const task = findTask(id);
    if (!task) return;
    task.isImportant = !task.isImportant;
    task.updatedAt = Date.now();
    saveAndRender();
}

function updateProgress(id, value) {
    const task = findTask(id);
    if (!task) return;
    task.progress = clamp(Number(value), 0, 100);
    if (task.progress >= 100) {
        task.status = "完了";
        task.completedAt = task.completedAt || Date.now();
        task.subtasks.forEach(subtask => { subtask.completed = true; });
    } else {
        task.status = task.progress > 0 ? "進行中" : "未着手";
        task.completedAt = null;
    }
    task.updatedAt = Date.now();
    saveAndRender();
}

function updateTaskStatus(id, status) {
    const task = findTask(id);
    if (!task || !VALID_STATUSES.includes(status)) return;
    task.status = status;
    if (status === "完了") {
        task.progress = 100;
        task.completedAt = task.completedAt || Date.now();
        task.subtasks.forEach(subtask => { subtask.completed = true; });
    } else if (status === "未着手") {
        task.progress = 0;
        task.completedAt = null;
        task.subtasks.forEach(subtask => { subtask.completed = false; });
    } else {
        if (task.progress === 0) task.progress = 10;
        if (task.progress === 100) task.progress = 90;
        task.completedAt = null;
    }
    task.updatedAt = Date.now();
    saveAndRender(status === "完了" ? "タスクを完了しました" : "タスクを戻しました");
}

function addSubtask(taskId) {
    const task = findTask(taskId);
    if (!task) return;
    const name = prompt("サブタスク名を入力してください");
    if (!name?.trim()) return;
    task.subtasks.push({ id: Date.now(), name: name.trim(), completed: false });
    task.updatedAt = Date.now();
    saveAndRender("サブタスクを追加しました");
}

function editSubtaskName(taskId, subtaskId) {
    const task = findTask(taskId);
    const subtask = task?.subtasks.find(item => item.id === subtaskId);
    if (!subtask) return;
    const name = prompt("サブタスク名", subtask.name);
    if (!name?.trim()) return;
    subtask.name = name.trim();
    task.updatedAt = Date.now();
    saveAndRender();
}

function toggleSubtask(taskId, subtaskId) {
    const task = findTask(taskId);
    const subtask = task?.subtasks.find(item => item.id === subtaskId);
    if (!task || !subtask) return;
    subtask.completed = !subtask.completed;
    const completedCount = task.subtasks.filter(item => item.completed).length;
    if (task.subtasks.length) {
        task.progress = Math.round((completedCount / task.subtasks.length) * 100);
        if (task.progress === 100) {
            task.status = "完了";
            task.completedAt = task.completedAt || Date.now();
        } else {
            task.status = task.progress > 0 ? "進行中" : "未着手";
            task.completedAt = null;
        }
    }
    task.updatedAt = Date.now();
    saveAndRender();
}

function deleteTask(id) {
    const task = findTask(id);
    if (!task || !confirm(`「${task.name}」を削除しますか？`)) return;
    lastDeletedTask = { task: { ...task, subtasks: task.subtasks.map(subtask => ({ ...subtask })) }, index: tasks.indexOf(task) };
    tasks = tasks.filter(item => item.id !== id);
    saveAndRender();
    showToast("タスクを削除しました", "元に戻す", undoDeleteTask);
}

function undoDeleteTask() {
    if (!lastDeletedTask) return;
    tasks.splice(lastDeletedTask.index, 0, lastDeletedTask.task);
    lastDeletedTask = null;
    saveAndRender("削除を取り消しました");
}

function renderAll() {
    renderDashboard();
    renderActiveTasks();
    renderCompletedTasks();
    updateStorageUsage();
    generateScrapboxReport();
}

function renderDashboard() {
    const now = Date.now();
    const active = tasks.filter(task => task.status !== "完了");
    const doing = tasks.filter(task => task.status === "進行中");
    const dueSoon = active.filter(task => {
        const deadline = deadlineTimestamp(task);
        return deadline && deadline >= now && deadline <= now + 24 * 60 * 60 * 1000;
    });
    const overdue = active.filter(task => {
        const deadline = deadlineTimestamp(task);
        return deadline && deadline < now;
    });
    const weeklyDone = tasks.filter(task => task.status === "完了" && task.completedAt >= now - 7 * 24 * 60 * 60 * 1000);
    $("#statActive").textContent = active.length;
    $("#statDoing").textContent = doing.length;
    $("#statDue").textContent = dueSoon.length + overdue.length;
    $("#statWeeklyDone").textContent = weeklyDone.length;
    $("#statDueCard").classList.toggle("danger", overdue.length > 0);

    const focusTask = pickFocusTask(active);
    if (focusTask) {
        $("#focusTitle").textContent = focusTask.name;
        $("#focusMeta").textContent = focusTask.deadlineDate ? formatDeadlineText(focusTask) : `${statusLabel(focusTask.status)}・期限未設定`;
        $("#focusProgressBar").style.width = `${focusTask.progress}%`;
        $("#focusAction").disabled = false;
        $("#focusAction").dataset.taskId = focusTask.id;
    } else {
        $("#focusTitle").textContent = "アクティブなタスクはありません";
        $("#focusMeta").textContent = "新しいタスクを追加して始めましょう";
        $("#focusProgressBar").style.width = "0%";
        $("#focusAction").disabled = true;
        delete $("#focusAction").dataset.taskId;
    }

    renderUpcoming(active);
    renderStatusDonut();
    renderTagBars(active);
}

function pickFocusTask(activeTasks) {
    return [...activeTasks].sort((a, b) => {
        if (a.status === "進行中" && b.status !== "進行中") return -1;
        if (a.status !== "進行中" && b.status === "進行中") return 1;
        if (a.isImportant !== b.isImportant) return a.isImportant ? -1 : 1;
        return (deadlineTimestamp(a) || Infinity) - (deadlineTimestamp(b) || Infinity);
    })[0] || null;
}

function renderUpcoming(activeTasks) {
    const container = $("#upcomingList");
    const upcoming = [...activeTasks]
        .filter(task => task.deadlineDate)
        .sort((a, b) => deadlineTimestamp(a) - deadlineTimestamp(b))
        .slice(0, 6);
    if (!upcoming.length) {
        container.innerHTML = emptyState("◷", "期限付きタスクはありません", "期限を設定すると、ここに予定が並びます");
        return;
    }
    container.innerHTML = upcoming.map(task => {
        const date = parseLocalDate(task.deadlineDate);
        const deadlineState = getDeadlineStatus(task.deadlineDate, task.deadlineTime);
        return `<button type="button" class="upcoming-item" data-action="edit-task" data-task-id="${task.id}" style="width:100%;text-align:left;background:transparent;cursor:pointer;">
            <span class="date-tile ${deadlineState === "past" ? "past" : ""}"><span>${date.getMonth() + 1}月<br>${date.getDate()}日</span></span>
            <span style="min-width:0">
                <span class="upcoming-title" style="display:block">${escapeHtml(task.name)}</span>
                <span class="upcoming-meta">${escapeHtml(task.deadlineTime || "23:59")}・${task.progress}% 完了</span>
            </span>
            ${deadlinePill(task)}
        </button>`;
    }).join("");
}

function renderStatusDonut() {
    const counts = {
        todo: tasks.filter(task => task.status === "未着手").length,
        doing: tasks.filter(task => task.status === "進行中").length,
        done: tasks.filter(task => task.status === "完了").length
    };
    const total = counts.todo + counts.doing + counts.done;
    const todoEnd = total ? counts.todo / total * 100 : 0;
    const doingEnd = total ? todoEnd + counts.doing / total * 100 : 0;
    $("#statusDonut").style.background = total
        ? `conic-gradient(#94a3b8 0 ${todoEnd}%, #3b82f6 ${todoEnd}% ${doingEnd}%, #22c55e ${doingEnd}% 100%)`
        : "rgba(147,197,253,0.25)";
    $("#donutTotal").textContent = total;
    $("#legendTodo").textContent = counts.todo;
    $("#legendDoing").textContent = counts.doing;
    $("#legendDone").textContent = counts.done;
}

function renderTagBars(activeTasks) {
    const container = $("#tagBars");
    const counts = {};
    activeTasks.forEach(task => task.tags.forEach(tag => { counts[tag] = (counts[tag] || 0) + 1; }));
    const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 7);
    if (!rows.length) {
        container.innerHTML = emptyState("#", "タグ集計はまだありません", "タスクにタグを付けると傾向が見えます");
        return;
    }
    const max = Math.max(...rows.map(([, count]) => count), 1);
    container.innerHTML = rows.map(([tag, count]) => `<div class="tag-bar-row">
        <span class="tag-bar-name">${escapeHtml(tag)}</span>
        <span class="tag-bar-track"><span class="tag-bar-fill" style="display:block;width:${count / max * 100}%"></span></span>
        <span class="tag-bar-count">${count}</span>
    </div>`).join("");
}

function getFilteredActiveTasks(includeCompleted = false) {
    const query = $("#searchActive").value.trim().toLowerCase();
    const statusFilter = $("#filterStatusActive").value;
    const tagFilter = $("#filterTagActive").value;
    const sortOption = $("#sortActive").value;
    const pinImportant = $("#pinImportantToggle").checked;
    let filtered = tasks.filter(task => includeCompleted || task.status !== "完了");
    if (statusFilter) filtered = filtered.filter(task => task.status === statusFilter);
    if (tagFilter) filtered = filtered.filter(task => task.tags.includes(tagFilter));
    if (query) filtered = filtered.filter(task => {
        const searchable = [task.name, task.note, ...task.tags, ...task.subtasks.map(subtask => subtask.name)].join(" ").toLowerCase();
        return searchable.includes(query);
    });
    filtered.sort((a, b) => {
        if (pinImportant && a.isImportant !== b.isImportant) return a.isImportant ? -1 : 1;
        if (sortOption === "deadline-desc") return (deadlineTimestamp(b) || -Infinity) - (deadlineTimestamp(a) || -Infinity);
        if (sortOption === "created-desc") return b.createdAt - a.createdAt;
        if (sortOption === "updated-desc") return b.updatedAt - a.updatedAt;
        return (deadlineTimestamp(a) || Infinity) - (deadlineTimestamp(b) || Infinity);
    });
    return filtered;
}

function renderActiveTasks() {
    if (preferences.viewMode === "kanban") renderKanban();
    else renderTaskList();
}

function renderTaskList() {
    const container = $("#taskList");
    const filtered = getFilteredActiveTasks(false);
    $("#activeResultCount").textContent = `${filtered.length}件`;
    if (!filtered.length) {
        container.innerHTML = emptyState("✓", "該当するタスクはありません", "条件を変えるか、新しいタスクを追加してください");
        return;
    }
    container.innerHTML = filtered.map(taskCardHtml).join("");
}

function taskCardHtml(task) {
    const deadlineState = getDeadlineStatus(task.deadlineDate, task.deadlineTime);
    const cardClass = taskVisualClass(task, deadlineState);
    const subtasks = task.subtasks.length ? `<ul class="subtask-list">${task.subtasks.map(subtask => `
        <li class="subtask-item ${subtask.completed ? "done" : ""}">
            <input type="checkbox" data-action="toggle-subtask" data-task-id="${task.id}" data-subtask-id="${subtask.id}" ${subtask.completed ? "checked" : ""} aria-label="${escapeHtml(subtask.name)}を完了">
            <button type="button" data-action="edit-subtask" data-task-id="${task.id}" data-subtask-id="${subtask.id}">${escapeHtml(subtask.name)}</button>
        </li>`).join("")}</ul>` : "";
    return `<article class="task-card panel ${cardClass}">
        <div class="task-main">
            <div class="task-title-row">
                <button type="button" class="star-button ${task.isImportant ? "active" : ""}" data-action="toggle-important" data-task-id="${task.id}" aria-label="重要度を切り替える">★</button>
                <h3 class="task-title">${escapeHtml(task.name)}</h3>
                ${statusPill(task.status)}
            </div>
            ${task.note ? `<p class="task-note">${escapeHtml(task.note)}</p>` : ""}
            <div class="task-meta">${task.deadlineDate ? deadlinePill(task) : `<span class="deadline-pill">期限なし</span>`}${task.tags.map(tag => `<span class="task-tag">${escapeHtml(tag)}</span>`).join("")}</div>
            ${subtasks}
        </div>
        <div class="task-progress-area">
            <div class="progress-heading"><span>進捗</span><strong data-progress-value>${task.progress}%</strong></div>
            <div class="progress-track"><div class="progress-fill" style="width:${task.progress}%"></div></div>
            <input class="progress-range" type="range" min="0" max="100" step="5" value="${task.progress}" data-action="progress-task" data-task-id="${task.id}" aria-label="${escapeHtml(task.name)}の進捗">
        </div>
        <div class="task-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-action="add-subtask" data-task-id="${task.id}">＋ サブ</button>
            <button type="button" class="btn btn-secondary btn-sm" data-action="edit-task" data-task-id="${task.id}">編集</button>
            <button type="button" class="btn btn-success btn-sm" data-action="complete-task" data-task-id="${task.id}">✓ 完了</button>
        </div>
    </article>`;
}

function renderKanban() {
    const query = $("#searchActive").value.trim().toLowerCase();
    const statusFilter = $("#filterStatusActive").value;
    const tagFilter = $("#filterTagActive").value;
    let filtered = tasks.filter(task => {
        const matchesQuery = !query || [task.name, task.note, ...task.tags].join(" ").toLowerCase().includes(query);
        const matchesStatus = !statusFilter || task.status === statusFilter;
        return matchesQuery && matchesStatus && (!tagFilter || task.tags.includes(tagFilter));
    });
    const columns = ["未着手", "進行中", "完了"];
    columns.forEach(status => {
        const list = $(status === "未着手" ? "#kanbanTodo" : status === "進行中" ? "#kanbanDoing" : "#kanbanDone");
        let columnTasks = filtered.filter(task => task.status === status);
        if (status === "完了") columnTasks = columnTasks.sort((a, b) => b.completedAt - a.completedAt).slice(0, 10);
        $(status === "未着手" ? "#kanbanTodoCount" : status === "進行中" ? "#kanbanDoingCount" : "#kanbanDoneCount").textContent = columnTasks.length;
        list.innerHTML = columnTasks.length ? columnTasks.map(kanbanCardHtml).join("") : `<div class="empty-state" style="padding:28px 12px"><strong>ここにはまだありません</strong></div>`;
    });
    $("#activeResultCount").textContent = `${filtered.filter(task => task.status !== "完了").length}件`;
    $$(".kanban-card").forEach(card => card.addEventListener("dragstart", event => {
        event.dataTransfer.setData("text/plain", card.dataset.taskId);
        event.dataTransfer.effectAllowed = "move";
    }));
}

function kanbanCardHtml(task) {
    const cardClass = task.status === "完了" ? "" : taskVisualClass(task);
    return `<article class="kanban-card ${cardClass}" draggable="true" data-task-id="${task.id}" data-action="edit-task">
        <h3 class="kanban-card-title">${task.isImportant ? `<span style="color:var(--accent)">★</span> ` : ""}${escapeHtml(task.name)}</h3>
        <div class="kanban-card-meta">
            ${task.deadlineDate ? deadlinePill(task) : `<span class="deadline-pill">期限なし</span>`}
            <span class="kanban-progress">${task.progress}%</span>
        </div>
        <div class="mini-progress"><span style="width:${task.progress}%"></span></div>
        ${task.tags.length ? `<div class="task-meta" style="margin-left:0">${task.tags.slice(0,2).map(tag => `<span class="task-tag">${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
    </article>`;
}

function taskVisualClass(task, deadlineState = getDeadlineStatus(task.deadlineDate, task.deadlineTime)) {
    if (deadlineState === "past") return "overdue";
    if (deadlineState === "warning-24h") return "urgent";
    if (deadlineState === "warning-week") return "due-week";
    return task.isImportant ? "important" : "";
}

function renderCompletedTasks() {
    const container = $("#completedList");
    const query = $("#searchCompleted").value.trim().toLowerCase();
    const tag = $("#filterTagCompleted").value;
    const sort = $("#sortCompleted").value;
    let completed = tasks.filter(task => task.status === "完了");
    if (query) completed = completed.filter(task => [task.name, task.note, ...task.tags].join(" ").toLowerCase().includes(query));
    if (tag) completed = completed.filter(task => task.tags.includes(tag));
    completed.sort((a, b) => sort === "completed-asc" ? a.completedAt - b.completedAt : b.completedAt - a.completedAt);
    const now = Date.now();
    $("#completedTotal").textContent = tasks.filter(task => task.status === "完了").length;
    $("#completedWeek").textContent = tasks.filter(task => task.status === "完了" && task.completedAt >= now - 7 * 86400000).length;
    $("#completedMonth").textContent = tasks.filter(task => task.status === "完了" && task.completedAt >= now - 30 * 86400000).length;
    if (!completed.length) {
        container.innerHTML = emptyState("✓", "完了したタスクはありません", "タスクを完了すると、ここに記録されます");
        return;
    }
    container.innerHTML = completed.map(task => `<article class="completed-card panel">
        <div>
            <div class="completed-title">${task.isImportant ? `<span style="color:var(--accent)">★</span> ` : ""}${escapeHtml(task.name)}</div>
            <div class="completed-meta">
                <span class="status-pill done">完了 ${escapeHtml(formatDateTime(task.completedAt))}</span>
                ${task.tags.map(item => `<span class="task-tag">${escapeHtml(item)}</span>`).join("")}
            </div>
        </div>
        <div class="completed-actions">
            <button type="button" class="btn btn-secondary btn-sm" data-action="restore-task" data-task-id="${task.id}">戻す</button>
            <button type="button" class="btn btn-danger btn-sm" data-action="delete-task" data-task-id="${task.id}">削除</button>
        </div>
    </article>`).join("");
}

function statusPill(status) {
    const className = status === "進行中" ? "doing" : status === "完了" ? "done" : "";
    return `<span class="status-pill ${className}">${escapeHtml(status)}</span>`;
}

function deadlinePill(task) {
    const state = getDeadlineStatus(task.deadlineDate, task.deadlineTime);
    const className = state === "past" ? "past" : ["warning-24h", "warning-week"].includes(state) ? "soon" : "";
    return `<span class="deadline-pill ${className}">◷ ${escapeHtml(formatDeadlineText(task))}</span>`;
}

function getDeadlineStatus(date, time) {
    if (!date) return "none";
    const diffHours = (new Date(`${date}T${time || "23:59"}:00`).getTime() - Date.now()) / 3600000;
    if (diffHours < 0) return "past";
    if (diffHours < 24) return "warning-24h";
    if (diffHours < 168) return "warning-week";
    return "safe";
}

function deadlineTimestamp(task) {
    if (!task.deadlineDate) return null;
    const value = new Date(`${task.deadlineDate}T${task.deadlineTime || "23:59"}:00`).getTime();
    return Number.isFinite(value) ? value : null;
}

function formatDeadlineText(task) {
    const deadline = deadlineTimestamp(task);
    if (!deadline) return "期限なし";
    const today = startOfDay(new Date());
    const target = startOfDay(new Date(deadline));
    const dayDiff = Math.round((target - today) / 86400000);
    const time = task.deadlineTime || "23:59";
    if (dayDiff < 0) return `${Math.abs(dayDiff)}日超過`;
    if (dayDiff === 0) return `今日 ${time}`;
    if (dayDiff === 1) return `明日 ${time}`;
    return `${task.deadlineDate.replace(/-/g, "/")} ${time}`;
}

function statusLabel(status) { return status === "進行中" ? "進行中" : status === "完了" ? "完了" : "未着手"; }

function startOfDay(date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime(); }
function parseLocalDate(value) { const [year, month, day] = value.split("-").map(Number); return new Date(year, month - 1, day); }
function toYMD(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function formatDateTime(value) { return value ? new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "-"; }
function clamp(value, min, max) { return Math.min(Math.max(Number.isFinite(value) ? value : min, min), max); }

function emptyState(icon, title, description) {
    return `<div class="empty-state"><span class="empty-icon">${icon}</span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(description)}</p></div>`;
}

function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function restoreReportDraft() {
    const draft = loadJson(STORAGE_KEYS.reportDraft, {});
    REPORT_FIELD_IDS.forEach(id => {
        if (Object.prototype.hasOwnProperty.call(draft, id)) $("#" + id).value = draft[id];
    });
}

function scheduleReportUpdate() {
    clearTimeout(reportSaveTimer);
    $("#reportSaveStatus").textContent = "保存中…";
    reportSaveTimer = setTimeout(() => {
        saveReportDraft();
        generateScrapboxReport();
        $("#reportSaveStatus").textContent = "自動保存済み";
    }, 180);
}

function saveReportDraft() {
    const draft = {};
    REPORT_FIELD_IDS.forEach(id => { draft[id] = $("#" + id).value; });
    localStorage.setItem(STORAGE_KEYS.reportDraft, JSON.stringify(draft));
}

function resetReportDraft() {
    if (!confirm("レポートの入力内容をリセットしますか？")) return;
    REPORT_FIELD_IDS.forEach(id => {
        if (["repName", "repTheme", "repPages"].includes(id)) return;
        $("#" + id).value = "";
    });
    initializeDates();
    localStorage.removeItem(STORAGE_KEYS.reportDraft);
    generateScrapboxReport();
    showToast("レポート入力をリセットしました");
}

function formatTagsForReport(tags) {
    return tags?.length ? " " + tags.map(tag => `#${tag.replace(/\s+/g, "_")}`).join(" ") : "";
}

function formatPageLinks(value) {
    return value.split(/[\n,、]+/).map(item => item.trim()).filter(Boolean).map(item => item.startsWith("[") && item.endsWith("]") ? item : `[${item}]`);
}

function indentReportText(value, spaces = 1) {
    const prefix = " ".repeat(spaces);
    return value.trim().split("\n").map(line => `${prefix}${line}`).join("\n");
}

function formatPlanItems(value) {
    return value.trim().split("\n").map(line => line.trim()).filter(Boolean).map(line => `  ${line.startsWith("○") ? line : `○ ${line}`}`).join("\n");
}

function generateScrapboxReport() {
    if (!$("#reportOutput")) return;
    const value = id => $("#" + id).value.trim();
    const name = value("repName");
    const date = (value("repDate") || toYMD(new Date())).replace(/-/g, "/");
    const links = [name, value("repTheme"), ...formatPageLinks(value("repPages"))]
        .flatMap(item => item ? (String(item).startsWith("[") ? [item] : [`[${item}]`]) : []);
    const startValue = value("extStartDate");
    const endValue = value("extEndDate");
    const start = startValue ? new Date(`${startValue}T00:00:00`).getTime() : -Infinity;
    const end = endValue ? new Date(`${endValue}T23:59:59`).getTime() : Infinity;
    const completedInRange = tasks.filter(task => task.status === "完了" && task.completedAt >= start && task.completedAt <= end);
    const actualWork = value("repActualWork");
    const deliverables = value("repDeliverables");
    const findings = value("repFindings");
    const incomplete = value("repIncomplete");
    const issues = value("repIssues");
    const todayWork = value("repTodayWork");
    const nextHighest = value("repNextHighest");
    const nextThen = value("repNextThen");
    const nextOptional = value("repNextOptional");
    const nextShow = value("repNextShow");
    const events = value("repEvents");
    const prerequisites = value("repPrerequisites");
    const consultTeacher = value("repConsultTeacher");
    const consultPeers = value("repConsultPeers");
    const todayResults = value("repTodayResults");
    const notes = value("repNotes");

    let report = `進捗-${date}-${name || "氏名"}\n\n${links.join("\n")}\n\n[* 前回ゼミから今日まで]\n\n`;
    report += `[** 実際にやったこと]\n`;
    if (actualWork) report += `${indentReportText(actualWork)}\n`;
    completedInRange.forEach(task => { report += ` ${task.name} を完了${formatTagsForReport(task.tags)}\n`; });
    if (!actualWork && !completedInRange.length) report += " 要確認\n";
    report += "\n";

    if (deliverables || findings) {
        report += "[** できたもの・分かったこと]\n";
        if (deliverables) report += ` 成果物\n${indentReportText(deliverables)}\n`;
        if (findings) report += ` 分かったこと\n${indentReportText(findings)}\n`;
        report += "\n";
    }

    report += "[** できなかったこと・止まっていること]\n";
    if (incomplete) report += `${indentReportText(incomplete)}\n`;
    if (issues) report += `${indentReportText(issues)}\n`;
    if (!incomplete && !issues) report += " 要確認\n";
    report += "\n[* 今日から次回ゼミまで]\n\n";
    if (todayWork) report += `[** 今日取り組むこと]\n${indentReportText(todayWork)}\n\n`;

    report += "[** 次回までにやること]\n";
    const active = [...tasks].filter(task => task.status !== "完了").sort((a, b) => (deadlineTimestamp(a) || Infinity) - (deadlineTimestamp(b) || Infinity));
    const important = active.filter(task => task.isImportant);
    const others = active.filter(task => !task.isImportant);
    const formatTask = task => {
        const suffix = task.deadlineDate ? `（期限: ${task.deadlineDate.replace(/-/g, "/")}）` : "";
        const pending = task.subtasks.filter(subtask => !subtask.completed);
        return pending.length ? pending.map(subtask => `  ○ ${task.name}: ${subtask.name}${suffix}`).join("\n") : `  ○ ${task.name}${suffix}`;
    };
    if (nextHighest || important.length) {
        report += " 最優先\n";
        if (nextHighest) report += `${formatPlanItems(nextHighest)}\n`;
        important.forEach(task => { report += `${formatTask(task)}\n`; });
        report += "\n";
    }
    if (nextThen || others.length) {
        report += " 次にやる\n";
        if (nextThen) report += `${formatPlanItems(nextThen)}\n`;
        others.forEach(task => { report += `${formatTask(task)}\n`; });
        report += "\n";
    }
    if (nextOptional) report += ` 余裕があれば\n${formatPlanItems(nextOptional)}\n\n`;
    if (!nextHighest && !nextThen && !nextOptional && !active.length) report += " 要確認\n\n";

    if (nextShow || events || prerequisites) {
        report += "[** 次に人に見せるもの]\n";
        if (nextShow) report += ` 次回ゼミで見せるもの\n${indentReportText(nextShow)}\n`;
        if (events) report += `\n 発表・展示・イベント等\n${indentReportText(events)}\n`;
        if (prerequisites) report += `\n そこまでに必要な作業\n${indentReportText(prerequisites)}\n`;
        report += "\n";
    }
    if (consultTeacher || consultPeers) {
        report += "[** 相談したいこと]\n";
        if (consultTeacher) report += ` 教員に確認したいこと\n${indentReportText(consultTeacher)}\n`;
        if (consultPeers) report += `\n 他の学生・先輩に聞きたいこと\n${indentReportText(consultPeers)}\n`;
        report += "\n";
    }
    if (todayResults) report += `[* 今日の作業結果]\n${indentReportText(todayResults)}\n\n`;
    if (notes) report += `[** 備考]\n${indentReportText(notes)}\n\n`;
    report += "#進捗\n#橋田ゼミ2026\n";
    $("#reportOutput").value = report;
}

async function copyReport() {
    const output = $("#reportOutput");
    if (!output.value) generateScrapboxReport();
    try {
        await navigator.clipboard.writeText(output.value);
    } catch (error) {
        output.select();
        document.execCommand("copy");
        window.getSelection()?.removeAllRanges();
    }
    showToast("レポートをコピーしました");
}

function exportJSON() {
    const payload = {
        version: 11,
        exportedAt: new Date().toISOString(),
        tasks,
        reportDraft: loadJson(STORAGE_KEYS.reportDraft, {}),
        preferences
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `progress_hub_backup_${toYMD(new Date())}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast("バックアップを書き出しました");
}

function importJSON(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const payload = JSON.parse(reader.result);
            const importedTasks = Array.isArray(payload) ? payload : payload.tasks;
            if (!Array.isArray(importedTasks)) throw new Error("invalid");
            if (!confirm(`${importedTasks.length}件のタスクで現在のデータを置き換えますか？`)) return;
            tasks = importedTasks.map(normalizeTask);
            if (!Array.isArray(payload) && payload.reportDraft) {
                localStorage.setItem(STORAGE_KEYS.reportDraft, JSON.stringify(payload.reportDraft));
                restoreReportDraft();
            }
            if (!Array.isArray(payload) && payload.preferences) {
                preferences = { ...preferences, ...payload.preferences };
                savePreferences();
            }
            saveAndRender("データを復元しました");
        } catch (error) {
            showToast("読み込めないバックアップです");
        } finally {
            event.target.value = "";
        }
    };
    reader.readAsText(file);
}

function clearAllData() {
    if (!confirm("すべてのタスクを削除します。この操作は元に戻せません。")) return;
    tasks = [];
    saveAndRender("すべてのタスクを削除しました");
}

function updateStorageUsage() {
    if (!$("#storageUsage")) return;
    const bytes = new Blob([localStorage.getItem(STORAGE_KEYS.tasks) || ""]).size;
    const estimatedLimit = 5 * 1024 * 1024;
    const percentage = Math.min(bytes / estimatedLimit * 100, 100);
    $("#storageUsage").textContent = `${tasks.length}件・${formatBytes(bytes)}`;
    $("#storageMeterFill").style.width = `${Math.max(percentage, bytes ? 1 : 0)}%`;
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
}

function checkNotificationStatus() {
    const status = $("#notifyStatus");
    const button = $("#notifyButton");
    if (!("Notification" in window)) {
        status.textContent = "このブラウザでは利用できません";
        button.disabled = true;
        return;
    }
    if (Notification.permission === "granted") {
        status.textContent = "通知はオンです";
        button.textContent = "テスト通知を送る";
        startNotificationTimer();
    } else if (Notification.permission === "denied") {
        status.textContent = "ブラウザ設定でブロックされています";
        button.disabled = true;
    } else {
        status.textContent = "通知はオフです";
    }
}

async function requestNotificationPermission() {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
        new Notification("Progress Hub", { body: "通知は正常に動作しています。" });
        return;
    }
    await Notification.requestPermission();
    checkNotificationStatus();
}

function startNotificationTimer() {
    clearInterval(notifyInterval);
    const check = () => {
        const now = Date.now();
        tasks.forEach(task => {
            const deadline = deadlineTimestamp(task);
            if (task.status === "完了" || !deadline || task.notified_24h) return;
            const diff = deadline - now;
            if (diff > 0 && diff <= 86400000) {
                new Notification("期限が近いタスク", { body: `「${task.name}」の期限が24時間以内です。` });
                task.notified_24h = true;
                saveData();
            }
        });
    };
    check();
    notifyInterval = setInterval(check, 60000);
}

function showToast(message, actionLabel, action) {
    const toast = document.createElement("div");
    toast.className = "toast";
    const text = document.createElement("span");
    text.textContent = message;
    toast.appendChild(text);
    if (actionLabel && action) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = actionLabel;
        button.addEventListener("click", () => { action(); toast.remove(); });
        toast.appendChild(button);
    }
    $("#toastRegion").appendChild(toast);
    setTimeout(() => toast.remove(), 4300);
}
