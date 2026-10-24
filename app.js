/* ديرتي | حسابات السائقين اليومية */
"use strict";

const DB_KEY = "deerty_new_daily_v1";

const $ = id => document.getElementById(id);

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const num = value => Math.max(0, Number(value) || 0);

const fmt = value =>
  `${(Number(value) || 0).toLocaleString("en-US", {
    maximumFractionDigits: 2
  })} ر.س`;

const uid = () =>
  `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const esc = value =>
  String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);

const dateLabel = value => {
  if (!value) return "—";
  const [y, m, d] = value.split("-");
  return `${d}/${m}/${y}`;
};

/* البيانات الافتراضية */
function seedDB() {
  return {
    version: 1,
    nextInvoiceNumber: 1,

    drivers: [
      { id: uid(), name: "مروان", phone: "", active: true },
      { id: uid(), name: "السائق الثاني", phone: "", active: true }
    ],

    items: [
      { id: uid(), name: "ربع دجاج رز شعبي", price: 8.50, category: "دجاج", active: true },
      { id: uid(), name: "ربع دجاج رز بشاور", price: 9, category: "دجاج", active: true },
      { id: uid(), name: "مشكل خضار", price: 10, category: "دجاج", active: true },
      { id: uid(), name: "رز", price: 9, category: "أرز", active: true },
      { id: uid(), name: "ببسي صغير", price: 3, category: "لحم", active: true },
      { id: uid(), name: "ببسي وسط", price: 5, category: "مشويات", active: true },
      { id: uid(), name: "ببسي كبير", price: 9, category: "مقبلات", active: true }
    ],

    invoices: []
  };
}

/* تحميل البيانات المحفوظة */
function loadDB() {
  try {
    const raw = localStorage.getItem(DB_KEY);

    if (!raw) {
      const fresh = seedDB();
      localStorage.setItem(DB_KEY, JSON.stringify(fresh));
      return fresh;
    }

    const data = JSON.parse(raw);

    return {
      version: 1,
      nextInvoiceNumber: 1,
      drivers: [],
      items: [],
      invoices: [],
      ...data,

      drivers: Array.isArray(data.drivers) ? data.drivers : [],
      items: Array.isArray(data.items) ? data.items : [],
      invoices: Array.isArray(data.invoices) ? data.invoices : []
    };
  } catch (error) {
    console.error(error);
    return seedDB();
  }
}

let db = loadDB();
let cart = [];
let editingDriverId = null;
let editingItemId = null;
let confirmAction = null;
let installPrompt = null;

/* حفظ البيانات */
function saveDB() {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch (error) {
    console.error(error);
    toast("تعذر حفظ البيانات. صدّر نسخة احتياطية أو وفر مساحة بالجهاز.", "error");
  }

  renderSummary();
}

/* رسائل التنبيه */
function toast(message, type = "") {
  const el = $("toast");
  if (!el) return;

  el.textContent = message;
  el.className = `toast show ${type}`;

  clearTimeout(toast.timer);

  toast.timer = setTimeout(() => {
    el.className = "toast";
  }, 2600);
}

/* التنقل بين الأقسام */
function showTab(tab) {
  document.querySelectorAll(".tab-panel").forEach(panel => {
    panel.classList.toggle("active", panel.id === `tab-${tab}`);
  });

  document.querySelectorAll("[data-tab]").forEach(button => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });

  if (tab === "account") {
    renderDriverSelect();
    renderQuickItems();
    renderCart();
    updatePayment();
  }

  if (tab === "drivers") renderDrivers();
  if (tab === "items") renderItems();

  if (tab === "reports") {
    renderHistory();
    renderReport();
  }

  if (tab === "home") renderHome();
}

/* نافذة تأكيد العمليات */
function askConfirm(title, message, fn, button = "تأكيد") {
  confirmAction = fn;

  $("confirmTitle").textContent = title;
  $("confirmMessage").textContent = message;
  $("confirmActionBtn").textContent = button;

  $("confirmActionBtn").onclick = () => {
    const run = confirmAction;
    closeConfirm();

    if (run) run();
  };

  $("confirmModal").classList.add("open");
}

function closeConfirm() {
  confirmAction = null;
  $("confirmModal").classList.remove("open");
}

/* =========================
   السائقون
========================= */

function renderDriverSelect() {
  const select = $("accountDriver");
  if (!select) return;

  const oldValue = select.value;

  select.innerHTML =
    '<option value="">اختر السائق</option>' +
    db.drivers
      .filter(driver => driver.active !== false)
      .map(driver =>
        `<option value="${esc(driver.id)}">${esc(driver.name)}</option>`
      )
      .join("");

  if (db.drivers.some(driver =>
    driver.id === oldValue && driver.active !== false
  )) {
    select.value = oldValue;
  }
}

function addDriver() {
  const name = $("driverName").value.trim();
  const phone = $("driverPhone").value.trim();

  if (!name) {
    return toast("اكتب اسم السائق", "error");
  }

  const duplicate = db.drivers.some(driver =>
    driver.name.toLowerCase() === name.toLowerCase() &&
    driver.id !== editingDriverId
  );

  if (duplicate) {
    return toast("اسم السائق موجود مسبقاً", "error");
  }

  if (editingDriverId) {
    const driver = db.drivers.find(item => item.id === editingDriverId);

    if (driver) {
      Object.assign(driver, { name, phone });
    }

    editingDriverId = null;
    $("addDriverBtn").textContent = "إضافة سائق";
  } else {
    db.drivers.push({
      id: uid(),
      name,
      phone,
      active: true
    });
  }

  $("driverName").value = "";
  $("driverPhone").value = "";

  saveDB();
  renderDrivers();
  renderDriverSelect();

  toast("تم حفظ السائق");
}

function editDriver(id) {
  const driver = db.drivers.find(item => item.id === id);
  if (!driver) return;

  editingDriverId = id;

  $("driverName").value = driver.name;
  $("driverPhone").value = driver.phone || "";
  $("addDriverBtn").textContent = "حفظ التعديل";

  showTab("drivers");
}

function deleteDriver(id) {
  const driver = db.drivers.find(item => item.id === id);
  if (!driver) return;

  const hasInvoices = db.invoices.some(invoice =>
    invoice.driverId === id
  );

  if (hasInvoices) {
    return askConfirm(
      "تعطيل السائق",
      `لدى ${driver.name} فواتير محفوظة. سيتم تعطيله بدلاً من حذف سجله.`,
      () => {
        driver.active = false;
        saveDB();
        renderDrivers();
        renderDriverSelect();
        toast("تم تعطيل السائق");
      },
      "تعطيل"
    );
  }

  askConfirm(
    "حذف السائق",
    `هل تريد حذف السائق ${driver.name}؟`,
    () => {
      db.drivers = db.drivers.filter(item => item.id !== id);

      saveDB();
      renderDrivers();
      renderDriverSelect();

      toast("تم حذف السائق");
    },
    "حذف"
  );
}

function renderDrivers() {
  $("driversRows").innerHTML = db.drivers.map(driver => `
    <tr>
      <td>${esc(driver.name)}</td>
      <td>${esc(driver.phone || "—")}</td>
      <td>${driver.active === false ? "غير نشط" : "نشط"}</td>
      <td>
        <button onclick="editDriver('${esc(driver.id)}')">تعديل</button>
        <button onclick="deleteDriver('${esc(driver.id)}')">
          ${driver.active === false ? "حذف" : "حذف/تعطيل"}
        </button>
      </td>
    </tr>
  `).join("") || `
    <tr><td colspan="4">لا يوجد سائقون</td></tr>
  `;
}

/* =========================
   المنتجات
========================= */

function addItem() {
  const name = $("itemName").value.trim();
  const price = Number($("itemPrice").value);
  const category = $("itemCategory").value.trim();

  if (!name) {
    return toast("اكتب اسم المنتج", "error");
  }

  if (!Number.isFinite(price) || price < 0) {
    return toast("اكتب سعراً صحيحاً", "error");
  }

  if (editingItemId) {
    const item = db.items.find(product => product.id === editingItemId);

    if (item) {
      Object.assign(item, { name, price, category });
    }

    editingItemId = null;
    $("addItemBtn").textContent = "إضافة منتج";
  } else {
    db.items.push({
      id: uid(),
      name,
      price,
      category,
      active: true
    });
  }

  $("itemName").value = "";
  $("itemPrice").value = "";
  $("itemCategory").value = "";

  saveDB();
  renderItems();
  renderQuickItems();

  toast("تم حفظ المنتج");
}

function editItem(id) {
  const item = db.items.find(product => product.id === id);
  if (!item) return;

  editingItemId = id;

  $("itemName").value = item.name;
  $("itemPrice").value = item.price;
  $("itemCategory").value = item.category || "";
  $("addItemBtn").textContent = "حفظ التعديل";

  showTab("items");
}

function deleteItem(id) {
  const item = db.items.find(product => product.id === id);
  if (!item) return;

  askConfirm(
    "حذف المنتج",
    `هل تريد حذف ${item.name} من قائمة المنتجات؟ الفواتير السابقة لن تتغير.`,
    () => {
      db.items = db.items.filter(product => product.id !== id);

      saveDB();
      renderItems();
      renderQuickItems();

      toast("تم حذف المنتج");
    },
    "حذف"
  );
}

function renderItems() {
  $("itemsRows").innerHTML = db.items.map(item => `
    <tr>
      <td>${esc(item.name)}</td>
      <td>${esc(item.category || "—")}</td>
      <td>${fmt(item.price)}</td>
      <td>
        <button onclick="editItem('${esc(item.id)}')">تعديل</button>
        <button onclick="deleteItem('${esc(item.id)}')">حذف</button>
      </td>
    </tr>
  `).join("") || `
    <tr><td colspan="4">لا توجد منتجات</td></tr>
  `;
}

/* =========================
   الأزرار السريعة
========================= */

function renderQuickItems() {
  const search = ($("productSearch").value || "")
    .trim()
    .toLocaleLowerCase("ar");

  const list = db.items.filter(item =>
    item.active !== false &&
    (
      !search ||
      `${item.name} ${item.category || ""}`
        .toLocaleLowerCase("ar")
        .includes(search)
    )
  );

  $("quickItems").innerHTML = list.map(item => `
    <article class="product-card">
      <div class="product-name">${esc(item.name)}</div>

      <div class="product-price">
        ${fmt(item.price)}
        <span class="muted">للوحدة</span>
      </div>

      <div class="product-add-row">
        <input
          id="qty-${esc(item.id)}"
          type="number"
          min="1"
          step="1"
          value=""
          inputmode="numeric"
          aria-label="كمية ${esc(item.name)}"
        >

        <button
          class="btn btn-primary"
          type="button"
          onclick="addProductToCart('${esc(item.id)}')"
        >
          إضافة للحساب
        </button>
      </div>
    </article>
  `).join("") || `
    <p class="muted">لا توجد منتجات. أضف منتجات من تبويب المنتجات.</p>
  `;
}

/* إضافة منتج للحساب */
function addProductToCart(id) {
  const item = db.items.find(product => product.id === id);
  if (!item) return;

  const input = $(`qty-${id}`);
  const qty = Math.floor(Number(input?.value) || 0);

  if (qty < 1) {
    return toast("اكتب كمية صحيحة أكبر من صفر", "error");
  }

  /*
    إذا تكرر المنتج بنفس الاسم والسعر،
    نجمع الكمية في سطر واحد.
  */
  const existing = cart.find(line =>
    line.name.trim().toLocaleLowerCase("ar") ===
      item.name.trim().toLocaleLowerCase("ar") &&
    Number(line.price) === Number(item.price)
  );

  if (existing) {
    existing.qty += qty;
  } else {
    cart.push({
      id: uid(),
      itemId: item.id,
      name: item.name,
      price: Number(item.price),
      qty
    });
  }

  if (input) input.value = "";

  renderCart();
  updatePayment();

  toast(`تمت إضافة ${item.name} × ${qty}`);
}

/* =========================
   الحساب الحالي
========================= */

function renderCart() {
  $("accountRows").innerHTML = cart.map(line => `
    <tr>
      <td>${esc(line.name)}</td>
      <td>${fmt(line.price)}</td>

      <td>
        <input
          class="qty-edit"
          type="number"
          min="1"
          step="1"
          value="${line.qty}"
          inputmode="numeric"
          onchange="editCartQty('${esc(line.id)}', this.value)"
        >
      </td>

      <td>${fmt(line.price * line.qty)}</td>

      <td>
        <button onclick="removeCartLine('${esc(line.id)}')">حذف</button>
      </td>
    </tr>
  `).join("") || `
    <tr>
      <td colspan="5">اختر المنتجات لإضافتها إلى الحساب</td>
    </tr>
  `;
}

function editCartQty(id, value) {
  const line = cart.find(item => item.id === id);
  if (!line) return;

  const qty = Math.floor(Number(value) || 0);

  if (qty < 1) {
    cart = cart.filter(item => item.id !== id);
  } else {
    line.qty = qty;
  }

  renderCart();
  updatePayment();
}

function removeCartLine(id) {
  cart = cart.filter(line => line.id !== id);

  renderCart();
  updatePayment();
}

function cartTotal() {
  return cart.reduce((sum, line) =>
    sum + num(line.price) * Math.max(0, Number(line.qty) || 0),
    0
  );
}

function updatePayment() {
  const total = cartTotal();
  const cash = num($("paymentCash").value);
  const card = num($("paymentCard").value);

  $("accountTotal").textContent = fmt(total);
  $("paymentPaid").textContent = fmt(cash + card);
  $("paymentRemaining").textContent = fmt(
    Math.max(0, total - cash - card)
  );
}

function clearAccountConfirm() {
  askConfirm(
    "مسح الحساب الحالي",
    "سيتم مسح المنتجات غير المحفوظة فقط.",
    () => {
      cart = [];

      $("accountNote").value = "";
      $("paymentCash").value = "";
      $("paymentCard").value = "";

      renderCart();
      updatePayment();

      toast("تم مسح الحساب الحالي");
    },
    "مسح"
  );
}

/* حفظ حساب السائق */
function closeAccount() {
  const driverId = $("accountDriver").value;

  if (!driverId) {
    return toast("اختر السائق أولاً", "error");
  }

  if (!cart.length) {
    return toast("أضف منتجاً واحداً على الأقل", "error");
  }

  const total = cartTotal();
  const cash = num($("paymentCash").value);
  const card = num($("paymentCard").value);

  if (cash + card > total + 0.001) {
    return toast("المبالغ المدفوعة أكبر من الإجمالي", "error");
  }

  const driver = db.drivers.find(item => item.id === driverId);

  const invoice = {
    id: uid(),
    number: db.nextInvoiceNumber++,
    type: "account",
    driverId,
    driverName: driver?.name || "سائق",
    date: todayISO(),
    createdAt: new Date().toISOString(),
    lines: cart.map(line => ({ ...line })),
    subtotal: total,
    discount: 0,
    total,
    cash,
    card,
    remaining: Math.max(0, total - cash - card),
    note: $("accountNote").value.trim()
  };

  db.invoices.push(invoice);

  saveDB();

  cart = [];

  $("accountNote").value = "";
  $("paymentCash").value = "";
  $("paymentCard").value = "";

  renderCart();
  updatePayment();
  renderHome();
  renderHistory();
  renderReport();

  toast(`تم حفظ الحساب رقم ${invoice.number}`);

  printInvoice(invoice);
}

/* =========================
   الإحصائيات والتقارير
========================= */

function getInvoicesForDate(date) {
  return db.invoices.filter(invoice => invoice.date === date);
}

function getStats(date = todayISO()) {
  return getInvoicesForDate(date).reduce((stats, invoice) => {
    stats.total += num(invoice.total);
    stats.cash += num(invoice.cash);
    stats.card += num(invoice.card);

    stats.credit += Math.max(
      0,
      num(invoice.total) - num(invoice.cash) - num(invoice.card)
    );

    stats.count++;

    return stats;
  }, {
    total: 0,
    cash: 0,
    card: 0,
    credit: 0,
    count: 0
  });
}

function renderSummary() {
  const stats = getStats(todayISO());

  $("headerTodayTotal").textContent = fmt(stats.total);
  $("headerTodayCash").textContent = fmt(stats.cash);
  $("headerTodayCard").textContent = fmt(stats.card);
  $("headerTodayCredit").textContent = fmt(stats.credit);

  $("driverCount").textContent =
    db.drivers.filter(driver => driver.active !== false).length;

  $("itemCount").textContent = db.items.length;
  $("homeInvoiceCount").textContent = stats.count;
}

function renderHome() {
  renderSummary();

  const rows = getInvoicesForDate(todayISO())
    .slice()
    .sort((a, b) =>
      (b.createdAt || "").localeCompare(a.createdAt || "")
    );

  $("homeRows").innerHTML = rows.map(invoice => `
    <tr>
      <td>${invoice.number}</td>
      <td>${esc(invoice.driverName)}</td>
      <td>${fmt(invoice.total)}</td>
      <td>${fmt(invoice.cash)}</td>
      <td>${fmt(invoice.card)}</td>
      <td>${fmt(Math.max(0, invoice.total - invoice.cash - invoice.card))}</td>
    </tr>
  `).join("") || `
    <tr><td colspan="6">لا توجد حسابات مسجلة اليوم</td></tr>
  `;
}

function renderReport() {
  const date = $("reportDate").value || todayISO();
  const stats = getStats(date);

  $("dailyTotal").textContent = fmt(stats.total);
  $("dailyCash").textContent = fmt(stats.cash);
  $("dailyCard").textContent = fmt(stats.card);
  $("dailyCredit").textContent = fmt(stats.credit);

  const invoices = getInvoicesForDate(date);

  $("dayRows").innerHTML = invoices.map(invoice => `
    <tr>
      <td>${invoice.number}</td>
      <td>${esc(invoice.driverName)}</td>
      <td>${invoice.type === "final" ? "نهائية" : "حساب يومي"}</td>
      <td>${fmt(invoice.total)}</td>
      <td>${fmt(invoice.cash)}</td>
      <td>${fmt(invoice.card)}</td>
      <td>${fmt(Math.max(0, invoice.total - invoice.cash - invoice.card))}</td>
    </tr>
  `).join("") || `
    <tr><td colspan="7">لا توجد فواتير في هذا اليوم</td></tr>
  `;
}

function renderHistory() {
  const search = ($("historySearch").value || "")
    .trim()
    .toLocaleLowerCase("ar");

  const type = $("historyType").value;

  const rows = db.invoices
    .slice()
    .sort((a, b) =>
      (b.createdAt || "").localeCompare(a.createdAt || "")
    )
    .filter(invoice => {
      if (type === "final" && invoice.type !== "final") return false;
      if (type === "single" && invoice.type === "final") return false;

      const text = `${invoice.number} ${invoice.driverName} ${invoice.note || ""} ${invoice.date}`
        .toLocaleLowerCase("ar");

      return !search || text.includes(search);
    });

  $("historyRows").innerHTML = rows.map(invoice => `
    <tr>
      <td>${invoice.number}</td>
      <td>${dateLabel(invoice.date)}</td>
      <td>${esc(invoice.driverName)}</td>
      <td>${invoice.type === "final" ? "نهائية" : "حساب يومي"}</td>
      <td>${fmt(invoice.total)}</td>
      <td>${fmt(invoice.cash)}</td>
      <td>${fmt(invoice.card)}</td>
      <td>${fmt(Math.max(0, invoice.total - invoice.cash - invoice.card))}</td>

      <td>
        <button onclick="printInvoiceById('${esc(invoice.id)}')">طباعة</button>
        <button onclick="deleteInvoice('${esc(invoice.id)}')">حذف</button>
      </td>
    </tr>
  `).join("") || `
    <tr><td colspan="9">لا توجد فواتير مطابقة</td></tr>
  `;
}

function deleteInvoice(id) {
  const invoice = db.invoices.find(item => item.id === id);
  if (!invoice) return;

  askConfirm(
    "حذف الفاتورة",
    `هل تريد حذف الفاتورة رقم ${invoice.number}؟`,
    () => {
      db.invoices = db.invoices.filter(item => item.id !== id);

      saveDB();
      renderHistory();
      renderReport();
      renderHome();

      toast("تم حذف الفاتورة");
    },
    "حذف"
  );
}

function clearAllAccountsConfirm() {
  askConfirm(
    "مسح جميع الفواتير",
    "سيتم حذف كل الفواتير المحفوظة من هذا الجهاز. لا يمكن التراجع.",
    () => {
      db.invoices = [];
      db.nextInvoiceNumber = 1;

      saveDB();
      renderHistory();
      renderReport();
      renderHome();

      toast("تم مسح جميع الفواتير");
    },
    "حذف الجميع"
  );
}

/* تجميع الأصناف المتطابقة بالاسم والسعر */
function aggregateItems(invoices) {
  const map = new Map();

  invoices.forEach(invoice => {
    (invoice.lines || []).forEach(line => {
      const name = String(line.name || "صنف").trim();
      const price = num(line.price);
      const key = `${name.toLocaleLowerCase("ar")}__${price}`;

      if (!map.has(key)) {
        map.set(key, {
          name,
          price,
          qty: 0,
          total: 0
        });
      }

      const row = map.get(key);
      const qty = Math.max(0, Number(line.qty) || 0);

      row.qty += qty;
      row.total += price * qty;
    });
  });

  return [...map.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "ar") || a.price - b.price
  );
}

/* =========================
   طباعة التقرير اليومي
========================= */

function printDailyReport() {
  const date = $("reportDate").value || todayISO();
  const selectedDriver = $("reportDriver")?.value || "all";

  let invoices = getInvoicesForDate(date);

  // اختيار فواتير السائق المحدد فقط
  if (selectedDriver !== "all") {
    invoices = invoices.filter(invoice =>
      invoice.driverId === selectedDriver
    );
  }

  if (!invoices.length) {
    toast("لا توجد فواتير لهذا الاختيار في هذا اليوم", "error");
    return;
  }

  const area = $("printArea");
  const items = aggregateItems(invoices);

  const total = invoices.reduce(
    (sum, invoice) => sum + Number(invoice.total || 0),
    0
  );

  const cash = invoices.reduce(
    (sum, invoice) => sum + Number(invoice.cash || 0),
    0
  );

  const card = invoices.reduce(
    (sum, invoice) => sum + Number(invoice.card || 0),
    0
  );

  const remaining = Math.max(0, total - cash - card);

  const driverNames = [
    ...new Set(
      invoices.map(invoice => invoice.driverName || "غير معروف")
    )
  ];

  const title = selectedDriver === "all"
    ? "تقرير الأصناف اليومي"
    : `تقرير السائق: ${driverNames.join("، ")}`;

  area.innerHTML = `
    <div class="print-receipt daily-print" dir="rtl">

      <h2>مطعم ديرتي</h2>

      <h3>${esc(title)}</h3>

      <p>التاريخ: ${dateLabel(date)}</p>

      <p>عدد الفواتير: ${invoices.length}</p>

      <div class="rule"></div>

      <table>
        <thead>
          <tr>
            <th class="name">الصنف</th>
            <th class="qty">العدد</th>
            <th class="price">سعر الحبة</th>
            <th class="sum">الإجمالي</th>
          </tr>
        </thead>

        <tbody>
          ${items.map(item => `
            <tr>
              <td class="name">${esc(item.name)}</td>
              <td class="qty">${item.qty}</td>
              <td class="price">
                ${Number(item.price).toLocaleString("en-US")}
              </td>
              <td class="sum">
                ${Number(item.total).toLocaleString("en-US")}
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>

      <div class="rule"></div>

      <p><strong>إجمالي الحساب: ${fmt(total)}</strong></p>

      <p>النقد: ${fmt(cash)}</p>

      <p>الشبكة: ${fmt(card)}</p>

      <p><strong>المتبقي: ${fmt(remaining)}</strong></p>

      <div class="rule"></div>

      <p style="text-align:center;font-weight:900">
        ديرتي.. نكهة الأصالة
      </p>

      <p style="text-align:center">شكراً لكم</p>

    </div>
  `;

  window.print();
}
/* =========================
   طباعة فاتورة السائق
========================= */

function printInvoice(invoice) {
  const area = $("printArea");

  area.innerHTML = `
    <div class="print-receipt" dir="rtl">
      <h2>ديرتي</h2>
      <h3>فاتورة حساب سائق</h3>

      <p>رقم الفاتورة: ${invoice.number}</p>
      <p>التاريخ: ${dateLabel(invoice.date)}</p>
      <p>السائق: ${esc(invoice.driverName)}</p>

      <div class="rule"></div>

      <table>
        <thead>
          <tr>
            <th class="name">الصنف</th>
            <th class="qty">العدد</th>
            <th class="price">سعر الحبة</th>
            <th class="sum">الإجمالي</th>
          </tr>
        </thead>

        <tbody>
          ${(invoice.lines || []).map(line => `
            <tr>
              <td class="name">${esc(line.name)}</td>
              <td class="qty">${line.qty}</td>
              <td class="price">${num(line.price)}</td>
              <td class="sum">${num(line.price) * num(line.qty)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>

      <div class="rule"></div>

      <p><strong>الإجمالي: ${fmt(invoice.total)}</strong></p>
      <p>النقد: ${fmt(invoice.cash)}</p>
      <p>الشبكة: ${fmt(invoice.card)}</p>
      <p>المتبقي: ${fmt(Math.max(0, invoice.total - invoice.cash - invoice.card))}</p>

      ${invoice.note ? `<p>ملاحظات: ${esc(invoice.note)}</p>` : ""}

      <div class="rule"></div>

      <p style="text-align:center">شكراً لكم</p>
    </div>
  `;

  window.print();
}

function printInvoiceById(id) {
  const invoice = db.invoices.find(item => item.id === id);
  if (invoice) printInvoice(invoice);
}

/* =========================
   النسخ الاحتياطي والاستعادة
========================= */

function exportBackup() {
  const blob = new Blob(
    [JSON.stringify(db, null, 2)],
    { type: "application/json" }
  );

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = `deerty-backup-${todayISO()}.json`;

  a.click();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function importBackupFile(file) {
  if (!file) return;

  const reader = new FileReader();

  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);

      if (
        !Array.isArray(data.drivers) ||
        !Array.isArray(data.items) ||
        !Array.isArray(data.invoices)
      ) {
        throw new Error("ملف غير صالح");
      }

      askConfirm(
        "استعادة نسخة احتياطية",
        "ستستبدل النسخة الحالية بالبيانات الموجودة في الملف.",
        () => {
          db = {
            ...db,
            ...data
          };

          saveDB();
          renderAll();

          toast("تمت استعادة النسخة الاحتياطية");
        },
        "استعادة"
      );
    } catch (error) {
      toast("ملف النسخة الاحتياطية غير صالح", "error");
    }
  };

  reader.readAsText(file);
}

/* تحديث جميع الأقسام */
function renderAll() {
  renderSummary();
  renderHome();
  renderDrivers();
  renderItems();
  renderDriverSelect();
  renderQuickItems();
  renderCart();
  updatePayment();
  renderHistory();
  renderReport();
  renderReportDriverSelect();
}

/* تشغيل التطبيق */
function renderReportDriverSelect() {
  const select = $("reportDriver");

  if (!select) return;

  const previous = select.value || "all";

  select.innerHTML = `
    <option value="all">جميع السائقين</option>

    ${db.drivers
      .map(driver => `
        <option value="${esc(driver.id)}">
          ${esc(driver.name)}
        </option>
      `)
      .join("")}
  `;

  if (
    previous === "all" ||
    db.drivers.some(driver => driver.id === previous)
  ) {
    select.value = previous;
  }
}
function initialize() {
  if (!$("reportDate").value) {
    $("reportDate").value = todayISO();
  }

  renderAll();

  $("productSearch").addEventListener("input", renderQuickItems);

  ["paymentCash", "paymentCard"].forEach(id => {
    $(id).addEventListener("input", updatePayment);
  });

  $("reportDate").addEventListener("change", renderReport);
  $("historySearch").addEventListener("input", renderHistory);
  $("historyType").addEventListener("change", renderHistory);

  document.querySelectorAll("[data-tab]").forEach(element => {
    element.addEventListener("click", () => {
      showTab(element.dataset.tab);
    });
  });
}

/* تثبيت التطبيق */
window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();

  installPrompt = event;

  if ($("installBtn")) {
    $("installBtn").hidden = false;
  }
});

async function installApp() {
  if (!installPrompt) {
    return toast("افتح قائمة المتصفح واختر إضافة إلى الشاشة الرئيسية");
  }

  installPrompt.prompt();

  await installPrompt.userChoice;

  installPrompt = null;

  if ($("installBtn")) {
    $("installBtn").hidden = true;
  }
}

/* تشغيل Service Worker */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .catch(console.warn);
  });
}

document.addEventListener("DOMContentLoaded", initialize);

/* إتاحة الدوال للأزرار */
Object.assign(window, {
  showTab,

  addDriver,
  editDriver,
  deleteDriver,

  addItem,
  editItem,
  deleteItem,

  addProductToCart,
  editCartQty,
  removeCartLine,

  closeAccount,
  clearAccountConfirm,

  printDailyReport,
  printInvoiceById,

  deleteInvoice,
  clearAllAccountsConfirm,

  closeConfirm,
  installApp,

  exportBackup,
  importBackupFile
});
