const $ = (id) => document.getElementById(id);

const MESES = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function fmtCLP(n) {
  const sign = n < 0 ? "-" : "";
  return sign + "$" + Math.round(Math.abs(n)).toLocaleString("es-CL");
}

let movimientos = []; // { fecha, año, mes, tipo, categoria, subcategoria, medioPago, estado, monto, detalle }
let presupuestoRows = []; // { mes, tipo, categoria, subcategoria, monto }
let cuentas = []; // { nombre, saldo }

/** The n month-keys strictly before `mes`, oldest to newest. Mirrors presupuesto.js
 * so both pages always agree on the "proposed" budget when nothing is fijado. */
function monthsBeforeExclusive(mes, n) {
  const [y, m] = mes.split("-").map(Number);
  const out = [];
  for (let i = n; i >= 1; i--) {
    const d = new Date(y, m - 1 - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function avg3Real(tipo, categoria, subcategoria, mes) {
  const months = monthsBeforeExclusive(mes, 3);
  const totals = months.map((mk) =>
    movimientos
      .filter((m) => m.tipo === tipo && m.categoria === categoria && (m.subcategoria || "") === subcategoria && monthKey(m) === mk)
      .reduce((s, m) => s + Math.abs(m.monto), 0)
  );
  return totals.reduce((a, b) => a + b, 0) / 3;
}

/** Budgeted amount for one categoria+subcategoria: explicit override if fijado,
 * else the same 3-month-average proposal shown on the Presupuesto page. */
function budgetForSubcategoria(mes, categoria, subcategoria, tipo = "Gasto") {
  const row = presupuestoRows.find(
    (p) => p.mes === mes && p.tipo === tipo && p.categoria === categoria && p.subcategoria === subcategoria
  );
  return row ? row.monto : avg3Real(tipo, categoria, subcategoria, mes);
}

/** Sum across all of a categoria's subcategorias (explicit-or-average each), matching
 * the Presupuesto page's "category = sum of its subcategorias" rule. Null only when
 * the categoria has no subcategorias with any recent activity at all. */
function budgetForCategoria(mes, categoria, tipo = "Gasto") {
  const historyMonths = monthsBeforeExclusive(mes, 3);
  const subs = new Set();
  for (const m of movimientos) {
    if (m.tipo === tipo && m.categoria === categoria && historyMonths.includes(monthKey(m))) subs.add(m.subcategoria || "");
  }
  for (const p of presupuestoRows) {
    if (p.mes === mes && p.tipo === tipo && p.categoria === categoria) subs.add(p.subcategoria || "");
  }
  if (subs.size === 0) return null;
  return [...subs].reduce((s, sub) => s + budgetForSubcategoria(mes, categoria, sub, tipo), 0);
}

/** Every categoria of `tipo` worth proposing a budget for (recent activity or fijado). */
function categoriasForTipo(tipo, mes) {
  const historyMonths = monthsBeforeExclusive(mes, 3);
  const all = new Set();
  for (const m of movimientos) if (m.tipo === tipo) all.add(m.categoria);
  for (const p of presupuestoRows) if (p.tipo === tipo) all.add(p.categoria);
  return [...all].filter((cat) => {
    const hasHistory = movimientos.some((m) => m.tipo === tipo && m.categoria === cat && historyMonths.includes(monthKey(m)));
    const hasFijado = presupuestoRows.some((p) => p.mes === mes && p.tipo === tipo && p.categoria === cat);
    return hasHistory || hasFijado;
  });
}

/** Total proposed-or-fijado budget for a whole tipo (Ingreso/Gasto) in a month. */
function totalBudgetForTipo(tipo, mes) {
  return categoriasForTipo(tipo, mes).reduce((s, cat) => s + budgetForCategoria(mes, cat, tipo), 0);
}

function parseMovimientos(rows) {
  return rows
    .filter((r) => r[0]) // has fecha
    .map((r) => ({
      fecha: r[0],
      año: String(r[1] || "").trim(),
      mes: String(r[2] || "").trim(),
      tipo: r[3] || "",
      categoria: r[4] || "",
      subcategoria: r[5] || "",
      medioPago: r[6] || "",
      estado: r[7] || "",
      monto: Number(r[8]) || 0,
      detalle: r[9] || "",
      fechaVencimiento: r[10] || "",
    }));
}

/** Parses DD/MM/YYYY or DD-MM-YYYY into a Date (or null). */
function parseFechaVenc(s) {
  if (!s) return null;
  const parts = String(s).trim().split(/[-/]/);
  if (parts.length !== 3) return null;
  const [d, m, y] = parts.map(Number);
  if (!d || !m || !y) return null;
  const date = new Date(y, m - 1, d);
  return isNaN(date) ? null : date;
}

function monthKey(m) {
  return `${m.año}-${String(m.mes).padStart(2, "0")}`;
}

/** Chronological array of the n month-keys ending at (and including) selectedKey. */
function monthsBackFrom(selectedKey, n) {
  const [y, m] = selectedKey.split("-").map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/** Best-effort short display date (DD/MM) from either DD/MM/YYYY or YYYY-MM-DD. */
function formatFechaCorta(fecha) {
  const s = String(fecha || "").trim();
  if (s.includes("/")) {
    const [d, m] = s.split("/");
    if (d && m) return `${d.padStart(2, "0")}/${m.padStart(2, "0")}`;
  }
  if (s.includes("-")) {
    const [y, m, d] = s.split("-");
    if (d && m) return `${d.padStart(2, "0")}/${m.padStart(2, "0")}`;
  }
  return s;
}

function populateMonthSelect() {
  const keys = [...new Set(movimientos.map(monthKey))].sort().reverse();
  const select = $("monthSelect");
  select.innerHTML = "";
  for (const key of keys) {
    const [y, m] = key.split("-");
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = `${MESES[Number(m)]} ${y}`;
    select.appendChild(opt);
  }
  return keys[0];
}

/** Monthly totals (Gasto only) for movimientos matching predicate, keyed by monthKey. */
function monthlyTotals(predicate) {
  const out = {};
  for (const m of movimientos) {
    if (m.tipo !== "Gasto" || !predicate(m)) continue;
    const key = monthKey(m);
    out[key] = (out[key] || 0) + Math.abs(m.monto);
  }
  return out;
}

/** Small 6-bar sparkline (with month labels) as an HTML string. */
function buildSparklineHTML(sixMonths, totalsByMonth) {
  const vals = sixMonths.map((k) => totalsByMonth[k] || 0);
  const max = Math.max(...vals, 1);
  return sixMonths
    .map((k, i) => {
      const [, mo] = k.split("-");
      const heightPct = Math.max(4, Math.round((vals[i] / max) * 100));
      return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;">
        <div style="width:100%;height:36px;display:flex;align-items:flex-end;">
          <div style="width:100%;background:var(--series-1);border-radius:3px 3px 0 0;height:${heightPct}%;"></div>
        </div>
        <div style="font-size:9px;color:var(--text-muted);">${MESES[Number(mo)]}</div>
      </div>`;
    })
    .join("");
}

const escapeAttr = (s) => String(s).replace(/"/g, "&quot;");

/** A clickable subcategory row; its own 6-month sparkline + transaction list build lazily on first click. */
function buildSubcategoryRow(cat, sub, subMonto, selectedKey) {
  const rowId = `sub-${cat}-${sub}`.replace(/[^a-zA-Z0-9]/g, "");
  const subMeta = budgetForSubcategoria(selectedKey, cat, sub === "(sin subcategoría)" ? "" : sub);
  return `
    <div class="category-row-top cat-clickable sub-clickable" data-cat="${escapeAttr(cat)}" data-sub="${escapeAttr(sub)}" data-key="${selectedKey}" data-target="${rowId}" style="padding:8px 0;font-size:13px;">
      <span style="color:var(--text-secondary)">${sub}</span>
      <span class="cat-amounts">${fmtCLP(subMonto)}${subMeta ? ` <span class="meta">de ${fmtCLP(subMeta)}</span>` : ""}</span>
    </div>
    <div class="sub-detail" id="${rowId}" hidden></div>`;
}

function wireSubcategoryToggles(scope) {
  scope.querySelectorAll(".sub-clickable").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation(); // don't also toggle the parent category
      const detail = document.getElementById(el.dataset.target);
      const willOpen = detail.hidden;
      detail.hidden = !detail.hidden;
      if (willOpen && !detail.dataset.loaded) {
        detail.dataset.loaded = "1";
        const { cat, sub, key } = el.dataset;
        const sparkline = buildSparklineHTML(
          monthsBackFrom(key, 6),
          monthlyTotals((m) => m.categoria === cat && (m.subcategoria || "(sin subcategoría)") === sub)
        );
        const items = movimientos
          .filter(
            (m) =>
              m.tipo === "Gasto" &&
              m.categoria === cat &&
              (m.subcategoria || "(sin subcategoría)") === sub &&
              monthKey(m) === key
          )
          .sort((a, b) => (a.fecha < b.fecha ? 1 : -1))
          .map(
            (m) => `<div class="category-row-top" style="padding:5px 0;font-size:12px;">
              <span style="color:var(--text-muted)">${formatFechaCorta(m.fecha)} · ${m.detalle || "—"}</span>
              <span class="cat-amounts">${fmtCLP(Math.abs(m.monto))}</span>
            </div>`
          )
          .join("");
        detail.innerHTML = `
          <div style="display:flex;gap:5px;margin:8px 0;">${sparkline}</div>
          ${items || '<div class="skeleton" style="padding:6px 0;font-size:12px;">Sin movimientos este mes</div>'}`;
      }
    });
  });
}

function renderStats(selectedKey) {
  const inMonth = movimientos.filter((m) => monthKey(m) === selectedKey);
  const ingresos = inMonth.filter((m) => m.tipo === "Ingreso").reduce((s, m) => s + m.monto, 0);
  const gastos = inMonth.filter((m) => m.tipo === "Gasto").reduce((s, m) => s + Math.abs(m.monto), 0);
  const neto = ingresos - gastos;

  $("statIngresos").textContent = fmtCLP(ingresos);
  $("statGastos").textContent = fmtCLP(gastos);
  const netoEl = $("statNeto");
  netoEl.textContent = fmtCLP(neto);
  netoEl.className = "stat-value " + (neto >= 0 ? "income" : "expense");

  // Categorías (gasto) vs presupuesto
  const byCat = {};
  for (const m of inMonth) {
    if (m.tipo !== "Gasto") continue;
    byCat[m.categoria] = (byCat[m.categoria] || 0) + Math.abs(m.monto);
  }
  const sorted = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const list = $("categoryList");
  list.innerHTML = "";
  if (sorted.length === 0) {
    list.innerHTML = '<div class="skeleton">Sin gastos este mes</div>';
  }
  for (const [cat, monto] of sorted) {
    const meta = budgetForCategoria(selectedKey, cat);
    const pct = meta ? Math.round((monto / meta) * 100) : null;
    const row = document.createElement("div");
    row.className = "category-row";

    const sparkline = buildSparklineHTML(
      monthsBackFrom(selectedKey, 6),
      monthlyTotals((m) => m.categoria === cat)
    );

    // Subcategorías de esta categoría, en el mes seleccionado.
    const bySub = {};
    for (const m of inMonth) {
      if (m.tipo !== "Gasto" || m.categoria !== cat) continue;
      const sub = m.subcategoria || "(sin subcategoría)";
      bySub[sub] = (bySub[sub] || 0) + Math.abs(m.monto);
    }
    const subRows = Object.entries(bySub)
      .sort((a, b) => b[1] - a[1])
      .map(([sub, subMonto]) => buildSubcategoryRow(cat, sub, subMonto, selectedKey))
      .join("");

    row.innerHTML = `
      <div class="category-row-top cat-clickable">
        <span class="cat-name">${cat}</span>
        <span class="cat-amounts">${fmtCLP(monto)}${meta ? ` <span class="meta">de ${fmtCLP(meta)}</span>` : ""}</span>
      </div>
      ${meta ? `<div class="bar-track"><div class="bar-fill${pct > 100 ? " over" : ""}" style="width:${Math.min(pct, 100)}%"></div></div>` : ""}
      <div class="cat-detail" hidden>
        <div style="display:flex;gap:6px;margin-top:12px;">${sparkline}</div>
        <div style="margin-top:12px;">${subRows || '<div class="skeleton" style="padding:8px 0;">Sin movimientos este mes</div>'}</div>
      </div>`;

    row.querySelector(".cat-clickable").addEventListener("click", () => {
      row.querySelector(".cat-detail").hidden = !row.querySelector(".cat-detail").hidden;
    });
    wireSubcategoryToggles(row);
    list.appendChild(row);
  }

  // Por pagar (global, no filtrado por mes)
  const pendientes = movimientos.filter((m) => m.estado === "Por pagar");
  const porPagar = pendientes.reduce((s, m) => s + Math.abs(m.monto), 0);
  $("statPorPagar").textContent = fmtCLP(porPagar);

  // Liquidez neta = saldo en cuentas - lo pendiente por pagar
  const totalCuentas = cuentas.reduce((s, c) => s + c.saldo, 0);
  const liquidezEl = $("statLiquidez");
  const liquidez = totalCuentas - porPagar;
  liquidezEl.textContent = fmtCLP(liquidez);
  liquidezEl.className = "stat-value " + (liquidez >= 0 ? "income" : "expense");

  renderLiquidezPresupuestada(selectedKey, liquidez);
  renderPorPagarDetail(pendientes);
}

function renderLiquidezPresupuestada(selectedKey, liquidezReal) {
  const el = $("liquidezPptoLine");
  const ingresoPpto = totalBudgetForTipo("Ingreso", selectedKey);
  const gastoPpto = totalBudgetForTipo("Gasto", selectedKey);
  if (ingresoPpto === 0 && gastoPpto === 0) {
    el.textContent = "(Sin datos para proponer presupuesto este mes)";
    el.style.color = "var(--text-muted)";
    return;
  }
  const resultadoPpto = ingresoPpto - gastoPpto;
  const liquidezPpto = liquidezReal + resultadoPpto;

  el.textContent = `(Presupuestada: ${fmtCLP(liquidezPpto)})`;
  el.style.color = resultadoPpto >= 0 ? "var(--good)" : "var(--critical)";
}

function renderPorPagarDetail(pendientes) {
  const withDate = pendientes
    .map((m) => ({ ...m, venc: parseFechaVenc(m.fechaVencimiento) }))
    .filter((m) => m.venc);

  // Por período (mes de vencimiento)
  const byPeriod = {};
  for (const m of withDate) {
    const key = `${m.venc.getFullYear()}-${String(m.venc.getMonth() + 1).padStart(2, "0")}`;
    byPeriod[key] = (byPeriod[key] || 0) + Math.abs(m.monto);
  }
  const periodosEl = $("porPagarPeriodos");
  periodosEl.innerHTML = "";
  const today = new Date();
  for (const [key, monto] of Object.entries(byPeriod).sort()) {
    const [y, mo] = key.split("-");
    const isPast = Number(y) < today.getFullYear() ||
      (Number(y) === today.getFullYear() && Number(mo) < today.getMonth() + 1);
    const row = document.createElement("div");
    row.className = "category-row-top";
    row.style.padding = "8px 0";
    row.innerHTML = `
      <span style="color:var(--text-secondary)">${MESES[Number(mo)]} ${y}${isPast ? ' <span class="badge badge-warning">atrasado</span>' : ""}</span>
      <span class="cat-amounts">${fmtCLP(monto)}</span>`;
    periodosEl.appendChild(row);
  }
  if (Object.keys(byPeriod).length === 0) {
    periodosEl.innerHTML = '<div class="skeleton">Sin vencimientos con fecha</div>';
  }
}

function renderPatrimonio() {
  const total = cuentas.reduce((s, c) => s + c.saldo, 0);
  $("statPatrimonio").textContent = fmtCLP(total);
  const mini = $("accountsMini");
  mini.innerHTML = "";
  const top = [...cuentas].sort((a, b) => b.saldo - a.saldo).slice(0, 4);
  for (const c of top) {
    const row = document.createElement("div");
    row.className = "category-row-top";
    row.style.padding = "4px 0";
    row.innerHTML = `<span style="color:var(--text-secondary)">${c.nombre}</span><span class="cat-amounts">${fmtCLP(c.saldo)}</span>`;
    mini.appendChild(row);
  }
}

function renderTrend() {
  const byMonth = {};
  for (const m of movimientos) {
    const key = monthKey(m);
    byMonth[key] ||= { ingresos: 0, gastos: 0 };
    if (m.tipo === "Ingreso") byMonth[key].ingresos += m.monto;
    else byMonth[key].gastos += Math.abs(m.monto);
  }
  const keys = Object.keys(byMonth).sort().slice(-9);
  const svg = $("trendChart");
  const tooltip = $("trendTooltip");
  if (keys.length < 2) {
    svg.innerHTML = "";
    return;
  }
  const w = 320, h = 140, padTop = 10, padBottom = 24, padX = 14;
  const plotH = h - padTop - padBottom;
  const maxVal = Math.max(...keys.map((k) => Math.max(byMonth[k].ingresos, byMonth[k].gastos)), 1);
  const stepX = (w - padX * 2) / (keys.length - 1);
  const yOf = (v) => padTop + plotH - (v / maxVal) * plotH;
  const xOf = (i) => padX + i * stepX;
  const pointsFor = (field) => keys.map((k, i) => `${xOf(i)},${yOf(byMonth[k][field])}`).join(" ");
  const dotsFor = (field, color) =>
    keys.map((k, i) => `<circle cx="${xOf(i)}" cy="${yOf(byMonth[k][field])}" r="2.5" fill="${color}"/>`).join("");

  const style = getComputedStyle(document.documentElement);
  const incomeColor = style.getPropertyValue("--income").trim();
  const expenseColor = style.getPropertyValue("--expense").trim();
  const mutedColor = style.getPropertyValue("--text-muted").trim();
  const gridColor = style.getPropertyValue("--grid").trim();

  const gridLine = `<line x1="${padX}" y1="${padTop + plotH}" x2="${w - padX}" y2="${padTop + plotH}" stroke="${gridColor}" stroke-width="1"/>`;

  const labels = keys
    .map((k, i) => {
      const [, mo] = k.split("-");
      // Show every label if it fits, otherwise skip alternating ones to avoid crowding.
      if (keys.length > 7 && i % 2 === 1 && i !== keys.length - 1) return "";
      return `<text x="${xOf(i)}" y="${h - 6}" font-size="9" fill="${mutedColor}" text-anchor="middle">${MESES[Number(mo)]}</text>`;
    })
    .join("");

  const hitAreas = keys
    .map((k, i) => `<rect x="${xOf(i) - stepX / 2}" y="0" width="${stepX}" height="${padTop + plotH}" fill="transparent" data-i="${i}"/>`)
    .join("");

  svg.innerHTML = `
    ${gridLine}
    <polyline points="${pointsFor("ingresos")}" fill="none" stroke="${incomeColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    <polyline points="${pointsFor("gastos")}" fill="none" stroke="${expenseColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    ${dotsFor("ingresos", incomeColor)}
    ${dotsFor("gastos", expenseColor)}
    ${labels}
    ${hitAreas}
  `;

  const showTip = (i, clientX) => {
    const k = keys[i];
    const [y, mo] = k.split("-");
    const rect = svg.getBoundingClientRect();
    tooltip.innerHTML = `${MESES[Number(mo)]} ${y}<br>Ing: ${fmtCLP(byMonth[k].ingresos)}<br>Gas: ${fmtCLP(byMonth[k].gastos)}`;
    tooltip.style.left = `${clientX - rect.left}px`;
    tooltip.style.top = `${((yOf(Math.max(byMonth[k].ingresos, byMonth[k].gastos)) / h) * rect.height)}px`;
    tooltip.classList.add("show");
  };
  const hideTip = () => tooltip.classList.remove("show");

  svg.querySelectorAll("rect[data-i]").forEach((rect) => {
    const i = Number(rect.dataset.i);
    rect.addEventListener("pointerenter", (e) => showTip(i, e.clientX));
    rect.addEventListener("pointermove", (e) => showTip(i, e.clientX));
  });
  svg.addEventListener("pointerleave", hideTip);
}

async function loadData() {
  const [movRows, presRows, cuentasRows] = await Promise.all([
    window.SheetsApi.readRange("Movimientos!A2:N100000"),
    window.SheetsApi.readRange("Presupuesto!A2:E10000"),
    window.SheetsApi.readRange("Cuentas!A2:C1000"),
  ]);
  movimientos = parseMovimientos(movRows);
  presupuestoRows = presRows
    .filter((r) => r[0] && r[2])
    .map(([mes, tipo, categoria, subcategoria, monto]) => ({
      mes, tipo, categoria, subcategoria: subcategoria || "", monto: Number(monto) || 0,
    }));
  cuentas = cuentasRows
    .filter((r) => r[0])
    .map(([nombre, saldo]) => ({ nombre, saldo: Number(saldo) || 0 }));
}

async function init() {
  if (!window.SheetsAuth.requireAuthOrRedirect()) return;

  $("loadingSkeleton").hidden = false;
  await loadData();
  $("loadingSkeleton").hidden = true;
  $("dashboard").hidden = false;

  const defaultKey = populateMonthSelect();
  renderStats(defaultKey);
  renderTrend();
  renderPatrimonio();

  $("monthSelect").addEventListener("change", (e) => renderStats(e.target.value));

  const toggleDetail = () => {
    const detail = $("porPagarDetail");
    detail.hidden = !detail.hidden;
    $("porPagarToggle").textContent = detail.hidden ? "Ver detalle ▾" : "Ocultar ▴";
  };
  $("porPagarHeader").addEventListener("click", toggleDetail);
}

init();
