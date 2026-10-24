/* ديرتي | نظام حسابات السائقين اليومية
   نسخة متكاملة مع عناصر index.html المرسلة.
   استبدل محتوى app.js الحالي بهذا الملف.
*/
"use strict";

const DB_KEY = "deerty_daily_system_v1";
const $ = (id) => document.getElementById(id);

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};

const money = (n) => `${(Number(n) || 0).toLocaleString("en-US",{maximumFractionDigits:2})} ر.س`;
const number = (v) => Math.max(0, Number(v) || 0);
const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2,8)}`;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({
  "&":"&amp;",
  "<":"&lt;",
  ">":"&gt;",
  '"':"&quot;",
  "'":"&#39;"
}[c]));

const dateLabel = (s) => {
  if (!s) return "—";
  const [y,m,d] = String(s).split("-");
  return `${d}/${m}/${y}`;
};

function emptyDB() {
  return {
    version: 1,
    drivers: [],
    items: [],
    invoices: [],
    finalInvoices: [],
    nextInvoiceNumber: 1
  };
}

function loadDB() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return emptyDB();

    const data = JSON.parse(raw);

    return {
      ...emptyDB(),
      ...data,
      drivers: Array.isArray(data.drivers) ? data.drivers : [],
      items: Array.isArray(data.items) ? data.items : [],
      invoices: Array.isArray(data.invoices) ? data.invoices : [],
      finalInvoices: Array.isArray(data.finalInvoices) ? data.finalInvoices : []
    };
  } catch (e) {
    console.error("تعذر قراءة البيانات", e);
    return emptyDB();
  }
}

let db = loadDB();
let accountLines = [];
let singleLines = [];
let editingDriverId = null;
let editingItemId = null;
let confirmCallback = null;
let installPromptEvent = null;

/* =========================
   الحفظ والتنبيهات
========================= */

function saveDB() {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
    renderHeaderStats();
  } catch (e) {
    console.error(e);
    toast("تعذر حفظ البيانات. قد تكون مساحة التخزين ممتلئة.", "error");
  }
}

function toast(message, type = "") {
  const el = $("toast");
  if (!el) return;

  el.textContent = message;
  el.className = `toast show ${type}`.trim();

  clearTimeout(toast._timer);

  toast._timer = setTimeout(() => {
    el.className = "toast";
  }, 2800);
}

/* =========================
   التنقل بين الصفحات
========================= */

function showTab(tab) {
  document.querySelectorAll(".tab-panel, .page-section, [data-tab-panel]").forEach(el => {
    const key = el.dataset.tabPanel || el.id?.replace(/^tab-/, "");
    if (key) el.classList.toggle("active", key === tab);
  });

  document.querySelectorAll("[data-tab], .nav-btn, .tab-btn").forEach(el => {
    const key = el.dataset.tab || el.dataset.target;
    if (key) el.classList.toggle("active", key === tab);
  });

  const panelIds = ["account","single","drivers","items","history","daily"];

  panelIds.forEach(key => {
    const el = $(`tab-${key}`) || $(`${key}Tab`) || $(`${key}-tab`);

    if (
      el &&
      (el.classList.contains("tab-panel") || el.dataset.tabPanel !== undefined)
    ) {
      el.classList.toggle("active", key === tab);
    }
  });

  if (tab === "account") {
    renderDriverOptions();
    renderQuickItems();
    renderAccountRows();
    updateAccountPayment();
  }

  if (tab === "single") {
    renderDriverOptions();
    renderSingleItemOptions();
    renderSingleRows();
    updateSinglePayment();
  }

  if (tab === "drivers") renderDrivers();
  if (tab === "items") renderItems();
  if (tab === "history") renderHistory();
  if (tab === "daily") renderDailyReport();
}

/* =========================
   نافذة التأكيد
========================= */

function showConfirm(title, message, action, buttonText = "تأكيد") {
  confirmCallback = action;

  if ($("confirmTitle")) $("confirmTitle").textContent = title;
  if ($("confirmMessage")) $("confirmMessage").textContent = message;

  if ($("confirmActionBtn")) {
    $("confirmActionBtn").textContent = buttonText;

    $("confirmActionBtn").onclick = () => {
      const fn = confirmCallback;
      closeConfirm();

      if (typeof fn === "function") fn();
    };
  } else {
    if (window.confirm(`${title}\n${message}`) && typeof action === "function") {
      action();
    }
  }

  const modal = $("confirmModal") || $("confirmDialog") || $("confirmBox");

  if (modal) modal.classList.add("open", "show", "active");
}

function closeConfirm() {
  confirmCallback = null;

  const modal = $("confirmModal") || $("confirmDialog") || $("confirmBox");

  if (modal) modal.classList.remove("open", "show", "active");
}

function clearAccountConfirm() {
  showConfirm(
    "مسح الحساب الحالي",
    "سيتم مسح الأصناف غير المحفوظة من الحساب الحالي فقط.",
    () => {
      accountLines = [];

      if ($("accountNote")) $("accountNote").value = "";
      if ($("paymentCash")) $("paymentCash").value = "";
      if ($("paymentCard")) $("paymentCard").value = "";

      renderAccountRows();
      updateAccountPayment();

      toast("تم مسح الحساب الحالي");
    },
    "مسح الحساب"
  );
}

function clearSingleConfirm() {
  showConfirm(
    "مسح الفاتورة",
    "سيتم مسح الأصناف غير المحفوظة من الفاتورة الحالية.",
    () => {
      singleLines = [];

      if ($("singleNote")) $("singleNote").value = "";
      if ($("singleCash")) $("singleCash").value = "";
      if ($("singleCard")) $("singleCard").value = "";

      renderSingleRows();
      updateSinglePayment();

      toast("تم مسح الفاتورة");
    },
    "مسح"
  );
}

/* =========================
   السائقون
========================= */

function getDriver(id) {
  return db.drivers.find(d => String(d.id) === String(id));
}

function getItem(id) {
  return db.items.find(i => String(i.id) === String(id));
}

function selectedDriverId() {
  return $("accountDriver")?.value || "";
}

function renderDriverOptions() {
  ["accountDriver","singleDriver"].forEach(id => {
    const select = $(id);
    if (!select) return;

    const old = select.value;

    select.innerHTML =
      `<option value="">اختر السائق</option>` +
      db.drivers
        .filter(d => d.active !== false)
        .map(d => `<option value="${esc(d.id)}">${esc(d.name)}</option>`)
        .join("");

    if (db.drivers.some(d => String(d.id) === String(old) && d.active !== false)) {
      select.value = old;
    }
  });
}

function addDriver() {
  const nameEl = $("driverName");
  const phoneEl = $("driverPhone");

  const name = nameEl?.value.trim();
  const phone = phoneEl?.value.trim() || "";

  if (!name) return toast("اكتب اسم السائق أولاً", "error");

  const duplicate = db.drivers.some(d =>
    d.name.trim().toLowerCase() === name.toLowerCase() &&
    String(d.id) !== String(editingDriverId)
  );

  if (duplicate) return toast("اسم السائق موجود مسبقاً", "error");

  if (editingDriverId) {
    const driver = getDriver(editingDriverId);

    if (driver) {
      driver.name = name;
      driver.phone = phone;
    }

    editingDriverId = null;

    const btn = $("driverSaveBtn") || $("addDriverBtn");
    if (btn) btn.textContent = "إضافة سائق";
  } else {
    db.drivers.push({
      id: uid(),
      name,
      phone,
      active: true,
      createdAt: new Date().toISOString()
    });
  }

  if (nameEl) nameEl.value = "";
  if (phoneEl) phoneEl.value = "";

  saveDB();
  renderDrivers();
  renderDriverOptions();

  toast("تم حفظ بيانات السائق");
}

function editDriver(id) {
  const d = getDriver(id);
  if (!d) return;

  editingDriverId = d.id;

  if ($("driverName")) $("driverName").value = d.name;
  if ($("driverPhone")) $("driverPhone").value = d.phone || "";

  const btn = $("driverSaveBtn") || $("addDriverBtn");
  if (btn) btn.textContent = "حفظ التعديل";

  showTab("drivers");
}

function deleteDriver(id) {
  const d = getDriver(id);
  if (!d) return;

  const used =
    db.invoices.some(i => String(i.driverId) === String(id)) ||
    db.finalInvoices.some(i => String(i.driverId) === String(id));

  if (used) {
    showConfirm(
      "تعطيل السائق",
      `لدى ${d.name} فواتير محفوظة. سيتم تعطيل السائق بدلاً من حذفه حتى تبقى السجلات محفوظة.`,
      () => {
        d.active = false;

        saveDB();
        renderDrivers();
        renderDriverOptions();

        toast("تم تعطيل السائق");
      },
      "تعطيل"
    );
  } else {
    showConfirm(
      "حذف السائق",
      `هل تريد حذف السائق ${d.name}؟`,
      () => {
        db.drivers = db.drivers.filter(x => String(x.id) !== String(id));

        saveDB();
        renderDrivers();
        renderDriverOptions();

        toast("تم حذف السائق");
      },
      "حذف"
    );
  }
}

function renderDrivers() {
  const body = $("driversRows") || $("driverRows") || $("driversTableBody");

  if (body) {
    body.innerHTML = db.drivers.map(d => `
      <tr>
        <td>${esc(d.name)}</td>
        <td>${esc(d.phone || "—")}</td>
        <td>${d.active === false ? "غير نشط" : "نشط"}</td>
        <td>
          <button type="button" onclick="editDriver('${esc(d.id)}')">تعديل</button>
          <button type="button" onclick="deleteDriver('${esc(d.id)}')">
            ${d.active === false ? "حذف" : "حذف/تعطيل"}
          </button>
        </td>
      </tr>
    `).join("") || `<tr><td colspan="4">لا يوجد سائقون حتى الآن</td></tr>`;
  }

  const count = $("driverCount");

  if (count) {
    count.textContent = db.drivers.filter(d => d.active !== false).length;
  }
}

/* =========================
   الأصناف
========================= */

function addItem() {
  const name = $("itemName")?.value.trim();
  const price = Number($("itemPrice")?.value);

  if (!name) return toast("اكتب اسم الصنف", "error");
  if (!Number.isFinite(price) || price < 0) return toast("أدخل سعراً صحيحاً", "error");

  const category = $("itemCategory")?.value.trim() || "";

  if (editingItemId) {
    const item = getItem(editingItemId);

    if (item) Object.assign(item, { name, price, category });

    editingItemId = null;

    const btn = $("itemSaveBtn") || $("addItemBtn");
    if (btn) btn.textContent = "إضافة صنف";
  } else {
    db.items.push({
      id: uid(),
      name,
      price,
      category,
      active: true
    });
  }

  if ($("itemName")) $("itemName").value = "";
  if ($("itemPrice")) $("itemPrice").value = "";
  if ($("itemCategory")) $("itemCategory").value = "";

  saveDB();
  renderItems();
  renderQuickItems();
  renderSingleItemOptions();

  toast("تم حفظ الصنف");
}

function editItem(id) {
  const item = getItem(id);
  if (!item) return;

  editingItemId = item.id;

  if ($("itemName")) $("itemName").value = item.name;
  if ($("itemPrice")) $("itemPrice").value = item.price;
  if ($("itemCategory")) $("itemCategory").value = item.category || "";

  const btn = $("itemSaveBtn") || $("addItemBtn");
  if (btn) btn.textContent = "حفظ التعديل";

  showTab("items");
}

function deleteItem(id) {
  const item = getItem(id);
  if (!item) return;

  showConfirm(
    "حذف الصنف",
    `هل تريد حذف ${item.name}؟ لن تتأثر الفواتير القديمة.`,
    () => {
      db.items = db.items.filter(x => String(x.id) !== String(id));

      saveDB();
      renderItems();
      renderQuickItems();
      renderSingleItemOptions();

      toast("تم حذف الصنف");
    },
    "حذف"
  );
}

function renderItems() {
  const body = $("itemsRows") || $("itemRows") || $("itemsTableBody");

  if (body) {
    body.innerHTML = db.items.map(i => `
      <tr>
        <td>${esc(i.name)}</td>
        <td>${esc(i.category || "—")}</td>
        <td>${money(i.price)}</td>
        <td>
          <button type="button" onclick="editItem('${esc(i.id)}')">تعديل</button>
          <button type="button" onclick="deleteItem('${esc(i.id)}')">حذف</button>
        </td>
      </tr>
    `).join("") || `<tr><td colspan="4">لا توجد أصناف. أضف الأصناف من هذه الصفحة.</td></tr>`;
  }

  const count = $("itemCount");
  if (count) count.textContent = db.items.length;
}

/* =========================
   حساب السائق اليومي
========================= */

function addAccountItem(itemId, qty = 1) {
  const item = getItem(itemId);
  if (!item) return;

  const existing = accountLines.find(x => String(x.itemId) === String(itemId));

  if (existing) {
    existing.qty += Math.max(1, Number(qty) || 1);
  } else {
    accountLines.push({
      id: uid(),
      itemId: item.id,
      name: item.name,
      price: Number(item.price) || 0,
      qty: Math.max(1, Number(qty) || 1)
    });
  }

  renderAccountRows();
  updateAccountPayment();
}

function renderQuickItems() {
  const box = $("quickItems");
  if (!box) return;

  const search = ($("productSearch")?.value || "").trim().toLowerCase();

  const items = db.items.filter(i =>
    i.active !== false &&
    (!search || `${i.name} ${i.category || ""}`.toLowerCase().includes(search))
  );

  box.innerHTML = items.map(i => `
    <button type="button" class="quick-item" onclick="addAccountItem('${esc(i.id)}')">
      <span>${esc(i.name)}</span>
      <strong>${money(i.price)}</strong>
    </button>
  `).join("") || `<p class="muted">لا توجد أصناف مطابقة. أضف الأصناف من تبويب الأصناف.</p>`;
}

function changeLineQty(kind, lineId, delta) {
  const lines = kind === "single" ? singleLines : accountLines;
  const line = lines.find(x => String(x.id) === String(lineId));

  if (!line) return;

  line.qty += delta;

  if (line.qty <= 0) {
    lines.splice(lines.indexOf(line), 1);
  }

  if (kind === "single") {
    renderSingleRows();
    updateSinglePayment();
  } else {
    renderAccountRows();
    updateAccountPayment();
  }
}

function setLineQty(kind, lineId, value) {
  const lines = kind === "single" ? singleLines : accountLines;
  const line = lines.find(x => String(x.id) === String(lineId));

  if (!line) return;

  line.qty = Math.max(1, Number(value) || 1);

  if (kind === "single") {
    renderSingleRows();
    updateSinglePayment();
  } else {
    renderAccountRows();
    updateAccountPayment();
  }
}

function removeLine(kind, lineId) {
  if (kind === "single") {
    singleLines = singleLines.filter(x => String(x.id) !== String(lineId));
    renderSingleRows();
    updateSinglePayment();
  } else {
    accountLines = accountLines.filter(x => String(x.id) !== String(lineId));
    renderAccountRows();
    updateAccountPayment();
  }
}

function linesTotal(lines) {
  return lines.reduce((sum, l) => sum + number(l.price) * Math.max(0, Number(l.qty) || 0), 0);
}

function renderLineTable(targetId, lines, kind) {
  const body = $(targetId);
  if (!body) return;

  body.innerHTML = lines.map(l => `
    <tr>
      <td>${esc(l.name)}</td>
      <td>${money(l.price)}</td>
      <td class="qty-control">
        <button type="button" onclick="changeLineQty('${kind}','${esc(l.id)}',-1)">−</button>
        <input aria-label="الكمية" type="number" min="1" value="${l.qty}"
          onchange="setLineQty('${kind}','${esc(l.id)}',this.value)">
        <button type="button" onclick="changeLineQty('${kind}','${esc(l.id)}',1)">+</button>
      </td>
      <td>${money(l.price * l.qty)}</td>
      <td><button type="button" onclick="removeLine('${kind}','${esc(l.id)}')">حذف</button></td>
    </tr>
  `).join("") || `<tr><td colspan="5">لم تتم إضافة أصناف</td></tr>`;
}

function renderAccountRows() {
  renderLineTable("accountRows", accountLines, "account");
}

function updateAccountPayment() {
  const total = linesTotal(accountLines);
  const cash = number($("paymentCash")?.value);
  const card = number($("paymentCard")?.value);

  if ($("accountTotal")) $("accountTotal").textContent = money(total);
  if ($("paymentPaid")) $("paymentPaid").textContent = money(cash + card);
  if ($("paymentRemaining")) $("paymentRemaining").textContent = money(Math.max(0, total - cash - card));
}

function closeAccount() {
  const driverId = selectedDriverId();

  if (!driverId) return toast("اختر السائق أولاً", "error");
  if (!accountLines.length) return toast("أضف صنفاً واحداً على الأقل", "error");

  const total = linesTotal(accountLines);
  const cash = number($("paymentCash")?.value);
  const card = number($("paymentCard")?.value);

  if (cash + card > total + 0.001) {
    return toast("المبلغ المستلم أكبر من إجمالي الحساب", "error");
  }

  const invoice = {
    id: uid(),
    number: db.nextInvoiceNumber++,
    type: "account",
    driverId,
    driverName: getDriver(driverId)?.name || "سائق محذوف",
    date: todayISO(),
    createdAt: new Date().toISOString(),
    lines: accountLines.map(l => ({ ...l })),
    subtotal: total,
    discount: 0,
    total,
    cash,
    card,
    remaining: Math.max(0, total - cash - card),
    note: $("accountNote")?.value.trim() || "",
    finalizedBy: null
  };

  db.invoices.push(invoice);
  saveDB();

  accountLines = [];

  if ($("accountNote")) $("accountNote").value = "";
  if ($("paymentCash")) $("paymentCash").value = "";
  if ($("paymentCard")) $("paymentCard").value = "";

  renderAccountRows();
  updateAccountPayment();
  renderHistory();
  renderDailyReport();

  toast(`تم حفظ الحساب رقم ${invoice.number}`);
  printInvoice(invoice, false);
}

/* =========================
   الفواتير المستقلة
========================= */

function renderSingleItemOptions() {
  const select = $("singleItem");
  if (!select) return;

  const old = select.value;

  select.innerHTML =
    `<option value="">اختر الصنف</option>` +
    db.items.filter(i => i.active !== false)
      .map(i => `<option value="${esc(i.id)}">${esc(i.name)} — ${money(i.price)}</option>`)
      .join("");

  if (getItem(old)) select.value = old;

  if ($("singlePrice") && select.value && !$("singlePrice").value) {
    $("singlePrice").value = getItem(select.value)?.price || "";
  }
}

function addSingleLine() {
  const id = $("singleItem")?.value;
  const item = getItem(id);
  const name = item?.name || $("singleItemName")?.value.trim();
  const price = Number($("singlePrice")?.value ?? item?.price);
  const qty = Math.max(1, Number($("singleQty")?.value) || 1);

  if (!name) return toast("اختر الصنف أولاً", "error");
  if (!Number.isFinite(price) || price < 0) return toast("أدخل السعر بشكل صحيح", "error");

  singleLines.push({
    id: uid(),
    itemId: id || null,
    name,
    price,
    qty
  });

  if ($("singleQty")) $("singleQty").value = 1;

  renderSingleRows();
  updateSinglePayment();
}

function renderSingleRows() {
  renderLineTable("singleRows", singleLines, "single");
}

function updateSinglePayment() {
  const total = linesTotal(singleLines);
  const cash = number($("singleCash")?.value);
  const card = number($("singleCard")?.value);

  if ($("singleTotal")) $("singleTotal").textContent = money(total);
  if ($("singleRemaining")) $("singleRemaining").textContent = money(Math.max(0, total - cash - card));
}

function saveSingleInvoice() {
  const driverId = $("singleDriver")?.value;

  if (!driverId) return toast("اختر السائق أولاً", "error");
  if (!singleLines.length) return toast("أضف صنفاً واحداً على الأقل", "error");

  const total = linesTotal(singleLines);
  const cash = number($("singleCash")?.value);
  const card = number($("singleCard")?.value);

  if (cash + card > total + 0.001) {
    return toast("المبلغ المستلم أكبر من إجمالي الفاتورة", "error");
  }

  const invoice = {
    id: uid(),
    number: db.nextInvoiceNumber++,
    type: "single",
    driverId,
    driverName: getDriver(driverId)?.name || "سائق محذوف",
    date: todayISO(),
    createdAt: new Date().toISOString(),
    lines: singleLines.map(l => ({ ...l })),
    subtotal: total,
    discount: 0,
    total,
    cash,
    card,
    remaining: Math.max(0, total - cash - card),
    note: $("singleNote")?.value.trim() || "",
    finalizedBy: null
  };

  db.invoices.push(invoice);
  saveDB();

  singleLines = [];

  ["singleNote", "singleCash", "singleCard"].forEach(id => {
    if ($(id)) $(id).value = "";
  });

  renderSingleRows();
  updateSinglePayment();
  renderHistory();
  renderDailyReport();

  toast(`تم حفظ الفاتورة رقم ${invoice.number}`);
  printInvoice(invoice, false);
}

/* =========================
   الفاتورة النهائية وتجميع الحسابات
========================= */

function getDriverOpenInvoices(driverId, date = todayISO()) {
  return db.invoices.filter(i =>
    String(i.driverId) === String(driverId) &&
    i.date === date &&
    !i.finalizedBy
  );
}

function prepareFinalInvoice() {
  const driverId = selectedDriverId();

  if (!driverId) return toast("اختر السائق أولاً", "error");

  const openInvoices = getDriverOpenInvoices(driverId);

  const lines = openInvoices.flatMap(inv =>
    (inv.lines || []).map(l => ({
      ...l,
      id: uid(),
      sourceInvoiceId: inv.id
    }))
  );

  const draftLines = accountLines.map(l => ({ ...l, id: uid() }));
  const combined = [...lines, ...draftLines];

  if (!combined.length) {
    return toast("لا توجد أصناف مفتوحة لهذا السائق", "error");
  }

  const priorCash =
    openInvoices.reduce((s, i) => s + number(i.cash), 0) +
    number($("paymentCash")?.value);

  const priorCard =
    openInvoices.reduce((s, i) => s + number(i.card), 0) +
    number($("paymentCard")?.value);

  const panel = $("finalInvoicePanel");

  if (panel) panel.classList.add("open", "show", "active");

  if ($("finalDriverName")) {
    $("finalDriverName").textContent = getDriver(driverId)?.name || "";
  }

  window.finalInvoiceDraft = {
    driverId,
    date: todayISO(),
    sourceInvoiceIds: openInvoices.map(i => i.id),
    lines: combined,
    originalSubtotal: linesTotal(combined),
    priorCash,
    priorCard,
    sourceAccountDraft: draftLines.length > 0
  };

  renderFinalInvoiceRows();

  if ($("finalDiscount")) $("finalDiscount").value = 0;
  if ($("finalCash")) $("finalCash").value = priorCash;
  if ($("finalCard")) $("finalCard").value = priorCard;
  if ($("finalNote")) $("finalNote").value = "";

  updateFinalInvoice();
  panel?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderFinalInvoiceRows() {
  const body = $("finalInvoiceRows");
  const draft = window.finalInvoiceDraft;

  if (!body || !draft) return;

  body.innerHTML = draft.lines.map(l => `
    <tr>
      <td>${esc(l.name)}</td>
      <td>${money(l.price)}</td>
      <td>${l.qty}</td>
      <td>${money(l.price * l.qty)}</td>
    </tr>
  `).join("") || `<tr><td colspan="4">لا توجد أصناف</td></tr>`;
}

function updateFinalInvoice() {
  const draft = window.finalInvoiceDraft;
  if (!draft) return;

  const subtotal = linesTotal(draft.lines);
  const discount = Math.min(subtotal, number($("finalDiscount")?.value));
  const total = Math.max(0, subtotal - discount);
  const cash = number($("finalCash")?.value);
  const card = number($("finalCard")?.value);
  const credit = Math.max(0, total - cash - card);

  if ($("finalTotal")) $("finalTotal").textContent = money(total);
  if ($("finalCredit")) $("finalCredit").textContent = money(credit);

  const discountText = $("finalDiscountValue");
  if (discountText) discountText.textContent = money(discount);

  return {
    subtotal,
    discount,
    total,
    cash,
    card,
    remaining: credit,
    overpaid: Math.max(0, cash + card - total)
  };
}

function saveFinalInvoice() {
  const draft = window.finalInvoiceDraft;

  if (!draft) return toast("لا توجد فاتورة نهائية مفتوحة", "error");

  const amounts = updateFinalInvoice();

  if (amounts.overpaid > 0.001) {
    return toast("إجمالي النقد والشبكة أكبر من الإجمالي بعد الخصم. راجع الخصم أو المبالغ.", "error");
  }

  const invoice = {
    id: uid(),
    number: db.nextInvoiceNumber++,
    type: "final",
    driverId: draft.driverId,
    driverName: getDriver(draft.driverId)?.name || "سائق محذوف",
    date: draft.date,
    createdAt: new Date().toISOString(),
    lines: draft.lines.map(l => ({ ...l })),
    subtotal: amounts.subtotal,
    discount: amounts.discount,
    total: amounts.total,
    cash: amounts.cash,
    card: amounts.card,
    remaining: amounts.remaining,
    note: $("finalNote")?.value.trim() || "",
    sourceInvoiceIds: [...draft.sourceInvoiceIds]
  };

  db.invoices.forEach(i => {
    if (draft.sourceInvoiceIds.includes(i.id)) i.finalizedBy = invoice.id;
  });

  db.finalInvoices.push(invoice);

  if (draft.sourceAccountDraft && accountLines.length) {
    accountLines = [];

    if ($("accountNote")) $("accountNote").value = "";
    if ($("paymentCash")) $("paymentCash").value = "";
    if ($("paymentCard")) $("paymentCard").value = "";

    renderAccountRows();
    updateAccountPayment();
  }

  saveDB();
  cancelFinalInvoice();
  renderHistory();
  renderDailyReport();

  toast(`تم حفظ الفاتورة النهائية رقم ${invoice.number}`);
  printInvoice(invoice, true);
}

function cancelFinalInvoice() {
  window.finalInvoiceDraft = null;

  const panel = $("finalInvoicePanel");

  if (panel) panel.classList.remove("open", "show", "active");
}

/* =========================
   التقارير والإحصائيات
========================= */

function paymentValues(invoice) {
  const total = number(invoice.total ?? invoice.subtotal);
  const cash = number(invoice.cash);
  const card = number(invoice.card);

  return {
    total,
    cash,
    card,
    paid: cash + card,
    remaining: Math.max(0, total - cash - card)
  };
}

function getEffectiveInvoicesForDay(date = todayISO()) {
  const normal = db.invoices.filter(i => i.date === date && !i.finalizedBy);
  const finals = db.finalInvoices.filter(i => i.date === date);

  return [...normal, ...finals];
}

function getDayStats(date = todayISO()) {
  const invoices = getEffectiveInvoicesForDay(date);

  return invoices.reduce((a, i) => {
    a.total += number(i.total);
    a.cash += number(i.cash);
    a.card += number(i.card);
    a.credit += Math.max(0, number(i.total) - number(i.cash) - number(i.card));
    a.count++;
    return a;
  }, {
    total: 0,
    cash: 0,
    card: 0,
    credit: 0,
    count: 0
  });
}

function renderHistory() {
  const body = $("historyRows");
  if (!body) return;

  const search = ($("historySearch")?.value || "").trim().toLowerCase();
  const type = $("historyType")?.value || "all";

  let rows = [...db.invoices, ...db.finalInvoices].sort((a, b) =>
    (b.createdAt || "").localeCompare(a.createdAt || "")
  );

  rows = rows.filter(i => {
    const isFinal = i.type === "final" || db.finalInvoices.some(f => f.id === i.id);

    if (type === "single" && isFinal) return false;
    if (type === "final" && !isFinal) return false;

    const hay = `${i.number || ""} ${i.driverName || ""} ${i.note || ""} ${i.date || ""}`.toLowerCase();

    return !search || hay.includes(search);
  });

  body.innerHTML = rows.map(i => {
    const final = i.type === "final" || db.finalInvoices.some(f => f.id === i.id);
    const linked = !!i.finalizedBy;

    return `
      <tr>
        <td>${esc(i.number || "—")}</td>
        <td>${dateLabel(i.date)}</td>
        <td>${esc(i.driverName || "—")}</td>
        <td>${final ? "نهائية" : i.type === "account" ? "حساب يومي" : "فاتورة مستقلة"}${linked ? " (مجمعة في نهائية)" : ""}</td>
        <td>${money(i.total)}</td>
        <td>${money(i.cash)}</td>
        <td>${money(i.card)}</td>
        <td>${money(Math.max(0, number(i.total) - number(i.cash) - number(i.card)))}</td>
        <td>
          <button type="button" onclick="printInvoiceById('${esc(i.id)}')">طباعة</button>
          ${!linked && !final ? `<button type="button" onclick="deleteInvoice('${esc(i.id)}')">حذف</button>` : ""}
        </td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="9">لا توجد فواتير مطابقة</td></tr>`;
}

function printInvoiceById(id) {
  const inv = db.invoices.find(i => i.id === id) || db.finalInvoices.find(i => i.id === id);
  if (inv) printInvoice(inv, inv.type === "final");
}

function deleteInvoice(id) {
  const inv = db.invoices.find(i => i.id === id);

  if (!inv || inv.finalizedBy) {
    return toast("لا يمكن حذف فاتورة مرتبطة بفاتورة نهائية", "error");
  }

  showConfirm("حذف الفاتورة", `حذف الفاتورة رقم ${inv.number}؟`, () => {
    db.invoices = db.invoices.filter(i => i.id !== id);

    saveDB();
    renderHistory();
    renderDailyReport();

    toast("تم حذف الفاتورة");
  }, "حذف");
}

function renderDailyReport() {
  const date = $("reportDate")?.value || todayISO();

  if ($("reportDate") && !$("reportDate").value) {
    $("reportDate").value = date;
  }

  const stats = getDayStats(date);

  const assign = (id, val) => {
    if ($(id)) $(id).textContent = val;
  };

  assign("dailyTotal", money(stats.total));
  assign("dailyCash", money(stats.cash));
  assign("dailyCard", money(stats.card));
  assign("dailyCredit", money(stats.credit));
  assign("dailyInvoiceCount", stats.count);

  const body = $("dayRows");

  if (body) {
    const rows = getEffectiveInvoicesForDay(date).sort((a, b) =>
      (a.createdAt || "").localeCompare(b.createdAt || "")
    );

    body.innerHTML = rows.map(i => `
      <tr>
        <td>${esc(i.number || "—")}</td>
        <td>${esc(i.driverName || "—")}</td>
        <td>${i.type === "final" ? "نهائية" : i.type === "account" ? "حساب يومي" : "مستقلة"}</td>
        <td>${money(i.total)}</td>
        <td>${money(i.cash)}</td>
        <td>${money(i.card)}</td>
        <td>${money(Math.max(0, i.total - i.cash - i.card))}</td>
      </tr>
    `).join("") || `<tr><td colspan="7">لا توجد فواتير في هذا اليوم</td></tr>`;
  }
}

function clearAllAccountsConfirm() {
  showConfirm(
    "مسح جميع الحسابات",
    "تحذير: سيتم حذف جميع الفواتير والحسابات النهائية نهائياً من هذا الجهاز. لا يمكن التراجع عن العملية.",
    clearAllAccounts,
    "حذف الجميع"
  );
}

function clearAllAccounts() {
  db.invoices = [];
  db.finalInvoices = [];
  db.nextInvoiceNumber = 1;

  accountLines = [];
  singleLines = [];

  cancelFinalInvoice();

  saveDB();

  renderAccountRows();
  renderSingleRows();
  updateAccountPayment();
  updateSinglePayment();
  renderHistory();
  renderDailyReport();

  toast("تم مسح جميع الحسابات والفواتير");
}

function renderHeaderStats() {
  const drivers = db.drivers.filter(d => d.active !== false).length;
  const stats = getDayStats(todayISO());

  if ($("headerDriverCount")) $("headerDriverCount").textContent = drivers;
  if ($("headerTodayTotal")) $("headerTodayTotal").textContent = money(stats.total);
  if ($("driverCount")) $("driverCount").textContent = drivers;
}

function renderAll() {
  renderDrivers();
  renderItems();
  renderDriverOptions();
  renderQuickItems();
  renderSingleItemOptions();
  renderAccountRows();
  renderSingleRows();
  updateAccountPayment();
  updateSinglePayment();
  renderHistory();
  renderDailyReport();
  renderHeaderStats();
}

/* =========================
   الطباعة
========================= */

function printInvoice(invoice, isFinal = false) {
  const area = $("printArea");

  if (!area) {
    window.print();
    return;
  }

  const total = number(invoice.total);
  const cash = number(invoice.cash);
  const card = number(invoice.card);

  const rows = (invoice.lines || []).map(l => `
    <tr>
      <td>${esc(l.name)}</td>
      <td>${l.qty}</td>
      <td>${money(l.price)}</td>
      <td>${money(l.price * l.qty)}</td>
    </tr>
  `).join("");

  area.innerHTML = `
    <div class="print-receipt" dir="rtl">
      <h2>ديرتي</h2>
      <h3>${isFinal ? "الفاتورة النهائية" : "فاتورة حساب سائق"}</h3>
      <p>رقم الفاتورة: ${esc(invoice.number || "—")}</p>
      <p>التاريخ: ${dateLabel(invoice.date)}
        ${invoice.createdAt ? new Date(invoice.createdAt).toLocaleTimeString("ar-SA",{hour:"2-digit",minute:"2-digit"}) : ""}
      </p>
      <p>السائق: ${esc(invoice.driverName || "—")}</p>
      <hr>
      <table>
        <thead>
          <tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <hr>
      <p>المجموع: ${money(invoice.subtotal ?? total)}</p>
      <p>الخصم: ${money(invoice.discount || 0)}</p>
      <h3>الإجمالي: ${money(total)}</h3>
      <p>نقداً: ${money(cash)}</p>
      <p>شبكة: ${money(card)}</p>
      <p>المتبقي: ${money(Math.max(0, total - cash - card))}</p>
      ${invoice.note ? `<p>ملاحظات: ${esc(invoice.note)}</p>` : ""}
      <p class="thanks">شكراً لكم</p>
    </div>
  `;

  window.print();
}

function printDailyReport() {
  const date = $("reportDate")?.value || todayISO();
  const stats = getDayStats(date);
  const area = $("printArea");

  if (!area) {
    window.print();
    return;
  }

  const rows = getEffectiveInvoicesForDay(date).map(i => `
    <tr>
      <td>${esc(i.number)}</td>
      <td>${esc(i.driverName)}</td>
      <td>${money(i.total)}</td>
      <td>${money(i.cash)}</td>
      <td>${money(i.card)}</td>
      <td>${money(Math.max(0, i.total - i.cash - i.card))}</td>
    </tr>
  `).join("");

  area.innerHTML = `
    <div class="print-receipt daily-print" dir="rtl">
      <h2>ديرتي</h2>
      <h3>تقرير الحسابات اليومية</h3>
      <p>التاريخ: ${dateLabel(date)}</p>
      <p>إجمالي الفواتير: ${stats.count}</p>
      <p>الإجمالي: ${money(stats.total)}</p>
      <p>النقد: ${money(stats.cash)}</p>
      <p>الشبكة: ${money(stats.card)}</p>
      <p>الآجل/المتبقي: ${money(stats.credit)}</p>
      <table>
        <thead>
          <tr><th>رقم</th><th>السائق</th><th>الإجمالي</th><th>نقد</th><th>شبكة</th><th>متبقي</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  window.print();
}

/* =========================
   التشغيل والتثبيت
========================= */

function initializeApp() {
  if ($("reportDate") && !$("reportDate").value) {
    $("reportDate").value = todayISO();
  }

  renderAll();

  $("productSearch")?.addEventListener("input", renderQuickItems);
  $("paymentCash")?.addEventListener("input", updateAccountPayment);
  $("paymentCard")?.addEventListener("input", updateAccountPayment);
  $("singleCash")?.addEventListener("input", updateSinglePayment);
  $("singleCard")?.addEventListener("input", updateSinglePayment);

  $("singleItem")?.addEventListener("change", () => {
    const item = getItem($("singleItem").value);
    if (item && $("singlePrice")) $("singlePrice").value = item.price;
  });

  $("finalDiscount")?.addEventListener("input", updateFinalInvoice);
  $("finalCash")?.addEventListener("input", updateFinalInvoice);
  $("finalCard")?.addEventListener("input", updateFinalInvoice);

  $("historySearch")?.addEventListener("input", renderHistory);
  $("historyType")?.addEventListener("change", renderHistory);
  $("reportDate")?.addEventListener("change", renderDailyReport);

  if ($("accountDriver")) {
    $("accountDriver").addEventListener("change", () => {
      if (accountLines.length) {
        toast("تأكد من أن الأصناف الحالية تخص السائق المحدد");
      }
    });
  }

  document.querySelectorAll("[data-tab]").forEach(el => {
    el.addEventListener("click", () => showTab(el.dataset.tab));
  });
}

window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  installPromptEvent = e;

  const button = $("installBtn");
  if (button) button.hidden = false;
});

async function installApp() {
  if (!installPromptEvent) {
    return toast("للتثبيت: افتح قائمة المتصفح ثم اختر إضافة إلى الشاشة الرئيسية");
  }

  installPromptEvent.prompt();
  await installPromptEvent.userChoice;

  installPromptEvent = null;

  if ($("installBtn")) $("installBtn").hidden = true;
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js")
      .catch(err => console.warn("SW:", err));
  });
}

document.addEventListener("DOMContentLoaded", initializeApp);

/* =========================
   ربط الدوال بأزرار HTML
========================= */

window.showTab = showTab;

window.addDriver = addDriver;
window.editDriver = editDriver;
window.deleteDriver = deleteDriver;

window.addItem = addItem;
window.editItem = editItem;
window.deleteItem = deleteItem;

window.addAccountItem = addAccountItem;
window.changeLineQty = changeLineQty;
window.setLineQty = setLineQty;
window.removeLine = removeLine;

window.closeAccount = closeAccount;
window.clearAccountConfirm = clearAccountConfirm;

window.addSingleLine = addSingleLine;
window.saveSingleInvoice = saveSingleInvoice;
window.clearSingleConfirm = clearSingleConfirm;

window.prepareFinalInvoice = prepareFinalInvoice;
window.renderFinalInvoiceRows = renderFinalInvoiceRows;
window.updateFinalInvoice = updateFinalInvoice;
window.saveFinalInvoice = saveFinalInvoice;
window.cancelFinalInvoice = cancelFinalInvoice;

window.renderHistory = renderHistory;
window.printInvoiceById = printInvoiceById;
window.deleteInvoice = deleteInvoice;

window.renderDailyReport = renderDailyReport;
window.printDailyReport = printDailyReport;

window.clearAllAccountsConfirm = clearAllAccountsConfirm;
window.clearAllAccounts = clearAllAccounts;

window.closeConfirm = closeConfirm;
window.installApp = installApp;
