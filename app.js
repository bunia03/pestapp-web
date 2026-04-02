const STORAGE_KEY = "pestapp-notes-v1";
const PREFS_KEY = "pestapp-prefs-v1";
const EMAIL_KEY = "pestapp-email-link";

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
  { id: "office", label: "W biurze" },
  { id: "michal", label: "Michał" }
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
  masterKey: null,
  encryptionSalt: null,
  unsubNotes: null
};

const els = {
  ownerTabs: document.getElementById("owner-tabs"),
  listTabs: document.getElementById("list-tabs"),
  newNote: document.getElementById("new-note"),
  addNote: document.getElementById("add-note"),
  filter: document.getElementById("filter"),
  filterDate: document.getElementById("filter-date"),
  filterMonth: document.getElementById("filter-month"),
  search: document.getElementById("search"),
  notesList: document.getElementById("notes-list"),
  empty: document.getElementById("empty"),
  selectAllRow: document.getElementById("select-all-row"),
  bulkActions: document.getElementById("bulk-actions"),
  calendarPanel: document.getElementById("calendar-panel"),
  calendarToggle: document.getElementById("calendar-toggle"),
  calendarDialog: document.getElementById("calendar-dialog"),
  calendarModalBody: document.getElementById("calendar-modal-body"),
  closeCalendar: document.getElementById("close-calendar"),
  authEmail: document.getElementById("auth-email"),
  sendLink: document.getElementById("send-link"),
  signOut: document.getElementById("sign-out"),
  authStatus: document.getElementById("auth-status")
};

init();

function init() {
  loadState();
  purgeTrash();
  bindEvents();
  bindAuth();
  render();
  registerServiceWorker();
  handleEmailLinkSignIn();
}

function bindEvents() {
  els.addNote.addEventListener("click", addFromInput);
  els.newNote.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addFromInput();
    }
  });

  els.filter.addEventListener("change", (e) => {
    state.filter = e.target.value;
    if (state.filter === "date") {
      state.filterDate = state.filterDate || todayISO();
    }
    if (state.filter === "month") {
      state.filterMonth = state.filterMonth || monthISO(new Date());
    }
    clearSelection();
    render();
  });

  els.filterDate.addEventListener("change", (e) => {
    state.filterDate = e.target.value;
    state.filter = "date";
    state.calendarMonth = startOfMonth(new Date(state.filterDate));
    render();
  });

  els.filterMonth.addEventListener("change", (e) => {
    state.filterMonth = e.target.value;
    state.filter = "month";
    const [year, month] = e.target.value.split("-").map(Number);
    state.calendarMonth = startOfMonth(new Date(year, month - 1, 1));
    render();
  });

  els.search.addEventListener("input", (e) => {
    state.search = e.target.value;
    render();
  });

  els.notesList.addEventListener("click", handleNoteClick);
  els.notesList.addEventListener("change", handleNoteChange);
  els.notesList.addEventListener("keydown", handleNoteKeydown);
  els.notesList.addEventListener("focusout", handleNoteBlur);

  els.calendarToggle.addEventListener("click", () => {
    if (typeof els.calendarDialog.showModal === "function") {
      els.calendarDialog.showModal();
    }
  });
  els.closeCalendar.addEventListener("click", () => els.calendarDialog.close());
}

function bindAuth() {
  els.sendLink.addEventListener("click", sendMagicLink);
  els.signOut.addEventListener("click", async () => {
    await auth.signOut();
    state.user = null;
    state.masterKey = null;
    state.encryptionSalt = null;
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
        await ensureEncryptionKey();
        await subscribeNotes();
      } catch (err) {
        console.error(err);
        alert("Nie udało się uruchomić szyfrowania. Spróbuj ponownie.");
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
  state.calendarMonth = startOfMonth(new Date(state.filterDate));
}

function saveState() {
  if (!state.user) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.notes));
  }
  const prefs = {
    selectedOwner: state.selectedOwner,
    selectedTab: state.selectedTab,
    filter: state.filter,
    filterDate: state.filterDate,
    filterMonth: state.filterMonth,
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

async function handleEmailLinkSignIn() {
  if (!auth.isSignInWithEmailLink(window.location.href)) return;
  let email = localStorage.getItem(EMAIL_KEY);
  if (!email) {
    email = prompt("Podaj adres e-mail użyty do logowania:");
  }
  if (!email) return;
  try {
    await auth.signInWithEmailLink(email, window.location.href);
    localStorage.removeItem(EMAIL_KEY);
    window.history.replaceState({}, document.title, window.location.origin + window.location.pathname);
  } catch (err) {
    alert("Nie udało się zalogować linkiem. Spróbuj ponownie.");
  }
}

async function sendMagicLink() {
  const email = (els.authEmail.value || "").trim();
  if (!email) {
    alert("Wpisz e-mail.");
    return;
  }
  const actionCodeSettings = {
    url: window.location.origin + window.location.pathname,
    handleCodeInApp: true
  };
  try {
    await auth.sendSignInLinkToEmail(email, actionCodeSettings);
    localStorage.setItem(EMAIL_KEY, email);
    els.authStatus.textContent = "Link wysłany. Sprawdź e-mail.";
  } catch (err) {
    console.error(err);
    alert("Nie udało się wysłać linku. Spróbuj ponownie.");
  }
}

function updateAuthUI() {
  const user = state.user;
  if (user) {
    els.authEmail.value = user.email || "";
    els.authEmail.disabled = true;
    els.sendLink.disabled = true;
    els.signOut.disabled = false;
    els.authStatus.textContent = `Zalogowana jako: ${user.email || "użytkownik"}`;
  } else {
    els.authEmail.disabled = false;
    els.sendLink.disabled = false;
    els.signOut.disabled = true;
    els.authStatus.textContent = "Zaloguj się, aby włączyć synchronizację.";
  }
}

async function ensureEncryptionKey() {
  if (!state.user) return;
  const ref = db.collection("users").doc(state.user.uid).collection("meta").doc("encryption");
  const snap = await ref.get();
  if (!snap.exists) {
    const password = await promptForPassword("Ustaw hasło szyfrujące dla notatek:");
    if (!password) throw new Error("Brak hasła");
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(password, salt);
    const verifier = await encryptString("PestApp", key);
    await ref.set({
      salt: toBase64(salt),
      verifier,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    state.masterKey = key;
    state.encryptionSalt = salt;
    return;
  }

  const data = snap.data();
  const salt = fromBase64(data.salt);
  state.encryptionSalt = salt;
  while (true) {
    const password = await promptForPassword("Wpisz hasło szyfrujące:");
    if (!password) throw new Error("Brak hasła");
    const key = await deriveKey(password, salt);
    try {
      const text = await decryptString(data.verifier.data, data.verifier.iv, key);
      if (text !== "PestApp") throw new Error("Błędny tekst");
      state.masterKey = key;
      return;
    } catch {
      alert("Błędne hasło. Spróbuj ponownie.");
    }
  }
}

async function subscribeNotes() {
  if (!state.user) return;
  unsubscribeNotes();
  const ref = db.collection("users").doc(state.user.uid).collection("notes");

  state.unsubNotes = ref.onSnapshot(async (snapshot) => {
    if (!state.masterKey) return;
    const decrypted = await Promise.all(
      snapshot.docs.map(async (doc) => {
        try {
          return await decryptNote(doc);
        } catch (err) {
          console.error(err);
          return null;
        }
      })
    );
    const remoteNotes = decrypted.filter(Boolean);

    if (snapshot.empty && state.notes.length > 0) {
      await Promise.all(state.notes.map((note) => pushNoteRemote(note)));
    }

    state.notes = mergeNotes(state.notes, remoteNotes);
    render();
  });
}

function unsubscribeNotes() {
  if (state.unsubNotes) {
    state.unsubNotes();
    state.unsubNotes = null;
  }
}

async function pushNoteRemote(note) {
  if (!state.user || !state.masterKey) return;
  const encrypted = await encryptString(JSON.stringify(note), state.masterKey);
  const ref = db.collection("users").doc(state.user.uid).collection("notes").doc(note.id);
  await ref.set(
    {
      iv: encrypted.iv,
      data: encrypted.data,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    },
    { merge: true }
  );
}

function queueNoteSync(note) {
  if (!state.user || !state.masterKey) return;
  pushNoteRemote(note).catch((err) => console.error(err));
}

async function deleteNoteRemote(noteId) {
  if (!state.user) return;
  const ref = db.collection("users").doc(state.user.uid).collection("notes").doc(noteId);
  await ref.delete();
}

function queueDeleteSync(noteId) {
  if (!state.user) return;
  deleteNoteRemote(noteId).catch((err) => console.error(err));
}

async function decryptNote(doc) {
  const payload = doc.data();
  const plain = await decryptString(payload.data, payload.iv, state.masterKey);
  const note = JSON.parse(plain);
  if (!note.id) note.id = doc.id;
  if (!note.owner) note.owner = "bunia";
  return note;
}

async function promptForPassword(message) {
  return prompt(message);
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
  renderOwners();
  renderTabs();
  renderFilters();
  renderNotes();
  renderCalendar(els.calendarPanel, false);
  renderCalendar(els.calendarModalBody, true);
  saveState();
}

function renderOwners() {
  els.ownerTabs.innerHTML = "";
  owners.forEach((owner) => {
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
  els.filter.value = state.filter;
  els.filterDate.style.display = state.filter === "date" ? "inline-flex" : "none";
  els.filterMonth.style.display = state.filter === "month" ? "inline-flex" : "none";
  els.filterDate.value = state.filterDate || todayISO();
  els.filterMonth.value = state.filterMonth || monthISO(new Date());
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
      <input class="select" data-action="select" type="checkbox" ${state.selection.has(note.id) ? "checked" : ""} />
      <button class="done-toggle ${note.isDone ? "done" : ""}" data-action="toggle-done">${note.isDone ? "✓" : ""}</button>
      <div class="note-body">
        <textarea class="note-text" data-action="edit-text" rows="1">${escapeHtml(note.text)}</textarea>
        <div class="note-meta">
          <span class="due ${note.dueDate ? (isOverdue(note) ? "overdue" : "upcoming") : ""}">${note.dueDate ? `Do: ${formatDate(note.dueDate)}` : "Brak daty"}</span>
          <input class="date-input" data-action="date-input" type="date" value="${note.dueDate ? toDateInput(note.dueDate) : ""}" />
          <button class="ghost" data-action="clear-date">Usuń datę</button>
        </div>
      </div>
      <div class="note-actions">
        <button class="urgent ${note.isUrgent ? "active" : ""}" data-action="toggle-urgent">!</button>
        ${state.selectedTab === "trash" ? "<button class=\"trash\" data-action=\"delete-forever\">Usuń</button>" : "<button class=\"trash\" data-action=\"trash\">Kosz</button>"}
        ${state.selectedTab === "trash" ? "<button class=\"ghost\" data-action=\"restore\">Przywróć</button>" : ""}
      </div>
    `;

    els.notesList.appendChild(row);
  });
}

function renderSelectAll(notes) {
  const allSelected = notes.length > 0 && notes.every((note) => state.selection.has(note.id));
  const anySelected = state.selection.size > 0;
  els.selectAllRow.innerHTML = `
    <input type="checkbox" id="select-all" ${allSelected ? "checked" : ""} />
    <label for="select-all">Zaznacz wszystkie</label>
    <span>${anySelected ? `Zaznaczono: ${state.selection.size}` : ""}</span>
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
  const action = e.target.dataset.action;
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

  if (action === "restore") {
    note.isDeleted = false;
    note.deletedAt = null;
    note.isDone = false;
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

  if (action === "clear-date") {
    note.dueDate = null;
    note.updatedAt = new Date().toISOString();
    queueNoteSync(note);
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

  if (action === "date-input") {
    if (e.target.value) {
      note.dueDate = new Date(e.target.value).toISOString();
    } else {
      note.dueDate = null;
    }
    note.updatedAt = new Date().toISOString();
    queueNoteSync(note);
    saveState();
    render();
  }
}

function handleNoteKeydown(e) {
  if (e.target.dataset.action !== "edit-text") return;
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    e.target.blur();
  }
}

function handleNoteBlur(e) {
  if (e.target.dataset.action !== "edit-text") return;
  const row = e.target.closest(".note");
  if (!row) return;
  const id = row.dataset.id;
  const note = state.notes.find((n) => n.id === id);
  if (!note) return;

  const raw = e.target.value.trim();
  if (!raw) return;
  const parsed = parseInput(raw);
  note.text = parsed.text;
  if (parsed.dueDate) {
    note.dueDate = parsed.dueDate;
  }
  if (parsed.isUrgent) {
    note.isUrgent = true;
  }
  note.updatedAt = new Date().toISOString();
  queueNoteSync(note);
  saveState();
  render();
}

function getVisibleNotes() {
  let items = state.notes.filter((note) => note.owner === state.selectedOwner);
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

  items = applyFilter(items);
  return sortNotes(items);
}

function applyFilter(items) {
  const today = startOfDay(new Date());
  if (state.filter === "today") {
    return items.filter((n) => n.dueDate && isSameDay(new Date(n.dueDate), today));
  }
  if (state.filter === "week") {
    const end = new Date(today);
    end.setDate(end.getDate() + 7);
    return items.filter((n) => n.dueDate && new Date(n.dueDate) >= today && new Date(n.dueDate) < end);
  }
  if (state.filter === "month") {
    const [year, month] = state.filterMonth.split("-").map(Number);
    return items.filter((n) => {
      if (!n.dueDate) return false;
      const d = new Date(n.dueDate);
      return d.getFullYear() === year && d.getMonth() === month - 1;
    });
  }
  if (state.filter === "date") {
    const selected = new Date(state.filterDate);
    return items.filter((n) => n.dueDate && isSameDay(new Date(n.dueDate), selected));
  }
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
      state.filter = "date";
      state.filterDate = toDateInput(date);
      state.calendarMonth = startOfMonth(date);
      render();
      if (isModal) els.calendarDialog.close();
    };
    grid.appendChild(cell);
  }

  container.append(header, grid);
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

function toBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function fromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptString(text, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(text);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  return { iv: toBase64(iv), data: toBase64(cipher) };
}

async function decryptString(data, iv, key) {
  const decoded = fromBase64(data);
  const ivBytes = fromBase64(iv);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ivBytes }, key, decoded);
  return new TextDecoder().decode(plain);
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
