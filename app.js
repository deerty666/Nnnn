"use strict";

/* =====================================================
   ديرتي | نظام حسابات السائقين اليومية
   app.js — الإصدار الأول
   ===================================================== */

const DB_KEY = "deerty_daily_system_v1";
const APP_VERSION = 1;

let db = loadDatabase();

let accountLines = [];
let singleLines = [];
let finalInvoiceState = null;
let confirmCallback = null;
let toastTimer = null;
let installPromptEvent = null;


/* =====================================================
   أدوات عامة
   ===================================================== */

function createId(prefix = "id") {
    return prefix + "_" + Date.now().toString(36) +
        "_" + Math.random().toString(36).slice(2, 9);
}

function money(value) {
    const number = Number(value) || 0;

    return number.toLocaleString("ar-SA", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }) + " ر.س";
}

function numeric(value) {
    const result = Number(value);

    return Number.isFinite(result) ? result : 0;
}

function roundMoney(value) {
    return Math.round((numeric(value) + Number.EPSILON) * 100) / 100;
}

function todayKey() {
    const date = new Date();

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function formatDate(dateValue = new Date()) {
    const date = dateValue instanceof Date
        ? dateValue
        : new Date(dateValue);

    if (Number.isNaN(date.getTime())) {
        return "—";
    }

    return date.toLocaleDateString("ar-SA", {
        year: "numeric",
        month: "long",
        day: "numeric"
    });
}

function formatTime(dateValue = new Date()) {
    const date = dateValue instanceof Date
        ? dateValue
        : new Date(dateValue);

    return date.toLocaleTimeString("ar-SA", {
        hour: "2-digit",
        minute: "2-digit"
    });
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

function getElement(id) {
    return document.getElementById(id);
}

function setText(id, value) {
    const element = getElement(id);

    if (element) {
        element.textContent = value;
    }
}

function getValue(id) {
    const element = getElement(id);

    return element ? element.value : "";
}

function setValue(id, value) {
    const element = getElement(id);

    if (element) {
        element.value = value;
    }
}

function safeAmount(id) {
    return Math.max(0, roundMoney(numeric(getValue(id))));
}

function showToast(message, type = "success") {
    const toast = getElement("toast");

    if (!toast) {
        alert(message);
        return;
    }

    toast.textContent = message;
    toast.className = `toast show ${type}`;

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
        toast.className = "toast";
    }, 3200);
}

function askConfirm(title, message, callback) {
    setText("confirmTitle", title);
    setText("confirmMessage", message);

    confirmCallback = callback;

    const modal = getElement("confirmModal");

    if (modal) {
        modal.hidden = false;
    }
}

function closeConfirmModal() {
    const modal = getElement("confirmModal");

    if (modal) {
        modal.hidden = true;
    }

    confirmCallback = null;
}

function runConfirmAction() {
    const callback = confirmCallback;

    closeConfirmModal();

    if (typeof callback === "function") {
        callback();
    }
}

function normalizeName(value) {
    return String(value ?? "").trim().replace(/\s+/g, " ");
}

function getDriverById(id) {
    return db.drivers.find(driver => driver.id === id);
}

function getItemById(id) {
    return db.items.find(item => item.id === id);
}

function currentDateInvoices() {
    return db.invoices.filter(invoice => invoice.date === todayKey());
}

function currentDateFinalInvoices() {
    return db.finalInvoices.filter(invoice => invoice.date === todayKey());
}

function invoiceGrandTotal(lines, discount = 0) {
    const subtotal = lines.reduce((sum, line) => {
        return sum + numeric(line.qty) * numeric(line.price);
    }, 0);

    return roundMoney(Math.max(0, subtotal - numeric(discount)));
}

function linesSubtotal(lines) {
    return roundMoney(lines.reduce((sum, line) => {
        return sum + numeric(line.qty) * numeric(line.price);
    }, 0));
}

function paymentValues(total, cash, card) {
    total = roundMoney(Math.max(0, total));
    cash = roundMoney(Math.max(0, cash));
    card = roundMoney(Math.max(0, card));

    const paid = roundMoney(cash + card);

    return {
        cash,
        card,
        paid,
        remaining: roundMoney(Math.max(0, total - paid)),
        overpaid: roundMoney(Math.max(0, paid - total))
    };
}


/* =====================================================
   حفظ البيانات
   ===================================================== */

function createEmptyDatabase() {
    return {
        version: APP_VERSION,
        drivers: [],
        items: [],
        invoices: [],
        finalInvoices: [],
        nextInvoiceNumber: 1
    };
}

function loadDatabase() {
    try {
        const raw = localStorage.getItem(DB_KEY);

        if (!raw) {
            return createEmptyDatabase();
        }

        const parsed = JSON.parse(raw);

        if (!parsed || typeof parsed !== "object") {
            return createEmptyDatabase();
        }

        return {
            version: APP_VERSION,
            drivers: Array.isArray(parsed.drivers) ? parsed.drivers : [],
            items: Array.isArray(parsed.items) ? parsed.items : [],
            invoices: Array.isArray(parsed.invoices) ? parsed.invoices : [],
            finalInvoices: Array.isArray(parsed.finalInvoices)
                ? parsed.finalInvoices
                : [],
            nextInvoiceNumber: Math.max(
                1,
                Number(parsed.nextInvoiceNumber) || 1
            )
        };
    } catch (error) {
        console.error("تعذر قراءة بيانات النظام:", error);

        return createEmptyDatabase();
    }
}

function saveDatabase() {
    try {
        localStorage.setItem(DB_KEY, JSON.stringify(db));
        return true;
    } catch (error) {
        console.error("تعذر حفظ البيانات:", error);

        showToast(
            "تعذر حفظ البيانات. قد تكون مساحة التخزين ممتلئة.",
            "error"
        );

        return false;
    }
}


/* =====================================================
   التنقل بين الأقسام
   ===================================================== */

function showTab(tabName) {
    document.querySelectorAll(".tab-panel").forEach(panel => {
        panel.classList.toggle(
            "active",
            panel.id === `tab-${tabName}`
        );
    });

    document.querySelectorAll(".nav-btn").forEach(button => {
        button.classList.toggle(
            "active",
            button.dataset.tab === tabName
        );
    });

    if (tabName === "account") {
        renderQuickItems();
        updateAccountPayment();
    }

    if (tabName === "single") {
        renderSingleItemOptions();
        updateSinglePayment();
    }

    if (tabName === "drivers") {
        renderDrivers();
    }

    if (tabName === "items") {
        renderItems();
    }

    if (tabName === "history") {
        renderHistory();
    }

    if (tabName === "daily") {
        renderDailyReport();
    }

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
}


/* =====================================================
   السائقون
   ===================================================== */

function addDriver(event) {
    if (event) {
        event.preventDefault();
    }

    const name = normalizeName(getValue("driverName"));
    const phone = normalizeName(getValue("driverPhone"));
    const editId = getValue("driverEditId");

    if (!name) {
        showToast("اكتب اسم السائق أولًا.", "error");
        return;
    }

    const duplicate = db.drivers.some(driver => {
        return driver.id !== editId &&
            normalizeName(driver.name).toLowerCase() === name.toLowerCase();
    });

    if (duplicate) {
        showToast("هذا الاسم موجود بالفعل.", "error");
        return;
    }

    if (editId) {
        const driver = getDriverById(editId);

        if (!driver) {
            showToast("تعذر العثور على السائق.", "error");
            resetDriverForm();
            return;
        }

        driver.name = name;
        driver.phone = phone;

        if (!saveDatabase()) {
            return;
        }

        showToast("تم تعديل بيانات السائق.");
    } else {
        db.drivers.push({
            id: createId("driver"),
            name,
            phone,
            createdAt: new Date().toISOString()
        });

        if (!saveDatabase()) {
            return;
        }

        showToast("تمت إضافة السائق.");
    }

    resetDriverForm();
    renderAll();
}

function editDriver(id) {
    const driver = getDriverById(id);

    if (!driver) {
        showToast("السائق غير موجود.", "error");
        return;
    }

    setValue("driverEditId", driver.id);
    setValue("driverName", driver.name);
    setValue("driverPhone", driver.phone);

    setText("driverFormTitle", "تعديل بيانات السائق");
    setText("driverSubmitBtn", "حفظ التعديلات");

    showTab("drivers");

    getElement("driverName").focus();
}

function resetDriverForm() {
    const form = getElement("driverForm");

    if (form) {
        form.reset();
    }

    setValue("driverEditId", "");

    setText("driverFormTitle", "إضافة سائق جديد");
    setText("driverSubmitBtn", "حفظ السائق");
}

function deleteDriver(id) {
    const driver = getDriverById(id);

    if (!driver) {
        return;
    }

    const hasInvoices = [...db.invoices, ...db.finalInvoices]
        .some(invoice => invoice.driverId === id);

    if (hasInvoices) {
        showToast(
            "لا يمكن حذف سائق له فواتير مسجلة. يمكنك تعديل بياناته.",
            "error"
        );

        return;
    }

    askConfirm(
        "حذف السائق",
        `هل تريد حذف السائق "${driver.name}"؟`,
        () => {
            db.drivers = db.drivers.filter(item => item.id !== id);

            if (!saveDatabase()) {
                return;
            }

            renderAll();
            showToast("تم حذف السائق.");
        }
    );
}

function renderDrivers() {
    const tbody = getElement("driversRows");

    if (!tbody) {
        return;
    }

    const drivers = db.drivers;

    setText("driverCount", `${drivers.length} سائق`);

    if (!drivers.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="empty-cell">
                    لا يوجد سائقون. أضف سائقًا من النموذج أعلاه.
                </td>
            </tr>
        `;

        return;
    }

    tbody.innerHTML = drivers.map((driver, index) => {
        const stats = getDriverDayStats(driver.id);

        return `
            <tr>
                <td>${index + 1}</td>
                <td>${escapeHTML(driver.name)}</td>
                <td>${escapeHTML(driver.phone || "—")}</td>
                <td>${money(stats.total)}</td>
                <td>
                    <button type="button"
                            class="btn btn-small btn-edit"
                            onclick="editDriver('${driver.id}')">
                        تعديل
                    </button>

                    <button type="button"
                            class="btn btn-small btn-delete"
                            onclick="deleteDriver('${driver.id}')">
                        حذف
                    </button>
                </td>
            </tr>
        `;
    }).join("");
}

function renderDriverOptions() {
    const selectIds = [
        "accountDriver",
        "singleDriver"
    ];

    selectIds.forEach(id => {
        const select = getElement(id);

        if (!select) {
            return;
        }

        const previous = select.value;

        select.innerHTML = `
            <option value="">اختر السائق</option>
            ${db.drivers.map(driver => `
                <option value="${escapeHTML(driver.id)}">
                    ${escapeHTML(driver.name)}
                </option>
            `).join("")}
        `;

        if (db.drivers.some(driver => driver.id === previous)) {
            select.value = previous;
        }
    });
}


/* =====================================================
   المنتجات
   ===================================================== */

function addItem(event) {
    if (event) {
        event.preventDefault();
    }

    const name = normalizeName(getValue("itemName"));
    const category = normalizeName(getValue("itemCategory"));
    const price = roundMoney(numeric(getValue("itemPrice")));
    const editId = getValue("itemEditId");

    if (!name) {
        showToast("اكتب اسم المنتج.", "error");
        return;
    }

    if (getValue("itemPrice") === "" || price < 0) {
        showToast("أدخل سعرًا صحيحًا.", "error");
        return;
    }

    const duplicate = db.items.some(item => {
        return item.id !== editId &&
            normalizeName(item.name).toLowerCase() === name.toLowerCase();
    });

    if (duplicate) {
        showToast("اسم المنتج موجود بالفعل.", "error");
        return;
    }

    if (editId) {
        const item = getItemById(editId);

        if (!item) {
            showToast("تعذر العثور على المنتج.", "error");
            resetItemForm();
            return;
        }

        item.name = name;
        item.category = category;
        item.price = price;

        if (!saveDatabase()) {
            return;
        }

        showToast("تم تعديل المنتج.");
    } else {
        db.items.push({
            id: createId("item"),
            name,
            category,
            price,
            createdAt: new Date().toISOString()
        });

        if (!saveDatabase()) {
            return;
        }

        showToast("تمت إضافة المنتج.");
    }

    resetItemForm();
    renderAll();
}

function editItem(id) {
    const item = getItemById(id);

    if (!item) {
        showToast("المنتج غير موجود.", "error");
        return;
    }

    setValue("itemEditId", item.id);
    setValue("itemName", item.name);
    setValue("itemPrice", item.price);
    setValue("itemCategory", item.category || "");

    setText("itemFormTitle", "تعديل المنتج");
    setText("itemSubmitBtn", "حفظ التعديلات");

    showTab("items");

    getElement("itemName").focus();
}

function resetItemForm() {
    const form = getElement("itemForm");

    if (form) {
        form.reset();
    }

    setValue("itemEditId", "");

    setText("itemFormTitle", "إضافة منتج جديد");
    setText("itemSubmitBtn", "حفظ المنتج");
}

function deleteItem(id) {
    const item = getItemById(id);

    if (!item) {
        return;
    }

    askConfirm(
        "حذف المنتج",
        `هل تريد حذف المنتج "${item.name}" من قائمة المنتجات؟`,
        () => {
            db.items = db.items.filter(product => product.id !== id);

            if (!saveDatabase()) {
                return;
            }

            renderAll();
            showToast("تم حذف المنتج من القائمة.");
        }
    );
}

function renderItems() {
    const tbody = getElement("itemsRows");

    if (!tbody) {
        return;
    }

    const search = normalizeName(getValue("itemSearch")).toLowerCase();

    const items = db.items.filter(item => {
        return !search ||
            item.name.toLowerCase().includes(search) ||
            String(item.category || "").toLowerCase().includes(search);
    });

    if (!items.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="empty-cell">
                    لا توجد منتجات مطابقة.
                </td>
            </tr>
        `;

        return;
    }

    tbody.innerHTML = items.map((item, index) => `
        <tr>
            <td>${index + 1}</td>
            <td>${escapeHTML(item.name)}</td>
            <td>${escapeHTML(item.category || "عام")}</td>
            <td>${money(item.price)}</td>
            <td>
                <button type="button"
                        class="btn btn-small btn-edit"
                        onclick="editItem('${item.id}')">
                    تعديل
                </button>

                <button type="button"
                        class="btn btn-small btn-delete"
                        onclick="deleteItem('${item.id}')">
                    حذف
                </button>
            </td>
        </tr>
    `).join("");
}

function renderSingleItemOptions() {
    const select = getElement("singleItem");

    if (!select) {
        return;
    }

    const previous = select.value;

    select.innerHTML = `
        <option value="">اختر المنتج</option>
        ${db.items.map(item => `
            <option value="${escapeHTML(item.id)}">
                ${escapeHTML(item.name)} — ${money(item.price)}
            </option>
        `).join("")}
    `;

    if (db.items.some(item => item.id === previous)) {
        select.value = previous;
    }
}

function renderQuickItems() {
    const container = getElement("quickItems");

    if (!container) {
        return;
    }

    const search = normalizeName(getValue("productSearch")).toLowerCase();

    const items = db.items.filter(item => {
        return !search ||
            item.name.toLowerCase().includes(search) ||
            String(item.category || "").toLowerCase().includes(search);
    });

    if (!items.length) {
        container.innerHTML = `
            <div class="empty-state">
                ${db.items.length
                    ? "لا توجد منتجات تطابق البحث."
                    : "أضف المنتجات أولًا من قسم إدارة المنتجات."}
            </div>
        `;

        return;
    }

    container.innerHTML = items.map(item => `
        <button type="button"
                class="quick-item"
                onclick="addItemToAccount('${item.id}')">

            <span class="quick-item-name">
                ${escapeHTML(item.name)}
            </span>

            <span class="quick-item-price">
                ${money(item.price)}
            </span>

            <span class="quick-item-category">
                ${escapeHTML(item.category || "عام")}
            </span>

        </button>
    `).join("");
}


/* =====================================================
   حساب السائق: إضافة المنتجات وتعديلها
   ===================================================== */

function addItemToAccount(itemId) {
    const item = getItemById(itemId);

    if (!item) {
        showToast("المنتج غير موجود.", "error");
        return;
    }

    const existing = accountLines.find(line => {
        return line.itemId === item.id &&
            numeric(line.price) === numeric(item.price);
    });

    if (existing) {
        existing.qty += 1;
    } else {
        accountLines.push({
            id: createId("line"),
            itemId: item.id,
            name: item.name,
            qty: 1,
            price: item.price
        });
    }

    renderAccountRows();
    updateAccountPayment();

    showToast(`تمت إضافة ${item.name}.`);
}

function updateAccountLine(id, field, value) {
    const line = accountLines.find(item => item.id === id);

    if (!line) {
        return;
    }

    if (field === "qty") {
        line.qty = Math.max(1, Math.floor(numeric(value)));
    } else if (field === "price") {
        line.price = roundMoney(Math.max(0, numeric(value)));
    }

    renderAccountRows();
    updateAccountPayment();
}

function removeAccountLine(id) {
    accountLines = accountLines.filter(line => line.id !== id);

    renderAccountRows();
    updateAccountPayment();
}

function renderAccountRows() {
    const tbody = getElement("accountRows");

    if (!tbody) {
        return;
    }

    if (!accountLines.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="empty-cell">
                    لم تتم إضافة منتجات بعد.
                </td>
            </tr>
        `;

        setText("accountTotal", money(0));
        return;
    }

    tbody.innerHTML = accountLines.map(line => `
        <tr>
            <td>${escapeHTML(line.name)}</td>

            <td>
                <input type="number"
                       min="1"
                       step="1"
                       value="${line.qty}"
                       aria-label="كمية ${escapeHTML(line.name)}"
                       onchange="updateAccountLine(
                           '${line.id}', 'qty', this.value
                       )">
            </td>

            <td>
                <input type="number"
                       min="0"
                       step="0.01"
                       value="${line.price}"
                       aria-label="سعر ${escapeHTML(line.name)}"
                       onchange="updateAccountLine(
                           '${line.id}', 'price', this.value
                       )">
            </td>

            <td>${money(line.qty * line.price)}</td>

            <td>
                <button type="button"
                        class="btn btn-small btn-delete"
                        onclick="removeAccountLine('${line.id}')">
                    حذف
                </button>
            </td>
        </tr>
    `).join("");

    setText("accountTotal", money(linesSubtotal(accountLines)));
}

function updateAccountPayment() {
    const total = linesSubtotal(accountLines);

    const cash = safeAmount("paymentCash");
    const card = safeAmount("paymentCard");

    const payment = paymentValues(total, cash, card);

    setText("accountTotal", money(total));
    setText("paymentPaid", money(payment.paid));
    setText("paymentRemaining", money(payment.remaining));

    return payment;
}

function clearAccountConfirm() {
    if (!accountLines.length) {
        showToast("الحساب الحالي فارغ.");
        return;
    }

    askConfirm(
        "مسح الحساب الحالي",
        "سيتم حذف المنتجات غير المحفوظة من هذا الحساب فقط.",
        () => {
            accountLines = [];

            setValue("accountNote", "");
            setValue("paymentCash", "0");
            setValue("paymentCard", "0");

            renderAccountRows();
            updateAccountPayment();

            showToast("تم مسح الحساب الحالي.");
        }
    );
}

function getAccountDriver() {
    const driverId = getValue("accountDriver");

    if (!driverId) {
        showToast("اختر السائق أولًا.", "error");
        return null;
    }

    const driver = getDriverById(driverId);

    if (!driver) {
        showToast("السائق غير موجود.", "error");
        return null;
    }

    return driver;
}

function closeAccount() {
    const driver = getAccountDriver();

    if (!driver) {
        return;
    }

    if (!accountLines.length) {
        showToast("أضف منتجًا واحدًا على الأقل.", "error");
        return;
    }

    const lines = accountLines.map(line => ({
        itemId: line.itemId,
        name: line.name,
        qty: Math.max(1, Math.floor(numeric(line.qty))),
        price: roundMoney(Math.max(0, numeric(line.price)))
    }));

    const total = invoiceGrandTotal(lines);

    const cash = safeAmount("paymentCash");
    const card = safeAmount("paymentCard");
    const payment = paymentValues(total, cash, card);

    if (payment.overpaid > 0) {
        showToast(
            "مجموع النقد والشبكة أكبر من قيمة الفاتورة.",
            "error"
        );

        return;
    }

    const invoice = {
        id: createId("invoice"),
        number: db.nextInvoiceNumber++,
        type: "single",
        date: todayKey(),
        time: new Date().toISOString(),
        driverId: driver.id,
        driverName: driver.name,
        lines,
        subtotal: total,
        discount: 0,
        total,
        cash: payment.cash,
        card: payment.card,
        paid: payment.paid,
        remaining: payment.remaining,
        note: normalizeName(getValue("accountNote"))
    };

    db.invoices.push(invoice);

    if (!saveDatabase()) {
        db.invoices = db.invoices.filter(item => item.id !== invoice.id);
        db.nextInvoiceNumber = Math.max(1, db.nextInvoiceNumber - 1);
        return;
    }

    accountLines = [];

    setValue("accountNote", "");
    setValue("paymentCash", "0");
    setValue("paymentCard", "0");

    renderAll();

    showToast("تم حفظ الفاتورة بنجاح.");

    printInvoice(invoice, false);
}


/* =====================================================
   الفاتورة المستقلة
   ===================================================== */

function setSinglePrice() {
    const item = getItemById(getValue("singleItem"));

    if (item) {
        setValue("singlePrice", item.price);
    } else {
        setValue("singlePrice", "0");
    }
}

function addSingleLine() {
    const item = getItemById(getValue("singleItem"));

    if (!item) {
        showToast("اختر المنتج أولًا.", "error");
        return;
    }

    const qty = Math.floor(numeric(getValue("singleQty")));
    const price = roundMoney(numeric(getValue("singlePrice")));

    if (qty < 1 || price < 0) {
        showToast("تحقق من الكمية والسعر.", "error");
        return;
    }

    singleLines.push({
        id: createId("line"),
        itemId: item.id,
        name: item.name,
        qty,
        price
    });

    renderSingleRows();
    updateSinglePayment();

    setValue("singleQty", "1");
}

function updateSingleLine(id, field, value) {
    const line = singleLines.find(item => item.id === id);

    if (!line) {
        return;
    }

    if (field === "qty") {
        line.qty = Math.max(1, Math.floor(numeric(value)));
    } else if (field === "price") {
        line.price = roundMoney(Math.max(0, numeric(value)));
    }

    renderSingleRows();
    updateSinglePayment();
}

function removeSingleLine(id) {
    singleLines = singleLines.filter(line => line.id !== id);

    renderSingleRows();
    updateSinglePayment();
}

function renderSingleRows() {
    const tbody = getElement("singleRows");

    if (!tbody) {
        return;
    }

    if (!singleLines.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="empty-cell">
                    الفاتورة فارغة.
                </td>
            </tr>
        `;

        setText("singleTotal", money(0));
        return;
    }

    tbody.innerHTML = singleLines.map(line => `
        <tr>
            <td>${escapeHTML(line.name)}</td>

            <td>
                <input type="number"
                       min="1"
                       step="1"
                       value="${line.qty}"
                       onchange="updateSingleLine(
                           '${line.id}', 'qty', this.value
                       )">
            </td>

            <td>
                <input type="number"
                       min="0"
                       step="0.01"
                       value="${line.price}"
                       onchange="updateSingleLine(
                           '${line.id}', 'price', this.value
                       )">
            </td>

            <td>${money(line.qty * line.price)}</td>

            <td>
                <button type="button"
                        class="btn btn-small btn-delete"
                        onclick="removeSingleLine('${line.id}')">
                    حذف
                </button>
            </td>
        </tr>
    `).join("");

    setText("singleTotal", money(linesSubtotal(singleLines)));
}

function updateSinglePayment() {
    const total = linesSubtotal(singleLines);

    const payment = paymentValues(
        total,
        safeAmount("singleCash"),
        safeAmount("singleCard")
    );

    setText("singleTotal", money(total));
    setText("singleRemaining", money(payment.remaining));

    return payment;
}

function clearSingleInvoice() {
    singleLines = [];

    setValue("singleNote", "");
    setValue("singleQty", "1");
    setValue("singlePrice", "0");
    setValue("singleCash", "0");
    setValue("singleCard", "0");

    renderSingleRows();
    updateSinglePayment();

    showToast("تم تفريغ الفاتورة.");
}

function saveSingleInvoice() {
    const driverId = getValue("singleDriver");
    const driver = getDriverById(driverId);

    if (!driver) {
        showToast("اختر السائق.", "error");
        return;
    }

    if (!singleLines.length) {
        showToast("أضف منتجًا واحدًا على الأقل.", "error");
        return;
    }

    const lines = singleLines.map(line => ({
        itemId: line.itemId,
        name: line.name,
        qty: Math.max(1, Math.floor(numeric(line.qty))),
        price: roundMoney(Math.max(0, numeric(line.price)))
    }));

    const total = invoiceGrandTotal(lines);

    const payment = paymentValues(
        total,
        safeAmount("singleCash"),
        safeAmount("singleCard")
    );

    if (payment.overpaid > 0) {
        showToast(
            "مجموع النقد والشبكة أكبر من قيمة الفاتورة.",
            "error"
        );

        return;
    }

    const invoice = {
        id: createId("invoice"),
        number: db.nextInvoiceNumber++,
        type: "single",
        date: todayKey(),
        time: new Date().toISOString(),
        driverId: driver.id,
        driverName: driver.name,
        lines,
        subtotal: total,
        discount: 0,
        total,
        cash: payment.cash,
        card: payment.card,
        paid: payment.paid,
        remaining: payment.remaining,
        note: normalizeName(getValue("singleNote"))
    };

    db.invoices.push(invoice);

    if (!saveDatabase()) {
        db.invoices = db.invoices.filter(item => item.id !== invoice.id);
        db.nextInvoiceNumber = Math.max(1, db.nextInvoiceNumber - 1);
        return;
    }

    singleLines = [];

    setValue("singleNote", "");
    setValue("singleCash", "0");
    setValue("singleCard", "0");
    setValue("singleQty", "1");
    setValue("singlePrice", "0");

    renderAll();

    showToast("تم حفظ الفاتورة الجديدة.");

    printInvoice(invoice, false);
}


/* =====================================================
   الفاتورة النهائية المجمعة
   ===================================================== */

function prepareFinalInvoice() {
    const driver = getAccountDriver();

    if (!driver) {
        return;
    }

    const sourceInvoices = currentDateInvoices().filter(invoice => {
        return invoice.driverId === driver.id &&
            !invoice.finalizedBy;
    });

    const draftLines = sourceInvoices.flatMap(invoice => invoice.lines || []);

    const allLines = [...draftLines, ...accountLines];

    if (!allLines.length) {
        showToast(
            "لا توجد منتجات أو فواتير لهذا السائق لتجميعها.",
            "error"
        );

        return;
    }

    const merged = new Map();

    allLines.forEach(line => {
        const key = `${line.itemId || line.name}|${numeric(line.price)}`;

        if (!merged.has(key)) {
            merged.set(key, {
                id: createId("final-line"),
                itemId: line.itemId || "",
                name: line.name,
                qty: 0,
                price: numeric(line.price)
            });
        }

        merged.get(key).qty += numeric(line.qty);
    });

    finalInvoiceState = {
        driverId: driver.id,
        driverName: driver.name,
        sourceInvoiceIds: sourceInvoices.map(invoice => invoice.id),
        lines: Array.from(merged.values())
    };

    setText("finalDriverName", driver.name);

    setValue("finalDiscount", "0");
    setValue("finalCash", "0");
    setValue("finalCard", "0");
    setValue("finalNote", "");

    renderFinalInvoiceRows();
    updateFinalInvoiceTotals();

    const panel = getElement("finalInvoicePanel");

    if (panel) {
        panel.hidden = false;
        panel.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }
}

function renderFinalInvoiceRows() {
    const tbody = getElement("finalInvoiceRows");

    if (!tbody || !finalInvoiceState) {
        return;
    }

    const lines = finalInvoiceState.lines;

    if (!lines.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="empty-cell">
                    لا توجد منتجات في الفاتورة.
                </td>
            </tr>
        `;

        return;
    }

    tbody.innerHTML = lines.map(line => `
        <tr>
            <td>${escapeHTML(line.name)}</td>

            <td>
                <input type="number"
                       min="1"
                       step="1"
                       value="${line.qty}"
                       onchange="updateFinalLine(
                           '${line.id}', 'qty', this.value
                       )">
            </td>

            <td>
                <input type="number"
                       min="0"
                       step="0.01"
                       value="${line.price}"
                       onchange="updateFinalLine(
                           '${line.id}', 'price', this.value
                       )">
            </td>

            <td>${money(line.qty * line.price)}</td>

            <td>
                <button type="button"
                        class="btn btn-small btn-delete"
                        onclick="removeFinalLine('${line.id}')">
                    حذف
                </button>
            </td>
        </tr>
    `).join("");
}

function updateFinalLine(id, field, value) {
    if (!finalInvoiceState) {
        return;
    }

    const line = finalInvoiceState.lines.find(item => item.id === id);

    if (!line) {
        return;
    }

    if (field === "qty") {
        line.qty = Math.max(1, Math.floor(numeric(value)));
    } else if (field === "price") {
        line.price = roundMoney(Math.max(0, numeric(value)));
    }

    renderFinalInvoiceRows();
    updateFinalInvoiceTotals();
}

function removeFinalLine(id) {
    if (!finalInvoiceState) {
        return;
    }

    finalInvoiceState.lines = finalInvoiceState.lines.filter(
        line => line.id !== id
    );

    renderFinalInvoiceRows();
    updateFinalInvoiceTotals();
}

function updateFinalInvoiceTotals() {
    if (!finalInvoiceState) {
        setText("finalTotal", money(0));
        setText("finalCredit", money(0));
        return;
    }

    const subtotal = linesSubtotal(finalInvoiceState.lines);

    const discount = roundMoney(
        Math.min(subtotal, safeAmount("finalDiscount"))
    );

    const total = roundMoney(subtotal - discount);

    const payment = paymentValues(
        total,
        safeAmount("finalCash"),
        safeAmount("finalCard")
    );

    setText("finalTotal", money(total));
    setText("finalCredit", money(payment.remaining));

    return {
        subtotal,
        discount,
        total,
        ...payment
    };
}

function cancelFinalInvoice() {
    finalInvoiceState = null;

    const panel = getElement("finalInvoicePanel");

    if (panel) {
        panel.hidden = true;
    }
}

function saveFinalInvoice() {
    if (!finalInvoiceState) {
        showToast("جهّز الفاتورة النهائية أولًا.", "error");
        return;
    }

    if (!finalInvoiceState.lines.length) {
        showToast("الفاتورة النهائية فارغة.", "error");
        return;
    }

    const driver = getDriverById(finalInvoiceState.driverId);

    if (!driver) {
        showToast("تعذر العثور على السائق.", "error");
        return;
    }

    const totals = updateFinalInvoiceTotals();

    if (!totals) {
        return;
    }

    if (totals.overpaid > 0) {
        showToast(
            "مجموع النقد والشبكة أكبر من إجمالي الفاتورة.",
            "error"
        );

        return;
    }

    const sourceIds = new Set(finalInvoiceState.sourceInvoiceIds);

    const stillValid = sourceIds.size === finalInvoiceState.sourceInvoiceIds.length &&
        Array.from(sourceIds).every(id => {
            const invoice = db.invoices.find(item => item.id === id);

            return invoice &&
                invoice.date === todayKey() &&
                invoice.driverId === driver.id &&
                !invoice.finalizedBy;
        });

    if (!stillValid) {
        showToast(
            "تغيرت الفواتير أثناء تجهيز التجميع. أعد تجهيز الفاتورة.",
            "error"
        );

        return;
    }

    const finalInvoice = {
        id: createId("final"),
        number: db.nextInvoiceNumber++,
        type: "final",
        date: todayKey(),
        time: new Date().toISOString(),
        driverId: driver.id,
        driverName: driver.name,
        sourceInvoiceIds: [...sourceIds],
        lines: finalInvoiceState.lines.map(line => ({
            itemId: line.itemId || "",
            name: line.name,
            qty: Math.max(1, Math.floor(numeric(line.qty))),
            price: roundMoney(Math.max(0, numeric(line.price)))
        })),
        subtotal: totals.subtotal,
        discount: totals.discount,
        total: totals.total,
        cash: totals.cash,
        card: totals.card,
        paid: totals.paid,
        remaining: totals.remaining,
        note: normalizeName(getValue("finalNote"))
    };

    const originalInvoiceStates = db.invoices
        .filter(invoice => sourceIds.has(invoice.id))
        .map(invoice => ({
            id: invoice.id,
            finalizedBy: invoice.finalizedBy
        }));

    originalInvoiceStates.forEach(original => {
        const invoice = db.invoices.find(item => item.id === original.id);

        if (invoice) {
            invoice.finalizedBy = finalInvoice.id;
        }
    });

    db.finalInvoices.push(finalInvoice);

    if (!saveDatabase()) {
        db.finalInvoices = db.finalInvoices.filter(
            invoice => invoice.id !== finalInvoice.id
        );

        originalInvoiceStates.forEach(original => {
            const invoice = db.invoices.find(item => item.id === original.id);

            if (invoice) {
                if (original.finalizedBy === undefined) {
                    delete invoice.finalizedBy;
                } else {
                    invoice.finalizedBy = original.finalizedBy;
                }
            }
        });

        db.nextInvoiceNumber = Math.max(1, db.nextInvoiceNumber - 1);

        return;
    }

    accountLines = [];

    setValue("accountNote", "");
    setValue("paymentCash", "0");
    setValue("paymentCard", "0");

    finalInvoiceState = null;

    const panel = getElement("finalInvoicePanel");

    if (panel) {
        panel.hidden = true;
    }

    renderAll();

    showToast("تم حفظ الفاتورة النهائية دون تكرار الحساب.");

    printInvoice(finalInvoice, true);
}


/* =====================================================
   إحصائيات اليوم
   ===================================================== */

function getEffectiveInvoicesForDay(date = todayKey()) {
    const normal = db.invoices.filter(invoice => {
        return invoice.date === date && !invoice.finalizedBy;
    });

    const final = db.finalInvoices.filter(invoice => invoice.date === date);

    return [...normal, ...final];
}

function getDayStats(date = todayKey()) {
    const invoices = getEffectiveInvoicesForDay(date);

    return invoices.reduce((stats, invoice) => {
        stats.count += 1;
        stats.total += numeric(invoice.total);
        stats.cash += numeric(invoice.cash);
        stats.card += numeric(invoice.card);
        stats.remaining += numeric(invoice.remaining);

        return stats;
    }, {
        count: 0,
        total: 0,
        cash: 0,
        card: 0,
        remaining: 0
    });
}

function getDriverDayStats(driverId, date = todayKey()) {
    const invoices = getEffectiveInvoicesForDay(date).filter(invoice => {
        return invoice.driverId === driverId;
    });

    return invoices.reduce((stats, invoice) => {
        stats.count += 1;
        stats.total += numeric(invoice.total);
        stats.cash += numeric(invoice.cash);
        stats.card += numeric(invoice.card);
        stats.remaining += numeric(invoice.remaining);

        return stats;
    }, {
        count: 0,
        total: 0,
        cash: 0,
        card: 0,
        remaining: 0
    });
}

function renderDailyReport() {
    const date = todayKey();

    setText("reportDate", formatDate(new Date()));

    const stats = getDayStats(date);

    setText("dailyTotal", money(stats.total));
    setText("dailyCash", money(stats.cash));
    setText("dailyCard", money(stats.card));
    setText("dailyCredit", money(stats.remaining));
    setText("dailyInvoiceCount", String(stats.count));

    const tbody = getElement("dayRows");

    if (!tbody) {
        return;
    }

    const driversWithStats = db.drivers.map(driver => ({
        driver,
        stats: getDriverDayStats(driver.id, date)
    })).filter(entry => entry.stats.count > 0);

    if (!driversWithStats.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-cell">
                    لا توجد بيانات لهذا اليوم.
                </td>
            </tr>
        `;

        return;
    }

    tbody.innerHTML = driversWithStats.map(entry => `
        <tr>
            <td>${escapeHTML(entry.driver.name)}</td>
            <td>${entry.stats.count}</td>
            <td>${money(entry.stats.total)}</td>
            <td>${money(entry.stats.cash)}</td>
            <td>${money(entry.stats.card)}</td>
            <td>${money(entry.stats.remaining)}</td>
        </tr>
    `).join("");
}


/* =====================================================
   سجل فواتير اليوم
   ===================================================== */

function renderHistory() {
    const tbody = getElement("historyRows");

    if (!tbody) {
        return;
    }

    const search = normalizeName(getValue("historySearch")).toLowerCase();
    const type = getValue("historyType") || "all";

    let invoices = [
        ...currentDateInvoices(),
        ...currentDateFinalInvoices()
    ];

    if (type === "single") {
        invoices = invoices.filter(invoice => invoice.type !== "final");
    } else if (type === "final") {
        invoices = invoices.filter(invoice => invoice.type === "final");
    }

    if (search) {
        invoices = invoices.filter(invoice => {
            return String(invoice.number).includes(search) ||
                String(invoice.driverName || "").toLowerCase().includes(search);
        });
    }

    invoices.sort((a, b) => {
        return new Date(b.time).getTime() - new Date(a.time).getTime();
    });

    if (!invoices.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-cell">
                    لا توجد فواتير مطابقة لهذا اليوم.
                </td>
            </tr>
        `;

        return;
    }

    tbody.innerHTML = invoices.map(invoice => {
        const typeLabel = invoice.type === "final"
            ? "نهائية"
            : "عادية";

        const linkedToFinal = Boolean(invoice.finalizedBy);

        return `
            <tr>
                <td>
                    #${invoice.number}
                    <br>
                    <span class="muted-text">${typeLabel}</span>
                </td>

                <td>${escapeHTML(formatTime(invoice.time))}</td>

                <td>${escapeHTML(invoice.driverName)}</td>

                <td>${money(invoice.total)}</td>
                <td>${money(invoice.cash)}</td>
                <td>${money(invoice.card)}</td>
                <td>${money(invoice.remaining)}</td>

                <td>
                    <button type="button"
                            class="btn btn-small btn-outline"
                            onclick="printSavedInvoice('${invoice.id}')">
                        طباعة
                    </button>

                    ${linkedToFinal
                        ? `<span class="muted-text">ضمن فاتورة نهائية</span>`
                        : ""}
                </td>
            </tr>
        `;
    }).join("");
}

function printSavedInvoice(id) {
    const invoice = [...db.invoices, ...db.finalInvoices]
        .find(item => item.id === id);

    if (!invoice) {
        showToast("تعذر العثور على الفاتورة.", "error");
        return;
    }

    printInvoice(invoice, invoice.type === "final");
}


/* =====================================================
   الطباعة الحرارية
   ===================================================== */

function buildReceiptHTML(invoice, isFinal = false) {
    const lines = Array.isArray(invoice.lines) ? invoice.lines : [];

    const lineRows = lines.map(line => `
        <tr>
            <td>${escapeHTML(line.name)}</td>
            <td>${numeric(line.qty)}</td>
            <td>${money(line.price)}</td>
            <td>${money(numeric(line.qty) * numeric(line.price))}</td>
        </tr>
    `).join("");

    const sourceInfo = isFinal && Array.isArray(invoice.sourceInvoiceIds)
        ? `<p>فاتورة مجمعة من ${invoice.sourceInvoiceIds.length} فاتورة</p>`
        : "";

    return `
        <div class="receipt">

            <h1>ديرتي</h1>
            <h2>${isFinal ? "الفاتورة النهائية" : "فاتورة حساب"}</h2>

            <div class="receipt-line"></div>

            <p>رقم الفاتورة: #${invoice.number}</p>
            <p>التاريخ: ${escapeHTML(formatDate(invoice.date + "T12:00:00"))}</p>
            <p>الوقت: ${escapeHTML(formatTime(invoice.time))}</p>
            <p>السائق: ${escapeHTML(invoice.driverName)}</p>

            ${sourceInfo}

            <div class="receipt-line"></div>

            <table>
                <thead>
                    <tr>
                        <th>المنتج</th>
                        <th>الكمية</th>
                        <th>السعر</th>
                        <th>الإجمالي</th>
                    </tr>
                </thead>

                <tbody>
                    ${lineRows}
                </tbody>
            </table>

            <div class="receipt-line"></div>

            <div class="receipt-total">
                <span>المجموع</span>
                <span>${money(invoice.subtotal ?? invoice.total)}</span>
            </div>

            ${numeric(invoice.discount) > 0 ? `
                <div class="receipt-total">
                    <span>الخصم</span>
                    <span>${money(invoice.discount)}</span>
                </div>
            ` : ""}

            <div class="receipt-total">
                <span>الإجمالي النهائي</span>
                <span>${money(invoice.total)}</span>
            </div>

            <div class="receipt-total">
                <span>نقدًا</span>
                <span>${money(invoice.cash)}</span>
            </div>

            <div class="receipt-total">
                <span>الشبكة</span>
                <span>${money(invoice.card)}</span>
            </div>

            <div class="receipt-total">
                <span>المتبقي</span>
                <span>${money(invoice.remaining)}</span>
            </div>

            ${invoice.note ? `
                <div class="receipt-line"></div>
                <p>ملاحظات: ${escapeHTML(invoice.note)}</p>
            ` : ""}

            <div class="receipt-line"></div>

            <div class="receipt-footer">
                <p>شكرًا لكم</p>
                <p>مطعم ديرتي</p>
            </div>

        </div>
    `;
}

function printInvoice(invoice, isFinal = false) {
    const printArea = getElement("printArea");

    if (!printArea) {
        showToast("منطقة الطباعة غير موجودة.", "error");
        return;
    }

    printArea.innerHTML = buildReceiptHTML(invoice, isFinal);

    setTimeout(() => {
        window.print();
    }, 100);
}

function printDailyReport() {
    const date = todayKey();
    const stats = getDayStats(date);

    const rows = db.drivers.map(driver => {
        const driverStats = getDriverDayStats(driver.id, date);

        if (!driverStats.count) {
            return "";
        }

        return `
            <tr>
                <td>${escapeHTML(driver.name)}</td>
                <td>${driverStats.count}</td>
                <td>${money(driverStats.total)}</td>
                <td>${money(driverStats.cash)}</td>
                <td>${money(driverStats.card)}</td>
                <td>${money(driverStats.remaining)}</td>
            </tr>
        `;
    }).join("");

    const printArea = getElement("printArea");

    printArea.innerHTML = `
        <div class="receipt">

            <h1>ديرتي</h1>
            <h2>التقرير اليومي</h2>

            <p>${escapeHTML(formatDate(new Date()))}</p>

            <div class="receipt-line"></div>

            <div class="receipt-total">
                <span>المبيعات</span>
                <span>${money(stats.total)}</span>
            </div>

            <div class="receipt-total">
                <span>النقد</span>
                <span>${money(stats.cash)}</span>
            </div>

            <div class="receipt-total">
                <span>الشبكة</span>
                <span>${money(stats.card)}</span>
            </div>

            <div class="receipt-total">
                <span>المتبقي</span>
                <span>${money(stats.remaining)}</span>
            </div>

            <div class="receipt-line"></div>

            <table>
                <thead>
                    <tr>
                        <th>السائق</th>
                        <th>عدد</th>
                        <th>الحساب</th>
                        <th>نقد</th>
                        <th>شبكة</th>
                        <th>متبقي</th>
                    </tr>
                </thead>

                <tbody>
                    ${rows || `
                        <tr>
                            <td colspan="6">لا توجد حسابات</td>
                        </tr>
                    `}
                </tbody>
            </table>

        </div>
    `;

    setTimeout(() => window.print(), 100);
}


/* =====================================================
   تصفير جميع الحسابات
   ===================================================== */

function clearAllAccountsConfirm() {
    const count = db.invoices.length + db.finalInvoices.length;

    if (count === 0) {
        showToast("لا توجد فواتير لتصفيرها.");
        return;
    }

    askConfirm(
        "تصفير جميع الحسابات",
        "تحذير: سيتم حذف جميع الفواتير والحسابات والمدفوعات نهائيًا. ستبقى أسماء السائقين والمنتجات وأسعارها محفوظة. هل تريد المتابعة؟",
        clearAllAccounts
    );
}

function clearAllAccounts() {
    const oldInvoices = db.invoices;
    const oldFinalInvoices = db.finalInvoices;
    const oldNextNumber = db.nextInvoiceNumber;

    db.invoices = [];
    db.finalInvoices = [];
    db.nextInvoiceNumber = 1;

    if (!saveDatabase()) {
        db.invoices = oldInvoices;
        db.finalInvoices = oldFinalInvoices;
        db.nextInvoiceNumber = oldNextNumber;

        return;
    }

    accountLines = [];
    singleLines = [];
    finalInvoiceState = null;

    setValue("accountNote", "");
    setValue("paymentCash", "0");
    setValue("paymentCard", "0");

    setValue("singleNote", "");
    setValue("singleCash", "0");
    setValue("singleCard", "0");
    setValue("singleQty", "1");
    setValue("singlePrice", "0");

    setValue("historySearch", "");
    setValue("historyType", "all");

    const finalPanel = getElement("finalInvoicePanel");

    if (finalPanel) {
        finalPanel.hidden = true;
    }

    renderAll();

    showToast("تم تصفير الحسابات والفواتير. الأسماء والمنتجات محفوظة.");
}


/* =====================================================
   ملخص الرأس
   ===================================================== */

function renderHeaderStats() {
    const stats = getDayStats();

    setText("invoiceCount", String(stats.count));
    setText("openTotal", money(stats.total));
    setText("cashTotal", money(stats.cash));
    setText("cardTotal", money(stats.card));
    setText("remainingTotal", money(stats.remaining));

    setText("todayDate", formatDate(new Date()));

    setText(
        "todayName",
        new Date().toLocaleDateString("ar-SA", {
            weekday: "long"
        })
    );

    setText("footerYear", String(new Date().getFullYear()));
}


/* =====================================================
   تحديث واجهة النظام
   ===================================================== */

function renderAll() {
    renderHeaderStats();
    renderDriverOptions();
    renderDrivers();
    renderItems();
    renderQuickItems();
    renderSingleItemOptions();
    renderAccountRows();
    renderSingleRows();
    updateAccountPayment();
    updateSinglePayment();
    renderHistory();
    renderDailyReport();
}


/* =====================================================
   التثبيت كتطبيق
   ===================================================== */

window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();

    installPromptEvent = event;

    const button = getElement("installBtn");

    if (button) {
        button.hidden = false;
    }
});

async function installApp() {
    if (!installPromptEvent) {
        showToast(
            "إذا لم يظهر خيار التثبيت، افتح قائمة المتصفح واختر إضافة إلى الشاشة الرئيسية.",
            "error"
        );

        return;
    }

    installPromptEvent.prompt();

    await installPromptEvent.userChoice;

    installPromptEvent = null;

    const button = getElement("installBtn");

    if (button) {
        button.hidden = true;
    }
}


/* =====================================================
   بدء النظام
   ===================================================== */

function initializeApp() {
    const confirmButton = getElement("confirmActionBtn");

    if (confirmButton) {
        confirmButton.addEventListener("click", runConfirmAction);
    }

    const installButton = getElement("installBtn");

    if (installButton) {
        installButton.addEventListener("click", installApp);
    }

    const accountDriver = getElement("accountDriver");

    if (accountDriver) {
        accountDriver.addEventListener("change", () => {
            accountLines = [];

            setValue("accountNote", "");
            setValue("paymentCash", "0");
            setValue("paymentCard", "0");

            renderAccountRows();
            updateAccountPayment();
        });
    }

    const singleDriver = getElement("singleDriver");

    if (singleDriver) {
        singleDriver.addEventListener("change", () => {
            singleLines = [];

            setValue("singleNote", "");
            setValue("singleCash", "0");
            setValue("singleCard", "0");

            renderSingleRows();
            updateSinglePayment();
        });
    }

    renderAll();

    if ("serviceWorker" in navigator && location.protocol === "https:") {
        navigator.serviceWorker.register("./sw.js").catch(error => {
            console.warn("تعذر تسجيل Service Worker:", error);
        });
    }

    console.info("تم تشغيل نظام ديرتي للحسابات اليومية.");
}

document.addEventListener("DOMContentLoaded", initializeApp);
