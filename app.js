'use strict';

/* =========================================
   نظام فواتير مطعم ديرتي
   ========================================= */

const STORAGE_KEY = 'deerty_driver_invoice_v2';

let db = loadDatabase();
let singleLines = [];
let deferredInstallPrompt = null;

function emptyDatabase() {
  return {
    drivers: [],
    items: [],
    accounts: {},
    invoices: [],
    seq: 1001
  };
}

function loadDatabase() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (raw) {
      const data = JSON.parse(raw);

      return {
        drivers: Array.isArray(data.drivers) ? data.drivers : [],
        items: Array.isArray(data.items) ? data.items : [],
        accounts: data.accounts || {},
        invoices: Array.isArray(data.invoices) ? data.invoices : [],
        seq: Number(data.seq) || 1001
      };
    }
  } catch (error) {
    console.error('خطأ في قراءة البيانات', error);
  }

  return emptyDatabase();
}

function saveDatabase() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    renderAll();
    return true;
  } catch (error) {
    console.error(error);
    alert('تعذر حفظ البيانات. تأكد من توفر مساحة في المتصفح.');
    return false;
  }
}

function nextId() {
  return db.seq++;
}

function money(value) {
  return (Number(value) || 0).toLocaleString('ar-SA', {
    maximumFractionDigits: 2
  });
}

function nowText() {
  return new Date().toLocaleString('ar-SA');
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function numberValue(value) {
  const normalized = String(value ?? '')
    .trim()
    .replace(/,/g, '.')
    .replace(/٫/g, '.')
    .replace(/[٠-٩]/g, char => '٠١٢٣٤٥٦٧٨٩'.indexOf(char))
    .replace(/[۰-۹]/g, char => '۰۱۲۳۴۵۶۷۸۹'.indexOf(char));

  return Number(normalized);
}

function calculateTotal(lines) {
  return lines.reduce((sum, line) => {
    return sum +
      (Number(line.qty) || 0) *
      (Number(line.price) || 0);
  }, 0);
}

function getAccount(driverId) {
  if (!db.accounts[driverId]) {
    db.accounts[driverId] = {
      lines: [],
      updated: nowText()
    };
  }

  if (!Array.isArray(db.accounts[driverId].lines)) {
    db.accounts[driverId].lines = [];
  }

  return db.accounts[driverId];
}

function notify(message) {
  const element = document.getElementById('toast');

  if (!element) {
    alert(message);
    return;
  }

  element.textContent = message;
  element.style.display = 'block';

  clearTimeout(notify.timer);

  notify.timer = setTimeout(() => {
    element.style.display = 'none';
  }, 2500);
}

/* =========================================
   التنقل بين الأقسام
   ========================================= */

function showTab(name) {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.add('hidden');
  });

  const target = document.getElementById('tab-' + name);

  if (target) {
    target.classList.remove('hidden');
  }

  document.querySelectorAll('.tabs button').forEach(button => {
    const active = button.getAttribute('onclick')?.includes(
      "'" + name + "'"
    );

    button.classList.toggle('secondary', !active);
  });

  renderAll();
}

/* =========================================
   قوائم الاختيار
   ========================================= */

function makeOptions(list, selected) {
  return list.map(item => `
    <option value="${item.id}"
      ${String(item.id) === String(selected) ? 'selected' : ''}>
      ${escapeHTML(item.name)}
    </option>
  `).join('');
}

function renderSelects() {
  const accountSelect = document.getElementById('accountDriver');
  const singleDriverSelect = document.getElementById('singleDriver');
  const singleItemSelect = document.getElementById('singleItem');

  if (!accountSelect || !singleDriverSelect || !singleItemSelect) {
    return;
  }

  const oldAccount = accountSelect.value;
  const oldDriver = singleDriverSelect.value;
  const oldItem = singleItemSelect.value;

  accountSelect.innerHTML =
    makeOptions(db.drivers, oldAccount) ||
    '<option value="">أضف سائقًا أولًا</option>';

  singleDriverSelect.innerHTML =
    makeOptions(db.drivers, oldDriver) ||
    '<option value="">أضف سائقًا أولًا</option>';

  singleItemSelect.innerHTML =
    makeOptions(db.items, oldItem) ||
    '<option value="">أضف صنفًا أولًا</option>';

  if (!accountSelect.value && db.drivers.length) {
    accountSelect.value = String(db.drivers[0].id);
  }

  if (!singleDriverSelect.value && db.drivers.length) {
    singleDriverSelect.value = String(db.drivers[0].id);
  }
}

/* =========================================
   تحديث الشاشة
   ========================================= */

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

function getSelectedDriverId() {
  return document.getElementById('accountDriver')?.value || '';
}

/* =========================================
   شاشة الكاشير
   ========================================= */

function renderAccount() {
  const driverId = getSelectedDriverId();
  const tbody = document.getElementById('accountRows');
  const title = document.getElementById('currentDriverTitle');

  if (!tbody || !title) return;

  const driver = db.drivers.find(
    item => String(item.id) === String(driverId)
  );

  title.textContent = driver ? driver.name : 'اختر سائقًا';

  const account = driverId
    ? getAccount(driverId)
    : { lines: [] };

  tbody.innerHTML = account.lines.map((line, index) => `
    <tr>
      <td>${escapeHTML(line.name)}</td>

      <td>
        <input
          class="qty-input"
          type="text"
          inputmode="decimal"
          aria-label="الكمية"
          value="${escapeHTML(line.qty)}"
          onchange="editAccountLine(${index}, 'qty', this.value)"
        >
      </td>

      <td>
        <input
          class="price-input"
          type="text"
          inputmode="decimal"
          aria-label="السعر"
          value="${escapeHTML(line.price)}"
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
  `).join('');

  if (!account.lines.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="empty">
          اضغط على صنف من القائمة لإضافته إلى الحساب
        </td>
      </tr>
    `;
  }

  document.getElementById('accountTotal').textContent =
    money(calculateTotal(account.lines));
}

function renderQuickItems() {
  const container = document.getElementById('quickItems');

  if (!container) return;

  const search = (
    document.getElementById('productSearch')?.value || ''
  ).trim().toLowerCase();

  const filtered = db.items.filter(item =>
    item.name.toLowerCase().includes(search)
  );

  container.innerHTML = filtered.map(item => `
    <button
      class="quick-item"
      onclick="quickAddItem(${item.id})"
    >
      <span class="item-name">
        ${escapeHTML(item.name)}
        <span class="plus">＋</span>
      </span>

      <strong class="item-price">
        ${money(item.price)} ر.س
      </strong>
    </button>
  `).join('') || `
    <div class="empty">
      لا توجد أصناف. أضف أصنافًا من قسم الأصناف والأسعار.
    </div>
  `;
}

function quickAddItem(itemId) {
  const driverId = getSelectedDriverId();

  if (!driverId) {
    notify('أضف سائقًا واختره أولًا');
    return;
  }

  const item = db.items.find(
    product => String(product.id) === String(itemId)
  );

  if (!item) return;

  const account = getAccount(driverId);

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
      price: Number(item.price)
    });
  }

  account.updated = nowText();

  if (saveDatabase()) {
    notify('تمت إضافة ' + item.name);
  }
}

function editAccountLine(index, field, value) {
  const driverId = getSelectedDriverId();

  if (!driverId) return;

  const account = getAccount(driverId);
  const line = account.lines[index];

  if (!line) return;

  if (field !== 'qty' && field !== 'price') return;

  const parsed = numberValue(value);

  if (!Number.isFinite(parsed)) {
    notify('اكتب رقمًا صحيحًا');
    renderAccount();
    return;
  }

  if (field === 'qty' && parsed <= 0) {
    notify('الكمية يجب أن تكون أكبر من صفر');
    renderAccount();
    return;
  }

  if (field === 'price' && parsed < 0) {
    notify('السعر لا يمكن أن يكون سالبًا');
    renderAccount();
    return;
  }

  line[field] = parsed;
  account.updated = nowText();

  saveDatabase();
}

function removeAccountLine(index) {
  if (!confirm('هل تريد حذف الصنف من الحساب؟')) return;

  const driverId = getSelectedDriverId();

  if (!driverId) return;

  const account = getAccount(driverId);

  account.lines.splice(index, 1);
  account.updated = nowText();

  saveDatabase();

  notify('تم حذف الصنف');
}

function saveAccount() {
  const driverId = getSelectedDriverId();

  if (!driverId) {
    notify('اختر سائقًا');
    return;
  }

  getAccount(driverId).updated = nowText();

  saveDatabase();

  notify('تم حفظ الحساب');
}

function clearAccountConfirm() {
  const driverId = getSelectedDriverId();

  if (!driverId) {
    notify('اختر سائقًا');
    return;
  }

  if (!confirm('هل تريد تفريغ الحساب المفتوح؟')) return;

  db.accounts[driverId] = {
    lines: [],
    updated: nowText()
  };

  saveDatabase();

  notify('تم تفريغ الحساب');
}

function closeAccount() {
  const driverId = getSelectedDriverId();

  if (!driverId) {
    notify('اختر سائقًا');
    return;
  }

  const account = getAccount(driverId);

  if (!account.lines.length) {
    notify('الحساب فارغ');
    return;
  }

  if (!confirm('إغلاق الحساب وحفظه في سجل الفواتير؟')) return;

  const driver = db.drivers.find(
    item => String(item.id) === String(driverId)
  );

  const invoice = {
    id: nextId(),
    type: 'closed',
    driverId,
    driverName: driver?.name || 'سائق',
    date: nowText(),
    lines: JSON.parse(JSON.stringify(account.lines)),
    total: calculateTotal(account.lines)
  };

  db.invoices.unshift(invoice);

  db.accounts[driverId] = {
    lines: [],
    updated: nowText()
  };

  if (saveDatabase()) {
    notify('تم حفظ الفاتورة رقم ' + invoice.id);
    printInvoice(invoice.id);
  }
}

/* =========================================
   إدارة السائقين
   ========================================= */

function addDriver() {
  const name = document.getElementById('driverName').value.trim();
  const phone = document.getElementById('driverPhone').value.trim();

  if (!name) {
    notify('اكتب اسم السائق');
    return;
  }

  const driver = {
    id: nextId(),
    name,
    phone
  };

  db.drivers.push(driver);

  getAccount(driver.id);

  document.getElementById('driverName').value = '';
  document.getElementById('driverPhone').value = '';

  if (saveDatabase()) {
    document.getElementById('accountDriver').value = String(driver.id);
    renderAll();
    notify('تمت إضافة السائق');
  }
}

function newDriverPrompt() {
  const name = prompt('اكتب اسم السائق:');

  if (!name || !name.trim()) return;

  const driver = {
    id: nextId(),
    name: name.trim(),
    phone: ''
  };

  db.drivers.push(driver);
  getAccount(driver.id);

  if (saveDatabase()) {
    document.getElementById('accountDriver').value = String(driver.id);
    renderAll();
    notify('تمت إضافة السائق');
  }
}

function renderDrivers() {
  const tbody = document.getElementById('driversRows');

  if (!tbody) return;

  tbody.innerHTML = db.drivers.map(driver => `
    <tr>
      <td>${escapeHTML(driver.name)}</td>
      <td>${escapeHTML(driver.phone || '—')}</td>
      <td>${money(calculateTotal(getAccount(driver.id).lines))} ر.س</td>
      <td>
        <div class="actions">
          <button class="secondary small"
            onclick="editDriver(${driver.id})">تعديل</button>

          <button class="danger small"
            onclick="deleteDriver(${driver.id})">حذف</button>
        </div>
      </td>
    </tr>
  `).join('') || `
    <tr><td colspan="4" class="empty">لا يوجد سائقون</td></tr>
  `;
}

function editDriver(driverId) {
  const driver = db.drivers.find(
    item => String(item.id) === String(driverId)
  );

  if (!driver) return;

  const name = prompt('اسم السائق:', driver.name);

  if (name === null) return;

  if (!name.trim()) {
    notify('الاسم مطلوب');
    return;
  }

  const phone = prompt('رقم الجوال:', driver.phone || '');

  if (phone === null) return;

  driver.name = name.trim();
  driver.phone = phone.trim();

  saveDatabase();

  notify('تم تعديل بيانات السائق');
}

function deleteDriver(driverId) {
  const driver = db.drivers.find(
    item => String(item.id) === String(driverId)
  );

  if (!driver) return;

  if (getAccount(driverId).lines.length) {
    notify('أغلق حساب السائق أو أفرغه قبل الحذف');
    return;
  }

  if (!confirm(
    'حذف السائق؟ ستبقى فواتيره السابقة في السجل.'
  )) return;

  db.drivers = db.drivers.filter(
    item => String(item.id) !== String(driverId)
  );

  delete db.accounts[driverId];

  saveDatabase();

  notify('تم حذف السائق');
}

/* =========================================
   إدارة الأصناف والأسعار
   ========================================= */

function addItem() {
  const name = document.getElementById('itemName').value.trim();
  const rawPrice = document.getElementById('itemPrice').value;
  const price = numberValue(rawPrice);

  if (!name || rawPrice.trim() === '' ||
      !Number.isFinite(price) || price < 0) {
    notify('اكتب اسم الصنف وسعرًا صحيحًا');
    return;
  }

  db.items.push({
    id: nextId(),
    name,
    price
  });

  document.getElementById('itemName').value = '';
  document.getElementById('itemPrice').value = '';

  saveDatabase();

  notify('تمت إضافة الصنف');
}

function renderItems() {
  const tbody = document.getElementById('itemsRows');

  if (!tbody) return;

  tbody.innerHTML = db.items.map(item => `
    <tr>
      <td>${escapeHTML(item.name)}</td>
      <td>${money(item.price)} ر.س</td>
      <td>
        <div class="actions">
          <button class="secondary small"
            onclick="editItem(${item.id})">تعديل</button>

          <button class="danger small"
            onclick="deleteItem(${item.id})">حذف</button>
        </div>
      </td>
    </tr>
  `).join('') || `
    <tr><td colspan="3" class="empty">لا توجد أصناف</td></tr>
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

  const price = numberValue(rawPrice);

  if (!name.trim() || !Number.isFinite(price) || price < 0) {
    notify('بيانات غير صحيحة');
    return;
  }

  item.name = name.trim();
  item.price = price;

  saveDatabase();

  notify('تم تعديل الصنف');
}

function deleteItem(itemId) {
  if (!confirm('حذف الصنف من القائمة؟')) return;

  db.items = db.items.filter(
    item => String(item.id) !== String(itemId)
  );

  saveDatabase();

  notify('تم حذف الصنف');
}

/* =========================================
   الفواتير المستقلة
   ========================================= */

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

  const qty = numberValue(document.getElementById('singleQty').value);
  const price = numberValue(document.getElementById('singlePrice').value);

  if (!item) {
    notify('اختر صنفًا');
    return;
  }

  if (!Number.isFinite(qty) || qty <= 0 ||
      !Number.isFinite(price) || price < 0) {
    notify('تحقق من الكمية والسعر');
    return;
  }

  singleLines.push({
    name: item.name,
    qty,
    price
  });

  renderSingleLines();

  document.getElementById('singleQty').value = '1';

  notify('تمت إضافة الصنف');
}

function renderSingleLines() {
  const tbody = document.getElementById('singleRows');

  if (!tbody) return;

  tbody.innerHTML = singleLines.map((line, index) => `
    <tr>
      <td>${escapeHTML(line.name)}</td>
      <td>${money(line.qty)}</td>
      <td>${money(line.price)}</td>
      <td>${money(line.qty * line.price)}</td>
      <td>
        <button class="danger small"
          onclick="removeSingleLine(${index})">حذف</button>
      </td>
    </tr>
  `).join('') || `
    <tr><td colspan="5" class="empty">أضف أصناف الفاتورة</td></tr>
  `;

  document.getElementById('singleTotal').textContent =
    money(calculateTotal(singleLines));
}

function removeSingleLine(index) {
  singleLines.splice(index, 1);
  renderSingleLines();
}

function saveSingleInvoice() {
  const driverId = document.getElementById('singleDriver').value;

  if (!driverId) {
    notify('اختر سائقًا');
    return;
  }

  if (!singleLines.length) {
    notify('أضف صنفًا واحدًا على الأقل');
    return;
  }

  const driver = db.drivers.find(
    item => String(item.id) === String(driverId)
  );

  const invoice = {
    id: nextId(),
    type: 'single',
    driverId,
    driverName: driver?.name || 'سائق',
    date: nowText(),
    note: document.getElementById('singleNote').value.trim(),
    lines: JSON.parse(JSON.stringify(singleLines)),
    total: calculateTotal(singleLines)
  };

  db.invoices.unshift(invoice);

  singleLines = [];

  document.getElementById('singleNote').value = '';

  renderSingleLines();

  if (saveDatabase()) {
    notify('تم حفظ الفاتورة رقم ' + invoice.id);
    printInvoice(invoice.id);
  }
}

/* =========================================
   سجل الفواتير
   ========================================= */

function renderHistory() {
  const tbody = document.getElementById('historyRows');

  if (!tbody) return;

  const query = (
    document.getElementById('historySearch')?.value || ''
  ).trim().toLowerCase();

  const type = document.getElementById('historyType')?.value || 'all';

  const filtered = db.invoices.filter(invoice => {
    const typeMatches = type === 'all' || invoice.type === type;

    const searchable = (
      String(invoice.id) + ' ' +
      String(invoice.driverName || '')
    ).toLowerCase();

    return typeMatches && searchable.includes(query);
  });

  tbody.innerHTML = filtered.map(invoice => `
    <tr>
      <td>${invoice.id}</td>
      <td>${invoice.type === 'single' ? 'مستقلة' : 'حساب مغلق'}</td>
      <td>${escapeHTML(invoice.driverName)}</td>
      <td>${escapeHTML(invoice.date)}</td>
      <td>${money(invoice.total)} ر.س</td>
      <td>
        <div class="actions">
          <button class="secondary small"
            onclick="printInvoice(${invoice.id})">طباعة</button>

          <button class="secondary small"
            onclick="editInvoice(${invoice.id})">تعديل</button>

          <button class="danger small"
            onclick="deleteInvoice(${invoice.id})">حذف</button>
        </div>
      </td>
    </tr>
  `).join('') || `
    <tr><td colspan="6" class="empty">لا توجد فواتير</td></tr>
  `;
}

function editInvoice(invoiceId) {
  const invoice = db.invoices.find(
    item => String(item.id) === String(invoiceId)
  );

  if (!invoice) return;

  const choice = prompt(
    'تعديل الفاتورة رقم ' + invoice.id + '\n' +
    'أدخل رقم السطر لتعديل الكمية والسعر.\n' +
    'اكتب 0 لإضافة صنف.\n' +
    'اكتب -1 لحذف سطر.',
    '1'
  );

  if (choice === null) return;

  const selected = Number(choice);

  if (selected === -1) {
    const rawIndex = prompt(
      'رقم السطر المراد حذفه من 1 إلى ' + invoice.lines.length
    );

    if (rawIndex === null) return;

    const index = Number(rawIndex) - 1;

    if (!Number.isInteger(index) || !invoice.lines[index]) {
      notify('رقم السطر غير صحيح');
      return;
    }

    if (!confirm('تأكيد حذف السطر؟')) return;

    invoice.lines.splice(index, 1);

  } else if (selected === 0) {
    const name = prompt('اسم الصنف الجديد:');

    if (name === null || !name.trim()) return;

    const priceText = prompt('السعر:', '0');

    if (priceText === null) return;

    const qtyText = prompt('الكمية:', '1');

    if (qtyText === null) return;

    const price = numberValue(priceText);
    const qty = numberValue(qtyText);

    if (!Number.isFinite(price) || price < 0 ||
        !Number.isFinite(qty) || qty <= 0) {
      notify('القيم غير صحيحة');
      return;
    }

    invoice.lines.push({
      name: name.trim(),
      price,
      qty
    });

  } else {
    const index = selected - 1;

    if (!Number.isInteger(index) || !invoice.lines[index]) {
      notify('رقم السطر غير صحيح');
      return;
    }

    const line = invoice.lines[index];

    const qtyText = prompt('الكمية الجديدة:', line.qty);

    if (qtyText === null) return;

    const priceText = prompt('السعر الجديد:', line.price);

    if (priceText === null) return;

    const qty = numberValue(qtyText);
    const price = numberValue(priceText);

    if (!Number.isFinite(qty) || qty <= 0 ||
        !Number.isFinite(price) || price < 0) {
      notify('القيم غير صحيحة');
      return;
    }

    line.qty = qty;
    line.price = price;
  }

  invoice.total = calculateTotal(invoice.lines);
  invoice.editedAt = nowText();

  saveDatabase();

  notify('تم تعديل الفاتورة');
}

function deleteInvoice(invoiceId) {
  if (!confirm('حذف الفاتورة من السجل نهائيًا؟')) return;

  db.invoices = db.invoices.filter(
    invoice => String(invoice.id) !== String(invoiceId)
  );

  saveDatabase();

  notify('تم حذف الفاتورة');
}

/* =========================================
   الإحصائيات
   ========================================= */

function renderStats() {
  document.getElementById('driverCount').textContent =
    db.drivers.length;

  document.getElementById('invoiceCount').textContent =
    db.invoices.filter(invoice => invoice.type === 'single').length;

  const openTotal = db.drivers.reduce((sum, driver) => {
    return sum + calculateTotal(getAccount(driver.id).lines);
  }, 0);

  document.getElementById('openTotal').textContent =
    money(openTotal) + ' ر.س';

  const todayKey = new Date().toLocaleDateString('en-CA');

  const todayTotal = db.invoices.reduce((sum, invoice) => {
    const date = new Date();

    const isToday =
      String(invoice.date).includes(todayKey) ||
      String(invoice.date).includes(
        date.toLocaleDateString('ar-SA')
      );

    return sum + (isToday ? Number(invoice.total || 0) : 0);
  }, 0);

  document.getElementById('todayTotal').textContent =
    money(todayTotal) + ' ر.س';
}

/* =========================================
   تصميم الفاتورة الحرارية
   ========================================= */

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
      <td class="r-item-name">${escapeHTML(line.name)}</td>
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

      <div class="receipt-title">${escapeHTML(title)}</div>

      <div class="receipt-meta">

        <div class="r-meta-row">
          <span>رقم الفاتورة:</span>
          <strong>${escapeHTML(number)}</strong>
        </div>

        <div class="r-meta-row">
          <span>اسم السائق:</span>
          <strong class="r-driver-name">${escapeHTML(driver)}</strong>
        </div>

        <div class="r-meta-row">
          <span>التاريخ والوقت:</span>
          <strong class="r-date">${escapeHTML(date)}</strong>
        </div>

      </div>

      ${note ? `
        <div class="r-note">
          ملاحظة: ${escapeHTML(note)}
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
  const driverId = getSelectedDriverId();

  if (!driverId) {
    notify('اختر سائقًا');
    return;
  }

  const driver = db.drivers.find(
    item => String(item.id) === String(driverId)
  );

  const account = getAccount(driverId);

  if (!account.lines.length) {
    notify('الحساب فارغ');
    return;
  }

  document.getElementById('printArea').innerHTML = receiptHTML(
    'الحساب المستمر المفتوح',
    driver?.name || '',
    nowText(),
    account.lines,
    calculateTotal(account.lines),
    'مفتوح'
  );

  window.print();
}

function printInvoice(invoiceId) {
  const invoice = db.invoices.find(
    item => String(item.id) === String(invoiceId)
  );

  if (!invoice) {
    notify('الفاتورة غير موجودة');
    return;
  }

  document.getElementById('printArea').innerHTML = receiptHTML(
    invoice.type === 'single' ? 'فاتورة مستقلة' : 'فاتورة حساب مغلق',
    invoice.driverName,
    invoice.date,
    invoice.lines,
    invoice.total,
    invoice.id,
    invoice.note || ''
  );

  window.print();
}

/* =========================================
   النسخ الاحتياطي والاستعادة
   ========================================= */

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
  link.download = 'deerty-backup-' +
    new Date().toISOString().slice(0, 10) + '.json';

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);

  notify('تم تنزيل النسخة الاحتياطية');
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
        throw new Error('نسخة غير صالحة');
      }

      if (!confirm(
        'ستستبدل الاستعادة البيانات الحالية. هل تريد المتابعة؟'
      )) return;

      db = {
        drivers: imported.drivers,
        items: imported.items,
        accounts: imported.accounts,
        invoices: imported.invoices,
        seq: Number(imported.seq) || 1001
      };

      saveDatabase();

      notify('تمت استعادة النسخة الاحتياطية');

    } catch (error) {
      console.error(error);
      alert('ملف النسخة الاحتياطية غير صالح.');
    } finally {
      event.target.value = '';
    }
  };

  reader.readAsText(file);
}

/* =========================================
   بيانات أولية عند التشغيل لأول مرة
   ========================================= */

if (!localStorage.getItem(STORAGE_KEY)) {
  db.items = [
    { id: nextId(), name: 'حبة شواية', price: 46 },
    { id: nextId(), name: 'نصف شواية', price: 23 },
    { id: nextId(), name: 'ربع دجاج', price: 15 },
    { id: nextId(), name: 'حبة مندي', price: 46 },
    { id: nextId(), name: 'نصف مندي', price: 23 },
    { id: nextId(), name: 'رز شعبي', price: 10 }
  ];

  saveDatabase();
}

/* =========================================
   تشغيل التطبيق
   ========================================= */

renderAll();
renderSingleLines();

/* =========================================
   تثبيت التطبيق
   ========================================= */

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

  notify('تم تثبيت التطبيق بنجاح');
});

async function installApp() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();

    await deferredInstallPrompt.userChoice;

    deferredInstallPrompt = null;
    return;
  }

  alert(
    'لتثبيت التطبيق، افتحه من Chrome عبر HTTPS، ' +
    'ثم افتح القائمة واختر تثبيت التطبيق أو إضافة إلى الشاشة الرئيسية.'
  );
}

/* =========================================
   العمل دون اتصال
   ========================================= */

if (
  'serviceWorker' in navigator &&
  (location.protocol === 'https:' || location.hostname === 'localhost')
) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .catch(error => console.warn('تعذر تسجيل Service Worker', error));
  });
}
