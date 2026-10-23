"use strict";

/* ==========================================
   ديرتي | نظام فواتير السائقين
   Cash + Card + Credit + Repayments + Shifts
========================================== */

const DB_KEY = "deerty_driver_invoice_v2";
const LEGACY_DB_KEY = "deerty_driver_invoice_v1";

let db;
let singleLines = [];
let installPrompt = null;
let toastTimer = null;

/* ---------- أدوات عامة ---------- */

function money(value) {
  return (Number(value) || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function num(value) {
  const n = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function uid(prefix = "ID") {
  return prefix + "-" + Date.now().toString(36) +
    "-" + Math.random().toString(36).slice(2, 7);
}

function today() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0")
  ].join("-");
}

function nowText() {
  return new Date().toLocaleString("ar-SA", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function dateTime() {
  return new Date().toISOString();
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[ch]);
}

function valueOf(id) {
  return document.getElementById(id)?.value ?? "";
}

function setValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value ?? "";
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? "";
}

function setHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function notify(message) {
  const el = document.getElementById("toast");

  if (!el) {
    alert(message);
    return;
  }

  el.textContent = message;
  el.classList.add("show");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3000);
}

function ask(message) {
  return window.confirm(message);
}

function promptAmount(message, defaultValue = "") {
  const raw = window.prompt(message, defaultValue);
  if (raw === null) return null;

  const amount = num(raw);

  if (!Number.isFinite(amount) || amount <= 0) {
    notify("أدخل مبلغًا صحيحًا أكبر من صفر.");
    return null;
  }

  return amount;
}

function makeCode(prefix) {
  const sequence = Number(db.seq) || 1;
  db.seq = sequence + 1;
  return prefix + "-" + today().replace(/-/g, "") +
    "-" + String(sequence).padStart(4, "0");
}

/* ---------- قاعدة البيانات ---------- */

function defaultDB() {
  return {
    version: 3,
    drivers: [],
    items: [],
    accounts: {},
    invoices: [],
    shifts: [],
    repayments: [],
    openingBalances: {},
    seq: 1
  };
}

function normaliseDB(raw) {
  const data = raw && typeof raw === "object" ? raw : defaultDB();

  data.version = 3;
  data.drivers = Array.isArray(data.drivers) ? data.drivers : [];
  data.items = Array.isArray(data.items) ? data.items : [];
  data.accounts = data.accounts && typeof data.accounts === "object"
    ? data.accounts : {};
  data.invoices = Array.isArray(data.invoices) ? data.invoices : [];
   data.finalInvoices = Array.isArray(data.finalInvoices)
  ? data.finalInvoices
  : [];
  data.shifts = Array.isArray(data.shifts) ? data.shifts : [];
  data.repayments = Array.isArray(data.repayments) ? data.repayments : [];
  data.openingBalances = data.openingBalances &&
    typeof data.openingBalances === "object" ? data.openingBalances : {};
  data.seq = Math.max(1, Number(data.seq) || 1);

  data.drivers.forEach(driver => {
    if (!driver.id) driver.id = uid("DRV");
    driver.name = String(driver.name || "سائق");
    driver.phone = String(driver.phone || "");
    driver.openingBalance = Math.max(0, num(driver.openingBalance));

    if (!Object.prototype.hasOwnProperty.call(
      data.openingBalances, driver.id
    )) {
      data.openingBalances[driver.id] = driver.openingBalance;
    }

    if (!Array.isArray(data.accounts[driver.id])) {
      data.accounts[driver.id] = [];
    }
  });

  data.items.forEach(item => {
    if (!item.id) item.id = uid("ITEM");
    item.name = String(item.name || "صنف");
    item.price = Math.max(0, num(item.price));
  });

  data.invoices.forEach(invoice => {
    if (!invoice.id) invoice.id = uid("INV");
    if (!invoice.code) invoice.code = makeCode("INV");

    invoice.items = Array.isArray(invoice.items) ? invoice.items : [];
    invoice.total = Math.max(0, num(invoice.total));
    invoice.cashPaid = Math.max(0, num(invoice.cashPaid));
    invoice.cardPaid = Math.max(0, num(invoice.cardPaid));

    if (!Number.isFinite(Number(invoice.credit))) {
      invoice.credit = Math.max(
        0,
        invoice.total - invoice.cashPaid - invoice.cardPaid
      );
    } else {
      invoice.credit = Math.max(0, num(invoice.credit));
    }

    if (!invoice.createdAt) invoice.createdAt = dateTime();
    if (!invoice.date) invoice.date = invoice.createdAt.slice(0, 10);
    if (!invoice.type) invoice.type = "closed";
  });

  data.repayments.forEach(payment => {
    if (!payment.id) payment.id = uid("PAY");
    payment.amount = Math.max(0, num(payment.amount));
    if (!payment.createdAt) payment.createdAt = dateTime();
  });

  data.shifts.forEach(shift => {
    if (!shift.id) shift.id = uid("SHIFT");
    if (!shift.createdAt) shift.createdAt = dateTime();
  });

  return data;
}

function loadDB() {
  try {
    const current = localStorage.getItem(DB_KEY);

    if (current) {
      return normaliseDB(JSON.parse(current));
    }

    const legacy = localStorage.getItem(LEGACY_DB_KEY);

    if (legacy) {
      const migrated = normaliseDB(JSON.parse(legacy));
      localStorage.setItem(DB_KEY, JSON.stringify(migrated));
      return migrated;
    }
  } catch (error) {
    console.error("تعذر قراءة قاعدة البيانات:", error);
    alert("تعذر قراءة البيانات المحفوظة. لا تمسح بيانات المتصفح قبل أخذ نسخة احتياطية إن أمكن.");
  }

  return normaliseDB(defaultDB());
}

function saveDB() {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
    return true;
  } catch (error) {
    console.error("تعذر حفظ البيانات:", error);
    notify("تعذر حفظ البيانات. قد تكون مساحة التخزين ممتلئة.");
    return false;
  }
}

/* ---------- السائقون والأرصدة ---------- */

function getDriver(driverId) {
  return db.drivers.find(driver => driver.id === driverId);
}

function driverName(driverId) {
  return getDriver(driverId)?.name || "غير محدد";
}

function driverOpeningBalance(driverId) {
  const driver = getDriver(driverId);
  const stored = db.openingBalances[driverId];

  return Math.max(0, num(
    stored !== undefined ? stored : driver?.openingBalance
  ));
}

function invoiceRemaining(invoice) {
  return Math.max(0, num(invoice.credit));
}

/*
 * الرصيد الحالي:
 * رصيد افتتاحي + آجل الفواتير - السداد اللاحق.
 * لا نضيف رصيد افتتاحي جديد عند كل إقفال دوام.
 */
function driverBalance(driverId) {
  const opening = driverOpeningBalance(driverId);

  const credits = db.invoices
    .filter(invoice =>
      invoice.driverId === driverId &&
      !invoice.settledBy
    )
    .reduce((sum, invoice) => sum + invoiceRemaining(invoice), 0);

  const finalCredits = (db.finalInvoices || [])
    .filter(invoice => invoice.driverId === driverId)
    .reduce((sum, invoice) => sum + num(invoice.credit), 0);

  const repayments = db.repayments
    .filter(payment => payment.driverId === driverId)
    .reduce((sum, payment) => sum + num(payment.amount), 0);

  return Math.max(0, opening + credits + finalCredits - repayments);
}

function addDriver() {
  const name = valueOf("driverName").trim();
  const phone = valueOf("driverPhone").trim();

  if (!name) {
    notify("اكتب اسم السائق أولًا.");
    return;
  }

  const duplicate = db.drivers.some(
    driver => driver.name.trim().toLowerCase() === name.toLowerCase()
  );

  if (duplicate && !ask("يوجد سائق بالاسم نفسه. هل تريد إضافته على أي حال؟")) {
    return;
  }

  const driver = {
    id: uid("DRV"),
    name,
    phone,
    openingBalance: 0,
    createdAt: dateTime()
  };

  db.drivers.push(driver);
  db.accounts[driver.id] = [];
  db.openingBalances[driver.id] = 0;

  saveDB();

  setValue("driverName", "");
  setValue("driverPhone", "");

  renderAll();
  setValue("accountDriver", driver.id);
  setValue("singleDriver", driver.id);
  renderAccount();

  notify("تم حفظ السائق.");
}

function newDriverPrompt() {
  showTab("drivers");
  document.getElementById("driverName")?.focus();
}

function deleteDriver(driverId) {
  const driver = getDriver(driverId);

  if (!driver) return;

  const hasHistory =
    db.invoices.some(invoice => invoice.driverId === driverId) ||
    db.repayments.some(payment => payment.driverId === driverId) ||
    driverBalance(driverId) > 0;

  if (hasHistory) {
    notify("لا يمكن حذف سائق لديه فواتير أو رصيد. احتفظ بسجله.");
    return;
  }

  if (!ask("هل تريد حذف السائق " + driver.name + "؟")) return;

  db.drivers = db.drivers.filter(item => item.id !== driverId);
  delete db.accounts[driverId];
  delete db.openingBalances[driverId];

  saveDB();
  renderAll();
  notify("تم حذف السائق.");
}

function selectDriver(driverId) {
  setValue("accountDriver", driverId);
  renderAccount();
  showTab("account");
}

function renderDrivers() {
  setHTML("driversRows", db.drivers.length
    ? db.drivers.map(driver => {
      const balance = driverBalance(driver.id);

      return `
        <tr>
          <td>${esc(driver.name)}</td>
          <td>${esc(driver.phone || "—")}</td>
          <td><strong>${money(balance)} ر.س</strong></td>
          <td>
            <button onclick="recordRepayment('${driver.id}')">💵 تسجيل سداد</button>
            <button class="secondary" onclick="selectDriver('${driver.id}')">فتح الحساب</button>
            <button class="danger" onclick="deleteDriver('${driver.id}')">حذف</button>
          </td>
        </tr>`;
    }).join("")
    : `<tr><td colspan="4" class="empty-state">لا يوجد سائقون بعد.</td></tr>`);
}

/* ---------- الأصناف ---------- */

function addItem() {
  const name = valueOf("itemName").trim();
  const price = num(valueOf("itemPrice"));

  if (!name || price < 0 || valueOf("itemPrice").trim() === "") {
    notify("أدخل اسم الصنف والسعر.");
    return;
  }

  db.items.push({
    id: uid("ITEM"),
    name,
    price,
    createdAt: dateTime()
  });

  saveDB();

  setValue("itemName", "");
  setValue("itemPrice", "");

  renderAll();
  notify("تم حفظ الصنف.");
}

function editItem(itemId) {
  const item = db.items.find(entry => entry.id === itemId);
  if (!item) return;

  const name = prompt("اسم الصنف:", item.name);
  if (name === null) return;

  const price = prompt("السعر:", String(item.price));
  if (price === null) return;

  if (!name.trim() || num(price) < 0 || price.trim() === "") {
    notify("الاسم أو السعر غير صحيح.");
    return;
  }

  item.name = name.trim();
  item.price = num(price);

  saveDB();
  renderAll();
  notify("تم تعديل الصنف.");
}

function deleteItem(itemId) {
  const item = db.items.find(entry => entry.id === itemId);
  if (!item) return;

  if (!ask("حذف الصنف " + item.name + " من قائمة الأصناف؟")) return;

  db.items = db.items.filter(entry => entry.id !== itemId);
  saveDB();
  renderAll();
  notify("تم حذف الصنف من القائمة.");
}

function renderItems() {
  setHTML("itemsRows", db.items.length
    ? db.items.map(item => `
      <tr>
        <td>${esc(item.name)}</td>
        <td>${money(item.price)} ر.س</td>
        <td>
          <button class="secondary" onclick="editItem('${item.id}')">تعديل</button>
          <button class="danger" onclick="deleteItem('${item.id}')">حذف</button>
        </td>
      </tr>`).join("")
    : `<tr><td colspan="3" class="empty-state">أضف الأصناف وأسعارها لتظهر هنا.</td></tr>`);

  const options = db.items.map(item =>
    `<option value="${item.id}">${esc(item.name)} — ${money(item.price)} ر.س</option>`
  ).join("");

  const singleItem = document.getElementById("singleItem");
  if (singleItem) {
    const old = singleItem.value;
    singleItem.innerHTML = options;
    if (db.items.some(item => item.id === old)) singleItem.value = old;
  }
}

function renderQuickItems() {
  const search = valueOf("productSearch").trim().toLowerCase();

  const items = db.items.filter(item =>
    item.name.toLowerCase().includes(search)
  );

  setHTML("quickItems", items.length
    ? items.map(item => `
      <button class="quick-item" onclick="addItemToAccount('${item.id}')">
        <span class="item-name">${esc(item.name)}</span>
        <span class="item-price">${money(item.price)} ر.س</span>
      </button>`).join("")
    : `<div class="empty-state">لا توجد أصناف مطابقة. أضف صنفًا من تبويب الأصناف والأسعار.</div>`);
}

/* ---------- حساب السائق الحالي ---------- */

function selectedDriverId() {
  return valueOf("accountDriver");
}

function accountLines(driverId = selectedDriverId()) {
  if (!driverId) return [];
  if (!Array.isArray(db.accounts[driverId])) db.accounts[driverId] = [];
  return db.accounts[driverId];
}

function addItemToAccount(itemId) {
  const driverId = selectedDriverId();

  if (!driverId) {
    notify("أضف سائقًا واختره أولًا.");
    showTab("drivers");
    return;
  }

  const item = db.items.find(entry => entry.id === itemId);
  if (!item) return;

  const lines = accountLines(driverId);
  const existing = lines.find(line => line.itemId === itemId);

  if (existing) {
    existing.qty = num(existing.qty) + 1;
  } else {
    lines.push({
      id: uid("LINE"),
      itemId: item.id,
      name: item.name,
      qty: 1,
      price: item.price
    });
  }

  saveDB();
  renderAccount();
}

function changeAccountQty(driverId, lineId, delta) {
  const lines = accountLines(driverId);
  const line = lines.find(item => item.id === lineId);
  if (!line) return;

  line.qty = Math.max(0, num(line.qty) + num(delta));

  if (line.qty <= 0) {
    db.accounts[driverId] = lines.filter(item => item.id !== lineId);
  }

  saveDB();
  renderAccount();
}

function editAccountPrice(driverId, lineId) {
  const line = accountLines(driverId).find(item => item.id === lineId);
  if (!line) return;

  const raw = prompt("سعر الوحدة:", String(line.price));
  if (raw === null) return;

  if (raw.trim() === "" || num(raw) < 0) {
    notify("أدخل سعرًا صحيحًا.");
    return;
  }

  line.price = num(raw);
  saveDB();
  renderAccount();
}

function removeAccountItem(driverId, lineId) {
  db.accounts[driverId] = accountLines(driverId)
    .filter(line => line.id !== lineId);

  saveDB();
  renderAccount();
}

function totalLines(lines) {
  return lines.reduce(
    (sum, line) => sum + num(line.qty) * num(line.price), 0
  );
}

function renderAccount() {
  const driverId = selectedDriverId();
  const driver = getDriver(driverId);
  const lines = accountLines(driverId);

  setText("currentDriverTitle", driver
    ? "فاتورة " + driver.name
    : "اختر سائقًا");

  setHTML("accountRows", lines.length
    ? lines.map(line => `
      <tr>
        <td>${esc(line.name)}</td>
        <td>
          <button class="secondary" onclick="changeAccountQty('${driverId}','${line.id}',-1)">−</button>
          ${money(line.qty)}
          <button class="secondary" onclick="changeAccountQty('${driverId}','${line.id}',1)">+</button>
        </td>
        <td>
          <button class="secondary" onclick="editAccountPrice('${driverId}','${line.id}')">${money(line.price)}</button>
        </td>
        <td>${money(num(line.qty) * num(line.price))}</td>
        <td><button class="danger" onclick="removeAccountItem('${driverId}','${line.id}')">×</button></td>
      </tr>`).join("")
    : `<tr><td colspan="5" class="empty-state">الفاتورة فارغة. اختر صنفًا من القائمة.</td></tr>`);

  setText("accountTotal", money(totalLines(lines)));
  updateAccountPayment();
}

function updateAccountPayment() {
  const total = totalLines(accountLines());
  let cash = Math.max(0, num(valueOf("paymentCash")));
  let card = Math.max(0, num(valueOf("paymentCard")));

  if (cash + card > total) {
    setText("paymentRemaining", "المبالغ تتجاوز الإجمالي");
    return;
  }

  setText("paymentRemaining", money(Math.max(0, total - cash - card)) + " ر.س");
}

function saveAccount() {
  const driverId = selectedDriverId();

  if (!driverId) {
    notify("اختر السائق أولًا.");
    return;
  }

  saveDB();
  notify("تم حفظ الفاتورة الحالية مؤقتًا.");
}

function clearAccountConfirm() {
  const driverId = selectedDriverId();
  if (!driverId) return;

  if (!ask("هل تريد تفريغ الفاتورة الحالية؟ لن تُحذف الفواتير المحفوظة سابقًا.")) {
    return;
  }

  db.accounts[driverId] = [];
  setValue("paymentCash", "0");
  setValue("paymentCard", "0");
  setValue("accountNote", "");

  saveDB();
  renderAccount();
  notify("تم تفريغ الفاتورة الحالية.");
}

/* ---------- الورديات ---------- */

function getOpenShift(driverId) {
  return db.shifts.find(shift =>
    shift.driverId === driverId && !shift.closedAt
  );
}

function getOrCreateShift(driverId) {
  let shift = getOpenShift(driverId);
  if (shift) return shift;

  shift = {
    id: uid("SHIFT"),
    code: makeCode("SHIFT"),
    driverId,
    createdAt: dateTime(),
    openingDebt: driverBalance(driverId),
    closedAt: null
  };

  db.shifts.push(shift);
  return shift;
}

/* ---------- حفظ فاتورة الكاشير ---------- */

function saveCurrentInvoice() {
  return closeAccount();
}

function closeAccount() {
  const driverId = selectedDriverId();
  const driver = getDriver(driverId);
  const lines = accountLines(driverId).map(line => ({ ...line }));
  const total = totalLines(lines);

  if (!driver) {
    notify("اختر السائق أولًا.");
    return;
  }

  if (!lines.length || total <= 0) {
    notify("أضف صنفًا واحدًا على الأقل.");
    return;
  }

  const cash = Math.max(0, num(valueOf("paymentCash")));
  const card = Math.max(0, num(valueOf("paymentCard")));

  if (cash + card > total + 0.001) {
    notify("إجمالي النقد والشبكة أكبر من قيمة الفاتورة.");
    return;
  }

  const shift = getOrCreateShift(driverId);

  const invoice = {
    id: uid("INV"),
    code: makeCode("INV"),
    type: "closed",
    driverId,
    shiftId: shift.id,
    createdAt: dateTime(),
    date: today(),
    note: valueOf("accountNote").trim(),
    items: lines,
    total,
    cashPaid: cash,
    cardPaid: card,
    credit: Math.max(0, total - cash - card)
  };

  db.invoices.push(invoice);
  db.accounts[driverId] = [];

  saveDB();
  renderAll();

  setValue("paymentCash", "0");
  setValue("paymentCard", "0");
  setValue("accountNote", "");

  printInvoice(invoice.id);
  notify("تم حفظ الفاتورة رقم " + invoice.code);
}

function printAccount() {
  const driverId = selectedDriverId();
  const lines = accountLines(driverId).map(line => ({ ...line }));
  const total = totalLines(lines);

  if (!lines.length) {
    notify("الفاتورة فارغة.");
    return;
  }

  const cash = Math.max(0, num(valueOf("paymentCash")));
  const card = Math.max(0, num(valueOf("paymentCard")));

  printReceipt({
    code: "معاينة",
    driverId,
    createdAt: dateTime(),
    date: today(),
    note: valueOf("accountNote"),
    items: lines,
    total,
    cashPaid: cash,
    cardPaid: card,
    credit: Math.max(0, total - cash - card)
  });
}

/* ---------- الفاتورة المستقلة ---------- */

function setSinglePrice() {
  const item = db.items.find(entry => entry.id === valueOf("singleItem"));
  if (item) setValue("singlePrice", item.price);
}

function addSingleLine() {
  const item = db.items.find(entry => entry.id === valueOf("singleItem"));
  const qty = num(valueOf("singleQty"));
  const price = num(valueOf("singlePrice"));

  if (!item) {
    notify("أضف صنفًا أولًا.");
    return;
  }

  if (qty <= 0 || price < 0 || valueOf("singlePrice").trim() === "") {
    notify("تحقق من الكمية والسعر.");
    return;
  }

  singleLines.push({
    id: uid("SLINE"),
    itemId: item.id,
    name: item.name,
    qty,
    price
  });

  renderSingleInvoice();
}

function removeSingleInvoiceItem(lineId) {
  singleLines = singleLines.filter(line => line.id !== lineId);
  renderSingleInvoice();
}

function renderSingleInvoice() {
  setHTML("singleRows", singleLines.length
    ? singleLines.map(line => `
      <tr>
        <td>${esc(line.name)}</td>
        <td>${money(line.qty)}</td>
        <td>${money(line.price)}</td>
        <td>${money(line.qty * line.price)}</td>
        <td><button class="danger" onclick="removeSingleInvoiceItem('${line.id}')">حذف</button></td>
      </tr>`).join("")
    : `<tr><td colspan="5" class="empty-state">لم تتم إضافة أصناف.</td></tr>`);

  setText("singleTotal", money(totalLines(singleLines)));
  updateSinglePayment();
}

function updateSinglePayment() {
  const total = totalLines(singleLines);
  const cash = Math.max(0, num(valueOf("singleCash")));
  const card = Math.max(0, num(valueOf("singleCard")));

  setText(
    "singleRemaining",
    cash + card > total
      ? "المبالغ تتجاوز الإجمالي"
      : money(Math.max(0, total - cash - card)) + " ر.س"
  );
}

function saveSingleInvoice() {
  const driverId = valueOf("singleDriver");
  const driver = getDriver(driverId);
  const lines = singleLines.map(line => ({ ...line }));
  const total = totalLines(lines);

  if (!driver) {
    notify("اختر السائق.");
    return;
  }

  if (!lines.length || total <= 0) {
    notify("أضف أصنافًا للفاتورة.");
    return;
  }

  const cash = Math.max(0, num(valueOf("singleCash")));
  const card = Math.max(0, num(valueOf("singleCard")));

  if (cash + card > total + 0.001) {
    notify("إجمالي النقد والشبكة أكبر من قيمة الفاتورة.");
    return;
  }

  const shift = getOrCreateShift(driverId);

  const invoice = {
    id: uid("INV"),
    code: makeCode("INV"),
    type: "single",
    driverId,
    shiftId: shift.id,
    createdAt: dateTime(),
    date: today(),
    note: valueOf("singleNote").trim(),
    items: lines,
    total,
    cashPaid: cash,
    cardPaid: card,
    credit: Math.max(0, total - cash - card)
  };

  db.invoices.push(invoice);
  saveDB();

  singleLines = [];
  setValue("singleNote", "");
  setValue("singleQty", "1");
  setValue("singleCash", "0");
  setValue("singleCard", "0");

  renderAll();
  printInvoice(invoice.id);
  notify("تم حفظ الفاتورة المستقلة " + invoice.code);
}

/* ---------- السداد اللاحق ---------- */

function recordRepayment(driverId) {
  const driver = getDriver(driverId);
  if (!driver) return;

  const balance = driverBalance(driverId);

  if (balance <= 0) {
    notify("لا يوجد رصيد آجل مستحق على هذا السائق.");
    return;
  }

  const amount = promptAmount(
    "رصيد " + driver.name + ": " + money(balance) +
    " ريال\nأدخل المبلغ المسدد:",
    String(balance)
  );

  if (amount === null) return;

  if (amount > balance + 0.001) {
    notify("المبلغ أكبر من الرصيد المستحق.");
    return;
  }

  const methodChoice = prompt(
    "طريقة السداد:\n1 = نقدًا\n2 = شبكة",
    "1"
  );

  if (methodChoice === null) return;

  const method = methodChoice.trim() === "2" ? "الشبكة" : "نقدًا";
  const note = prompt("ملاحظة (اختياري):", "") || "";
  const shift = getOpenShift(driverId);

  db.repayments.push({
    id: uid("PAY"),
    code: makeCode("PAY"),
    driverId,
    amount,
    method,
    note,
    shiftId: shift?.id || null,
    createdAt: dateTime(),
    date: today()
  });

  saveDB();
  renderAll();
  notify("تم تسجيل السداد وتحديث رصيد السائق.");
}

function renderRepayments() {
  const rows = [...db.repayments].sort((a, b) =>
    String(b.createdAt).localeCompare(String(a.createdAt))
  );

  setHTML("repaymentRows", rows.length
    ? rows.map(payment => `
      <tr>
        <td>${esc(payment.createdAt ? new Date(payment.createdAt).toLocaleString("ar-SA") : "—")}</td>
        <td>${esc(driverName(payment.driverId))}</td>
        <td>${money(payment.amount)} ر.س</td>
        <td>${esc(payment.method || "نقدًا")}</td>
        <td>${esc(payment.note || "—")}</td>
      </tr>`).join("")
    : `<tr><td colspan="5" class="empty-state">لا توجد عمليات سداد مسجلة.</td></tr>`);
}

/* ---------- إقفال الدوام ---------- */

function closeShift() {
  const driverId = selectedDriverId();
  const driver = getDriver(driverId);

  if (!driver) {
    notify("اختر السائق من شاشة الكاشير أولًا.");
    showTab("account");
    return;
  }

  const shift = getOpenShift(driverId);

  if (!shift) {
    notify("لا يوجد دوام مفتوح لهذا السائق.");
    return;
  }

  const invoices = db.invoices.filter(invoice => invoice.shiftId === shift.id);
  const total = invoices.reduce((sum, invoice) => sum + num(invoice.total), 0);
  const cash = invoices.reduce((sum, invoice) => sum + num(invoice.cashPaid), 0);
  const card = invoices.reduce((sum, invoice) => sum + num(invoice.cardPaid), 0);
  const credit = invoices.reduce((sum, invoice) => sum + invoiceRemaining(invoice), 0);
  const repayments = db.repayments
    .filter(payment => payment.shiftId === shift.id)
    .reduce((sum, payment) => sum + num(payment.amount), 0);

  const balance = driverBalance(driverId);

  const summary =
    "إقفال دوام " + driver.name + "\n\n" +
    "عدد الفواتير: " + invoices.length + "\n" +
    "إجمالي الفواتير: " + money(total) + " ريال\n" +
    "النقد: " + money(cash) + " ريال\n" +
    "الشبكة: " + money(card) + " ريال\n" +
    "آجل فواتير الدوام: " + money(credit) + " ريال\n" +
    "السداد المسجل أثناء الدوام: " + money(repayments) + " ريال\n" +
    "رصيد السائق المتبقي: " + money(balance) + " ريال\n\n" +
    "هل تريد إقفال الدوام؟";

  if (!ask(summary)) return;

  shift.closedAt = dateTime();
  shift.closingDebt = balance;
  shift.invoiceCount = invoices.length;
  shift.total = total;
  shift.cash = cash;
  shift.card = card;
  shift.credit = credit;
  shift.repayments = repayments;

  saveDB();
  renderAll();
  notify("تم إقفال دوام " + driver.name + ".");
}

function renderShiftSummary() {
  const rows = [...db.shifts].sort((a, b) =>
    String(b.createdAt).localeCompare(String(a.createdAt))
  );

  setHTML("shiftRows", rows.length
    ? rows.map(shift => {
      const invoices = db.invoices.filter(
        invoice => invoice.shiftId === shift.id
      );

      const total = invoices.reduce((sum, invoice) => sum + num(invoice.total), 0);
      const cash = invoices.reduce((sum, invoice) => sum + num(invoice.cashPaid), 0);
      const card = invoices.reduce((sum, invoice) => sum + num(invoice.cardPaid), 0);
      const credit = invoices.reduce((sum, invoice) => sum + invoiceRemaining(invoice), 0);
      const balance = shift.closedAt
        ? num(shift.closingDebt)
        : driverBalance(shift.driverId);

      return `
        <tr>
          <td>${esc(new Date(shift.createdAt).toLocaleString("ar-SA"))}</td>
          <td>${esc(driverName(shift.driverId))}</td>
          <td>${invoices.length}</td>
          <td>${money(total)}</td>
          <td>${money(cash)}</td>
          <td>${money(card)}</td>
          <td>${money(credit)}</td>
          <td>${money(balance)}</td>
        </tr>`;
    }).join("")
    : `<tr><td colspan="8" class="empty-state">لم يتم تسجيل دوام حتى الآن.</td></tr>`);
}

/* ---------- سجل الفواتير ---------- */

function renderHistory() {
  const query = valueOf("historySearch").trim().toLowerCase();
  const type = valueOf("historyType") || "all";

  let invoices = [...db.invoices];

  if (type === "single") {
    invoices = invoices.filter(invoice => invoice.type === "single");
  } else if (type === "closed") {
    invoices = invoices.filter(invoice => invoice.type !== "single");
  }

  if (query) {
    invoices = invoices.filter(invoice =>
      String(invoice.code || "").toLowerCase().includes(query) ||
      driverName(invoice.driverId).toLowerCase().includes(query)
    );
  }

  invoices.sort((a, b) =>
    String(b.createdAt).localeCompare(String(a.createdAt))
  );

  setHTML("historyRows", invoices.length
    ? invoices.map(invoice => `
      <tr>
        <td>${esc(invoice.code)}</td>
        <td>${invoice.type === "single" ? "مستقلة" : "الكاشير"}</td>
        <td>${esc(driverName(invoice.driverId))}</td>
        <td>${esc(invoice.createdAt ? new Date(invoice.createdAt).toLocaleString("ar-SA") : invoice.date || "—")}</td>
        <td>${money(invoice.total)}</td>
        <td>${money(num(invoice.cashPaid) + num(invoice.cardPaid))}</td>
        <td>${money(invoiceRemaining(invoice))}</td>
        <td>
          <button class="secondary" onclick="showInvoiceDetails('${invoice.id}')">تفاصيل</button>
          <button class="print-btn" onclick="printInvoice('${invoice.id}')">طباعة</button>
        </td>
      </tr>`).join("")
    : `<tr><td colspan="8" class="empty-state">لا توجد فواتير مطابقة.</td></tr>`);
}

function showInvoiceDetails(invoiceId) {
  const invoice = db.invoices.find(item => item.id === invoiceId);
  if (!invoice) return;

  const lines = invoice.items.map(item =>
    `${item.name} — ${item.qty} × ${money(item.price)} = ${money(item.qty * item.price)}`
  ).join("\n");

  alert(
    "فاتورة رقم: " + invoice.code + "\n" +
    "السائق: " + driverName(invoice.driverId) + "\n" +
    "التاريخ: " + new Date(invoice.createdAt).toLocaleString("ar-SA") + "\n\n" +
    lines + "\n\n" +
    "الإجمالي: " + money(invoice.total) + " ريال\n" +
    "النقد: " + money(invoice.cashPaid) + " ريال\n" +
    "الشبكة: " + money(invoice.cardPaid) + " ريال\n" +
    "الآجل: " + money(invoiceRemaining(invoice)) + " ريال\n" +
    "ملاحظة: " + (invoice.note || "—")
  );
}

/* ---------- الطباعة الحرارية ---------- */

function printFinalInvoiceRecord(invoice) {
  const driver = getDriver(invoice.driverId);

  const rows = invoice.items.map((item, index) => `
    <tr>
      <td class="f-item">
        <strong>${esc(item.name)}</strong>
        <div class="f-detail">
          ${money(item.qty)} × ${money(item.price)} ر.س
        </div>
      </td>
      <td class="f-amount">
        ${money(num(item.qty) * num(item.price))}
      </td>
    </tr>
  `).join("");

  setHTML("printArea", `
    <div class="final-receipt">

      <header class="f-header">
        <h1>ديرتي</h1>
        <div class="f-subtitle">للمأكولات السعودية</div>
        <div class="f-title">فاتورة ختامية</div>
      </header>

      <div class="f-divider"></div>

      <section class="f-info">
        <div class="f-info-row">
          <span>رقم الفاتورة</span>
          <strong>${esc(invoice.code)}</strong>
        </div>

        <div class="f-info-row">
          <span>السائق</span>
          <strong>${esc(driver?.name || "—")}</strong>
        </div>

        <div class="f-info-row">
          <span>التاريخ</span>
          <strong>${esc(new Date(invoice.createdAt).toLocaleString("ar-SA"))}</strong>
        </div>

        <div class="f-info-row">
          <span>الفواتير المجمعة</span>
          <strong>${(invoice.sourceInvoiceIds || []).length}</strong>
        </div>
      </section>

      <div class="f-divider"></div>

      <table class="f-table">
        <thead>
          <tr>
            <th>الصنف والكمية والسعر</th>
            <th>الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>

      <div class="f-divider"></div>

      <section class="f-totals">
        <div class="f-total-row">
          <span>الإجمالي قبل الخصم</span>
          <strong>${money(invoice.gross)} ر.س</strong>
        </div>

        <div class="f-total-row">
          <span>الخصم</span>
          <strong>${money(invoice.discount)} ر.س</strong>
        </div>

        <div class="f-grand-total">
          <span>الإجمالي النهائي</span>
          <strong>${money(invoice.total)} ر.س</strong>
        </div>
      </section>

      <div class="f-divider"></div>

      <section class="f-payments">
        <div class="f-payment-row">
          <span>💵 نقدًا</span>
          <strong>${money(invoice.cashPaid)} ر.س</strong>
        </div>

        <div class="f-payment-row">
          <span>💳 الشبكة</span>
          <strong>${money(invoice.cardPaid)} ر.س</strong>
        </div>

        <div class="f-credit-row">
          <span>المتبقي آجلًا</span>
          <strong>${money(invoice.credit)} ر.س</strong>
        </div>
      </section>

      <div class="f-divider"></div>

      <footer class="f-footer">
        <strong>شكرًا لزيارتكم مطعم ديرتي</strong>
        <div>نتشرف بخدمتكم دائمًا</div>
      </footer>

    </div>
  `);

  const printArea = document.getElementById("printArea");
  printArea.classList.remove("hidden");

  setTimeout(() => {
    window.print();
  }, 300);
}
/* ---------- الإحصائيات والعرض ---------- */

function renderStats() {
  setText("driverCount", db.drivers.length);
  setText("invoiceCount", db.invoices.length);

  const totalBalance = db.drivers.reduce(
    (sum, driver) => sum + driverBalance(driver.id), 0
  );

  setText("openTotal", money(totalBalance) + " ر.س");

  const totalToday = db.invoices
    .filter(invoice => (invoice.date || invoice.createdAt?.slice(0, 10)) === today())
    .reduce((sum, invoice) => sum + num(invoice.total), 0);

  setText("todayTotal", money(totalToday) + " ر.س");
}

function renderSelects() {
  const driverOptions = db.drivers.map(driver =>
    `<option value="${driver.id}">${esc(driver.name)}</option>`
  ).join("");

  ["accountDriver", "singleDriver"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;

    const old = el.value;

    el.innerHTML = driverOptions ||
      `<option value="">لا يوجد سائقون — أضف سائقًا أولًا</option>`;

    if (db.drivers.some(driver => driver.id === old)) {
      el.value = old;
    }
  });
}

function renderAll() {
  renderSelects();
  renderItems();
  renderQuickItems();
  renderDrivers();
  renderAccount();
  renderSingleInvoice();
  renderHistory();
  renderRepayments();
  renderShiftSummary();
  renderStats();
}

/* ---------- التنقل ---------- */

function showTab(name) {
  document.querySelectorAll(".tab").forEach(tab => {
    tab.classList.add("hidden");
  });

  const target = document.getElementById("tab-" + name);

  if (target) target.classList.remove("hidden");

  document.querySelectorAll(".tabs button").forEach(button => {
    const onclick = button.getAttribute("onclick") || "";
    button.classList.toggle(
      "active",
      onclick.includes("'" + name + "'")
    );
  });

  if (name === "account") renderAccount();
  if (name === "single") renderSingleInvoice();
  if (name === "history") renderHistory();
  if (name === "drivers") {
    renderDrivers();
    renderRepayments();
  }
  if (name === "shifts") renderShiftSummary();
}

/* ---------- النسخ الاحتياطي والاستعادة ---------- */

function exportData() {
  const payload = {
    app: "Deerty Driver Invoices",
    exportedAt: dateTime(),
    data: db
  };

  const blob = new Blob(
    [JSON.stringify(payload, null, 2)],
    { type: "application/json;charset=utf-8" }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "deerty-backup-" + today() + ".json";

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify("تم تنزيل النسخة الاحتياطية.");
}

function importData(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const incoming = parsed.data || parsed;

      if (!incoming || !Array.isArray(incoming.drivers) ||
          !Array.isArray(incoming.invoices)) {
        throw new Error("صيغة الملف غير صحيحة");
      }

      if (!ask("استعادة النسخة ستستبدل البيانات الحالية. هل أنشأت نسخة احتياطية من البيانات الحالية؟")) {
        event.target.value = "";
        return;
      }

      db = normaliseDB(incoming);

      if (!saveDB()) return;

      renderAll();
      notify("تمت استعادة النسخة الاحتياطية.");
    } catch (error) {
      console.error(error);
      notify("تعذرت استعادة الملف. تأكد أنه نسخة احتياطية صحيحة.");
    }

    event.target.value = "";
  };

  reader.onerror = () => {
    notify("تعذر قراءة الملف.");
    event.target.value = "";
  };

  reader.readAsText(file);
}

/* ---------- تثبيت التطبيق وPWA ---------- */

async function installApp() {
  if (!installPrompt) {
    notify("إذا لم يظهر التثبيت، افتح قائمة المتصفح واختر إضافة إلى الشاشة الرئيسية.");
    return;
  }

  installPrompt.prompt();

  try {
    await installPrompt.userChoice;
  } finally {
    installPrompt = null;
    setHTML("installBtn", "📲 تثبيت التطبيق");
    document.getElementById("installBtn")?.classList.add("hidden");
  }
}

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  installPrompt = event;
  document.getElementById("installBtn")?.classList.remove("hidden");
});

window.addEventListener("appinstalled", () => {
  notify("تم تثبيت تطبيق ديرتي.");
  document.getElementById("installBtn")?.classList.add("hidden");
});

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(error => {
      console.warn("تعذر تسجيل Service Worker:", error);
    });
  });
}

/* ---------- ربط الأسماء القديمة والجديدة ---------- */

function exportBackup() {
  exportData();
}

function importBackup(event) {
  importData(event);
}

/* ---------- التشغيل ---------- */

function init() {
  db = loadDB();

  renderAll();

  const firstDriver = db.drivers[0];

  if (firstDriver) {
    setValue("accountDriver", firstDriver.id);
    setValue("singleDriver", firstDriver.id);
    renderAccount();
  }

  if (db.items.length) {
    setSinglePrice();
  }

  saveDB();
}

Object.assign(window, {
  showTab,
  addDriver,
  newDriverPrompt,
  deleteDriver,
  selectDriver,
  addItem,
  editItem,
  deleteItem,
  renderQuickItems,
  addItemToAccount,
  changeAccountQty,
  editAccountPrice,
  removeAccountItem,
  saveAccount,
  saveCurrentInvoice,
  closeAccount,
  clearAccountConfirm,
  printAccount,
  updateAccountPayment,
  setSinglePrice,
  addSingleLine,
  removeSingleInvoiceItem,
  saveSingleInvoice,
  updateSinglePayment,
  recordRepayment,
  closeShift,
  renderHistory,
  showInvoiceDetails,
  printInvoice,
  exportData,
  importData,
  exportBackup,
  importBackup,
  installApp
});

init();
/* ==========================================
   الفاتورة الختامية الموحدة للسائق
========================================== */

let finalInvoiceDraft = null;

function prepareFinalInvoice() {
  const driverId = selectedDriverId();
  const driver = getDriver(driverId);

  if (!driver) {
    notify("اختر السائق أولًا من شاشة الكاشير.");
    showTab("account");
    return;
  }

  const shift = getOpenShift(driverId);

  if (!shift) {
    notify("لا يوجد دوام مفتوح لهذا السائق.");
    return;
  }

  const invoices = db.invoices.filter(invoice =>
    invoice.driverId === driverId &&
    invoice.shiftId === shift.id &&
    !invoice.settledBy
  );

  if (!invoices.length) {
    notify("لا توجد فواتير غير مسوّاة في الدوام الحالي.");
    return;
  }

  // نجمع الأصناف المتشابهة ذات السعر نفسه.
  // الأصناف ذات الأسعار المختلفة تبقى في سطرين منفصلين.
  const merged = new Map();

  invoices.forEach(invoice => {
    (invoice.items || []).forEach(item => {
      const key = String(item.itemId || item.name) + "|" + num(item.price);

      if (!merged.has(key)) {
        merged.set(key, {
          id: uid("FINAL-LINE"),
          itemId: item.itemId || null,
          name: item.name,
          qty: 0,
          price: num(item.price)
        });
      }

      merged.get(key).qty += num(item.qty);
    });
  });

  finalInvoiceDraft = {
    driverId,
    shiftId: shift.id,
    sourceInvoiceIds: invoices.map(invoice => invoice.id),
    items: Array.from(merged.values()),
    createdAt: dateTime()
  };

  setText("finalDriverName", "السائق: " + driver.name);

  setValue("finalDiscount", "0");
  setValue("finalCash", "0");
  setValue("finalCard", "0");

  renderFinalInvoiceRows();

  document.getElementById("finalInvoicePanel")?.classList.remove("hidden");

  updateFinalInvoiceTotals();

  document.getElementById("finalInvoicePanel")?.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function renderFinalInvoiceRows() {
  const draft = finalInvoiceDraft;

  if (!draft) return;

  setHTML("finalInvoiceRows", draft.items.length
    ? draft.items.map(item => `
      <tr>
        <td>${esc(item.name)}</td>
        <td>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value="${num(item.qty)}"
            onchange="changeFinalInvoiceLine('${item.id}','qty',this.value)">
        </td>
        <td>
          <input
            type="number"
            min="0"
            step="0.01"
            value="${num(item.price)}"
            onchange="changeFinalInvoiceLine('${item.id}','price',this.value)">
        </td>
        <td>${money(num(item.qty) * num(item.price))} ر.س</td>
        <td>
          <button class="danger" onclick="removeFinalInvoiceLine('${item.id}')">
            حذف
          </button>
        </td>
      </tr>
    `).join("")
    : `<tr><td colspan="5" class="empty-state">لا توجد أصناف في الفاتورة.</td></tr>`);
}

function changeFinalInvoiceLine(lineId, field, value) {
  if (!finalInvoiceDraft) return;

  const line = finalInvoiceDraft.items.find(item => item.id === lineId);
  if (!line) return;

  const amount = num(value);

  if (String(value).trim() === "" || amount < 0 ||
      (field === "qty" && amount <= 0)) {
    notify("أدخل قيمة صحيحة.");
    renderFinalInvoiceRows();
    return;
  }

  line[field] = amount;

  renderFinalInvoiceRows();
  updateFinalInvoiceTotals();
}

function removeFinalInvoiceLine(lineId) {
  if (!finalInvoiceDraft) return;

  if (!ask("هل تريد حذف هذا الصنف من الفاتورة الختامية؟")) return;

  finalInvoiceDraft.items = finalInvoiceDraft.items.filter(
    item => item.id !== lineId
  );

  renderFinalInvoiceRows();
  updateFinalInvoiceTotals();
}

function addFinalInvoiceItem() {
  if (!finalInvoiceDraft) return;

  if (!db.items.length) {
    notify("أضف الأصناف أولًا من تبويب الأصناف والأسعار.");
    return;
  }

  const choices = db.items.map((item, index) =>
    (index + 1) + " - " + item.name + " (" + money(item.price) + " ريال)"
  ).join("\n");

  const choice = prompt("اختر رقم الصنف لإضافته:\n" + choices);

  if (choice === null) return;

  const index = parseInt(choice, 10) - 1;
  const item = db.items[index];

  if (!item) {
    notify("رقم الصنف غير صحيح.");
    return;
  }

  const qtyText = prompt("أدخل الكمية:", "1");

  if (qtyText === null) return;

  const qty = num(qtyText);

  if (qty <= 0) {
    notify("الكمية يجب أن تكون أكبر من صفر.");
    return;
  }

  finalInvoiceDraft.items.push({
    id: uid("FINAL-LINE"),
    itemId: item.id,
    name: item.name,
    qty,
    price: num(item.price)
  });

  renderFinalInvoiceRows();
  updateFinalInvoiceTotals();
}

function finalInvoiceGross() {
  if (!finalInvoiceDraft) return 0;

  return finalInvoiceDraft.items.reduce(
    (sum, item) => sum + num(item.qty) * num(item.price),
    0
  );
}

function finalInvoiceNet() {
  const gross = finalInvoiceGross();
  const discount = Math.max(0, num(valueOf("finalDiscount")));

  return Math.max(0, gross - discount);
}

function updateFinalInvoiceTotals() {
  const gross = finalInvoiceGross();
  const discount = Math.max(0, num(valueOf("finalDiscount")));
  const total = Math.max(0, gross - discount);
  const cash = Math.max(0, num(valueOf("finalCash")));
  const card = Math.max(0, num(valueOf("finalCard")));

  setValue("finalTotal", money(total) + " ريال");

  if (discount > gross) {
    setText("finalCredit", "الخصم أكبر من الإجمالي");
    return;
  }

  if (cash + card > total + 0.001) {
    setText("finalCredit", "المبالغ تتجاوز الإجمالي");
    return;
  }

  setText(
    "finalCredit",
    money(Math.max(0, total - cash - card)) + " ر.س"
  );
}

function buildFinalInvoiceRecord() {
  if (!finalInvoiceDraft) return null;

  const items = finalInvoiceDraft.items.map(item => ({ ...item }));
  const gross = items.reduce(
    (sum, item) => sum + num(item.qty) * num(item.price),
    0
  );

  const discount = Math.max(0, num(valueOf("finalDiscount")));
  const total = Math.max(0, gross - discount);
  const cash = Math.max(0, num(valueOf("finalCash")));
  const card = Math.max(0, num(valueOf("finalCard")));

  if (!items.length || total <= 0) {
    notify("الفاتورة الختامية فارغة أو إجماليها صفر.");
    return null;
  }

  if (discount > gross) {
    notify("الخصم لا يمكن أن يتجاوز إجمالي الأصناف.");
    return null;
  }

  if (cash + card > total + 0.001) {
    notify("مجموع النقد والشبكة أكبر من إجمالي الفاتورة.");
    return null;
  }

  return {
    id: uid("FINAL"),
    code: makeCode("FINAL"),
    driverId: finalInvoiceDraft.driverId,
    shiftId: finalInvoiceDraft.shiftId,
    sourceInvoiceIds: [...finalInvoiceDraft.sourceInvoiceIds],
    createdAt: dateTime(),
    date: today(),
    items,
    gross,
    discount,
    total,
    cashPaid: cash,
    cardPaid: card,
    credit: Math.max(0, total - cash - card),
    type: "final",
    note: "فاتورة ختامية موحدة"
  };
}

function saveFinalInvoice() {
  if (!finalInvoiceDraft) {
    notify("جهّز الفاتورة الختامية أولًا.");
    return;
  }

  const invoice = buildFinalInvoiceRecord();

  if (!invoice) return;

  const sourceInvoices = db.invoices.filter(item =>
    finalInvoiceDraft.sourceInvoiceIds.includes(item.id)
  );

  if (sourceInvoices.length !== finalInvoiceDraft.sourceInvoiceIds.length) {
    notify("تعذر العثور على جميع الفواتير الأصلية. لم يتم الاعتماد.");
    return;
  }

  if (sourceInvoices.some(item => item.settledBy)) {
    notify("بعض الفواتير تمت تسويتها مسبقًا. أعد فتح الشاشة بعد تحديث البيانات.");
    return;
  }

  const confirmation =
    "اعتماد الفاتورة الختامية رقم " + invoice.code + "؟\n\n" +
    "الإجمالي قبل الخصم: " + money(invoice.gross) + " ريال\n" +
    "الخصم: " + money(invoice.discount) + " ريال\n" +
    "الإجمالي النهائي: " + money(invoice.total) + " ريال\n" +
    "نقدًا: " + money(invoice.cashPaid) + " ريال\n" +
    "الشبكة: " + money(invoice.cardPaid) + " ريال\n" +
    "آجل: " + money(invoice.credit) + " ريال\n\n" +
    "سيتم تعليم الفواتير الأصلية بأنها مسوّاة، ولن تُضاف الفاتورة الختامية إلى مبيعات الأصناف مرة ثانية.";

  if (!ask(confirmation)) return;

  if (!Array.isArray(db.finalInvoices)) db.finalInvoices = [];

  db.finalInvoices.push(invoice);

  sourceInvoices.forEach(original => {
    original.settledBy = invoice.id;
    original.settledAt = invoice.createdAt;
  });

  if (!saveDB()) {
    // لا نترك حالة الواجهة توحي بأن الاعتماد نجح.
    db.finalInvoices = db.finalInvoices.filter(item => item.id !== invoice.id);
    sourceInvoices.forEach(original => {
      delete original.settledBy;
      delete original.settledAt;
    });
    return;
  }

  finalInvoiceDraft = null;

  document.getElementById("finalInvoicePanel")?.classList.add("hidden");

  renderAll();
  printFinalInvoiceRecord(invoice);

  notify("تم اعتماد الفاتورة الختامية.");
}

function printFinalInvoice() {
  if (!finalInvoiceDraft) {
    notify("جهّز الفاتورة الختامية أولًا.");
    return;
  }

  const invoice = buildFinalInvoiceRecord();

  if (invoice) printFinalInvoiceRecord(invoice);
}

function printFinalInvoiceRecord(invoice) {
  const driver = getDriver(invoice.driverId);

  const rows = invoice.items.map(item => `
    <tr>
      <td>
        ${esc(item.name)}
        <br>
        <small>${money(item.qty)} × ${money(item.price)}</small>
      </td>
      <td>${money(num(item.qty) * num(item.price))}</td>
    </tr>
  `).join("");

  setHTML("printArea", `
    <div class="receipt-center">
      <h1>ديرتي</h1>
      <h3>للمأكولات السعودية</h3>
      <h3>الفاتورة الختامية</h3>
    </div>

    <div class="receipt-divider"></div>

    <p>رقم الفاتورة: ${esc(invoice.code)}</p>
    <p>السائق: ${esc(driver?.name || "—")}</p>
    <p>التاريخ: ${esc(new Date(invoice.createdAt).toLocaleString("ar-SA"))}</p>
    <p>عدد الفواتير المجمعة: ${invoice.sourceInvoiceIds.length}</p>

    <div class="receipt-divider"></div>

    <table>
      <thead>
        <tr>
          <th>الصنف / الكمية / السعر</th>
          <th>الإجمالي</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="receipt-divider"></div>

    <p>الإجمالي قبل الخصم: ${money(invoice.gross)} ريال</p>
    <p>الخصم: ${money(invoice.discount)} ريال</p>
    <p class="receipt-total">الإجمالي النهائي: ${money(invoice.total)} ريال</p>
    <p>نقدًا: ${money(invoice.cashPaid)} ريال</p>
    <p>الشبكة: ${money(invoice.cardPaid)} ريال</p>
    <p>المتبقي آجلًا: ${money(invoice.credit)} ريال</p>

    <div class="receipt-divider"></div>

    <p class="receipt-center">شكرًا لكم</p>
  `);

  const printArea = document.getElementById("printArea");

  printArea.classList.remove("hidden");

  setTimeout(() => {
    window.print();

    setTimeout(() => {
      printArea.classList.add("hidden");
    }, 700);
  }, 300);
}

function cancelFinalInvoice() {
  finalInvoiceDraft = null;

  document.getElementById("finalInvoicePanel")?.classList.add("hidden");

  notify("تم إلغاء تجهيز الفاتورة الختامية دون تغيير الفواتير الأصلية.");
}

/* إتاحة وظائف الشاشة لأزرار HTML */
Object.assign(window, {
  prepareFinalInvoice,
  renderFinalInvoiceRows,
  changeFinalInvoiceLine,
  removeFinalInvoiceLine,
  addFinalInvoiceItem,
  updateFinalInvoiceTotals,
  saveFinalInvoice,
  printFinalInvoice,
  cancelFinalInvoice
});
