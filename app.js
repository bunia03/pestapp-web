const STORAGE_KEY = "pestapp-notes-v1";
const PREFS_KEY = "pestapp-prefs-v1";

const firebaseConfig = {
  apiKey: "AIzaSyAed1v1mqgM1YYtdVsf5y44ULHpDDbYKis",
  authDomain: "pestapps.firebaseapp.com",
  projectId: "pestapps",
  storageBucket: "pestapps.firebasestorage.app",
  messagingSenderId: "406062964826",
  appId: "1:406062964826:web:b88fe02ba2c3c31b887863",
  measurementId: "G-2S3J0F46KC"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
db.enablePersistence({ synchronizeTabs: true }).catch(() => {});

const owners = [
  { id: "bunia", label: "Bunia" },
  { id: "greg", label: "Greg" },
  { id: "michal", label: "Michał" },
  { id: "office", label: "W biurze" },
  { id: "secondStages", label: "Drugie etapy" },
  { id: "billing", label: "Rozliczenie" },
  { id: "all", label: "Wszystkie" }
];

const tabs = [
  { id: "active", label: "Notatki" },
  { id: "done", label: "Done" },
  { id: "trash", label: "Kosz" }
];

const state = {
  notes: [],
  selectedOwner: "bunia",
  selectedTab: "active",
  filter: "all",
  filterDate: todayISO(),
  filterMonth: monthISO(new Date()),
  search: "",
  selection: new Set(),
  calendarMonth: startOfMonth(new Date()),
  user: null,
  allowedOwners: owners.filter((owner) => owner.id !== "all").map((owner) => owner.id),
  unsubNotes: null,
  searchOpen: false,
  settingsOpen: false,
  editingNoteId: null
};

const els = {
  ownerTabs: document.getElementById("owner-tabs"),
  listTabs: document.getElementById("list-tabs"),
  newNote: document.getElementById("new-note"),
  addNote: document.getElementById("add-note"),
  search: document.getElementById("search"),
  notesList: document.getElementById("notes-list"),
  empty: document.getElementById("empty"),
  selectAllRow: document.getElementById("select-all-row"),
  bulkActions: document.getElementById("bulk-actions"),
  calendarPanel: document.getElementById("calendar-panel"),
  searchToggle: document.getElementById("search-toggle"),
  searchRow: document.getElementById("search-row"),
  settingsToggle: document.getElementById("settings-toggle"),
  settingsMenu: document.getElementById("settings-menu"),
  refreshData: document.getElementById("refresh-data"),
  exportBackup: document.getElementById("export-backup"),
  calendarToggle: document.getElementById("calendar-toggle"),
  calendarDialog: document.getElementById("calendar-dialog"),
  calendarModalBody: document.getElementById("calendar-modal-body"),
  closeCalendar: document.getElementById("close-calendar"),
  authEmail: document.getElementById("auth-email"),
  authPassword: document.getElementById("auth-password"),
  signIn: document.getElementById("sign-in"),
  register: document.getElementById("register"),
  resetPassword: document.getElementById("reset-password"),
  signOut: document.getElementById("sign-out"),
  authStatus: document.getElementById("auth-status"),
  editRow: document.getElementById("edit-row"),
  editNoteText: document.getElementById("edit-note-text"),
  editNoteDate: document.getElementById("edit-note-date"),
  editNoteUrgent: document.getElementById("edit-note-urgent"),
  editNoteDone: document.getElementById("edit-note-done"),
  editNoteClearDate: document.getElementById("edit-note-clear-date"),
  editNoteSave: document.getElementById("edit-note-save"),
  editNoteCancel: document.getElementById("edit-note-cancel")
};

init();

function init() {
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch((err) => {
    console.error("Auth persistence error", err);
  });
  loadState();
  purgeTrash();
  bindEvents();
  bindAuth();
  render();
  registerServiceWorker();
}

function bindEvents() {
  els.addNote.addEventListener("click", addFromInput);
  els.newNote.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addFromInput();
    }
  });

  els.search.addEventListener("input", (e) => {
    state.search = e.target.value;
    render();
  });

  els.notesList.addEventListener("click", handleNoteClick);
  els.notesList.addEventListener("change", handleNoteChange);

  els.searchToggle.addEventListener("click", () => {
    state.searchOpen = !state.searchOpen;
    if (!state.searchOpen) {
      state.search = "";
      els.search.value = "";
    }
    render();
    if (state.searchOpen) {
      setTimeout(() => els.search.focus(), 0);
    }
  });

  els.settingsToggle.addEventListener("click", () => {
    state.settingsOpen = !state.settingsOpen;
    renderUtilityState();
  });

  els.calendarToggle.addEventListener("click", () => {
    if (typeof els.calendarDialog.showModal === "function") {
      els.calendarDialog.showModal();
    }
  });
  els.closeCalendar.addEventListener("click", () => els.calendarDialog.close());

  els.editNoteClearDate.addEventListener("click", () => {
    els.editNoteDate.value = "";
  });
  els.editNoteSave.addEventListener("click", saveInlineEditor);
  els.editNoteCancel.addEventListener("click", closeInlineEditor);
  els.refreshData.addEventListener("click", async () => {
    if (state.user) {
      await subscribeNotes();
    }
    state.settingsOpen = false;
    render();
  });
  els.exportBackup.addEventListener("click", () => {
    downloadBackup();
    state.settingsOpen = false;
    renderUtilityState();
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".settings-wrap")) {
      state.settingsOpen = false;
      renderUtilityState();
    }
  });
}

function bindAuth() {
  els.signIn.addEventListener("click", signInWithPassword);
  els.register.addEventListener("click", registerWithPassword);
  els.resetPassword.addEventListener("click", sendPasswordReset);
  els.signOut.addEventListener("click", async () => {
    await auth.signOut();
    state.user = null;
    state.allowedOwners = owners.filter((owner) => owner.id !== "all").map((owner) => owner.id);
    state.selectedOwner = state.allowedOwners[0] || "bunia";
    unsubscribeNotes();
    const stored = localStorage.getItem(STORAGE_KEY);
    state.notes = stored ? JSON.parse(stored) : [];
    updateAuthUI();
    render();
  });

  auth.onAuthStateChanged(async (user) => {
    state.user = user || null;
    updateAuthUI();
    if (user) {
      try {
        await loadAccessProfile();
        await subscribeNotes();
      } catch (err) {
        console.error(err);
        alert("Nie udało się uruchomić synchronizacji. Spróbuj ponownie.");
      }
    } else {
      unsubscribeNotes();
    }
    render();
  });
}

function loadState() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      state.notes = JSON.parse(stored);
    } catch {
      state.notes = [];
    }
  }

  const prefs = localStorage.getItem(PREFS_KEY);
  if (prefs) {
    try {
      const parsed = JSON.parse(prefs);
      Object.assign(state, parsed, { selection: new Set() });
    } catch {
      // ignore
    }
  }

  if (!state.filterDate) state.filterDate = todayISO();
  if (!state.filterMonth) state.filterMonth = monthISO(new Date());
  state.calendarMonth = startOfMonth(new Date());
}

function saveState() {
  if (!state.user) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.notes));
  }
  const prefs = {
    selectedOwner: state.selectedOwner,
    selectedTab: state.selectedTab,
    search: state.search
  };
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

function purgeTrash() {
  const now = Date.now();
  const monthMs = 30 * 24 * 60 * 60 * 1000;
  state.notes = state.notes.filter((note) => {
    if (!note.isDeleted) return true;
    if (!note.deletedAt) return true;
    return now - new Date(note.deletedAt).getTime() <= monthMs;
  });
  saveState();
}

async function signInWithPassword() {
  const email = (els.authEmail.value || "").trim();
  const password = els.authPassword.value || "";
  if (!email || !password) {
    alert("Wpisz e-mail i hasło.");
    return;
  }
  try {
    await auth.signInWithEmailAndPassword(email, password);
  } catch (err) {
    console.error(err);
    alert("Nie udało się zalogować hasłem. Sprawdź dane albo ustaw hasło w wersji na Macu.");
  }
}

async function registerWithPassword() {
  const email = (els.authEmail.value || "").trim();
  const password = els.authPassword.value || "";
  if (!email || !password) {
    alert("Wpisz e-mail i hasło.");
    return;
  }
  try {
    await auth.createUserWithEmailAndPassword(email, password);
  } catch (err) {
    console.error(err);
    alert("Nie udało się założyć konta. Jeśli ten e-mail już istnieje, ustaw hasło najpierw w aplikacji na Macu.");
  }
}

async function sendPasswordReset() {
  const email = (els.authEmail.value || "").trim();
  if (!email) {
    alert("Wpisz e-mail.");
    return;
  }
  try {
    await auth.sendPasswordResetEmail(email);
    alert("Link do zmiany hasła został wysłany na e-mail.");
  } catch (err) {
    console.error(err);
    alert("Nie udało się wysłać resetu hasła.");
  }
}

function updateAuthUI() {
  const user = state.user;
  if (user) {
    els.authEmail.value = user.email || "";
    els.authEmail.disabled = true;
    els.authPassword.value = "";
    els.authPassword.disabled = true;
    els.signIn.disabled = true;
    els.register.disabled = true;
    els.resetPassword.disabled = false;
    els.signOut.disabled = false;
    const allowedLabels = owners
      .filter((owner) => state.allowedOwners.includes(owner.id))
      .map((owner) => owner.label)
      .join(", ");
    els.authStatus.textContent = `Zalogowana jako: ${user.email || "użytkownik"}${allowedLabels ? ` | Dostęp: ${allowedLabels}` : ""}`;
    document.body.classList.add("signed-in");
  } else {
    els.authEmail.disabled = false;
    els.authPassword.disabled = false;
    els.signIn.disabled = false;
    els.register.disabled = false;
    els.resetPassword.disabled = false;
    els.signOut.disabled = true;
    els.authStatus.textContent = "Zaloguj się mailem i hasłem, aby włączyć synchronizację.";
    document.body.classList.remove("signed-in");
  }
}

async function loadAccessProfile() {
  if (!state.user) return;

  const email = (state.user.email || "").trim().toLowerCase();
  const bootstrapOwners = accessBootstrap(email);
  let allowed = bootstrapOwners;

  try {
    const snap = await db.collection("access").doc(email).get();
    if (snap.exists) {
      const spaces = Array.isArray(snap.data()?.spaces) ? snap.data().spaces : [];
      const sanitized = spaces.filter((space) => owners.some((owner) => owner.id === space && owner.id !== "all"));
      if (sanitized.length > 0) {
        allowed = sanitized;
      }
    }
  } catch (err) {
    console.error(err);
  }

  state.allowedOwners = allowed.length > 0 ? allowed : owners.filter((owner) => owner.id !== "all").map((owner) => owner.id);
  if (!state.allowedOwners.includes(state.selectedOwner)) {
    state.selectedOwner = state.allowedOwners[0] || "bunia";
  }
}

async function subscribeNotes() {
  if (!state.user) return;
  unsubscribeNotes();
  const remoteBySpace = new Map();
  const unsubscribers = [];

  state.allowedOwners.forEach((owner) => {
    const ref = db.collection("spaces").doc(owner).collection("notes");
    const unsubscribe = ref.onSnapshot(async (snapshot) => {
      const remoteNotes = snapshot.docs
        .map((doc) => normalizeRemoteNote(doc))
        .filter(Boolean);

      remoteBySpace.set(owner, remoteNotes);

      const mergedRemote = Array.from(remoteBySpace.values()).flat();
      const localAllowed = state.notes.filter((note) => state.allowedOwners.includes(note.owner));

      if (snapshot.empty && localAllowed.some((note) => note.owner === owner)) {
        const pending = localAllowed.filter((note) => note.owner === owner);
        await Promise.all(pending.map((note) => pushNoteRemote(note)));
        return;
      }

      state.notes = mergeNotes(state.notes, mergedRemote);
      render();
    });

    unsubscribers.push(unsubscribe);
  });

  state.unsubNotes = () => {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  };
}

function unsubscribeNotes() {
  if (state.unsubNotes) {
    state.unsubNotes();
    state.unsubNotes = null;
  }
}

async function pushNoteRemote(note) {
  if (!state.user) return;
  const ref = db.collection("spaces").doc(note.owner).collection("notes").doc(note.id);
  await ref.set(
    serializeNote(note),
    { merge: true }
  );
}

function queueNoteSync(note) {
  if (!state.user) return;
  pushNoteRemote(note).catch((err) => console.error(err));
}

async function deleteNoteRemote(noteId) {
  if (!state.user) return;
  const note = state.notes.find((item) => item.id === noteId);
  if (!note) return;
  const ref = db.collection("spaces").doc(note.owner).collection("notes").doc(noteId);
  await ref.delete();
}

function queueDeleteSync(noteId) {
  if (!state.user) return;
  deleteNoteRemote(noteId).catch((err) => console.error(err));
}

function addFromInput() {
  const raw = els.newNote.value.trim();
  if (!raw) return;

  const parsed = parseInput(raw);
  const now = new Date().toISOString();
  const note = {
    id: uid(),
    text: parsed.text,
    createdAt: now,
    updatedAt: now,
    dueDate: parsed.dueDate,
    isUrgent: parsed.isUrgent,
    isDone: false,
    isDeleted: false,
    deletedAt: null,
    owner: state.selectedOwner
  };

  state.notes.unshift(note);
  els.newNote.value = "";
  queueNoteSync(note);
  saveState();
  render();
}

function render() {
  updateAuthUI();
  renderUtilityState();
  renderOwners();
  renderTabs();
  renderFilters();
  renderInlineEditor();
  renderNotes();
  renderCalendar(els.calendarPanel, false);
  renderCalendar(els.calendarModalBody, true);
  saveState();
}

function renderUtilityState() {
  els.searchRow.classList.toggle("hidden", !state.searchOpen);
  els.settingsMenu.classList.toggle("hidden", !state.settingsOpen);
}

function renderOwners() {
  els.ownerTabs.innerHTML = "";
  owners
    .filter((owner) => owner.id === "all" || state.allowedOwners.includes(owner.id))
    .forEach((owner) => {
    const btn = document.createElement("button");
    btn.textContent = owner.label;
    btn.className = owner.id === state.selectedOwner ? "active" : "";
    btn.addEventListener("click", () => {
      state.selectedOwner = owner.id;
      clearSelection();
      render();
    });
    els.ownerTabs.appendChild(btn);
  });
}

function renderTabs() {
  els.listTabs.innerHTML = "";
  tabs.forEach((tab) => {
    const btn = document.createElement("button");
    btn.textContent = tab.label;
    btn.className = tab.id === state.selectedTab ? "active" : "";
    btn.addEventListener("click", () => {
      state.selectedTab = tab.id;
      clearSelection();
      render();
    });
    els.listTabs.appendChild(btn);
  });
}

function renderFilters() {
  // Filtr zostal usuniety z mobilnego widoku.
}

function renderNotes() {
  const notes = getVisibleNotes();
  renderSelectAll(notes);
  renderBulkActions(notes);

  els.notesList.innerHTML = "";
  if (notes.length === 0) {
    els.empty.textContent = state.selectedTab === "trash" ? "Kosz jest pusty" : "Brak notatek";
    return;
  }
  els.empty.textContent = "";

  notes.forEach((note) => {
    const row = document.createElement("div");
    row.className = "note" + (note.isUrgent ? " urgent" : "") + (isOverdue(note) ? " overdue" : "");
    if (state.selection.has(note.id)) row.classList.add("selected");
    row.dataset.id = note.id;

    row.innerHTML = `
      <button class="done-toggle ${note.isDone ? "done" : ""}" data-action="toggle-done" type="button">${note.isDone ? "✓" : ""}</button>
      <div class="note-body" data-action="edit-note" role="button" tabindex="0" aria-label="Edytuj notatkę">
        <div class="note-text">${escapeHtml(note.text)}</div>
      </div>
      <div class="note-actions">
        <button class="urgent ${note.isUrgent ? "active" : ""}" data-action="toggle-urgent" type="button" aria-label="Pilne">!</button>
        ${state.selectedTab === "trash"
          ? `<button class="trash" data-action="delete-forever" type="button" aria-label="Usuń na zawsze">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M8 7l1 12h6l1-12M10 11v5M14 11v5"/></svg>
            </button>`
          : `<button class="trash" data-action="trash" type="button" aria-label="Kosz">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M8 7l1 12h6l1-12M10 11v5M14 11v5"/></svg>
            </button>`}
        <input class="select" data-action="select" type="checkbox" ${state.selection.has(note.id) ? "checked" : ""} aria-label="Zaznacz" />
      </div>
    `;

    els.notesList.appendChild(row);
  });
}

function renderSelectAll(notes) {
  const allSelected = notes.length > 0 && notes.every((note) => state.selection.has(note.id));
  const anySelected = state.selection.size > 0;
  els.selectAllRow.innerHTML = `
    <span class="select-count">${anySelected ? `Zaznaczono: ${state.selection.size}` : ""}</span>
    <input type="checkbox" id="select-all" ${allSelected ? "checked" : ""} aria-label="Zaznacz wszystkie" />
  `;
  const checkbox = els.selectAllRow.querySelector("#select-all");
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) {
      notes.forEach((note) => state.selection.add(note.id));
    } else {
      state.selection.clear();
    }
    render();
  });
}

function renderBulkActions(notes) {
  const count = state.selection.size;
  if (count === 0) {
    els.bulkActions.className = "bulk-actions";
    els.bulkActions.innerHTML = "";
    return;
  }

  els.bulkActions.className = "bulk-actions active";
  const actions = [];
  if (state.selectedTab === "active") {
    actions.push({ id: "bulk-done", label: "Done" });
    actions.push({ id: "bulk-urgent", label: "Pilne" });
    actions.push({ id: "bulk-unurgent", label: "Usuń pilne" });
    actions.push({ id: "bulk-trash", label: "Do kosza" });
  } else if (state.selectedTab === "done") {
    actions.push({ id: "bulk-restore", label: "Przywróć" });
    actions.push({ id: "bulk-trash", label: "Do kosza" });
  } else if (state.selectedTab === "trash") {
    actions.push({ id: "bulk-restore", label: "Przywróć" });
    actions.push({ id: "bulk-delete", label: "Usuń na stałe" });
  }

  els.bulkActions.innerHTML = actions
    .map((a) => `<button data-action="${a.id}">${a.label}</button>`)
    .join("");

  els.bulkActions.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => handleBulkAction(btn.dataset.action, notes));
  });
}

function handleBulkAction(action, notes) {
  const ids = Array.from(state.selection);
  ids.forEach((id) => {
    const note = state.notes.find((n) => n.id === id);
    if (!note) return;
    switch (action) {
      case "bulk-done":
        note.isDone = true;
        note.updatedAt = new Date().toISOString();
        queueNoteSync(note);
        break;
      case "bulk-urgent":
        note.isUrgent = true;
        note.updatedAt = new Date().toISOString();
        queueNoteSync(note);
        break;
      case "bulk-unurgent":
        note.isUrgent = false;
        note.updatedAt = new Date().toISOString();
        queueNoteSync(note);
        break;
      case "bulk-trash":
        note.isDeleted = true;
        note.deletedAt = new Date().toISOString();
        note.updatedAt = new Date().toISOString();
        queueNoteSync(note);
        break;
      case "bulk-restore":
        note.isDeleted = false;
        note.deletedAt = null;
        note.isDone = false;
        note.updatedAt = new Date().toISOString();
        queueNoteSync(note);
        break;
      case "bulk-delete":
        state.notes = state.notes.filter((n) => n.id !== id);
        queueDeleteSync(id);
        break;
    }
  });
  clearSelection();
  saveState();
  render();
}

function handleNoteClick(e) {
  const actionTarget = e.target.closest("[data-action]");
  const action = actionTarget?.dataset.action;
  if (!action) return;
  const row = e.target.closest(".note");
  if (!row) return;
  const id = row.dataset.id;
  const note = state.notes.find((n) => n.id === id);
  if (!note) return;

  if (action === "toggle-done") {
    note.isDone = !note.isDone;
    note.updatedAt = new Date().toISOString();
    queueNoteSync(note);
    clearSelection();
    saveState();
    render();
  }

  if (action === "edit-note") {
    openInlineEditor(note);
  }

  if (action === "toggle-urgent") {
    note.isUrgent = !note.isUrgent;
    note.updatedAt = new Date().toISOString();
    queueNoteSync(note);
    saveState();
    render();
  }

  if (action === "trash") {
    note.isDeleted = true;
    note.deletedAt = new Date().toISOString();
    note.updatedAt = new Date().toISOString();
    queueNoteSync(note);
    clearSelection();
    saveState();
    render();
  }

  if (action === "delete-forever") {
    state.notes = state.notes.filter((n) => n.id !== id);
    queueDeleteSync(id);
    clearSelection();
    saveState();
    render();
  }
}

function handleNoteChange(e) {
  const action = e.target.dataset.action;
  if (!action) return;
  const row = e.target.closest(".note");
  if (!row) return;
  const id = row.dataset.id;
  const note = state.notes.find((n) => n.id === id);
  if (!note) return;

  if (action === "select") {
    if (e.target.checked) {
      state.selection.add(id);
    } else {
      state.selection.delete(id);
    }
    render();
  }

}

function getVisibleNotes() {
  let items = state.selectedOwner === "all"
    ? state.notes.filter((note) => state.allowedOwners.includes(note.owner))
    : state.notes.filter((note) => note.owner === state.selectedOwner);
  if (state.selectedTab === "active") {
    items = items.filter((n) => !n.isDone && !n.isDeleted);
  } else if (state.selectedTab === "done") {
    items = items.filter((n) => n.isDone && !n.isDeleted);
  } else {
    items = items.filter((n) => n.isDeleted);
  }

  if (state.search.trim()) {
    const q = state.search.toLowerCase();
    items = items.filter((n) => n.text.toLowerCase().includes(q));
  }

  return sortNotes(items);
}

function applyFilter(items) {
  return items;
}

function sortNotes(items) {
  const today = startOfDay(new Date());
  const currentYear = today.getFullYear();

  return items.slice().sort((a, b) => {
    if (a.isUrgent !== b.isUrgent) return a.isUrgent ? -1 : 1;

    const aDue = a.dueDate ? new Date(a.dueDate) : null;
    const bDue = b.dueDate ? new Date(b.dueDate) : null;
    const aOver = aDue ? startOfDay(aDue) < today : false;
    const bOver = bDue ? startOfDay(bDue) < today : false;

    if (aOver !== bOver) return aOver ? -1 : 1;

    const aHas = !!aDue;
    const bHas = !!bDue;
    if (aHas !== bHas) return aHas ? -1 : 1;

    if (aHas && bHas) {
      const aCurrent = aDue.getFullYear() === currentYear;
      const bCurrent = bDue.getFullYear() === currentYear;
      if (aCurrent !== bCurrent) return aCurrent ? -1 : 1;
      if (aDue.getTime() !== bDue.getTime()) return aDue - bDue;
    }

    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}

function renderCalendar(container, isModal) {
  container.innerHTML = "";

  const monthStart = startOfMonth(state.calendarMonth);
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1);
  const weekdayOffset = (firstDay.getDay() + 6) % 7; // Monday first

  const header = document.createElement("div");
  header.className = "calendar-header";

  const prev = document.createElement("button");
  prev.className = "ghost";
  prev.textContent = "‹";
  prev.onclick = () => {
    state.calendarMonth = startOfMonth(new Date(year, month - 1, 1));
    render();
  };

  const next = document.createElement("button");
  next.className = "ghost";
  next.textContent = "›";
  next.onclick = () => {
    state.calendarMonth = startOfMonth(new Date(year, month + 1, 1));
    render();
  };

  const title = document.createElement("div");
  title.textContent = monthStart.toLocaleDateString("pl-PL", { month: "long", year: "numeric" });

  header.append(prev, title, next);

  const grid = document.createElement("div");
  grid.className = "calendar-grid";

  const weekdays = ["Pn", "Wt", "Śr", "Cz", "Pt", "Sb", "Nd"];
  weekdays.forEach((day) => {
    const cell = document.createElement("div");
    cell.className = "calendar-cell weekday";
    cell.textContent = day;
    grid.appendChild(cell);
  });

  for (let i = 0; i < weekdayOffset; i++) {
    const cell = document.createElement("div");
    cell.className = "calendar-cell";
    grid.appendChild(cell);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const cell = document.createElement("div");
    const date = new Date(year, month, day);
    const isSelected = isSameDay(date, new Date(state.filterDate));
    const isToday = isSameDay(date, new Date());
    cell.className = "calendar-cell day" + (isSelected ? " selected" : "") + (isToday ? " today" : "");
    cell.textContent = day;
    cell.onclick = () => {
      state.filterDate = toDateInput(date);
      const prefix = formatShortDatePrefix(date);
      const current = els.newNote.value.trim();
      els.newNote.value = current ? `${prefix} ${stripDatePrefix(current)}` : `${prefix} `;
      if (state.editingNoteId) {
        els.editNoteDate.value = toDateInput(date);
      }
      state.calendarMonth = startOfMonth(date);
      if (isModal) els.calendarDialog.close();
      els.newNote.focus();
    };
    grid.appendChild(cell);
  }

  container.append(header, grid);
}

function openInlineEditor(note) {
  state.editingNoteId = note.id;
  els.editNoteText.value = note.text || "";
  els.editNoteDate.value = note.dueDate ? toDateInput(note.dueDate) : "";
  els.editNoteUrgent.checked = !!note.isUrgent;
  els.editNoteDone.checked = !!note.isDone;
  renderInlineEditor();
  setTimeout(() => els.editNoteText.focus(), 0);
}

function closeInlineEditor() {
  state.editingNoteId = null;
  renderInlineEditor();
}

function renderInlineEditor() {
  const note = state.notes.find((item) => item.id === state.editingNoteId);
  els.editRow.classList.toggle("hidden", !note);
}

function saveInlineEditor() {
  const note = state.notes.find((item) => item.id === state.editingNoteId);
  if (!note) return;

  const raw = els.editNoteText.value.trim();
  if (!raw) return;

  const parsed = parseInput(raw);
  note.text = parsed.text;
  note.isUrgent = els.editNoteUrgent.checked || parsed.isUrgent;
  note.isDone = els.editNoteDone.checked;
  note.dueDate = els.editNoteDate.value ? new Date(els.editNoteDate.value).toISOString() : null;
  if (parsed.dueDate && !els.editNoteDate.value) {
    note.dueDate = parsed.dueDate;
  }
  note.updatedAt = new Date().toISOString();
  queueNoteSync(note);
  saveState();
  closeInlineEditor();
  render();
}

function parseInput(raw) {
  let text = raw.trim();
  let isUrgent = false;
  if (text.startsWith("!")) {
    isUrgent = true;
    text = text.replace(/^!+\s*/, "");
  }

  const dateMatch = text.match(/^\s*(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\.?\s*(.*)$/);
  let dueDate = null;

  if (dateMatch) {
    const day = parseInt(dateMatch[1], 10);
    const month = parseInt(dateMatch[2], 10);
    const year = dateMatch[3] ? parseInt(dateMatch[3], 10) : new Date().getFullYear();
    const rest = dateMatch[4]?.trim() || "";
    const candidate = new Date(year, month - 1, day);
    if (!Number.isNaN(candidate.getTime()) && candidate.getDate() === day) {
      dueDate = candidate.toISOString();
      if (rest) text = rest;
    }
  }

  return { text: text || raw.trim(), dueDate, isUrgent };
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function isOverdue(note) {
  if (!note.dueDate) return false;
  const due = startOfDay(new Date(note.dueDate));
  const today = startOfDay(new Date());
  return due < today;
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatShortDatePrefix(date) {
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function stripDatePrefix(text) {
  return text.replace(/^\s*\d{1,2}\.\d{1,2}(?:\.\d{4})?\.?\s*/, "").trim();
}

function downloadBackup() {
  const payload = {
    exportedAt: new Date().toISOString(),
    notes: state.notes
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `pestapp-backup-${todayISO()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function toDateInput(isoOrDate) {
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  return d.toISOString().slice(0, 10);
}

function todayISO() {
  return toDateInput(new Date());
}

function monthISO(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function clearSelection() {
  state.selection.clear();
}

function escapeHtml(str) {
  return str.replace(/[&<>"]/g, (char) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" };
    return map[char] || char;
  });
}

function mergeNotes(localNotes, remoteNotes) {
  const map = new Map();
  localNotes.forEach((note) => map.set(note.id, note));
  remoteNotes.forEach((note) => {
    const existing = map.get(note.id);
    if (!existing) {
      map.set(note.id, note);
      return;
    }
    const existingDate = new Date(existing.updatedAt || existing.createdAt || 0).getTime();
    const incomingDate = new Date(note.updatedAt || note.createdAt || 0).getTime();
    if (incomingDate >= existingDate) {
      map.set(note.id, note);
    }
  });
  return Array.from(map.values());
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
}

function uid() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function accessBootstrap(email) {
  const allOwnerIds = owners.filter((owner) => owner.id !== "all").map((owner) => owner.id);
  switch ((email || "").trim().toLowerCase()) {
    case "ujczak.s@gmail.com":
      return allOwnerIds;
    case "michalik.gregory@gmail.com":
      return ["greg"];
    case "michalik.zddid@gmail.com":
      return ["michal"];
    default:
      return allOwnerIds;
  }
}

function serializeNote(note) {
  return {
    text: note.text,
    createdAt: firebase.firestore.Timestamp.fromDate(new Date(note.createdAt)),
    updatedAt: firebase.firestore.Timestamp.fromDate(new Date(note.updatedAt)),
    dueDate: note.dueDate ? firebase.firestore.Timestamp.fromDate(new Date(note.dueDate)) : null,
    isUrgent: !!note.isUrgent,
    isPinned: !!note.isPinned,
    isDone: !!note.isDone,
    isDeleted: !!note.isDeleted,
    deletedAt: note.deletedAt ? firebase.firestore.Timestamp.fromDate(new Date(note.deletedAt)) : null,
    owner: note.owner || "bunia",
    recurrence: note.recurrence || "none"
  };
}

function normalizeRemoteNote(doc) {
  const payload = doc.data() || {};
  return {
    id: doc.id,
    text: payload.text || "",
    createdAt: normalizeDate(payload.createdAt) || new Date().toISOString(),
    updatedAt: normalizeDate(payload.updatedAt) || normalizeDate(payload.createdAt) || new Date().toISOString(),
    dueDate: normalizeDate(payload.dueDate),
    isUrgent: !!payload.isUrgent,
    isPinned: !!payload.isPinned,
    isDone: !!payload.isDone,
    isDeleted: !!payload.isDeleted,
    deletedAt: normalizeDate(payload.deletedAt),
    owner: payload.owner || doc.ref.parent.parent?.id || "bunia",
    recurrence: payload.recurrence || "none"
  };
}

function normalizeDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}
