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

let rows = []; // { row, mes, tipo, categoria, subcategoria, monto }
let categoriasConocidas = [];
let categoriaSubMap = {};
let tipoState = "Gasto";

function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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

function buildRow(item) {
  const label = item.subcategoria ? `${item.categoria} · ${item.subcategoria}` : item.categoria;
  const el = document.createElement("div");
  el.className = "account-row";
  el.innerHTML = `
    <div>
      <div class="account-name">${label}</div>
    </div>
    <div class="account-actions">
      <div class="account-balance" id="amt-${item.row}">${fmtCLP(item.monto)}</div>
      <button class="btn-secondary" data-edit="${item.row}">✎</button>
      <button class="btn-secondary" data-del="${item.row}">×</button>
    </div>
  `;
  return el;
}

function render() {
  const month = $("monthPicker").value;
  const inMonth = rows.filter((r) => r.mes === month);
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

  const gastoList = $("gastoList");
  gastoList.innerHTML = "";
  if (gastos.length === 0) gastoList.innerHTML = '<div class="skeleton">Sin presupuesto de gasto este mes</div>';
  gastos.forEach((r) => gastoList.appendChild(buildRow(r)));

  const ingresoList = $("ingresoList");
  ingresoList.innerHTML = "";
  if (ingresos.length === 0) ingresoList.innerHTML = '<div class="skeleton">Sin presupuesto de ingreso este mes</div>';
  ingresos.forEach((r) => ingresoList.appendChild(buildRow(r)));

  wireRowButtons();
}

function wireRowButtons() {
  document.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const rowNum = Number(btn.dataset.edit);
      const item = rows.find((r) => r.row === rowNum);
      const nuevo = prompt(`Nuevo monto para ${item.categoria}${item.subcategoria ? " · " + item.subcategoria : ""}:`, item.monto);
      if (nuevo == null || nuevo === "" || isNaN(Number(nuevo))) return;
      updateMonto(rowNum, Number(nuevo));
    });
  });
  document.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (confirm("¿Eliminar esta línea de presupuesto?")) deleteRow(Number(btn.dataset.del));
    });
  });
}

async function updateMonto(rowNum, nuevoMonto) {
  try {
    await window.SheetsApi.updateRange(`Presupuesto!E${rowNum}`, [[nuevoMonto]]);
    const item = rows.find((r) => r.row === rowNum);
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
    rows = rows.filter((r) => r.row !== rowNum);
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
    showToast("Agregado ✓ (recargando…)");
    await loadData();
    render();
  } catch (err) {
    console.error(err);
    showToast("Error al agregar", true);
  } finally {
    addBtn.disabled = false;
  }
}

async function loadData() {
  const [presRows, movRows] = await Promise.all([
    window.SheetsApi.readRange("Presupuesto!A2:E10000"),
    window.SheetsApi.readRange("Movimientos!E2:F100000"),
  ]);
  rows = presRows
    .map((r, i) => ({
      row: i + 2,
      mes: r[0] || "",
      tipo: r[1] || "",
      categoria: r[2] || "",
      subcategoria: r[3] || "",
      monto: Number(r[4]) || 0,
    }))
    .filter((r) => r.mes && r.categoria);

  categoriaSubMap = {};
  const cats = new Set();
  for (const [cat, sub] of movRows) {
    if (!cat) continue;
    cats.add(cat);
    if (sub) (categoriaSubMap[cat] ||= new Set()).add(sub);
  }
  rows.forEach((r) => cats.add(r.categoria));
  categoriasConocidas = [...cats];
  fillDatalist("categoriaList", categoriasConocidas);
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
