const $ = (id) => document.getElementById(id);

function fmtCLP(n) {
  const sign = n < 0 ? "-" : "";
  return sign + "$" + Math.round(Math.abs(n)).toLocaleString("es-CL");
}

function showToast(msg, isError = false) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast show" + (isError ? " error" : "");
  setTimeout(() => (t.className = "toast"), 2200);
}

let presRows = []; // { row, mes, tipo, categoria, subcategoria, monto }
let movimientos = []; // full Movimientos, same shape as dashboard.js
let categoriaSubMap = {}; // from Movimientos, for the add-line datalists
let tipoState = "Gasto";

function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthKeyOf(m) {
  return `${m.año}-${String(m.mes).padStart(2, "0")}`;
}

function formatFechaCorta(fecha) {
  const s = String(fecha || "").trim();
  if (s.includes("/")) {
    const [d, mo] = s.split("/");
    if (d && mo) return `${d.padStart(2, "0")}/${mo.padStart(2, "0")}`;
  }
  if (s.includes("-")) {
    const [, mo, d] = s.split("-");
    if (d && mo) return `${d.padStart(2, "0")}/${mo.padStart(2, "0")}`;
  }
  return s;
}

function fillDatalist(id, values) {
  const dl = $(id);
  dl.innerHTML = "";
  [...new Set(values.filter(Boolean))].sort().forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v;
    dl.appendChild(opt);
  });
}

/** Builds one category accordion: header (auto-summed total) + its subcategory rows. */
function buildCategoriaBlock(categoria, subRows, tipo, month) {
  const total = subRows.reduce((s, r) => s + r.monto, 0);
  const catId = `cat-${tipo}-${categoria}`.replace(/[^a-zA-Z0-9]/g, "");
  const subHtml = subRows
    .sort((a, b) => b.monto - a.monto)
    .map((r) => buildSubcategoriaRow(r, tipo, month))
    .join("");

  const wrap = document.createElement("div");
  wrap.className = "category-row";
  wrap.innerHTML = `
    <div class="category-row-top cat-clickable" data-target="${catId}">
      <span class="cat-name">${categoria}</span>
      <span class="cat-amounts">${fmtCLP(total)}</span>
    </div>
    <div class="sub-detail" id="${catId}" hidden>${subHtml}</div>
  `;
  wrap.querySelector(".cat-clickable").addEventListener("click", () => {
    const detail = wrap.querySelector(`#${catId}`);
    detail.hidden = !detail.hidden;
  });
  wireSubcategoriaToggles(wrap);
  return wrap;
}

function buildSubcategoriaRow(item, tipo, month) {
  const label = item.subcategoria || "General";
  const subId = `sub-${item.row}`;
  return `
    <div class="category-row-top cat-clickable sub-clickable" data-row="${item.row}" data-target="${subId}" style="padding:8px 0;font-size:13px;">
      <span style="color:var(--text-secondary)">${label}</span>
      <span class="cat-amounts">${fmtCLP(item.monto)}</span>
    </div>
    <div class="sub-detail" id="${subId}" hidden></div>`;
}

function wireSubcategoriaToggles(scope) {
  scope.querySelectorAll(".sub-clickable").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const rowNum = Number(el.dataset.row);
      const item = presRows.find((r) => r.row === rowNum);
      const detail = document.getElementById(el.dataset.target);
      const willOpen = detail.hidden;
      detail.hidden = !detail.hidden;
      if (willOpen) renderSubcategoriaDetail(detail, item);
    });
  });
}

function renderSubcategoriaDetail(detail, item) {
  const sub = item.subcategoria || "";
  const realMovs = movimientos
    .filter(
      (m) =>
        m.tipo === item.tipo &&
        m.categoria === item.categoria &&
        (m.subcategoria || "") === sub &&
        monthKeyOf(m) === item.mes
    )
    .sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  const realTotal = realMovs.reduce((s, m) => s + Math.abs(m.monto), 0);
  const pct = item.monto ? Math.round((realTotal / item.monto) * 100) : null;

  const movHtml =
    realMovs
      .map(
        (m) => `<div class="category-row-top" style="padding:5px 0;font-size:12px;">
        <span style="color:var(--text-muted)">${formatFechaCorta(m.fecha)} · ${m.detalle || "—"}</span>
        <span class="cat-amounts">${fmtCLP(Math.abs(m.monto))}</span>
      </div>`
      )
      .join("") || '<div class="skeleton" style="padding:6px 0;font-size:12px;">Sin movimientos reales este mes</div>';

  detail.innerHTML = `
    <div class="inline-form">
      <input type="number" inputmode="numeric" value="${item.monto}" id="editInput-${item.row}">
      <button class="btn-secondary" data-save="${item.row}">Guardar</button>
      <button class="btn-secondary" data-del="${item.row}">×</button>
    </div>
    <div style="font-size:12px;color:var(--text-muted);margin:8px 0;">
      Real: ${fmtCLP(realTotal)}${pct != null ? ` (${pct}% del presupuesto)` : ""}
    </div>
    ${movHtml}
  `;

  detail.querySelector("[data-save]").addEventListener("click", (e) => {
    e.stopPropagation();
    const val = Number($(`editInput-${item.row}`).value);
    if (isNaN(val)) return showToast("Monto inválido", true);
    updateMonto(item.row, val);
  });
  detail.querySelector("[data-del]").addEventListener("click", (e) => {
    e.stopPropagation();
    if (confirm("¿Eliminar esta línea de presupuesto?")) deleteRow(item.row);
  });
}

function render() {
  const month = $("monthPicker").value;
  const inMonth = presRows.filter((r) => r.mes === month);
  const gastos = inMonth.filter((r) => r.tipo === "Gasto");
  const ingresos = inMonth.filter((r) => r.tipo === "Ingreso");

  const totalGasto = gastos.reduce((s, r) => s + r.monto, 0);
  const totalIngreso = ingresos.reduce((s, r) => s + r.monto, 0);
  const resultado = totalIngreso - totalGasto;

  $("statIngresoPpto").textContent = fmtCLP(totalIngreso);
  $("statGastoPpto").textContent = fmtCLP(totalGasto);
  const resEl = $("statResultado");
  resEl.textContent = fmtCLP(resultado);
  resEl.className = "stat-value " + (resultado >= 0 ? "income" : "expense");

  renderGroup($("gastoList"), gastos, "Gasto", month, "Sin presupuesto de gasto este mes");
  renderGroup($("ingresoList"), ingresos, "Ingreso", month, "Sin presupuesto de ingreso este mes");
}

function renderGroup(container, rowsForTipo, tipo, month, emptyMsg) {
  container.innerHTML = "";
  if (rowsForTipo.length === 0) {
    container.innerHTML = `<div class="skeleton">${emptyMsg}</div>`;
    return;
  }
  const byCat = {};
  for (const r of rowsForTipo) (byCat[r.categoria] ||= []).push(r);
  Object.entries(byCat)
    .sort((a, b) => b[1].reduce((s, r) => s + r.monto, 0) - a[1].reduce((s, r) => s + r.monto, 0))
    .forEach(([categoria, subRows]) => container.appendChild(buildCategoriaBlock(categoria, subRows, tipo, month)));
}

async function updateMonto(rowNum, nuevoMonto) {
  try {
    await window.SheetsApi.updateRange(`Presupuesto!E${rowNum}`, [[nuevoMonto]]);
    const item = presRows.find((r) => r.row === rowNum);
    item.monto = nuevoMonto;
    render();
    showToast("Actualizado ✓");
  } catch (err) {
    console.error(err);
    showToast("Error al guardar", true);
  }
}

async function deleteRow(rowNum) {
  try {
    await window.SheetsApi.updateRange(`Presupuesto!A${rowNum}:E${rowNum}`, [["", "", "", "", ""]]);
    presRows = presRows.filter((r) => r.row !== rowNum);
    render();
    showToast("Eliminado ✓");
  } catch (err) {
    console.error(err);
    showToast("Error al eliminar", true);
  }
}

function updateSubcategorias() {
  const cat = $("categoria").value.trim();
  fillDatalist("subcategoriaList", categoriaSubMap[cat] ? [...categoriaSubMap[cat]] : []);
}

async function handleAdd() {
  const month = $("monthPicker").value;
  const categoria = $("categoria").value.trim();
  const subcategoria = $("subcategoria").value.trim();
  const monto = Number($("monto").value);
  if (!month || !categoria || !monto) {
    showToast("Falta mes, categoría o monto", true);
    return;
  }
  const addBtn = $("addBtn");
  addBtn.disabled = true;
  try {
    await window.SheetsApi.appendRow("Presupuesto!A:E", [month, tipoState, categoria, subcategoria, monto]);
    $("categoria").value = "";
    $("subcategoria").value = "";
    $("monto").value = "";
    await loadPresupuesto();
    render();
    showToast("Agregado ✓");
  } catch (err) {
    console.error(err);
    showToast("Error al agregar", true);
  } finally {
    addBtn.disabled = false;
  }
}

async function loadPresupuesto() {
  const rows = await window.SheetsApi.readRange("Presupuesto!A2:E10000");
  presRows = rows
    .map((r, i) => ({
      row: i + 2,
      mes: r[0] || "",
      tipo: r[1] || "",
      categoria: r[2] || "",
      subcategoria: r[3] || "",
      monto: Number(r[4]) || 0,
    }))
    .filter((r) => r.mes && r.categoria);
}

async function loadData() {
  const [movRows] = await Promise.all([window.SheetsApi.readRange("Movimientos!A2:N100000"), loadPresupuesto()]);
  movimientos = movRows
    .filter((r) => r[0])
    .map((r) => ({
      fecha: r[0],
      año: String(r[1] || "").trim(),
      mes: String(r[2] || "").trim(),
      tipo: r[3] || "",
      categoria: r[4] || "",
      subcategoria: r[5] || "",
      estado: r[7] || "",
      monto: Number(r[8]) || 0,
      detalle: r[9] || "",
    }));

  categoriaSubMap = {};
  const cats = new Set();
  for (const m of movimientos) {
    if (!m.categoria) continue;
    cats.add(m.categoria);
    if (m.subcategoria) (categoriaSubMap[m.categoria] ||= new Set()).add(m.subcategoria);
  }
  presRows.forEach((r) => cats.add(r.categoria));
  fillDatalist("categoriaList", [...cats]);
}

async function init() {
  if (!window.SheetsAuth.requireAuthOrRedirect()) return;

  $("loadingSkeleton").hidden = false;
  await loadData();
  $("loadingSkeleton").hidden = true;
  $("content").hidden = false;

  $("monthPicker").value = currentMonthValue();
  render();

  $("monthPicker").addEventListener("change", render);
  $("categoria").addEventListener("input", updateSubcategorias);
  $("categoria").addEventListener("change", updateSubcategorias);
  $("addBtn").addEventListener("click", handleAdd);

  $("tipoToggle").querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      $("tipoToggle").querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      tipoState = btn.dataset.type;
    });
  });
}

init();
