const $ = (id) => document.getElementById(id);
const MESES = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

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

let presRows = []; // { row, mes, tipo, categoria, subcategoria, monto } — explicit overrides only
let movimientos = []; // full Movimientos
let categoriaSubMap = {}; // for the "add a brand-new line" form's datalists
let tipoState = "Gasto";

function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthKeyOf(m) {
  return `${m.año}-${String(m.mes).padStart(2, "0")}`;
}

/** The n month-keys strictly before `mes`, oldest to newest. */
function monthsBeforeExclusive(mes, n) {
  const [y, m] = mes.split("-").map(Number);
  const out = [];
  for (let i = n; i >= 1; i--) {
    const d = new Date(y, m - 1 - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
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

function realMonthlyTotal(tipo, categoria, subcategoria, monthKey) {
  return movimientos
    .filter(
      (m) => m.tipo === tipo && m.categoria === categoria && (m.subcategoria || "") === subcategoria && monthKeyOf(m) === monthKey
    )
    .reduce((s, m) => s + Math.abs(m.monto), 0);
}

function findExplicit(mes, tipo, categoria, subcategoria) {
  return presRows.find(
    (r) => r.mes === mes && r.tipo === tipo && r.categoria === categoria && (r.subcategoria || "") === subcategoria
  );
}

/** Everything needed to render/edit one subcategoria's budget line for `mes`. */
function subInfo(tipo, categoria, subcategoria, mes, historyMonths) {
  const historyTotals = historyMonths.map((mk) => realMonthlyTotal(tipo, categoria, subcategoria, mk));
  const avg = historyTotals.reduce((a, b) => a + b, 0) / historyMonths.length;
  const explicit = findExplicit(mes, tipo, categoria, subcategoria);
  return {
    sub: subcategoria,
    historyTotals,
    avg,
    effective: explicit ? explicit.monto : avg,
    row: explicit ? explicit.row : null,
  };
}

/** Subcategorias worth showing for a categoria: had real spend in the trailing 3
 * months, or already have an explicit budget line this month. */
function subcategoriasFor(tipo, categoria, mes, historyMonths) {
  const set = new Set();
  for (const m of movimientos) {
    if (m.tipo !== tipo || m.categoria !== categoria) continue;
    if (historyMonths.includes(monthKeyOf(m))) set.add(m.subcategoria || "");
  }
  for (const r of presRows) {
    if (r.mes === mes && r.tipo === tipo && r.categoria === categoria) set.add(r.subcategoria || "");
  }
  return [...set];
}

function categoriasFor(tipo, mes, historyMonths) {
  const all = new Set();
  for (const m of movimientos) if (m.tipo === tipo) all.add(m.categoria);
  for (const r of presRows) if (r.tipo === tipo) all.add(r.categoria);
  return [...all].filter((cat) => subcategoriasFor(tipo, cat, mes, historyMonths).length > 0);
}

function buildStatsRow(promedio, historyTotals, historyMonths) {
  const cells = [
    `<div style="flex:1.3;text-align:center;"><div style="font-weight:700;font-size:13px;">${fmtCLP(promedio)}</div><div style="font-size:9px;color:var(--text-muted);">Prom. 3m</div></div>`,
    ...historyTotals.map((v, i) => {
      const [, mo] = historyMonths[i].split("-");
      return `<div style="flex:1;text-align:center;"><div style="font-size:11px;color:var(--text-secondary);">${fmtCLP(v)}</div><div style="font-size:9px;color:var(--text-muted);">${MESES[Number(mo)]}</div></div>`;
    }),
  ];
  return `<div style="display:flex;gap:4px;margin-top:6px;padding-top:6px;border-top:1px solid var(--grid);">${cells.join("")}</div>`;
}

function buildCategoriaBlock(tipo, categoria, mes, historyMonths) {
  const subs = subcategoriasFor(tipo, categoria, mes, historyMonths);
  const subInfos = subs.map((sub) => subInfo(tipo, categoria, sub, mes, historyMonths));
  const catPromedio = subInfos.reduce((s, si) => s + si.effective, 0);
  const catHistory = historyMonths.map((_, i) => subInfos.reduce((s, si) => s + si.historyTotals[i], 0));
  const catId = `cat-${tipo}-${categoria}`.replace(/[^a-zA-Z0-9]/g, "");

  const subHtml = subInfos
    .sort((a, b) => b.effective - a.effective)
    .map((si) => buildSubcategoriaRow(tipo, categoria, si, mes, historyMonths))
    .join("");

  const wrap = document.createElement("div");
  wrap.className = "category-row";
  wrap.innerHTML = `
    <div class="category-row-top cat-clickable" data-target="${catId}">
      <span class="cat-name">${categoria}</span>
      <span class="cat-amounts">${fmtCLP(catPromedio)}</span>
    </div>
    ${buildStatsRow(catPromedio, catHistory, historyMonths)}
    <div class="sub-detail" id="${catId}" hidden style="margin-top:10px;">${subHtml}</div>
  `;
  wrap.querySelector(".cat-clickable").addEventListener("click", () => {
    wrap.querySelector(`#${catId}`).hidden = !wrap.querySelector(`#${catId}`).hidden;
  });
  wireSubcategoriaToggles(wrap, tipo, categoria, mes, historyMonths);
  return wrap;
}

function buildSubcategoriaRow(tipo, categoria, si, mes, historyMonths) {
  const label = si.sub || "General";
  const subId = `sub-${tipo}-${categoria}-${si.sub}`.replace(/[^a-zA-Z0-9]/g, "");
  return `
    <div class="category-row-top cat-clickable sub-clickable" data-sub="${si.sub}" data-target="${subId}" style="padding:8px 0;font-size:13px;">
      <span style="color:var(--text-secondary)">${label}${si.row ? "" : ' <span class="meta" style="font-size:10px;">(sugerido)</span>'}</span>
      <span class="cat-amounts">${fmtCLP(si.effective)}</span>
    </div>
    ${buildStatsRow(si.effective, si.historyTotals, historyMonths)}
    <div class="sub-detail" id="${subId}" hidden></div>`;
}

function wireSubcategoriaToggles(scope, tipo, categoria, mes, historyMonths) {
  scope.querySelectorAll(".sub-clickable").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const sub = el.dataset.sub;
      const detail = document.getElementById(el.dataset.target);
      const willOpen = detail.hidden;
      detail.hidden = !detail.hidden;
      if (willOpen) {
        const si = subInfo(tipo, categoria, sub, mes, historyMonths);
        renderSubcategoriaDetail(detail, tipo, categoria, sub, mes, si);
      }
    });
  });
}

function renderSubcategoriaDetail(detail, tipo, categoria, sub, mes, si) {
  const realMovs = movimientos
    .filter((m) => m.tipo === tipo && m.categoria === categoria && (m.subcategoria || "") === sub && monthKeyOf(m) === mes)
    .sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
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
      <input type="number" inputmode="numeric" value="${si.effective}" id="editInput">
      <button class="btn-secondary" id="saveBtn">Guardar</button>
      ${si.row ? `<button class="btn-secondary" id="delBtn">×</button>` : ""}
    </div>
    <div style="font-size:11px;color:var(--text-muted);margin:6px 0;">
      ${si.row ? "Monto fijado manualmente." : `Propuesta = promedio de los 3 meses anteriores.`}
    </div>
    <div style="font-size:12px;color:var(--text-muted);margin:8px 0;">Movimientos reales de este mes:</div>
    ${movHtml}
  `;

  detail.querySelector("#saveBtn").addEventListener("click", async (e) => {
    e.stopPropagation();
    const val = Number($("editInput").value);
    if (isNaN(val)) return showToast("Monto inválido", true);
    await upsertMonto(mes, tipo, categoria, sub, val, si.row);
  });
  const delBtn = detail.querySelector("#delBtn");
  if (delBtn) {
    delBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (confirm("¿Volver a usar el promedio sugerido en vez del monto fijado?")) {
        await deleteRow(si.row);
      }
    });
  }
}

async function upsertMonto(mes, tipo, categoria, subcategoria, monto, existingRow) {
  try {
    if (existingRow) {
      await window.SheetsApi.updateRange(`Presupuesto!E${existingRow}`, [[monto]]);
    } else {
      await window.SheetsApi.appendRow("Presupuesto!A:E", [mes, tipo, categoria, subcategoria, monto]);
    }
    await loadPresupuesto();
    render();
    showToast("Guardado ✓");
  } catch (err) {
    console.error(err);
    showToast("Error al guardar", true);
  }
}

async function deleteRow(rowNum) {
  try {
    await window.SheetsApi.updateRange(`Presupuesto!A${rowNum}:E${rowNum}`, [["", "", "", "", ""]]);
    await loadPresupuesto();
    render();
    showToast("Vuelto al promedio ✓");
  } catch (err) {
    console.error(err);
    showToast("Error", true);
  }
}

function render() {
  const mes = $("monthPicker").value;
  const historyMonths = monthsBeforeExclusive(mes, 3);

  const gastoCats = categoriasFor("Gasto", mes, historyMonths);
  const ingresoCats = categoriasFor("Ingreso", mes, historyMonths);

  const sumTipo = (cats, tipo) =>
    cats.reduce((total, cat) => {
      const subs = subcategoriasFor(tipo, cat, mes, historyMonths);
      return total + subs.reduce((s, sub) => s + subInfo(tipo, cat, sub, mes, historyMonths).effective, 0);
    }, 0);

  const totalGasto = sumTipo(gastoCats, "Gasto");
  const totalIngreso = sumTipo(ingresoCats, "Ingreso");
  const resultado = totalIngreso - totalGasto;

  $("statIngresoPpto").textContent = fmtCLP(totalIngreso);
  $("statGastoPpto").textContent = fmtCLP(totalGasto);
  const resEl = $("statResultado");
  resEl.textContent = fmtCLP(resultado);
  resEl.className = "stat-value " + (resultado >= 0 ? "income" : "expense");

  const gastoList = $("gastoList");
  gastoList.innerHTML = "";
  if (gastoCats.length === 0) gastoList.innerHTML = '<div class="skeleton">Sin datos para proponer presupuesto de gasto</div>';
  gastoCats.forEach((cat) => gastoList.appendChild(buildCategoriaBlock("Gasto", cat, mes, historyMonths)));

  const ingresoList = $("ingresoList");
  ingresoList.innerHTML = "";
  if (ingresoCats.length === 0) ingresoList.innerHTML = '<div class="skeleton">Sin datos para proponer presupuesto de ingreso</div>';
  ingresoCats.forEach((cat) => ingresoList.appendChild(buildCategoriaBlock("Ingreso", cat, mes, historyMonths)));
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
