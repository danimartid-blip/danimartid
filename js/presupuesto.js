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
let categoriaSubMap = {}; // categoria -> Set(subcategorias) para los datalists de "+"

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
  const max = Math.max(...historyTotals, 1);
  const cells = [
    `<div class="stats-cell is-primary">
      <div class="v">${fmtCLP(promedio)}</div>
      <div class="k">Prom. 3m</div>
    </div>`,
    ...historyTotals.map((v, i) => {
      const [, mo] = historyMonths[i].split("-");
      const pct = Math.max(3, Math.round((v / max) * 100));
      return `<div class="stats-cell">
        <div class="v">${fmtCLP(v)}</div>
        <div class="minibar"><i style="height:${pct}%"></i></div>
        <div class="k">${MESES[Number(mo)]}</div>
      </div>`;
    }),
  ];
  return `<div class="stats-row">${cells.join("")}</div>`;
}

const escapeAttr = (s) => String(s ?? "").replace(/"/g, "&quot;");

/** Contador global: los ids del DOM deben ser únicos, si no getElementById
 * devuelve el panel equivocado (los paneles cerrados siguen en el DOM). */
let uid = 0;

/* Qué está desplegado, por clave estable (no por id de DOM), para que al
   re-renderizar tras guardar no se pliegue todo y se pierda dónde ibas. */
const openCats = new Set(); // "Gasto|Diezmo"
const openSubs = new Set(); // "Gasto|Diezmo|Diezmo"
const catKeyOf = (tipo, categoria) => `${tipo}|${categoria}`;
const subKeyOf = (tipo, categoria, sub) => `${tipo}|${categoria}|${sub}`;

function buildCategoriaBlock(tipo, categoria, mes, historyMonths) {
  const subs = subcategoriasFor(tipo, categoria, mes, historyMonths);
  const subInfos = subs.map((sub) => subInfo(tipo, categoria, sub, mes, historyMonths));
  const catPromedio = subInfos.reduce((s, si) => s + si.effective, 0);
  const catHistory = historyMonths.map((_, i) => subInfos.reduce((s, si) => s + si.historyTotals[i], 0));
  const catId = `cat${++uid}`;
  const listId = `subopts${uid}`;
  const knownSubs = [...(categoriaSubMap[categoria] || [])].sort();

  const catKey = catKeyOf(tipo, categoria);
  const catOpen = openCats.has(catKey);

  const subHtml = subInfos
    .sort((a, b) => b.effective - a.effective)
    .map((si) => buildSubcategoriaRow(si, historyMonths, tipo, categoria))
    .join("");

  const wrap = document.createElement("div");
  wrap.className = "category-row";
  wrap.innerHTML = `
    <div class="category-row-top cat-clickable" data-target="${catId}">
      <span class="cat-name">${categoria}</span>
      <span class="cat-amounts">${fmtCLP(catPromedio)}</span>
    </div>
    ${buildStatsRow(catPromedio, catHistory, historyMonths)}
    <div class="sub-detail${catOpen ? " no-anim" : ""}" id="${catId}" ${catOpen ? "" : "hidden"} style="margin-top:10px;">
      ${subHtml}
      <div class="add-sub">
        <button type="button" class="btn-link add-sub-toggle">+ Agregar subcategoría</button>
        <div class="add-sub-form" hidden>
          <input type="text" class="new-sub-name" placeholder="Nombre de la subcategoría" list="${listId}" autocomplete="off">
          <datalist id="${listId}">${knownSubs.map((s) => `<option value="${escapeAttr(s)}"></option>`).join("")}</datalist>
          <div class="inline-form">
            <input type="number" class="new-sub-monto" inputmode="numeric" placeholder="Monto">
            <button type="button" class="btn-secondary new-sub-save">Agregar</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const panel = wrap.querySelector(`#${catId}`);
  wrap.querySelector(".cat-clickable").addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    panel.classList.remove("no-anim");
    if (panel.hidden) openCats.delete(catKey);
    else openCats.add(catKey);
  });

  const addToggle = wrap.querySelector(".add-sub-toggle");
  const addForm = wrap.querySelector(".add-sub-form");
  addToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    addForm.hidden = !addForm.hidden;
    addToggle.textContent = addForm.hidden ? "+ Agregar subcategoría" : "Cancelar";
    if (!addForm.hidden) wrap.querySelector(".new-sub-name").focus();
  });
  wrap.querySelector(".new-sub-save").addEventListener("click", async (e) => {
    e.stopPropagation();
    const nombre = wrap.querySelector(".new-sub-name").value.trim();
    const monto = Number(wrap.querySelector(".new-sub-monto").value);
    if (!nombre || !monto) return showToast("Falta nombre o monto", true);
    // Si ya existe una línea fijada para esa subcategoría, la actualiza en vez de duplicar.
    const existente = findExplicit(mes, tipo, categoria, nombre);
    await upsertMonto(mes, tipo, categoria, nombre, monto, existente ? existente.row : null);
  });

  wireSubcategoriaToggles(wrap, tipo, categoria, mes, historyMonths);
  return wrap;
}

function buildSubcategoriaRow(si, historyMonths, tipo, categoria) {
  const label = si.sub || "General";
  const subId = `sub${++uid}`;
  const isOpen = openSubs.has(subKeyOf(tipo, categoria, si.sub));
  return `
    <div class="category-row-top cat-clickable sub-clickable" data-sub="${escapeAttr(si.sub)}" data-target="${subId}" style="padding:8px 0;font-size:13px;">
      <span style="color:var(--text-secondary)">${label}${si.row ? "" : ' <span class="meta" style="font-size:10px;">(sugerido)</span>'}</span>
      <span class="cat-amounts">${fmtCLP(si.effective)}</span>
    </div>
    ${buildStatsRow(si.effective, si.historyTotals, historyMonths)}
    <div class="sub-detail${isOpen ? " no-anim" : ""}" id="${subId}" ${isOpen ? "" : "hidden"}></div>`;
}

function wireSubcategoriaToggles(scope, tipo, categoria, mes, historyMonths) {
  scope.querySelectorAll(".sub-clickable").forEach((el) => {
    const sub = el.dataset.sub;
    const detail = scope.querySelector(`#${el.dataset.target}`);
    const key = subKeyOf(tipo, categoria, sub);

    // Si venía abierto de antes del re-render, se repuebla al vuelo.
    if (!detail.hidden) {
      renderSubcategoriaDetail(detail, tipo, categoria, sub, mes, subInfo(tipo, categoria, sub, mes, historyMonths));
    }

    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = detail.hidden;
      detail.hidden = !detail.hidden;
      detail.classList.remove("no-anim");
      if (willOpen) {
        openSubs.add(key);
        renderSubcategoriaDetail(detail, tipo, categoria, sub, mes, subInfo(tipo, categoria, sub, mes, historyMonths));
      } else {
        openSubs.delete(key);
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
      .join("") || '<div class="skeleton no-spinner" style="padding:6px 0;font-size:12px;">Sin movimientos reales este mes</div>';

  detail.innerHTML = `
    <div class="inline-form">
      <input type="number" inputmode="numeric" value="${Math.round(si.effective)}" class="edit-input">
      <button class="btn-secondary edit-save">Guardar</button>
      ${si.row ? `<button class="btn-secondary edit-del" title="Volver al promedio">×</button>` : ""}
    </div>
    <div style="font-size:11px;color:var(--text-muted);margin:8px 0 10px;">
      ${si.row
        ? '<span class="badge badge-good">fijado</span> Monto puesto por ti.'
        : '<span class="badge badge-muted">sugerido</span> Promedio de los 3 meses anteriores.'}
    </div>
    <div style="font-size:11.5px;color:var(--text-muted);margin:10px 0 4px;font-weight:650;">Movimientos reales de este mes</div>
    ${movHtml}
  `;

  // OJO: siempre acotado a este panel. Los paneles cerrados quedan en el DOM,
  // así que un lookup global tomaría el input de otra subcategoría.
  detail.querySelector(".edit-save").addEventListener("click", async (e) => {
    e.stopPropagation();
    const val = Number(detail.querySelector(".edit-input").value);
    if (isNaN(val)) return showToast("Monto inválido", true);
    await upsertMonto(mes, tipo, categoria, sub, val, si.row);
  });
  const delBtn = detail.querySelector(".edit-del");
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
      await window.SheetsApi.updateRange(`Presupuesto!E${existingRow}`, [[monto]], "RAW");
    } else {
      // RAW: si no, Sheets convierte "2026-09" en una fecha (nº de serie) y la fila
      // deja de encontrarse al recargar, duplicándose en cada guardado.
      await window.SheetsApi.appendRow("Presupuesto!A:E", [mes, tipo, categoria, subcategoria, monto], "RAW");
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
  const scrollY = window.scrollY; // se restaura al final: guardar no debe saltar al inicio
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
  if (gastoCats.length === 0) gastoList.innerHTML = '<div class="skeleton no-spinner">Sin datos para proponer presupuesto de gasto</div>';
  gastoCats.forEach((cat) => gastoList.appendChild(buildCategoriaBlock("Gasto", cat, mes, historyMonths)));
  gastoList.appendChild(buildAddCategoriaBlock("Gasto", mes));

  const ingresoList = $("ingresoList");
  ingresoList.innerHTML = "";
  if (ingresoCats.length === 0) ingresoList.innerHTML = '<div class="skeleton no-spinner">Sin datos para proponer presupuesto de ingreso</div>';
  ingresoCats.forEach((cat) => ingresoList.appendChild(buildCategoriaBlock("Ingreso", cat, mes, historyMonths)));
  ingresoList.appendChild(buildAddCategoriaBlock("Ingreso", mes));

  requestAnimationFrame(() => window.scrollTo(0, scrollY));
}

/** "+ Agregar categoría" al final de cada lista — para categorías que aún no existen. */
function buildAddCategoriaBlock(tipo, mes) {
  const id = ++uid;
  const conocidas = [...new Set(movimientos.filter((m) => m.tipo === tipo).map((m) => m.categoria))].sort();

  const wrap = document.createElement("div");
  wrap.className = "add-cat";
  wrap.innerHTML = `
    <button type="button" class="btn-link add-cat-toggle">+ Agregar categoría</button>
    <div class="add-cat-form" hidden>
      <input type="text" class="new-cat-name" placeholder="Nombre de la categoría" list="catopts${id}" autocomplete="off">
      <datalist id="catopts${id}">${conocidas.map((c) => `<option value="${escapeAttr(c)}"></option>`).join("")}</datalist>
      <input type="text" class="new-cat-sub" placeholder="Subcategoría (opcional)" autocomplete="off" style="margin-top:8px;">
      <div class="inline-form">
        <input type="number" class="new-cat-monto" inputmode="numeric" placeholder="Monto">
        <button type="button" class="btn-secondary new-cat-save">Agregar</button>
      </div>
    </div>
  `;

  const toggle = wrap.querySelector(".add-cat-toggle");
  const form = wrap.querySelector(".add-cat-form");
  toggle.addEventListener("click", () => {
    form.hidden = !form.hidden;
    toggle.textContent = form.hidden ? "+ Agregar categoría" : "Cancelar";
    if (!form.hidden) wrap.querySelector(".new-cat-name").focus();
  });
  wrap.querySelector(".new-cat-save").addEventListener("click", async () => {
    const categoria = wrap.querySelector(".new-cat-name").value.trim();
    const subcategoria = wrap.querySelector(".new-cat-sub").value.trim();
    const monto = Number(wrap.querySelector(".new-cat-monto").value);
    if (!categoria || !monto) return showToast("Falta categoría o monto", true);
    const existente = findExplicit(mes, tipo, categoria, subcategoria);
    await upsertMonto(mes, tipo, categoria, subcategoria, monto, existente ? existente.row : null);
  });
  return wrap;
}

/** Acepta "2026-09" o el número de serie de fecha de Sheets (ej. 46266) y
 * siempre devuelve "YYYY-MM". Blinda contra filas guardadas antes del fix. */
function normalizeMes(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
    if (!isNaN(d)) return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  const d = new Date(s);
  if (!isNaN(d)) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return s;
}

async function loadPresupuesto() {
  const rows = await window.SheetsApi.readRange("Presupuesto!A2:E10000");
  presRows = rows
    .map((r, i) => ({
      row: i + 2,
      mes: normalizeMes(r[0]),
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
  for (const m of movimientos) {
    if (!m.categoria) continue;
    if (m.subcategoria) (categoriaSubMap[m.categoria] ||= new Set()).add(m.subcategoria);
  }
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
}

init();
