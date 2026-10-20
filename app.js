const KEY = 'deerty_driver_invoice_v1';

let db = loadDB();
let singleLines = [];

function loadDB() {
    try {
        return JSON.parse(localStorage.getItem(KEY)) || {
            drivers: [],
            items: [],
            accounts: {},
            invoices: [],
            seq: 1001
        };
    } catch (e) {
        return {
            drivers: [],
            items: [],
            accounts: {},
            invoices: [],
            seq: 1001
        };
    }
}

function persist() {
    localStorage.setItem(KEY, JSON.stringify(db));
    renderAll();
}

function money(n) {
    return (Number(n) || 0).toLocaleString('ar-SA', {
        maximumFractionDigits: 2
    });
}

function id() {
    return db.seq++;
}

function today() {
    return new Date().toLocaleDateString('sv-SE');
}

function stamp() {
    return new Date().toLocaleString('ar-SA');
}

function toast(s) {
    let e = document.getElementById('toast');
    e.textContent = s;
    e.style.display = 'block';

    setTimeout(() => {
        e.style.display = 'none';
    }, 2400);
}

function showTab(t) {
    document.querySelectorAll('.tab').forEach(x => {
        x.classList.add('hidden');
    });

    document.getElementById('tab-' + t).classList.remove('hidden');

    document.querySelectorAll('.tabs button').forEach(b => {
        b.classList.toggle(
            'secondary',
            !b.getAttribute('onclick').includes("'" + t + "'")
        );
    });

    renderAll();
}

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[c]));
}

function currentDriver() {
    return document.getElementById('accountDriver').value;
}

function activeAccount(did) {
    if (!db.accounts[did]) {
        db.accounts[did] = {
            lines: [],
            updated: stamp()
        };
    }

    return db.accounts[did];
}

function options(list, selected) {
    return list.map(x =>
        `<option value="${x.id}" ${String(x.id) === String(selected) ? 'selected' : ''}>${esc(x.name)}</option>`
    ).join('');
}

function renderSelects() {
    const ad = document.getElementById('accountDriver');
    const sd = document.getElementById('singleDriver');

    const oldA = ad.value;
    const oldS = sd.value;

    ad.innerHTML = options(db.drivers, oldA) ||
        '<option value="">أضف سائقًا أولًا</option>';

    sd.innerHTML = options(db.drivers, oldS) ||
        '<option value="">أضف سائقًا أولًا</option>';

    ['accountItem', 'singleItem'].forEach(k => {
        let el = document.getElementById(k);
        let old = el.value;

        el.innerHTML = options(db.items, old) ||
            '<option value="">أضف صنفًا أولًا</option>';
    });

    if (!ad.value && db.drivers.length) {
        ad.value = db.drivers[0].id;
    }
}

function renderAll() {
    renderSelects();
    renderAccount();
    renderDrivers();
    renderItems();
    renderHistory();
    renderStats();
    setSinglePrice();
}

function total(lines) {
    return lines.reduce(
        (s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0),
        0
    );
}

function renderAccount() {
    let did = currentDriver();
    let a = activeAccount(did);

    let body = document.getElementById('accountRows');
    body.innerHTML = '';

    a.lines.forEach((l, i) => {
        body.insertAdjacentHTML('beforeend', `
            <tr>
                <td>${esc(l.name)}</td>

                <td>
                    <input
                        aria-label="الكمية"
                        type="number"
                        min="1"
                        value="${l.qty}"
                        style="width:68px"
                        onchange="editAccountLine(${i},'qty',this.value)"
                    >
                </td>

                <td>
                    <input
                        aria-label="السعر"
                        type="number"
                        min="0"
                        step=".25"
                        value="${l.price}"
                        style="width:88px"
                        onchange="editAccountLine(${i},'price',this.value)"
                    >
                </td>

                <td>${money(l.qty * l.price)}</td>

                <td>
                    <button
                        class="danger small"
                        onclick="removeAccountLine(${i})"
                    >
                        حذف
                    </button>
                </td>
            </tr>
        `);
    });

    if (!a.lines.length) {
        body.innerHTML = `
            <tr>
                <td colspan="5" class="empty">
                    لا توجد أصناف في الحساب المفتوح
                </td>
            </tr>
        `;
    }

    document.getElementById('accountTotal').textContent =
        money(total(a.lines));

    let it = db.items.find(
        x => String(x.id) === document.getElementById('accountItem').value
    );

    if (it) {
        document.getElementById('accountPrice').value = it.price;
    }
}

function addToAccount() {
    let did = currentDriver();

    let it = db.items.find(
        x => String(x.id) === document.getElementById('accountItem').value
    );

    let qty = Number(document.getElementById('accountQty').value);
    let price = Number(document.getElementById('accountPrice').value);

    if (!did) {
        return toast('أضف سائقًا أولًا');
    }

    if (!it) {
        return toast('أضف صنفًا أولًا');
    }

    if (
        qty < 1 ||
        !Number.isFinite(qty) ||
        price < 0 ||
        !Number.isFinite(price)
    ) {
        return toast('تحقق من الكمية والسعر');
    }

    let a = activeAccount(did);

    a.lines.push({
        name: it.name,
        qty,
        price,
        addedAt: stamp()
    });

    a.updated = stamp();

    persist();

    toast('تمت الإضافة إلى الحساب المستمر');
}

function editAccountLine(i, k, v) {
    let a = activeAccount(currentDriver());
    let n = Number(v);

    if (
        (k === 'qty' && n < 1) ||
        (k === 'price' && n < 0) ||
        !Number.isFinite(n)
    ) {
        toast('قيمة غير صحيحة');
        renderAccount();
        return;
    }

    a.lines[i][k] = n;
    a.updated = stamp();

    persist();
}

function removeAccountLine(i) {
    if (!confirm('هل تريد حذف هذا الصنف من الحساب؟')) {
        return;
    }

    activeAccount(currentDriver()).lines.splice(i, 1);

    persist();
}

function saveAccount() {
    activeAccount(currentDriver()).updated = stamp();

    persist();

    toast('تم حفظ الحساب');
}

function clearAccountConfirm() {
    if (confirm('سيتم حذف أصناف الحساب المفتوح الحالي. هل أنت متأكد؟')) {
        activeAccount(currentDriver()).lines = [];

        persist();
    }
}

function closeAccount() {
    let did = currentDriver();

    if (!did) {
        return toast('اختر سائقًا');
    }

    let a = activeAccount(did);

    if (!a.lines.length) {
        return toast('الحساب فارغ');
    }

    if (!confirm('إغلاق الحساب الحالي وحفظه في سجل الفواتير؟')) {
        return;
    }

    db.invoices.unshift({
        id: id(),
        type: 'closed',
        driverId: did,

        driverName:
            db.drivers.find(d => String(d.id) === String(did))?.name ||
            'سائق محذوف',

        date: stamp(),
        lines: JSON.parse(JSON.stringify(a.lines)),
        total: total(a.lines)
    });

    db.accounts[did] = {
        lines: [],
        updated: stamp()
    };

    persist();

    toast('تم إغلاق الحساب وحفظ الفاتورة');
}

function addDriver() {
    let name = document.getElementById('driverName').value.trim();

    let phone = document.getElementById('driverPhone').value.trim();

    if (!name) {
        return toast('اكتب اسم السائق');
    }

    let d = {
        id: id(),
        name,
        phone
    };

    db.drivers.push(d);

    activeAccount(d.id);

    document.getElementById('driverName').value = '';
    document.getElementById('driverPhone').value = '';

    persist();

    document.getElementById('accountDriver').value = d.id;

    renderAccount();

    toast('تمت إضافة السائق');
}

function newDriverPrompt() {
    let name = prompt('اسم السائق الجديد:');

    if (!name?.trim()) {
        return;
    }

    let d = {
        id: id(),
        name: name.trim(),
        phone: ''
    };

    db.drivers.push(d);

    activeAccount(d.id);

    persist();

    document.getElementById('accountDriver').value = d.id;

    renderAccount();
}

function renderDrivers() {
    let b = document.getElementById('driversRows');

    b.innerHTML = db.drivers.map(d => `
        <tr>
            <td>${esc(d.name)}</td>

            <td>${esc(d.phone || '—')}</td>

            <td>
                ${money(total(activeAccount(d.id).lines))} ر.س
            </td>

            <td>
                <div class="actions">

                    <button
                        class="secondary small"
                        onclick="editDriver(${d.id})"
                    >
                        تعديل
                    </button>

                    <button
                        class="danger small"
                        onclick="deleteDriver(${d.id})"
                    >
                        حذف
                    </button>

                </div>
            </td>
        </tr>
    `).join('') || `
        <tr>
            <td colspan="4" class="empty">
                لا يوجد سائقون
            </td>
        </tr>
    `;
}

function editDriver(did) {
    let d = db.drivers.find(x => x.id === did);

    if (!d) {
        return;
    }

    let name = prompt('تعديل اسم السائق:', d.name);

    if (name === null) {
        return;
    }

    if (!name.trim()) {
        return toast('الاسم لا يمكن أن يكون فارغًا');
    }

    let phone = prompt('رقم الجوال:', d.phone || '');

    if (phone === null) {
        return;
    }

    d.name = name.trim();
    d.phone = phone.trim();

    persist();
}

function deleteDriver(did) {
    if (!confirm('حذف السائق من القائمة؟ ستبقى فواتيره المحفوظة في السجل.')) {
        return;
    }

    db.drivers = db.drivers.filter(d => d.id !== did);

    persist();
}

function addItem() {
    let name = document.getElementById('itemName').value.trim();

    let price = Number(document.getElementById('itemPrice').value);

    if (
        !name ||
        !document.getElementById('itemPrice').value ||
        price < 0
    ) {
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
    let b = document.getElementById('itemsRows');

    b.innerHTML = db.items.map(it => `
        <tr>
            <td>${esc(it.name)}</td>

            <td>${money(it.price)} ر.س</td>

            <td>
                <div class="actions">

                    <button
                        class="secondary small"
                        onclick="editItem(${it.id})"
                    >
                        تعديل
                    </button>

                    <button
                        class="danger small"
                        onclick="deleteItem(${it.id})"
                    >
                        حذف
                    </button>

                </div>
            </td>
        </tr>
    `).join('') || `
        <tr>
            <td colspan="3" class="empty">
                لا توجد أصناف
            </td>
        </tr>
    `;
}

function editItem(iid) {
    let it = db.items.find(x => x.id === iid);

    if (!it) {
        return;
    }

    let n = prompt('اسم الصنف:', it.name);

    if (n === null) {
        return;
    }

    let p = prompt('السعر:', it.price);

    if (p === null) {
        return;
    }

    if (
        !n.trim() ||
        !Number.isFinite(Number(p)) ||
        Number(p) < 0
    ) {
        return toast('بيانات غير صحيحة');
    }

    it.name = n.trim();
    it.price = Number(p);

    persist();
}

function deleteItem(iid) {
    if (confirm('حذف الصنف من قائمة الأصناف؟ لن تتغير الفواتير القديمة.')) {
        db.items = db.items.filter(x => x.id !== iid);

        persist();
    }
}

function setSinglePrice() {
    let it = db.items.find(
        x => String(x.id) === document.getElementById('singleItem').value
    );

    if (it) {
        document.getElementById('singlePrice').value = it.price;
    }
}

function addSingleLine() {
    let it = db.items.find(
        x => String(x.id) === document.getElementById('singleItem').value
    );

    let qty = Number(document.getElementById('singleQty').value);

    let price = Number(document.getElementById('singlePrice').value);

    if (!it) {
        return toast('أضف صنفًا أولًا');
    }

    if (
        !Number.isFinite(qty) ||
        qty < 1 ||
        !Number.isFinite(price) ||
        price < 0
    ) {
        return toast('تحقق من الكمية والسعر');
    }

    singleLines.push({
        name: it.name,
        qty,
        price
    });

    renderSingleLines();
}

function renderSingleLines() {
    let b = document.getElementById('singleRows');

    b.innerHTML = singleLines.map((l, i) => `
        <tr>
            <td>${esc(l.name)}</td>
            <td>${l.qty}</td>
            <td>${money(l.price)}</td>
            <td>${money(l.qty * l.price)}</td>

            <td>
                <button
                    class="danger small"
                    onclick="singleLines.splice(${i},1);renderSingleLines()"
                >
                    حذف
                </button>
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

function saveSingleInvoice() {
    let did = document.getElementById('singleDriver').value;

    if (!did) {
        return toast('اختر السائق');
    }

    if (!singleLines.length) {
        return toast('أضف صنفًا واحدًا على الأقل');
    }

    let d = db.drivers.find(
        x => String(x.id) === String(did)
    );

    let inv = {
        id: id(),
        type: 'single',
        driverId: did,
        driverName: d?.name || 'سائق',
        date: stamp(),

        note: document.getElementById('singleNote').value.trim(),

        lines: JSON.parse(JSON.stringify(singleLines)),
        total: total(singleLines)
    };

    db.invoices.unshift(inv);

    singleLines = [];

    document.getElementById('singleNote').value = '';

    renderSingleLines();

    persist();

    toast('تم حفظ الفاتورة رقم ' + inv.id);

    printInvoice(inv.id);
}

function renderHistory() {
    let q = (
        document.getElementById('historySearch').value || ''
    ).trim().toLowerCase();

    let type = document.getElementById('historyType').value;

    let list = db.invoices.filter(i =>
        (type === 'all' || i.type === type) &&
        (`${i.id} ${i.driverName}`.toLowerCase().includes(q))
    );

    let b = document.getElementById('historyRows');

    b.innerHTML = list.map(i => `
        <tr>
            <td>${i.id}</td>

            <td>
                ${i.type === 'single' ? 'مستقلة' : 'حساب مغلق'}
            </td>

            <td>${esc(i.driverName)}</td>

            <td>${esc(i.date)}</td>

            <td>${money(i.total)} ر.س</td>

            <td>
                <div class="actions">

                    <button
                        class="secondary small"
                        onclick="printInvoice(${i.id})"
                    >
                        طباعة
                    </button>

                    <button
                        class="secondary small"
                        onclick="editInvoice(${i.id})"
                    >
                        تعديل
                    </button>

                    <button
                        class="danger small"
                        onclick="deleteInvoice(${i.id})"
                    >
                        حذف
                    </button>

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

function editInvoice(iid) {
    let i = db.invoices.find(x => x.id === iid);

    if (!i) {
        return;
    }

    let idx = prompt(
        'اكتب رقم السطر الذي تريد تعديله (1 إلى ' +
        i.lines.length +
        ') أو اكتب 0 لإضافة صنف:',
        '1'
    );

    if (idx === null) {
        return;
    }

    if (Number(idx) === 0) {
        let name = prompt('اسم الصنف الجديد:');

        if (!name?.trim()) {
            return;
        }

        let price = Number(prompt('السعر:', '0'));
        let qty = Number(prompt('الكمية:', '1'));

        if (
            !Number.isFinite(price) ||
            price < 0 ||
            !Number.isFinite(qty) ||
            qty < 1
        ) {
            return toast('قيم غير صحيحة');
        }

        i.lines.push({
            name: name.trim(),
            price,
            qty
        });

    } else {
        let n = Number(idx) - 1;

        if (!Number.isInteger(n) || !i.lines[n]) {
            return toast('رقم سطر غير صحيح');
        }

        let qty = prompt('الكمية الجديدة:', i.lines[n].qty);

        if (qty === null) {
            return;
        }

        let price = prompt('السعر الجديد:', i.lines[n].price);

        if (price === null) {
            return;
        }

        if (
            Number(qty) < 1 ||
            Number(price) < 0 ||
            !Number.isFinite(Number(qty)) ||
            !Number.isFinite(Number(price))
        ) {
            return toast('قيم غير صحيحة');
        }

        i.lines[n].qty = Number(qty);
        i.lines[n].price = Number(price);
    }

    i.total = total(i.lines);
    i.editedAt = stamp();

    persist();

    toast('تم تعديل الفاتورة');
}

function deleteInvoice(iid) {
    if (confirm('حذف الفاتورة من السجل نهائيًا؟')) {
        db.invoices = db.invoices.filter(i => i.id !== iid);

        persist();
    }
}

function renderStats() {
    document.getElementById('driverCount').textContent =
        db.drivers.length;

    document.getElementById('invoiceCount').textContent =
        db.invoices.filter(i => i.type === 'single').length;

    document.getElementById('openTotal').textContent =
        money(
            db.drivers.reduce(
                (s, d) => s + total(activeAccount(d.id).lines),
                0
            )
        ) + ' ر.س';

    let t = today();

    document.getElementById('todayTotal').textContent =
        money(
            db.invoices.filter(
                i => i.date.includes(t) ||
                i.date.includes(new Date().toLocaleDateString('en-CA'))
            ).reduce((s, i) => s + i.total, 0)
        ) + ' ر.س';
}

function receiptHTML(title, driver, date, lines, sum, number, note = '') {
    return `
        <h2>مطعم ديرتي</h2>

        <div class="pcenter">${title}</div>

        <div class="pline"></div>

        <div>رقم الفاتورة: ${number}</div>

        <div>السائق: ${esc(driver)}</div>

        <div>التاريخ: ${esc(date)}</div>

        ${note ? `<div>ملاحظة: ${esc(note)}</div>` : ''}

        <div class="pline"></div>

        <table>

            <thead>
                <tr>
                    <th>الصنف</th>
                    <th>ك</th>
                    <th>السعر</th>
                    <th>الإجمالي</th>
                </tr>
            </thead>

            <tbody>
                ${lines.map(l => `
                    <tr>
                        <td>${esc(l.name)}</td>
                        <td>${l.qty}</td>
                        <td>${money(l.price)}</td>
                        <td>${money(l.qty * l.price)}</td>
                    </tr>
                `).join('')}
            </tbody>

        </table>

        <div class="ptotal">
            الإجمالي: ${money(sum)} ريال
        </div>

        <div class="pline"></div>

        <div class="pcenter">شكرًا لكم — ديرتي</div>
    `;
}

function printAccount() {
    let did = currentDriver();

    if (!did) {
        return toast('اختر سائقًا');
    }

    let d = db.drivers.find(
        x => String(x.id) === String(did)
    );

    let a = activeAccount(did);

    if (!a.lines.length) {
        return toast('الحساب فارغ');
    }

    document.getElementById('printArea').innerHTML =
        receiptHTML(
            'الحساب المستمر المفتوح',
            d?.name || '',
            stamp(),
            a.lines,
            total(a.lines),
            'مفتوح'
        );

    window.print();
}

function printInvoice(iid) {
    let i = db.invoices.find(x => x.id === iid);

    if (!i) {
        return;
    }

    document.getElementById('printArea').innerHTML =
        receiptHTML(
            i.type === 'single' ? 'فاتورة مستقلة' : 'فاتورة حساب مغلق',
            i.driverName,
            i.date,
            i.lines,
            i.total,
            i.id,
            i.note || ''
        );

    window.print();
}

function exportData() {
    let blob = new Blob(
        [JSON.stringify(db, null, 2)],
        { type: 'application/json' }
    );

    let url = URL.createObjectURL(blob);

    let a = document.createElement('a');

    a.href = url;
    a.download = 'deerty-backup-' + today() + '.json';

    a.click();

    URL.revokeObjectURL(url);

    toast('تم تنزيل النسخة الاحتياطية');
}

function importData(e) {
    let f = e.target.files[0];

    if (!f) {
        return;
    }

    let r = new FileReader();

    r.onload = () => {
        try {
            let x = JSON.parse(r.result);

            if (
                !x.drivers ||
                !x.items ||
                !x.accounts ||
                !x.invoices
            ) {
                throw Error();
            }

            if (!confirm('استعادة النسخة ستستبدل البيانات الحالية. هل تريد المتابعة؟')) {
                return;
            }

            db = x;

            persist();

            toast('تمت استعادة النسخة');

        } catch (err) {
            alert('ملف النسخة غير صالح');

        } finally {
            e.target.value = '';
        }
    };

    r.readAsText(f);
}

// إضافة أصناف تجريبية عند أول تشغيل فقط.
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

renderAll();
renderSingleLines();
