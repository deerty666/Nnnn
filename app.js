'use strict';

/* ==========================================
   نظام فواتير السائقين - مطعم ديرتي
   ========================================== */

const KEY = 'deerty_driver_invoice_v1';

let db = loadDB();
let singleLines = [];
let deferredInstallPrompt = null;

/* ---------- البيانات والحفظ ---------- */

function emptyDB() {
  return {
    drivers: [],
    items: [],
    accounts: {},
    invoices: [],
    seq: 1001
  };
}

function loadDB() {
  try {
    const saved = localStorage.getItem(KEY);
    if (!saved) return emptyDB();

    const data = JSON.parse(saved);

    return {
      drivers: Array.isArray(data.drivers) ? data.drivers : [],
      items: Array.isArray(data.items) ? data.items : [],
      accounts: data.accounts || {},
      invoices: Array.isArray(data.invoices) ? data.invoices : [],
      seq: Number(data.seq) || 1001
    };
  } catch (error) {
    console.error('تعذر تحميل البيانات', error);
    return emptyDB();
  }
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
    renderAll();
  } catch (error) {
    alert(
      'تعذر حفظ البيانات. قد تكون مساحة التخزين ممتلئة. ' +
      'خذ نسخة احتياطية وتحقق من إعدادات المتصفح.'
    );
    console.error(error);
  }
}

function money(value) {
  return (Number(value) || 0).toLocaleString('ar-SA', {
    maximumFractionDigits: 2
  });
}

function id() {
  return db.seq++;
}

function today() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0')
  ].join('-');
}

function stamp() {
  return new Date().toLocaleString('ar-SA');
}

function toast(message) {
  const element = document.getElementById('toast');
  if (!element) return;

  element.textContent = message;
  element.style.display = 'block';

  clearTimeout(toast.timer);

  toast.timer = setTimeout(() => {
    element.style.display = 'none';
  }, 2600);
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function parseNumber(value) {
  const normalized = String(value ?? '')
    .trim()
    .replace(/٫/g, '.')
    .replace(/,/g, '.')
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));

  return Number(normalized);
}

function total(lines) {
  return lines.reduce((sum, line) => {
    return sum +
      (Number(line.qty) || 0) *
      (Number(line.price) || 0);
  }, 0);
}

function activeAccount(driverId) {
  if (!db.accounts[driverId]) {
    db.accounts[driverId] = {
      lines: [],
      updated: stamp()
    };
  }

  if (!Array.isArray(db.accounts[driverId].lines)) {
    db.accounts[driverId].lines = [];
  }

  return db.accounts[driverId];
}

/* ---------- التنقل ---------- */

function showTab(name) {
  document.querySelectorAll('.tab').forEach(section => {
    section.classList.add('hidden');
  });

  const target = document.getElementById('tab-' + name);

  if (target) {
    target.classList.remove('hidden');
  }

  document.querySelectorAll('.tabs button').forEach(button => {
    const selected = button.getAttribute('onclick')?.includes(
      "'" + name + "'"
    );

    button.classList.toggle('secondary', !selected);
  });

  renderAll();
}

/* ---------- القوائم ---------- */

function options(list, selected) {
  return list.map(item => `
    <option
      value="${item.id}"
      ${String(item.id) === String(selected) ? 'selected' : ''}
    >${esc(item.name)}</option>
  `).join('');
}

function renderSelects() {
  const accountDriver = document.getElementById('accountDriver');
  const singleDriver = document.getElementById('singleDriver');
  const singleItem = document.getElementById('singleItem');

  const oldAccount = accountDriver.value;
  const oldSingleDriver = singleDriver.value;
  const oldSingleItem = singleItem.value;

  accountDriver.innerHTML =
    options(db.drivers, oldAccount) ||
    '<option value="">أضف سائقًا أولًا</option>';

  singleDriver.innerHTML =
    options(db.drivers, oldSingleDriver) ||
    '<option value="">أضف سائقًا أولًا</option>';

  singleItem.innerHTML =
    options(db.items, oldSingleItem) ||
    '<option value="">أضف صنفًا أولًا</option>';

  if (!accountDriver.value && db.drivers.length) {
    accountDriver.value = String(db.drivers[0].id);
  }

  if (!singleDriver.value && db.drivers.length) {
    singleDriver.value = String(db.drivers[0].id);
  }
}

function renderAll() {
  renderSelects();
  renderAccount();
  renderQuickItems();
  renderDrivers();
  renderItems();
  renderHistory();
  renderStats();
  setSinglePrice();
}

/* ==========================================
   شاشة الكاشير السريعة
   ========================================== */

function currentDriver() {
  return document.getElementById('accountDriver').value;
}

function renderAccount() {
  const driverId = currentDriver();

  const account = driverId
    ? activeAccount(driverId)
    : { lines: [] };

  const body = document.getElementById('accountRows');
  const title = document.getElementById('currentDriverTitle');

  body.innerHTML = '';

  const driver = db.drivers.find(
    item => String(item.id) === String(driverId)
  );

  title.textContent = driver
    ? driver.name
    : 'اختر سائقًا';

  account.lines.forEach((line, index) => {
    body.insertAdjacentHTML('beforeend', `
      <tr>
        <td>${esc(line.name)}</td>

        <td>
          <input
            class="qty-input"
            type="text"
            inputmode="decimal"
            aria-label="الكمية"
            value="${esc(line.qty)}"
            onchange="editAccountLine(${index}, 'qty', this.value)"
          >
        </td>

        <td>
          <input
            class="price-input"
            type="text"
            inputmode="decimal"
            aria-label="السعر"
            value="${esc(line.price)}"
            onchange="editAccountLine(${index}, 'price', this.value)"
          >
        </td>

        <td class="line-sum">
          ${money(Number(line.qty) * Number(line.price))}
        </td>

        <td>
          <button
            class="danger small"
            onclick="removeAccountLine(${index})"
            aria-label="حذف الصنف"
          >×</button>
        </td>
      </tr>
    `);
  });

  if (!account.lines.length) {
    body.innerHTML = `
      <tr>
        <td colspan="5" class="empty">
          لا توجد أصناف في الحساب المفتوح
        </td>
      </tr>
    `;
  }

  document.getElementById('accountTotal').textContent =
    money(total(account.lines));
}

function renderQuickItems() {
  const box = document.getElementById('quickItems');
  if (!box) return;

  const search = (
    document.getElementById('productSearch')?.value || ''
  ).trim().toLowerCase();

  const items = db.items.filter(item =>
    item.name.toLowerCase().includes(search)
  );

  box.innerHTML = items.map(item => `
    <button
      class="quick-item"
      onclick="quickAddItem(${item.id})"
    >
      <span class="item-name">
        ${esc(item.name)}
        <span class="plus">＋</span>
      </span>

      <strong class="item-price">
        ${money(item.price)} ر.س
      </strong>
    </button>
  `).join('') || `
    <div class="empty">
      لا توجد أصناف مطابقة. أضف أصنافًا من قسم الأصناف والأسعار.
    </div>
  `;
}

/* إضافة صنف بالضغط عليه */

function quickAddItem(itemId) {
  const driverId = currentDriver();

  if (!driverId) {
    return toast('أضف سائقًا أولًا');
  }

  const item = db.items.find(
    product => String(product.id) === String(itemId)
  );

  if (!item) return;

  const account = activeAccount(driverId);

  const existing = account.lines.find(line =>
    line.name === item.name &&
    Number(line.price) === Number(item.price)
  );

  if (existing) {
    existing.qty = Number(existing.qty) + 1;
  } else {
    account.lines.push({
      name: item.name,
      qty: 1,
      price: Number(item.price),
      addedAt: stamp()
    });
  }

  account.updated = stamp();

  persist();

  toast('تمت إضافة ' + item.name);
}

/* تعديل الكمية والسعر بالكتابة */

function editAccountLine(index, field, value) {
  const driverId = currentDriver();

  if (!driverId) return;

  const account = activeAccount(driverId);
  const line = account.lines[index];

  if (!line) return;

  const number = parseNumber(value);

  if (!Number.isFinite(number)) {
    toast('أدخل رقمًا صحيحًا');
    renderAccount();
    return;
  }

  if (field === 'qty' && number <= 0) {
    toast('الكمية يجب أن تكون أكبر من صفر');
    renderAccount();
    return;
  }

  if (field === 'price' && number < 0) {
    toast('السعر لا يمكن أن يكون سالبًا');
    renderAccount();
    return;
  }

  if (field !== 'qty' && field !== 'price') return;

  line[field] = number;
  account.updated = stamp();

  persist();
}

function removeAccountLine(index) {
  if (!confirm('هل تريد حذف هذا الصنف من الحساب؟')) {
    return;
  }

  const driverId = currentDriver();

  if (!driverId) return;

  activeAccount(driverId).lines.splice(index, 1);

  persist();

  toast('تم حذف الصنف');
}

function saveAccount() {
  const driverId = currentDriver();

  if (!driverId) {
    return toast('اختر سائقًا');
  }

  activeAccount(driverId).updated = stamp();

  persist();

  toast('تم حفظ الحساب');
}

function clearAccountConfirm() {
  const driverId = currentDriver();

  if (!driverId) {
    return toast('اختر سائقًا');
  }

  if (!confirm('سيتم حذف أصناف الحساب المفتوح الحالي. هل أنت متأكد؟')) {
    return;
  }

  activeAccount(driverId).lines = [];
  activeAccount(driverId).updated = stamp();

  persist();

  toast('تم تفريغ الحساب');
}

/* إغلاق حساب السائق */

function closeAccount() {
  const driverId = currentDriver();

  if (!driverId) {
    return toast('اختر سائقًا');
  }

  const account = activeAccount(driverId);

  if (!account.lines.length) {
    return toast('الحساب فارغ');
  }

  if (!confirm('إغلاق الحساب الحالي وحفظه في سجل الفواتير؟')) {
    return;
  }

  const driver = db.drivers.find(
    item => String(item.id) === String(driverId)
  );

  const invoice = {
    id: id(),
    type: 'closed',
    driverId,
    driverName: driver?.name || 'سائق محذوف',
    date: stamp(),
    lines: JSON.parse(JSON.stringify(account.lines)),
    total: total(account.lines)
  };

  db.invoices.unshift(invoice);

  db.accounts[driverId] = {
    lines: [],
    updated: stamp()
  };

  persist();

  toast('تم إغلاق الحساب وحفظ الفاتورة رقم ' + invoice.id);

  printInvoice(invoice.id);
}

/* ==========================================
   إدارة السائقين
   ========================================== */

function addDriver() {
  const name = document.getElementById('driverName').value.trim();
  const phone = document.getElementById('driverPhone').value.trim();

  if (!name) {
    return toast('اكتب اسم السائق');
  }

  const driver = {
    id: id(),
    name,
    phone
  };

  db.drivers.push(driver);

  activeAccount(driver.id);

  document.getElementById('driverName').value = '';
  document.getElementById('driverPhone').value = '';

  persist();

  document.getElementById('accountDriver').value = driver.id;

  renderAll();

  toast('تمت إضافة السائق');
}

function newDriverPrompt() {
  const name = prompt('اسم السائق الجديد:');

  if (!name || !name.trim()) return;

  const driver = {
    id: id(),
    name: name.trim(),
    phone: ''
  };

  db.drivers.push(driver);

  activeAccount(driver.id);

  persist();

  document.getElementById('accountDriver').value = driver.id;

  renderAll();

  toast('تمت إضافة السائق');
}

function renderDrivers() {
  const body = document.getElementById('driversRows');

  body.innerHTML = db.drivers.map(driver => `
    <tr>
      <td>${esc(driver.name)}</td>

      <td>${esc(driver.phone || '—')}</td>

      <td>
        ${money(total(activeAccount(driver.id).lines))} ر.س
      </td>

      <td>
        <div class="actions">

          <button
            class="secondary small"
            onclick="editDriver(${driver.id})"
          >تعديل</button>

          <button
            class="danger small"
            onclick="deleteDriver(${driver.id})"
          >حذف</button>

        </div>
      </td>
    </tr>
  `).join('') || `
    <tr>
      <td colspan="4" class="empty">لا يوجد سائقون</td>
    </tr>
  `;
}

function editDriver(driverId) {
  const driver = db.drivers.find(
    item => String(item.id) === String(driverId)
  );

  if (!driver) return;

  const name = prompt('تعديل اسم السائق:', driver.name);

  if (name === null) return;

  if (!name.trim()) {
    return toast('الاسم لا يمكن أن يكون فارغًا');
  }

  const phone = prompt('رقم الجوال:', driver.phone || '');

  if (phone === null) return;

  driver.name = name.trim();
  driver.phone = phone.trim();

  persist();

  toast('تم تعديل بيانات السائق');
}

function deleteDriver(driverId) {
  const driver = db.drivers.find(
    item => String(item.id) === String(driverId)
  );

  if (!driver) return;

  const account = activeAccount(driverId);

  if (account.lines.length) {
    return toast('أغلق حساب السائق أو أفرغه قبل الحذف');
  }

  if (!confirm(
    'حذف السائق من القائمة؟ ستبقى فواتيره المحفوظة في السجل.'
  )) {
    return;
  }

  db.drivers = db.drivers.filter(
    item => String(item.id) !== String(driverId)
  );

  persist();

  toast('تم حذف السائق');
}

/* ==========================================
   إدارة الأصناف والأسعار
   ========================================== */

function addItem() {
  const name = document.getElementById('itemName').value.trim();

  const rawPrice = document.getElementById('itemPrice').value;
  const price = parseNumber(rawPrice);

  if (!name || rawPrice.trim() === '' ||
      !Number.isFinite(price) || price < 0) {
    return toast('أدخل اسم الصنف وسعرًا صحيحًا');
  }

  db.items.push({
    id: id(),
    name,
    price
  });

  document.getElementById('itemName').value = '';
  document.getElementById('itemPrice').value = '';

  persist();

  toast('تمت إضافة الصنف');
}

function renderItems() {
  const body = document.getElementById('itemsRows');

  body.innerHTML = db.items.map(item => `
    <tr>
      <td>${esc(item.name)}</td>

      <td>${money(item.price)} ر.س</td>

      <td>
        <div class="actions">

          <button
            class="secondary small"
            onclick="editItem(${item.id})"
          >تعديل</button>

          <button
            class="danger small"
            onclick="deleteItem(${item.id})"
          >حذف</button>

        </div>
      </td>
    </tr>
  `).join('') || `
    <tr>
      <td colspan="3" class="empty">لا توجد أصناف</td>
    </tr>
  `;
}

function editItem(itemId) {
  const item = db.items.find(
    product => String(product.id) === String(itemId)
  );

  if (!item) return;

  const name = prompt('اسم الصنف:', item.name);

  if (name === null) return;

  const rawPrice = prompt('السعر:', item.price);

  if (rawPrice === null) return;

  const price = parseNumber(rawPrice);

  if (!name.trim() || !Number.isFinite(price) || price < 0) {
    return toast('بيانات غير صحيحة');
  }

  item.name = name.trim();
  item.price = price;

  persist();

  toast('تم تعديل الصنف');
}

function deleteItem(itemId) {
  if (!confirm(
    'حذف الصنف من القائمة؟ لن تتغير الفواتير القديمة.'
  )) {
    return;
  }

  db.items = db.items.filter(
    item => String(item.id) !== String(itemId)
  );

  persist();

  toast('تم حذف الصنف');
}

/* ==========================================
   الفواتير المستقلة
   ========================================== */

function setSinglePrice() {
  const select = document.getElementById('singleItem');
  const priceInput = document.getElementById('singlePrice');

  if (!select || !priceInput) return;

  const item = db.items.find(
    product => String(product.id) === String(select.value)
  );

  if (item) {
    priceInput.value = item.price;
  }
}

function addSingleLine() {
  const itemId = document.getElementById('singleItem').value;

  const item = db.items.find(
    product => String(product.id) === String(itemId)
  );

  const qty = parseNumber(
    document.getElementById('singleQty').value
  );

  const price = parseNumber(
    document.getElementById('singlePrice').value
  );

  if (!item) {
    return toast('أضف صنفًا أولًا');
  }

  if (!Number.isFinite(qty) || qty <= 0 ||
      !Number.isFinite(price) || price < 0) {
    return toast('تحقق من الكمية والسعر');
  }

  singleLines.push({
    name: item.name,
    qty,
    price
  });

  renderSingleLines();

  document.getElementById('singleQty').value = '1';

  toast('تمت إضافة الصنف للفاتورة');
}

function renderSingleLines() {
  const body = document.getElementById('singleRows');

  body.innerHTML = singleLines.map((line, index) => `
    <tr>
      <td>${esc(line.name)}</td>
      <td>${money(line.qty)}</td>
      <td>${money(line.price)}</td>
      <td>${money(line.qty * line.price)}</td>

      <td>
        <button
          class="danger small"
          onclick="removeSingleLine(${index})"
        >حذف</button>
      </td>
    </tr>
  `).join('') || `
    <tr>
      <td colspan="5" class="empty">
        أضف أصناف الفاتورة
      </td>
    </tr>
  `;

  document.getElementById('singleTotal').textContent =
    money(total(singleLines));
}

function removeSingleLine(index) {
  singleLines.splice(index, 1);
  renderSingleLines();
}

function saveSingleInvoice() {
  const driverId = document.getElementById('singleDriver').value;

  if (!driverId) {
    return toast('اختر السائق');
  }

  if (!singleLines.length) {
    return toast('أضف صنفًا واحدًا على الأقل');
  }

  const driver = db.drivers.find(
    item => String(item.id) === String(driverId)
  );

  const invoice = {
    id: id(),
    type: 'single',
    driverId,
    driverName: driver?.name || 'سائق',
    date: stamp(),
    note: document.getElementById('singleNote').value.trim(),
    lines: JSON.parse(JSON.stringify(singleLines)),
    total: total(singleLines)
  };

  db.invoices.unshift(invoice);

  singleLines = [];

  document.getElementById('singleNote').value = '';

  renderSingleLines();

  persist();

  toast('تم حفظ الفاتورة رقم ' + invoice.id);

  printInvoice(invoice.id);
}

/* ==========================================
   سجل الفواتير
   ========================================== */

function renderHistory() {
  const searchElement = document.getElementById('historySearch');
  const typeElement = document.getElementById('historyType');

  const query = (searchElement?.value || '').trim().toLowerCase();
  const type = typeElement?.value || 'all';

  const invoices = db.invoices.filter(invoice => {
    const typeMatches =
      type === 'all' || invoice.type === type;

    const text = (
      String(invoice.id) + ' ' +
      String(invoice.driverName || '')
    ).toLowerCase();

    return typeMatches && text.includes(query);
  });

  const body = document.getElementById('historyRows');

  body.innerHTML = invoices.map(invoice => `
    <tr>
      <td>${invoice.id}</td>

      <td>
        ${invoice.type === 'single'
          ? 'مستقلة'
          : 'حساب مغلق'}
      </td>

      <td>${esc(invoice.driverName)}</td>

      <td>${esc(invoice.date)}</td>

      <td>${money(invoice.total)} ر.س</td>

      <td>
        <div class="actions">

          <button
            class="secondary small"
            onclick="printInvoice(${invoice.id})"
          >طباعة</button>

          <button
            class="secondary small"
            onclick="editInvoice(${invoice.id})"
          >تعديل</button>

          <button
            class="danger small"
            onclick="deleteInvoice(${invoice.id})"
          >حذف</button>

        </div>
      </td>
    </tr>
  `).join('') || `
    <tr>
      <td colspan="6" class="empty">
        لا توجد فواتير محفوظة
      </td>
    </tr>
  `;
}

/* تعديل فاتورة سابقة */

function editInvoice(invoiceId) {
  const invoice = db.invoices.find(
    item => String(item.id) === String(invoiceId)
  );

  if (!invoice) return;

  const choice = prompt(
    'الفاتورة رقم ' + invoice.id + '\n' +
    'اكتب رقم السطر الذي تريد تعديله.\n' +
    'اكتب 0 لإضافة صنف جديد.\n' +
    'اكتب -1 لحذف سطر.',
    '1'
  );

  if (choice === null) return;

  const selected = Number(choice);

  if (selected === -1) {
    const lineNumber = prompt(
      'رقم السطر الذي تريد حذفه من 1 إلى ' +
      invoice.lines.length
    );

    if (lineNumber === null) return;

    const index = Number(lineNumber) - 1;

    if (!Number.isInteger(index) || !invoice.lines[index]) {
      return toast('رقم سطر غير صحيح');
    }

    if (!confirm('هل تريد حذف هذا السطر؟')) return;

    invoice.lines.splice(index, 1);

  } else if (selected === 0) {
    const name = prompt('اسم الصنف الجديد:');

    if (name === null || !name.trim()) return;

    const priceText = prompt('السعر:', '0');

    if (priceText === null) return;

    const qtyText = prompt('الكمية:', '1');

    if (qtyText === null) return;

    const price = parseNumber(priceText);
    const qty = parseNumber(qtyText);

    if (!Number.isFinite(price) || price < 0 ||
        !Number.isFinite(qty) || qty <= 0) {
      return toast('قيم غير صحيحة');
    }

    invoice.lines.push({
      name: name.trim(),
      price,
      qty
    });

  } else {
    const index = selected - 1;

    if (!Number.isInteger(index) || !invoice.lines[index]) {
      return toast('رقم سطر غير صحيح');
    }

    const line = invoice.lines[index];

    const qtyText = prompt('الكمية الجديدة:', line.qty);

    if (qtyText === null) return;

    const priceText = prompt('السعر الجديد:', line.price);

    if (priceText === null) return;

    const qty = parseNumber(qtyText);
    const price = parseNumber(priceText);

    if (!Number.isFinite(qty) || qty <= 0 ||
        !Number.isFinite(price) || price < 0) {
      return toast('قيم غير صحيحة');
    }

    line.qty = qty;
    line.price = price;
  }

  invoice.total = total(invoice.lines);
  invoice.editedAt = stamp();

  persist();

  toast('تم تعديل الفاتورة');
}

function deleteInvoice(invoiceId) {
  if (!confirm('حذف الفاتورة من السجل نهائيًا؟')) {
    return;
  }

  db.invoices = db.invoices.filter(
    invoice => String(invoice.id) !== String(invoiceId)
  );

  persist();

  toast('تم حذف الفاتورة');
}

/* ==========================================
   الإحصائيات
   ========================================== */

function renderStats() {
  document.getElementById('driverCount').textContent =
    db.drivers.length;

  document.getElementById('invoiceCount').textContent =
    db.invoices.filter(invoice => invoice.type === 'single').length;

  const openTotal = db.drivers.reduce((sum, driver) => {
    return sum + total(activeAccount(driver.id).lines);
  }, 0);

  document.getElementById('openTotal').textContent =
    money(openTotal) + ' ر.س';

  const currentDate = today();

  const todayTotal = db.invoices
    .filter(invoice => {
      const date = new Date();

      const dateText = String(invoice.date || '');

      return dateText.includes(currentDate) ||
        dateText.includes(
          date.toLocaleDateString('en-CA')
        );
    })
    .reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);

  document.getElementById('todayTotal').textContent =
    money(todayTotal) + ' ر.س';
}

/* ==========================================
   تصميم الفاتورة الحرارية
   ========================================== */

function receiptHTML(
  title,
  driver,
  date,
  lines,
  sum,
  number,
  note = ''
) {
  const count = lines.reduce((result, line) => {
    return result + (Number(line.qty) || 0);
  }, 0);

  const rows = lines.map(line => `
    <tr>
      <td>${esc(line.name)}</td>
      <td>${money(line.qty)}</td>
      <td>${money(line.price)}</td>
      <td>${money(line.qty * line.price)}</td>
    </tr>
  `).join('');

  return `
    <div class="receipt">

      <div class="receipt-brand">
        <div class="r-logo">د</div>
        <h2>مطعم ديرتي</h2>
        <p>للمأكولات السعودية</p>
        <p>فاتورة السائقين والحسابات</p>
      </div>

      <div class="receipt-title">
        ${esc(title)}
      </div>

      <div class="receipt-meta">

        <div>
          <span>رقم الفاتورة</span>
          <strong>${esc(number)}</strong>
        </div>

        <div>
          <span>اسم السائق</span>
          <strong>${esc(driver)}</strong>
        </div>

        <div>
          <span>التاريخ والوقت</span>
          <span>${esc(date)}</span>
        </div>

      </div>

      ${note ? `
        <div class="r-note">
          ملاحظة: ${esc(note)}
        </div>
      ` : ''}

      <table>
        <thead>
          <tr>
            <th>الصنف</th>
            <th>ك</th>
            <th>السعر</th>
            <th>الإجمالي</th>
          </tr>
        </thead>

        <tbody>${rows}</tbody>
      </table>

      <div class="r-count">
        عدد الوحدات: ${money(count)}
      </div>

      <div class="r-total">
        <span>الإجمالي المستحق</span>
        <span>${money(sum)} ر.س</span>
      </div>

      <div class="r-thanks">
        شكرًا لثقتكم بمطعم ديرتي
        <br>
        <small>نتمنى لكم يومًا سعيدًا</small>
      </div>

    </div>
  `;
}

function printAccount() {
  const driverId = currentDriver();

  if (!driverId) {
    return toast('اختر سائقًا');
  }

  const driver = db.drivers.find(
    item => String(item.id) === String(driverId)
  );

  const account = activeAccount(driverId);

  if (!account.lines.length) {
    return toast('الحساب فارغ');
  }

  document.getElementById('printArea').innerHTML =
    receiptHTML(
      'الحساب المستمر المفتوح',
      driver?.name || '',
      stamp(),
      account.lines,
      total(account.lines),
      'مفتوح'
    );

  window.print();
}

function printInvoice(invoiceId) {
  const invoice = db.invoices.find(
    item => String(item.id) === String(invoiceId)
  );

  if (!invoice) {
    return toast('الفاتورة غير موجودة');
  }

  document.getElementById('printArea').innerHTML =
    receiptHTML(
      invoice.type === 'single'
        ? 'فاتورة مستقلة'
        : 'فاتورة حساب مغلق',
      invoice.driverName,
      invoice.date,
      invoice.lines,
      invoice.total,
      invoice.id,
      invoice.note || ''
    );

  window.print();
}

/* ==========================================
   النسخ الاحتياطي والاستعادة
   ========================================== */

function exportData() {
  const backup = {
    ...db,
    exportedAt: new Date().toISOString()
  };

  const blob = new Blob(
    [JSON.stringify(backup, null, 2)],
    { type: 'application/json;charset=utf-8' }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = 'deerty-backup-' + today() + '.json';

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);

  toast('تم تنزيل النسخة الاحتياطية');
}

function importData(event) {
  const file = event.target.files?.[0];

  if (!file) return;

  const reader = new FileReader();

  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);

      if (
        !Array.isArray(imported.drivers) ||
        !Array.isArray(imported.items) ||
        !imported.accounts ||
        !Array.isArray(imported.invoices)
      ) {
        throw new Error('Invalid backup format');
      }

      if (!confirm(
        'استعادة النسخة ستستبدل البيانات الحالية. هل تريد المتابعة؟'
      )) {
        return;
      }

      db = {
        drivers: imported.drivers,
        items: imported.items,
        accounts: imported.accounts,
        invoices: imported.invoices,
        seq: Number(imported.seq) || 1001
      };

      persist();

      toast('تمت استعادة النسخة الاحتياطية');

    } catch (error) {
      alert('ملف النسخة الاحتياطية غير صالح أو تالف.');
      console.error(error);

    } finally {
      event.target.value = '';
    }
  };

  reader.readAsText(file);
}

/* ==========================================
   بيانات أولية عند التشغيل لأول مرة
   ========================================== */

if (!localStorage.getItem(KEY)) {
  db.items = [
    { id: id(), name: 'حبة شواية', price: 46 },
    { id: id(), name: 'نصف شواية', price: 23 },
    { id: id(), name: 'ربع دجاج', price: 15 },
    { id: id(), name: 'حبة مندي', price: 46 },
    { id: id(), name: 'نصف مندي', price: 23 },
    { id: id(), name: 'رز شعبي', price: 10 }
  ];

  persist();
}

/* تشغيل الواجهة */

renderAll();
renderSingleLines();

/* ==========================================
   تثبيت التطبيق PWA
   يتطلب HTTPS مثل GitHub Pages
   ========================================== */

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();

  deferredInstallPrompt = event;

  const button = document.getElementById('installBtn');

  if (button) {
    button.classList.remove('hidden');
  }
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;

  const button = document.getElementById('installBtn');

  if (button) {
    button.classList.add('hidden');
  }

  toast('تم تثبيت تطبيق ديرتي بنجاح');
});

async function installApp() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();

    await deferredInstallPrompt.userChoice;

    deferredInstallPrompt = null;

    const button = document.getElementById('installBtn');

    if (button) {
      button.classList.add('hidden');
    }

    return;
  }

  toast(
    'افتح قائمة المتصفح واختر تثبيت التطبيق أو إضافة إلى الشاشة الرئيسية'
  );
}

/* تشغيل ملفات التطبيق دون اتصال بعد تحميلها */

if (
  'serviceWorker' in navigator &&
  (
    location.protocol === 'https:' ||
    location.hostname === 'localhost'
  )
) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .catch(error => {
        console.warn('تعذر تسجيل Service Worker', error);
      });
  });
}
