const $ = (id) => document.getElementById(id);

const MESES = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function fmtCLP(n) {
  const sign = n < 0 ? "-" : "";
  return sign + "$" + Math.round(Math.abs(n)).toLocaleString("es-CL");
}

let movimientos = []; // { fecha, año, mes, tipo, categoria, subcategoria, medioPago, estado, monto, detalle }
let presupuestoRows = []; // { mes, tipo, categoria, subcategoria, monto }
let cuentas = []; // { nombre, saldo }
let saldosMensuales = []; // { row, mes, saldoInicial } — ancla de la conciliación

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

/** Acepta "2026-09" o el número de serie de fecha de Sheets y devuelve "YYYY-MM". */
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
  const cols = sixMonths
    .map((k, i) => {
      const [, mo] = k.split("-");
      const heightPct = Math.max(3, Math.round((vals[i] / max) * 100));
      return `<div class="spark-col" title="${MESES[Number(mo)]}: ${fmtCLP(vals[i])}">
        <div class="spark-bar-slot"><div class="spark-bar" style="height:${heightPct}%"></div></div>
        <div class="spark-label">${MESES[Number(mo)]}</div>
      </div>`;
    })
    .join("");
  return `<div class="spark">${cols}</div>`;
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
          <div style="margin:10px 0 12px;">${sparkline}</div>
          ${items || '<div class="skeleton no-spinner" style="padding:6px 0;font-size:12px;">Sin movimientos este mes</div>'}`;
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
    list.innerHTML = '<div class="skeleton no-spinner">Sin gastos este mes</div>';
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
        <div style="margin-top:14px;">${sparkline}</div>
        <div style="margin-top:12px;">${subRows || '<div class="skeleton no-spinner" style="padding:8px 0;">Sin movimientos este mes</div>'}</div>
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
  renderConciliacion(selectedKey);
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
    periodosEl.innerHTML = '<div class="skeleton no-spinner">Sin vencimientos con fecha</div>';
  }
}

/** Mes calendario actual, "YYYY-MM". */
function mesActual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Conciliación: cruza lo que dicen los movimientos con el saldo real de las cuentas.
 * Solo cuentan los movimientos "Pagado": lo "Por pagar" (tarjeta) todavía no sale
 * de la cuenta, así que no debe afectar el saldo esperado. */
function renderConciliacion(selectedKey) {
  const body = $("conciliacionBody");
  const hoy = mesActual();

  if (selectedKey !== hoy) {
    body.innerHTML = `<div class="skeleton no-spinner" style="padding:10px 0;">
      La conciliación aplica solo al mes actual — no hay saldos históricos guardados.
    </div>`;
    return;
  }

  const snap = saldosMensuales.find((s) => s.mes === hoy);
  const saldoReal = cuentas.reduce((s, c) => s + c.saldo, 0);

  if (!snap) {
    body.innerHTML = `
      <div style="font-size:13px;color:var(--text-secondary);line-height:1.5;margin-bottom:10px;">
        Falta el saldo con el que arrancó este mes. Se usa como punto de partida para cuadrar
        tus movimientos contra el saldo real de tus cuentas.
      </div>
      <div class="inline-form">
        <input type="number" inputmode="numeric" id="nuevoSaldoInicial" value="${Math.round(saldoReal)}">
        <button class="btn-secondary" id="fijarSaldoInicial">Fijar</button>
      </div>`;
    $("fijarSaldoInicial").addEventListener("click", async () => {
      const val = Number($("nuevoSaldoInicial").value);
      if (isNaN(val)) return;
      await window.SheetsApi.appendRow("SaldoMensual!A:B", [hoy, val], "RAW");
      await loadData();
      renderConciliacion(selectedKey);
    });
    return;
  }

  const delMes = movimientos.filter((m) => monthKey(m) === hoy && (m.estado || "").trim() === "Pagado");
  const ingresos = delMes.filter((m) => m.tipo === "Ingreso").reduce((s, m) => s + Math.abs(m.monto), 0);
  const gastos = delMes.filter((m) => m.tipo === "Gasto").reduce((s, m) => s + Math.abs(m.monto), 0);
  const esperado = snap.saldoInicial + ingresos - gastos;
  const diff = saldoReal - esperado;

  const abs = Math.abs(diff);
  const pct = saldoReal ? abs / Math.abs(saldoReal) : 0;
  let badge, clase;
  if (abs < 1) { badge = "conciliado"; clase = "badge-good"; }
  else if (pct <= 0.01) { badge = "diferencia menor"; clase = "badge-warning"; }
  else { badge = "revisar"; clase = "badge-critical"; }

  const fila = (etiqueta, valor, extra = "") =>
    `<div class="category-row-top" style="padding:7px 0;font-size:13.5px;${extra}">
      <span style="color:var(--text-secondary)">${etiqueta}</span>
      <span class="cat-amounts">${valor}</span>
    </div>`;

  body.innerHTML = `
    ${fila("Saldo inicial del mes", fmtCLP(snap.saldoInicial))}
    ${fila("+ Ingresos pagados", `<span class="income">${fmtCLP(ingresos)}</span>`)}
    ${fila("− Gastos pagados", `<span class="expense">${fmtCLP(gastos)}</span>`)}
    ${fila("= Saldo contable esperado", `<strong>${fmtCLP(esperado)}</strong>`, "border-top:1px solid var(--grid);")}
    ${fila("Saldo real en cuentas", `<strong>${fmtCLP(saldoReal)}</strong>`)}
    <div class="category-row-top" style="padding:11px 0 4px;border-top:1px solid var(--grid);font-size:14.5px;">
      <span style="font-weight:700;">Diferencia</span>
      <span class="cat-amounts" style="font-weight:800;">
        <span class="badge ${clase}" style="margin-right:7px;">${badge}</span>${fmtCLP(diff)}
      </span>
    </div>
    ${abs >= 1
      ? `<div style="margin-top:14px;">
           <div class="stat-label" style="margin-bottom:8px;">Cuadrar registrando</div>
           <div style="display:flex;gap:8px;flex-wrap:wrap;">
             ${diff > 0
               ? `<button class="btn-secondary" id="cuadrarInteres" style="flex:1;min-width:150px;">Interés cuenta remunerada</button>`
               : ""}
             <button class="btn-secondary" id="cuadrarAjuste" style="flex:1;min-width:150px;">Ajuste de conciliación</button>
           </div>
           ${diff < 0
             ? `<div style="font-size:11px;color:var(--text-muted);margin-top:8px;line-height:1.5;">
                  Falta plata respecto a lo registrado, así que no puede ser interés (el interés suma).
                </div>`
             : ""}
         </div>`
      : ""}
    <div style="font-size:11.5px;color:var(--text-muted);margin-top:12px;line-height:1.55;">
      El <strong>saldo inicial</strong> es cuánto tenías en total en tus cuentas el día que empezó el mes.
      Solo cuenta lo <strong>pagado</strong>: lo que está "por pagar" aún no sale de tus cuentas.
      <button class="btn-link" id="editSaldoInicial" style="font-size:11.5px;padding:0;margin-left:4px;">Ajustar saldo inicial</button>
    </div>
    <div class="inline-form" id="editSaldoForm" hidden>
      <input type="number" inputmode="numeric" id="saldoInicialInput" value="${Math.round(snap.saldoInicial)}">
      <button class="btn-secondary" id="guardarSaldoInicial">Guardar</button>
    </div>`;

  /** Registra un movimiento que absorbe exactamente la diferencia y deja la
   * conciliación en cero. diff > 0 -> entró plata sin registrar (Ingreso);
   * diff < 0 -> salió plata sin registrar (Gasto). */
  const registrarCuadre = async (btn, { categoria, subcategoria, medioPago, detalle }) => {
    const tipo = diff >= 0 ? "Ingreso" : "Gasto";
    const magnitud = Math.round(abs);
    if (!confirm(`Se registrará un ${tipo.toLowerCase()} de ${fmtCLP(magnitud)} como "${categoria} / ${subcategoria}" y la diferencia quedará en cero. ¿Continuar?`)) return;

    const textoOriginal = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Cuadrando…";
    const hoyISO = new Date().toISOString().slice(0, 10);
    const [yyyy, mm] = hoyISO.split("-");
    try {
      await window.SheetsApi.appendRow(
        "Movimientos!A:N",
        [
          hoyISO, yyyy, String(Number(mm)), tipo,
          categoria, subcategoria, medioPago, "Pagado",
          tipo === "Gasto" ? -magnitud : magnitud,
          detalle,
          "", "", "", "",
        ],
        "RAW"
      );
      await loadData();
      renderStats(selectedKey);
      renderPatrimonio();
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      btn.textContent = textoOriginal;
    }
  };

  const btnInteres = $("cuadrarInteres");
  if (btnInteres) {
    btnInteres.addEventListener("click", () =>
      registrarCuadre(btnInteres, {
        categoria: "Sueldo",
        subcategoria: "Cuenta remunerada",
        medioPago: "Mercado Pago",
        detalle: "Interes",
      })
    );
  }
  const btnAjuste = $("cuadrarAjuste");
  if (btnAjuste) {
    btnAjuste.addEventListener("click", () =>
      registrarCuadre(btnAjuste, {
        categoria: "Ajuste conciliación",
        subcategoria: "Ajuste",
        medioPago: "",
        detalle: "Ajuste de conciliación",
      })
    );
  }

  $("editSaldoInicial").addEventListener("click", () => {
    const f = $("editSaldoForm");
    f.hidden = !f.hidden;
  });
  $("guardarSaldoInicial").addEventListener("click", async () => {
    const val = Number($("saldoInicialInput").value);
    if (isNaN(val)) return;
    await window.SheetsApi.updateRange(`SaldoMensual!B${snap.row}`, [[val]], "RAW");
    await loadData();
    renderConciliacion(selectedKey);
  });
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
  const w = 320, h = 140, padTop = 12, padBottom = 26, padX = 14;
  const plotH = h - padTop - padBottom;
  const maxVal = Math.max(...keys.map((k) => Math.max(byMonth[k].ingresos, byMonth[k].gastos)), 1);
  const stepX = (w - padX * 2) / (keys.length - 1);
  const yOf = (v) => padTop + plotH - (v / maxVal) * plotH;
  const xOf = (i) => padX + i * stepX;
  const ptsFor = (field) => keys.map((k, i) => ({ x: xOf(i), y: yOf(byMonth[k][field]) }));

  const style = getComputedStyle(document.documentElement);
  const incomeColor = style.getPropertyValue("--income").trim();
  const expenseColor = style.getPropertyValue("--expense").trim();
  const mutedColor = style.getPropertyValue("--text-muted").trim();
  const gridColor = style.getPropertyValue("--grid").trim();

  // Catmull-Rom -> bezier: una curva suave en vez de quiebres duros.
  const smoothPath = (pts) => {
    if (pts.length < 2) return "";
    let d = `M ${pts[0].x},${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      const t = 0.2;
      d += ` C ${p1.x + (p2.x - p0.x) * t},${p1.y + (p2.y - p0.y) * t}` +
           ` ${p2.x - (p3.x - p1.x) * t},${p2.y - (p3.y - p1.y) * t}` +
           ` ${p2.x},${p2.y}`;
    }
    return d;
  };
  const areaPath = (pts) => `${smoothPath(pts)} L ${pts[pts.length - 1].x},${padTop + plotH} L ${pts[0].x},${padTop + plotH} Z`;

  const ingPts = ptsFor("ingresos");
  const gasPts = ptsFor("gastos");

  // gridlines suaves de fondo (3 niveles)
  const gridLines = [0, 0.5, 1]
    .map((f) => {
      const y = padTop + plotH - f * plotH;
      return `<line x1="${padX}" y1="${y}" x2="${w - padX}" y2="${y}" stroke="${gridColor}" stroke-width="1" ${f > 0 ? 'stroke-dasharray="2 4"' : ""}/>`;
    })
    .join("");

  const labels = keys
    .map((k, i) => {
      const [, mo] = k.split("-");
      if (keys.length > 7 && i % 2 === 1 && i !== keys.length - 1) return "";
      return `<text x="${xOf(i)}" y="${h - 7}" font-size="9" font-weight="600" fill="${mutedColor}" text-anchor="middle">${MESES[Number(mo)]}</text>`;
    })
    .join("");

  const hitAreas = keys
    .map((k, i) => `<rect x="${xOf(i) - stepX / 2}" y="0" width="${stepX}" height="${padTop + plotH}" fill="transparent" data-i="${i}"/>`)
    .join("");

  svg.innerHTML = `
    <defs>
      <linearGradient id="gradIng" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${incomeColor}" stop-opacity="0.26"/>
        <stop offset="100%" stop-color="${incomeColor}" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="gradGas" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${expenseColor}" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="${expenseColor}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${gridLines}
    <path d="${areaPath(ingPts)}" fill="url(#gradIng)"/>
    <path d="${areaPath(gasPts)}" fill="url(#gradGas)"/>
    <path d="${smoothPath(ingPts)}" fill="none" stroke="${incomeColor}" stroke-width="2.4" stroke-linecap="round"/>
    <path d="${smoothPath(gasPts)}" fill="none" stroke="${expenseColor}" stroke-width="2.4" stroke-linecap="round"/>
    <line id="crosshair" x1="0" y1="${padTop}" x2="0" y2="${padTop + plotH}" stroke="${mutedColor}" stroke-width="1" stroke-dasharray="3 3" opacity="0"/>
    <circle id="dotIng" r="4" fill="${incomeColor}" stroke="var(--surface)" stroke-width="2" opacity="0"/>
    <circle id="dotGas" r="4" fill="${expenseColor}" stroke="var(--surface)" stroke-width="2" opacity="0"/>
    ${labels}
    ${hitAreas}
  `;

  const crosshair = svg.querySelector("#crosshair");
  const dotIng = svg.querySelector("#dotIng");
  const dotGas = svg.querySelector("#dotGas");

  const showTip = (i, clientX) => {
    const k = keys[i];
    const [y, mo] = k.split("-");
    const rect = svg.getBoundingClientRect();
    tooltip.innerHTML =
      `<strong>${MESES[Number(mo)]} ${y}</strong><br>` +
      `↑ ${fmtCLP(byMonth[k].ingresos)}<br>↓ ${fmtCLP(byMonth[k].gastos)}`;
    tooltip.style.left = `${clientX - rect.left}px`;
    tooltip.style.top = `${(yOf(Math.max(byMonth[k].ingresos, byMonth[k].gastos)) / h) * rect.height}px`;
    tooltip.classList.add("show");

    crosshair.setAttribute("x1", xOf(i));
    crosshair.setAttribute("x2", xOf(i));
    crosshair.setAttribute("opacity", "0.55");
    dotIng.setAttribute("cx", xOf(i));
    dotIng.setAttribute("cy", yOf(byMonth[k].ingresos));
    dotIng.setAttribute("opacity", "1");
    dotGas.setAttribute("cx", xOf(i));
    dotGas.setAttribute("cy", yOf(byMonth[k].gastos));
    dotGas.setAttribute("opacity", "1");
  };
  const hideTip = () => {
    tooltip.classList.remove("show");
    crosshair.setAttribute("opacity", "0");
    dotIng.setAttribute("opacity", "0");
    dotGas.setAttribute("opacity", "0");
  };

  svg.querySelectorAll("rect[data-i]").forEach((rect) => {
    const i = Number(rect.dataset.i);
    rect.addEventListener("pointerenter", (e) => showTip(i, e.clientX));
    rect.addEventListener("pointermove", (e) => showTip(i, e.clientX));
  });
  svg.addEventListener("pointerleave", hideTip);
}

async function loadData() {
  const [movRows, presRows, cuentasRows, saldoRows] = await Promise.all([
    window.SheetsApi.readRange("Movimientos!A2:N100000"),
    window.SheetsApi.readRange("Presupuesto!A2:E10000"),
    window.SheetsApi.readRange("Cuentas!A2:C1000"),
    window.SheetsApi.readRange("SaldoMensual!A2:B200"),
  ]);
  saldosMensuales = saldoRows
    .map((r, i) => ({ row: i + 2, mes: normalizeMes(r[0]), saldoInicial: Number(r[1]) || 0 }))
    .filter((s) => s.mes);
  movimientos = parseMovimientos(movRows);
  presupuestoRows = presRows
    .filter((r) => r[0] && r[2])
    .map(([mes, tipo, categoria, subcategoria, monto]) => ({
      mes: normalizeMes(mes),
      tipo,
      categoria,
      subcategoria: subcategoria || "",
      monto: Number(monto) || 0,
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
