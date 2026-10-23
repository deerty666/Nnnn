/* ==========================================
   ديرتي | نظام فواتير السائقين
   إدارة الفواتير والسداد والدوام والمديونيات
   ========================================== */

"use strict";

const DB_KEY = "deerty_driver_invoice_v2";
const LEGACY_DB_KEY = "deerty_driver_invoice_v1";

const money = value =>
  (Number(value) || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

const num = value => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const uid = prefix =>
  `${prefix || "ID"}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 7)
    .toUpperCase()}`;

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const nowText = () => new Date().toLocaleString("ar-SA");

const esc = value =>
  String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);

function defaultDB() {
  return {
    version: 2,
    drivers: [],
    items: [],
    accounts: {},
    invoices: [],
    shifts: [],
    repayments: [],
    seq: 1
  };
}

function loadDB() {
  try {
    const raw =
      localStorage.getItem(DB_KEY) ||
      localStorage.getItem(LEGACY_DB_KEY);

    if (!raw) return defaultDB();

    const parsed = JSON.parse(raw);
    const db = { ...defaultDB(), ...parsed };

    db.drivers = Array.isArray(db.drivers) ? db.drivers : [];
    db.items = Array.isArray(db.items) ? db.items : [];
    db.invoices = Array.isArray(db.invoices) ? db.invoices : [];
    db.shifts = Array.isArray(db.shifts) ? db.shifts : [];
    db.repayments = Array.isArray(db.repayments) ? db.repayments : [];
    db.accounts = db.accounts && typeof db.accounts === "object"
      ? db.accounts
      : {};

    db.drivers.forEach(driver => {
      if (!driver.id) driver.id = uid("DRV");
      if (driver.openingBalance == null) driver.openingBalance = 0;
    });

    db.items.forEach(item => {
      if (!item.id) item.id = uid("ITEM");
      item.price = num(item.price);
    });

    db.invoices.forEach(invoice => {
      if (!invoice.id) invoice.id = uid("INV");
      if (!Array.isArray(invoice.items)) invoice.items = [];

      invoice.total = num(invoice.total);
      invoice.cashPaid = num(invoice.cashPaid);
      invoice.cardPaid = num(invoice.cardPaid);

      if (invoice.credit == null) {
        invoice.credit = Math.max(
          0,
          invoice.total - invoice.cashPaid - invoice.cardPaid
        );
      } else {
        invoice.credit = num(invoice.credit);
      }

      if (!invoice.date) invoice.date = today();
      if (!invoice.createdAt) invoice.createdAt = nowText();
    });

    db.shifts.forEach(shift => {
      if (!shift.id) shift.id = uid("SHIFT");
    });

    db.repayments.forEach(payment => {
      if (!payment.id) payment.id = uid("PAY");
      payment.amount = num(payment.amount);
    });

    return db;
  } catch (error) {
    console.error("تعذر قراءة قاعدة البيانات:", error);
    return defaultDB();
  }
}

let db = loadDB();
let activeTab = "account";
let selectedHistoryInvoice = null;

function saveDB() {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
    return true;
  } catch (error) {
    console.error(error);
    notify("تعذر حفظ البيانات. تحقق من مساحة التخزين.", "error");
    return false;
  }
}

/* ------------------------------------------
   أدوات الواجهة
   ------------------------------------------ */

function $(id) {
  return document.getElementById(id);
}

function notify(message, type = "success") {
  let toast = $("toast");

  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.className = `show ${type}`;

  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => {
    toast.className = "";
  }, 3000);
}

function ask(message) {
  return window.confirm(message);
}

function promptAmount(message, defaultValue = "") {
  const result = window.prompt(message, String(defaultValue));
  if (result === null) return null;

  const amount = Number(result);

  if (!Number.isFinite(amount) || amount < 0) {
    notify("أدخل مبلغًا صحيحًا.", "error");
    return null;
  }

  return amount;
}

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

function setHTML(id, value) {
  const element = $(id);
  if (element) element.innerHTML = value;
}

function valueOf(id) {
  return $(id) ? $("" + id).value.trim() : "";
}

function setValue(id, value) {
  if ($(id)) $(id).value = value ?? "";
}

function dateTime() {
  return new Date().toISOString();
}

function makeCode(prefix) {
  const sequence = String(db.seq++).padStart(5, "0");
  saveDB();
  return `${prefix}-${today().replaceAll("-", "")}-${sequence}`;
}

/* ------------------------------------------
   بيانات السائق والدوام
   ------------------------------------------ */

function findDriver(driverId) {
  return db.drivers.find(driver => driver.id === driverId);
}

function currentDriverId() {
  return valueOf("accountDriver");
}

function currentDriver() {
  return findDriver(currentDriverId());
}

function activeShift(driverId) {
  return db.shifts.find(
    shift => shift.driverId === driverId && !shift.closedAt
  ) || null;
}

function getOrCreateShift(driverId) {
  let shift = activeShift(driverId);

  if (!shift) {
    shift = {
      id: uid("SHIFT"),
      driverId,
      startedAt: dateTime(),
      closedAt: null,
      openingDebt: driverBalance(driverId),
      invoiceIds: [],
      note: ""
    };

    db.shifts.push(shift);
    saveDB();
  }

  return shift;
}

function driverInvoices(driverId) {
  return db.invoices.filter(invoice => invoice.driverId === driverId);
}

function invoiceTotal(invoice) {
  return Math.max(0, num(invoice.total));
}

function invoicePaid(invoice) {
  return Math.min(
    invoiceTotal(invoice),
    Math.max(0, num(invoice.cashPaid) + num(invoice.cardPaid))
  );
}

function invoiceRemaining(invoice) {
  return Math.max(0, invoiceTotal(invoice) - invoicePaid(invoice));
}

function driverRepayments(driverId) {
  return db.repayments.filter(payment => payment.driverId === driverId);
}

function driverBalance(driverId) {
  const invoices = driverInvoices(driverId);

  const totalCredit = invoices.reduce(
    (sum, invoice) => sum + invoiceRemaining(invoice),
    0
  );

  const repayments = driverRepayments(driverId).reduce(
    (sum, payment) => sum + num(payment.amount),
    0
  );

  const opening = num(findDriver(driverId)?.openingBalance);

  return Math.max(0, opening + totalCredit - repayments);
}

/* ------------------------------------------
   تبويبات النظام
   ------------------------------------------ */

function showTab(tabName) {
  activeTab = tabName;

  document.querySelectorAll("[data-tab]").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.tab === tabName
    );
  });

  document.querySelectorAll("[data-panel]").forEach(panel => {
    panel.hidden = panel.dataset.panel !== tabName;
  });

  renderAll();
}

function bindTabs() {
  document.querySelectorAll("[data-tab]").forEach(button => {
    button.addEventListener("click", () => {
      showTab(button.dataset.tab);
    });
  });
}

/* ------------------------------------------
   السائقون
   ------------------------------------------ */

function renderDriverOptions() {
  const selectors = ["accountDriver", "singleDriver"];

  selectors.forEach(id => {
    const select = $(id);
    if (!select) return;

    const previous = select.value;

    select.innerHTML =
      '<option value="">اختر السائق</option>' +
      db.drivers.map(driver => `
        <option value="${esc(driver.id)}">
          ${esc(driver.name)}
        </option>
      `).join("");

    if (db.drivers.some(driver => driver.id === previous)) {
      select.value = previous;
    }
  });
}

function addDriver() {
  const name = valueOf("driverName");
  const phone = valueOf("driverPhone");

  if (!name) {
    notify("اكتب اسم السائق.", "error");
    return;
  }

  const exists = db.drivers.some(
    driver => driver.name.trim().toLowerCase() === name.toLowerCase()
  );

  if (exists) {
    notify("هذا السائق مسجل بالفعل.", "error");
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
  saveDB();

  setValue("driverName", "");
  setValue("driverPhone", "");

  renderAll();
  notify("تمت إضافة السائق.");
}

function deleteDriver(driverId) {
  const driver = findDriver(driverId);
  if (!driver) return;

  const hasRecords =
    driverInvoices(driverId).length ||
    driverRepayments(driverId).length ||
    db.shifts.some(shift => shift.driverId === driverId);

  if (hasRecords) {
    notify("لا يمكن حذف سائق لديه فواتير أو دفعات مسجلة.", "error");
    return;
  }

  if (!ask(`حذف السائق ${driver.name}؟`)) return;

  db.drivers = db.drivers.filter(item => item.id !== driverId);
  saveDB();
  renderAll();
  notify("تم حذف السائق.");
}

function renderDrivers() {
  const target = $("driversRows");
  if (!target) return;

  if (!db.drivers.length) {
    target.innerHTML = '<tr><td colspan="5" class="empty-state">لا يوجد سائقون مسجلون.</td></tr>';
    return;
  }

  target.innerHTML = db.drivers.map(driver => {
    const invoices = driverInvoices(driver.id);
    const totalSales = invoices.reduce((sum, invoice) => sum + invoiceTotal(invoice), 0);
    const balance = driverBalance(driver.id);
    const shift = activeShift(driver.id);

    return `
      <tr>
        <td>${esc(driver.name)}</td>
        <td>${esc(driver.phone || "-")}</td>
        <td>${money(totalSales)} ر.س</td>
        <td class="${balance > 0 ? "red-text" : "green-text"}">${money(balance)} ر.س</td>
        <td>
          <span class="badge ${shift ? "green" : ""}">
            ${shift ? "دوام مفتوح" : "لا يوجد دوام مفتوح"}
          </span>
          <div class="row-actions">
            <button class="small" onclick="selectDriver('${driver.id}')">اختيار</button>
            <button class="small info" onclick="recordRepayment('${driver.id}')">تسجيل سداد</button>
            <button class="small danger" onclick="deleteDriver('${driver.id}')">حذف</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function selectDriver(driverId) {
  if (!$("accountDriver")) return;
  $("accountDriver").value = driverId;
  showTab("account");
  notify("تم اختيار السائق.");
}

/* ------------------------------------------
   الأصناف
   ------------------------------------------ */

function addItem() {
  const name = valueOf("itemName");
  const price = num(valueOf("itemPrice"));

  if (!name) {
    notify("اكتب اسم الصنف.", "error");
    return;
  }

  if (price < 0) {
    notify("السعر لا يمكن أن يكون سالبًا.", "error");
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
  notify("تمت إضافة الصنف.");
}

function editItem(itemId) {
  const item = db.items.find(entry => entry.id === itemId);
  if (!item) return;

  const name = window.prompt("اسم الصنف:", item.name);
  if (name === null) return;

  const price = promptAmount("سعر الصنف:", item.price);
  if (price === null) return;

  if (!name.trim()) {
    notify("اسم الصنف مطلوب.", "error");
    return;
  }

  item.name = name.trim();
  item.price = price;

  saveDB();
  renderAll();
  notify("تم تعديل الصنف.");
}

function deleteItem(itemId) {
  const item = db.items.find(entry => entry.id === itemId);
  if (!item) return;

  if (!ask(`حذف الصنف ${item.name}؟`)) return;

  db.items = db.items.filter(entry => entry.id !== itemId);
  saveDB();
  renderAll();
  notify("تم حذف الصنف.");
}

function renderItems() {
  const target = $("itemsRows");
  if (!target) return;

  if (!db.items.length) {
    target.innerHTML = '<tr><td colspan="4" class="empty-state">لا توجد أصناف. أضف الأصناف أولًا.</td></tr>';
    renderQuickItems();
    return;
  }

  target.innerHTML = db.items.map(item => `
    <tr>
      <td>${esc(item.name)}</td>
      <td>${money(item.price)} ر.س</td>
      <td>${esc(item.id)}</td>
      <td>
        <div class="row-actions">
          <button class="small info" onclick="editItem('${item.id}')">تعديل</button>
          <button class="small danger" onclick="deleteItem('${item.id}')">حذف</button>
        </div>
      </td>
    </tr>
  `).join("");

  renderQuickItems();
}

function renderQuickItems() {
  const target = $("quickItems");
  if (!target) return;

  const search = valueOf("productSearch").toLowerCase();

  const items = db.items.filter(item =>
    item.name.toLowerCase().includes(search)
  );

  target.innerHTML = items.map(item => `
    <button class="quick-item" onclick="addItemToAccount('${item.id}')">
      <span class="product-name">${esc(item.name)}</span>
      <span class="product-price">${money(item.price)} ر.س</span>
    </button>
  `).join("");

  if (!items.length) {
    target.innerHTML = '<div class="empty-state">لا توجد أصناف مطابقة.</div>';
  }
}

/* ------------------------------------------
   سلة الفاتورة الحالية
   ------------------------------------------ */

function getCurrentAccount() {
  const driverId = currentDriverId();
  if (!driverId) return null;

  if (!db.accounts[driverId]) {
    db.accounts[driverId] = {
      items: [],
      note: "",
      updatedAt: dateTime()
    };
  }

  return db.accounts[driverId];
}

function addItemToAccount(itemId) {
  const driverId = currentDriverId();

  if (!driverId) {
    notify("اختر السائق أولًا.", "error");
    return;
  }

  const item = db.items.find(entry => entry.id === itemId);
  if (!item) return;

  const account = getCurrentAccount();
  const existing = account.items.find(entry => entry.itemId === itemId);

  if (existing) {
    existing.qty += 1;
  } else {
    account.items.push({
      itemId: item.id,
      name: item.name,
      price: num(item.price),
      qty: 1
    });
  }

  account.updatedAt = dateTime();
  saveDB();
  renderAccount();
}

function changeAccountQty(index, change) {
  const account = getCurrentAccount();
  if (!account || !account.items[index]) return;

  account.items[index].qty += change;

  if (account.items[index].qty <= 0) {
    account.items.splice(index, 1);
  }

  account.updatedAt = dateTime();
  saveDB();
  renderAccount();
}

function editAccountPrice(index) {
  const account = getCurrentAccount();
  if (!account || !account.items[index]) return;

  const item = account.items[index];
  const price = promptAmount("سعر الوحدة:", item.price);
  if (price === null) return;

  item.price = price;
  saveDB();
  renderAccount();
}

function removeAccountItem(index) {
  const account = getCurrentAccount();
  if (!account) return;

  account.items.splice(index, 1);
  saveDB();
  renderAccount();
}

function accountTotal() {
  const account = getCurrentAccount();
  if (!account) return 0;

  return account.items.reduce(
    (sum, item) => sum + num(item.price) * num(item.qty),
    0
  );
}

function renderAccount() {
  const driver = currentDriver();
  const account = getCurrentAccount();

  setText("currentDriverTitle", driver ? driver.name : "اختر السائق");
  setText("accountTotal", money(accountTotal()));

  const target = $("accountRows");
  if (target) {
    if (!account || !account.items.length) {
      target.innerHTML = '<tr><td colspan="6" class="empty-state">الفاتورة فارغة. اختر صنفًا لإضافته.</td></tr>';
    } else {
      target.innerHTML = account.items.map((item, index) => `
        <tr>
          <td>${esc(item.name)}</td>
          <td>${money(item.price)}</td>
          <td>
            <div class="row-actions">
              <button class="small secondary" onclick="changeAccountQty(${index},-1)">−</button>
              <strong>${num(item.qty)}</strong>
              <button class="small secondary" onclick="changeAccountQty(${index},1)">+</button>
            </div>
          </td>
          <td>${money(item.price * item.qty)}</td>
          <td><button class="small info" onclick="editAccountPrice(${index})">السعر</button></td>
          <td><button class="small danger" onclick="removeAccountItem(${index})">حذف</button></td>
        </tr>
      `).join("");
    }
  }

  renderQuickItems();
  renderDriverBalanceSummary();
}

function renderDriverBalanceSummary() {
  const driver = currentDriver();
  if (!driver) return;

  setText("driverBalance", money(driverBalance(driver.id)));
  setText("driverOpeningBalance", money(num(driver.openingBalance)));
}

/* ------------------------------------------
   حفظ الفاتورة مع الدفع
   ------------------------------------------ */

function paymentInput(id) {
  return Math.max(0, num(valueOf(id)));
}

function clearPaymentInputs() {
  setValue("paymentCash", "0");
  setValue("paymentCard", "0");
}

function saveCurrentInvoice() {
  const driver = currentDriver();
  const account = getCurrentAccount();

  if (!driver || !account) {
    notify("اختر السائق أولًا.", "error");
    return;
  }

  if (!account.items.length) {
    notify("الفاتورة فارغة.", "error");
    return;
  }

  const total = accountTotal();
  let cashPaid = paymentInput("paymentCash");
  let cardPaid = paymentInput("paymentCard");

  if (cashPaid + cardPaid > total) {
    notify("مجموع النقد والشبكة أكبر من قيمة الفاتورة.", "error");
    return;
  }

  if (!ask(
    `حفظ فاتورة للسائق ${driver.name}\n` +
    `الإجمالي: ${money(total)} ريال\n` +
    `نقدًا: ${money(cashPaid)} ريال\n` +
    `شبكة: ${money(cardPaid)} ريال\n` +
    `آجل: ${money(total - cashPaid - cardPaid)} ريال\n\n` +
    `هل تريد المتابعة؟`
  )) return;

  const shift = getOrCreateShift(driver.id);

  const invoice = {
    id: uid("INV"),
    code: makeCode("INV"),
    driverId: driver.id,
    driverName: driver.name,
    shiftId: shift.id,
    date: today(),
    createdAt: nowText(),
    items: account.items.map(item => ({ ...item })),
    note: valueOf("singleNote"),
    total,
    cashPaid,
    cardPaid,
    credit: Math.max(0, total - cashPaid - cardPaid),
    status: "saved"
  };

  db.invoices.push(invoice);
  shift.invoiceIds = shift.invoiceIds || [];
  shift.invoiceIds.push(invoice.id);

  db.accounts[driver.id] = {
    items: [],
    note: "",
    updatedAt: dateTime()
  };

  saveDB();
  clearPaymentInputs();
  setValue("singleNote", "");

  renderAll();
  notify(`تم حفظ الفاتورة ${invoice.code}.`);
}

function closeAccount() {
  saveCurrentInvoice();
}

function clearAccountConfirm() {
  const driver = currentDriver();
  if (!driver) {
    notify("اختر السائق أولًا.", "error");
    return;
  }

  if (!ask("هل تريد مسح أصناف الفاتورة الحالية دون حفظها؟")) return;

  db.accounts[driver.id] = {
    items: [],
    note: "",
    updatedAt: dateTime()
  };

  saveDB();
  renderAll();
  notify("تم مسح الفاتورة الحالية.");
}

/* ------------------------------------------
   فاتورة مستقلة
   ------------------------------------------ */

function addSingleInvoiceItem() {
  const driverId = valueOf("singleDriver");
  const itemId = valueOf("singleItem");
  const qty = Math.max(1, num(valueOf("singleQty")));
  const price = Math.max(0, num(valueOf("singlePrice")));

  if (!driverId) {
    notify("اختر السائق.", "error");
    return;
  }

  const item = db.items.find(entry => entry.id === itemId);

  if (!item) {
    notify("اختر صنفًا صحيحًا.", "error");
    return;
  }

  const invoice = window.__singleInvoice || (window.__singleInvoice = []);

  invoice.push({
    itemId: item.id,
    name: item.name,
    qty,
    price
  });

  renderSingleInvoice();
  setValue("singleQty", "1");
}

function renderSingleInvoice() {
  const rows = $("singleRows");
  const items = window.__singleInvoice || [];

  if (rows) {
    rows.innerHTML = items.length
      ? items.map((item, index) => `
        <tr>
          <td>${esc(item.name)}</td>
          <td>${num(item.qty)}</td>
          <td>${money(item.price)}</td>
          <td>${money(item.qty * item.price)}</td>
          <td><button class="small danger" onclick="removeSingleInvoiceItem(${index})">حذف</button></td>
        </tr>
      `).join("")
      : '<tr><td colspan="5" class="empty-state">لا توجد أصناف في الفاتورة.</td></tr>';
  }

  const total = items.reduce((sum, item) => sum + item.qty * item.price, 0);
  setText("singleTotal", money(total));
}

function removeSingleInvoiceItem(index) {
  const items = window.__singleInvoice || [];
  items.splice(index, 1);
  renderSingleInvoice();
}

function saveSingleInvoice() {
  const driver = findDriver(valueOf("singleDriver"));
  const items = window.__singleInvoice || [];

  if (!driver) {
    notify("اختر السائق.", "error");
    return;
  }

  if (!items.length) {
    notify("أضف صنفًا واحدًا على الأقل.", "error");
    return;
  }

  const total = items.reduce((sum, item) => sum + item.qty * item.price, 0);
  const cashPaid = Math.max(0, num(valueOf("singleCash")));
  const cardPaid = Math.max(0, num(valueOf("singleCard")));

  if (cashPaid + cardPaid > total) {
    notify("المدفوع أكبر من الإجمالي.", "error");
    return;
  }

  const shift = getOrCreateShift(driver.id);

  const invoice = {
    id: uid("INV"),
    code: makeCode("INV"),
    driverId: driver.id,
    driverName: driver.name,
    shiftId: shift.id,
    date: today(),
    createdAt: nowText(),
    items: items.map(item => ({ ...item })),
    note: valueOf("singleNote"),
    total,
    cashPaid,
    cardPaid,
    credit: Math.max(0, total - cashPaid - cardPaid),
    status: "saved"
  };

  db.invoices.push(invoice);
  shift.invoiceIds = shift.invoiceIds || [];
  shift.invoiceIds.push(invoice.id);

  window.__singleInvoice = [];
  saveDB();
  renderAll();
  renderSingleInvoice();

  setValue("singleNote", "");
  setValue("singleCash", "0");
  setValue("singleCard", "0");

  notify(`تم حفظ الفاتورة ${invoice.code}.`);
}

/* ------------------------------------------
   تسجيل دفعة لاحقة من السائق
   ------------------------------------------ */

function recordRepayment(driverId) {
  const driver = findDriver(driverId);
  if (!driver) return;

  const balance = driverBalance(driverId);

  if (balance <= 0) {
    notify("لا يوجد رصيد مستحق على هذا السائق.");
    return;
  }

  const amount = promptAmount(
    `رصيد السائق ${driver.name}: ${money(balance)} ريال\nأدخل مبلغ السداد:`,
    balance
  );

  if (amount === null) return;

  if (amount <= 0) {
    notify("المبلغ يجب أن يكون أكبر من صفر.", "error");
    return;
  }

  if (amount > balance) {
    notify("مبلغ السداد أكبر من الرصيد المستحق.", "error");
    return;
  }

  const method = window.prompt(
    "طريقة السداد:\n1 = نقدًا\n2 = شبكة",
    "1"
  );

  if (method === null) return;

  const normalizedMethod = method.trim() === "2" ? "شبكة" : "نقدًا";

  db.repayments.push({
    id: uid("PAY"),
    code: makeCode("PAY"),
    driverId,
    driverName: driver.name,
    amount,
    method: normalizedMethod,
    date: today(),
    createdAt: nowText(),
    note: ""
  });

  saveDB();
  renderAll();

  notify(`تم تسجيل سداد ${money(amount)} ريال.`);
}

/* ------------------------------------------
   إقفال دوام السائق
   ------------------------------------------ */

function closeShift(driverId) {
  const driver = findDriver(driverId || currentDriverId());

  if (!driver) {
    notify("اختر السائق أولًا.", "error");
    return;
  }

  const shift = activeShift(driver.id);

  if (!shift) {
    notify("لا يوجد دوام مفتوح لهذا السائق.", "error");
    return;
  }

  const account = db.accounts[driver.id];

  if (account && account.items && account.items.length) {
    if (!ask("توجد أصناف غير محفوظة. إقفال الدوام دون حفظها؟")) return;
  }

  const shiftInvoices = db.invoices.filter(
    invoice => invoice.shiftId === shift.id
  );

  const total = shiftInvoices.reduce(
    (sum, invoice) => sum + invoiceTotal(invoice), 0
  );

  const cash = shiftInvoices.reduce(
    (sum, invoice) => sum + num(invoice.cashPaid), 0
  );

  const card = shiftInvoices.reduce(
    (sum, invoice) => sum + num(invoice.cardPaid), 0
  );

  const credit = shiftInvoices.reduce(
    (sum, invoice) => sum + invoiceRemaining(invoice), 0
  );

  const balance = driverBalance(driver.id);

  if (!ask(
    `إقفال دوام ${driver.name}؟\n\n` +
    `إجمالي الفواتير: ${money(total)} ريال\n` +
    `نقدًا: ${money(cash)} ريال\n` +
    `شبكة: ${money(card)} ريال\n` +
    `الرصيد الآجل للدوام: ${money(credit)} ريال\n` +
    `إجمالي رصيد السائق بعد الإقفال: ${money(balance)} ريال\n\n` +
    `سيبقى الرصيد المستحق محفوظًا على السائق.`
  )) return;

  shift.closedAt = dateTime();
  shift.total = total;
  shift.cash = cash;
  shift.card = card;
  shift.credit = credit;
  shift.balanceAtClose = balance;

  saveDB();
  renderAll();
  notify("تم إقفال الدوام وحفظ كشف السائق.");
}

/* ------------------------------------------
   سجل الفواتير
   ------------------------------------------ */

function renderHistory() {
  const target = $("historyRows");
  if (!target) return;

  const search = valueOf("historySearch").toLowerCase();
  const type = valueOf("historyType");

  let invoices = [...db.invoices];

  if (search) {
    invoices = invoices.filter(invoice =>
      String(invoice.code || "").toLowerCase().includes(search) ||
      String(invoice.driverName || "").toLowerCase().includes(search)
    );
  }

  if (type === "paid") {
    invoices = invoices.filter(invoice => invoiceRemaining(invoice) === 0);
  } else if (type === "unpaid") {
    invoices = invoices.filter(invoice => invoiceRemaining(invoice) > 0);
  }

  invoices.sort((a, b) =>
    String(b.createdAt).localeCompare(String(a.createdAt))
  );

  if (!invoices.length) {
    target.innerHTML = '<tr><td colspan="8" class="empty-state">لا توجد فواتير مطابقة.</td></tr>';
    return;
  }

  target.innerHTML = invoices.map(invoice => `
    <tr>
      <td>${esc(invoice.code)}</td>
      <td>${esc(invoice.date)}</td>
      <td>${esc(invoice.driverName)}</td>
      <td>${money(invoiceTotal(invoice))}</td>
      <td>${money(invoice.cashPaid)}</td>
      <td>${money(invoice.cardPaid)}</td>
      <td class="${invoiceRemaining(invoice) > 0 ? "red-text" : "green-text"}">${money(invoiceRemaining(invoice))}</td>
      <td>
        <div class="row-actions">
          <button class="small info" onclick="printInvoice('${invoice.id}')">طباعة</button>
          <button class="small secondary" onclick="showInvoiceDetails('${invoice.id}')">تفاصيل</button>
        </div>
      </td>
    </tr>
  `).join("");
}

function showInvoiceDetails(invoiceId) {
  const invoice = db.invoices.find(entry => entry.id === invoiceId);
  if (!invoice) return;

  const itemText = invoice.items.map(item =>
    `${item.name} × ${item.qty} = ${money(item.price * item.qty)} ريال`
  ).join("\n");

  window.alert(
    `فاتورة: ${invoice.code}\n` +
    `السائق: ${invoice.driverName}\n` +
    `التاريخ: ${invoice.date}\n\n` +
    `${itemText}\n\n` +
    `الإجمالي: ${money(invoice.total)} ريال\n` +
    `نقدًا: ${money(invoice.cashPaid)} ريال\n` +
    `شبكة: ${money(invoice.cardPaid)} ريال\n` +
    `المتبقي: ${money(invoiceRemaining(invoice))} ريال`
  );
}

/* ------------------------------------------
   الطباعة الحرارية
   ------------------------------------------ */

function printInvoice(invoiceId) {
  const invoice = db.invoices.find(entry => entry.id === invoiceId);
  if (!invoice) return;

  const target = $("printArea");
  if (!target) {
    notify("منطقة الطباعة غير موجودة في الصفحة.", "error");
    return;
  }

  target.innerHTML = `
    <div class="receipt">
      <h1>ديرتي</h1>
      <h2>فاتورة سائق</h2>
      <p>رقم الفاتورة: ${esc(invoice.code)}</p>
      <p>السائق: ${esc(invoice.driverName)}</p>
      <p>التاريخ: ${esc(invoice.date)}</p>
      <p>وقت الحفظ: ${esc(invoice.createdAt || "")}</p>
      <hr>
      <table>
        <thead>
          <tr>
            <th>الصنف</th>
            <th>العدد</th>
            <th>السعر</th>
            <th>الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          ${invoice.items.map(item => `
            <tr>
              <td>${esc(item.name)}</td>
              <td>${num(item.qty)}</td>
              <td>${money(item.price)}</td>
              <td>${money(item.price * item.qty)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      <div class="receipt-total">
        <div><span>الإجمالي</span><strong>${money(invoiceTotal(invoice))} ر.س</strong></div>
        <div><span>نقدًا</span><strong>${money(invoice.cashPaid)} ر.س</strong></div>
        <div><span>شبكة</span><strong>${money(invoice.cardPaid)} ر.س</strong></div>
        <div><span>المتبقي</span><strong>${money(invoiceRemaining(invoice))} ر.س</strong></div>
      </div>
      ${invoice.note ? `<p>ملاحظات: ${esc(invoice.note)}</p>` : ""}
      <hr>
      <p style="text-align:center">شكرًا لكم</p>
    </div>
  `;

  window.print();
}

/* ------------------------------------------
   لوحة السداد والرصيد
   ------------------------------------------ */

function renderRepayments() {
  const target = $("repaymentRows");
  if (!target) return;

  const payments = [...db.repayments].sort((a, b) =>
    String(b.createdAt).localeCompare(String(a.createdAt))
  );

  if (!payments.length) {
    target.innerHTML = '<tr><td colspan="5" class="empty-state">لا توجد دفعات مسجلة.</td></tr>';
    return;
  }

  target.innerHTML = payments.map(payment => `
    <tr>
      <td>${esc(payment.date)}</td>
      <td>${esc(payment.driverName)}</td>
      <td>${money(payment.amount)} ر.س</td>
      <td>${esc(payment.method || "نقدًا")}</td>
      <td>${esc(payment.code || payment.id)}</td>
    </tr>
  `).join("");
}

function renderShiftSummary() {
  const target = $("shiftRows");
  if (!target) return;

  const shifts = [...db.shifts].sort((a, b) =>
    String(b.startedAt).localeCompare(String(a.startedAt))
  );

  if (!shifts.length) {
    target.innerHTML = '<tr><td colspan="7" class="empty-state">لا توجد دوامات مسجلة.</td></tr>';
    return;
  }

  target.innerHTML = shifts.map(shift => {
    const driver = findDriver(shift.driverId);
    const invoices = db.invoices.filter(invoice => invoice.shiftId === shift.id);

    const total = invoices.reduce((sum, invoice) => sum + invoiceTotal(invoice), 0);
    const cash = invoices.reduce((sum, invoice) => sum + num(invoice.cashPaid), 0);
    const card = invoices.reduce((sum, invoice) => sum + num(invoice.cardPaid), 0);
    const remaining = invoices.reduce((sum, invoice) => sum + invoiceRemaining(invoice), 0);

    return `
      <tr>
        <td>${esc(driver?.name || "سائق محذوف")}</td>
        <td>${esc(new Date(shift.startedAt).toLocaleString("ar-SA"))}</td>
        <td>${shift.closedAt ? esc(new Date(shift.closedAt).toLocaleString("ar-SA")) : "مفتوح"}</td>
        <td>${money(total)} ر.س</td>
        <td>${money(cash)} ر.س</td>
        <td>${money(card)} ر.س</td>
        <td>${money(remaining)} ر.س</td>
      </tr>
    `;
  }).join("");
}

/* ------------------------------------------
   تصدير واستيراد نسخة احتياطية
   ------------------------------------------ */

function exportBackup() {
  const blob = new Blob(
    [JSON.stringify(db, null, 2)],
    { type: "application/json;charset=utf-8" }
  );

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = `deerty-backup-${today()}.json`;
  anchor.click();

  URL.revokeObjectURL(url);
  notify("تم تنزيل النسخة الاحتياطية.");
}

function importBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);

      if (
        !imported ||
        !Array.isArray(imported.drivers) ||
        !Array.isArray(imported.items) ||
        !Array.isArray(imported.invoices)
      ) {
        throw new Error("صيغة النسخة غير صحيحة");
      }

      if (!ask("سيتم استبدال بيانات النظام الحالية ببيانات النسخة الاحتياطية. هل تريد المتابعة؟")) {
        event.target.value = "";
        return;
      }

      db = {
        ...defaultDB(),
        ...imported,
        shifts: Array.isArray(imported.shifts) ? imported.shifts : [],
        repayments: Array.isArray(imported.repayments) ? imported.repayments : []
      };

      saveDB();
      renderAll();
      notify("تم استيراد النسخة الاحتياطية.");
    } catch (error) {
      console.error(error);
      notify("تعذر استيراد الملف. تأكد أنه نسخة احتياطية صحيحة.", "error");
    }

    event.target.value = "";
  };

  reader.readAsText(file);
}

/* ------------------------------------------
   التثبيت والتطبيق
   ------------------------------------------ */

let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredInstallPrompt = event;

  const button = $("installBtn");
  if (button) button.hidden = false;
});

async function installApp() {
  if (!deferredInstallPrompt) {
    notify("من قائمة المتصفح اختر إضافة إلى الشاشة الرئيسية.");
    return;
  }

  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;

  if ($("installBtn")) $("installBtn").hidden = true;
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(error => {
      console.warn("Service worker registration failed:", error);
    });
  });
}

/* ------------------------------------------
   عرض جميع البيانات
   ------------------------------------------ */

function renderAll() {
  renderDriverOptions();
  renderDrivers();
  renderItems();
  renderAccount();
  renderSingleInvoice();
  renderHistory();
  renderRepayments();
  renderShiftSummary();
}

function bindEvents() {
  $("driverName")?.addEventListener("keydown", event => {
    if (event.key === "Enter") addDriver();
  });

  $("itemName")?.addEventListener("keydown", event => {
    if (event.key === "Enter") addItem();
  });

  $("accountDriver")?.addEventListener("change", () => {
    renderAccount();
  });

  $("productSearch")?.addEventListener("input", renderQuickItems);
  $("historySearch")?.addEventListener("input", renderHistory);
  $("historyType")?.addEventListener("change", renderHistory);

  $("installBtn")?.addEventListener("click", installApp);
  $("importFile")?.addEventListener("change", importBackup);
}

function init() {
  bindTabs();
  bindEvents();
  renderAll();
  registerServiceWorker();

  if ($("installBtn")) {
    $("installBtn").hidden = true;
  }
}

document.addEventListener("DOMContentLoaded", init);

/* إتاحة الدوال للأزرار الموجودة في HTML */
Object.assign(window, {
  showTab,
  addDriver,
  deleteDriver,
  selectDriver,
  addItem,
  editItem,
  deleteItem,
  addItemToAccount,
  changeAccountQty,
  editAccountPrice,
  removeAccountItem,
  saveCurrentInvoice,
  closeAccount,
  clearAccountConfirm,
  addSingleInvoiceItem,
  removeSingleInvoiceItem,
  saveSingleInvoice,
  recordRepayment,
  closeShift,
  printInvoice,
  showInvoiceDetails,
  exportBackup,
  importBackup
});
