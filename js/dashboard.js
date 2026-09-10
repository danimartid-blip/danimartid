const $ = (id) => document.getElementById(id);

const MESES = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function fmtCLP(n) {
  const sign = n < 0 ? "-" : "";
  return sign + "$" + Math.round(Math.abs(n)).toLocaleString("es-CL");
}

/** Paleta de colores por categoría — evita rojos/naranjos (esos quedan
 * reservados para "excedido"). Cada categoría siempre saca el mismo color
 * (hash estable de su nombre), para que el puntito junto al nombre y el fondo
 * de su detalle al abrirla sean siempre el mismo, sesión tras sesión. */
const CATEGORY_PALETTE = [
  "#4f8fdb", // azul
  "#9575cd", // púrpura
  "#26a69a", // verde azulado
  "#d16ba5", // rosa
  "#c9a227", // dorado
  "#4fb3bf", // cian
  "#7986cb", // índigo
  "#7cb342", // verde oliva
  "#b0708a", // rosa viejo
  "#5f9ea0", // cadete
];
function colorForCategoria(nombre) {
  let hash = 0;
  for (let i = 0; i < nombre.length; i++) hash = (hash * 31 + nombre.charCodeAt(i)) >>> 0;
  return CATEGORY_PALETTE[hash % CATEGORY_PALETTE.length];
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

/** Compara subcategorías ignorando mayúsculas/espacios — para que "Pago prestamo"
 * y "Pago Prestamo" (typeos de tipeo distinto) se traten como la misma. */
function normSub(s) {
  return (s || "").trim().toLowerCase();
}

/** La única subcategoría (normalizada) de `tipo` bajo esta categoría en estos
 * meses, ignorando filas en $0 (placeholders) — o null si hay cero o más de una.
 * Sirve para detectar categorías "de a par" (ej. Pago Prestamo: lo pagas con la
 * subcategoría "Pago Prestamo" y te lo devuelven con la subcategoría "Cobro
 * prestamo" — etiquetas distintas pero sin ambigüedad de a qué se refieren,
 * porque cada lado tiene un solo bucket). No se usa cuando el Gasto tiene VARIAS
 * subcategorías (ej. Sueldo: un solo bucket de Gasto pero muchos Ingresos que no
 * tienen nada que ver — ahí NO debe aplicar, y por eso exigimos que AMBOS lados
 * sean single-bucket). */
function singleBucket(categoria, meses, tipo) {
  const set = new Set();
  for (const m of movimientos) {
    if (m.tipo === tipo && m.categoria === categoria && meses.includes(monthKey(m)) && m.monto !== 0) set.add(normSub(m.subcategoria));
  }
  return set.size === 1 ? [...set][0] : null;
}

/** Para un Gasto, separa cuánto es el gasto bruto y cuánto el reembolso que se
 * le neta ese mes (en vez de devolver solo el neto) — para mostrar la
 * "apertura" (gasto real + reembolso) en la misma línea, igual que en
 * Presupuesto. reembolsoLabel es la subcategoría real del Ingreso cuando es
 * distinta a la del Gasto (caso "categoría de a par", ej. Pago Prestamo /
 * Cobro prestamo).
 *
 * anchorMes fija la ventana de 4 meses (3 anteriores + anchorMes) usada para
 * decidir si la categoría "es de a par" — la MISMA ventana sin importar cuál
 * mes se está totalizando (mes). Si se decidiera mes a mes, un mes suelto
 * donde por coincidencia solo aparece una subcategoría de Ingreso (ej. Sueldo/
 * Cuenta remunerada en un mes sin sueldo depositado todavía) se leería como
 * "de a par" y netearía ingresos reales que no tienen nada que ver — el mismo
 * falso positivo que ya se evitó en esReembolsoDeGasto. */
function gastoMonthlyBreakdown(categoria, subcategoria, mes, anchorMes = mes) {
  const sub = normSub(subcategoria);
  const ventana = [...monthsBeforeExclusive(anchorMes, 3), anchorMes];
  const gastoBucket = singleBucket(categoria, ventana, "Gasto");
  const ingresoBucket = singleBucket(categoria, ventana, "Ingreso");
  const pairMode = gastoBucket !== null && ingresoBucket !== null && gastoBucket === sub;
  let bruto = 0;
  let reembolso = 0;
  let reembolsoLabel = null;
  for (const m of movimientos) {
    if (m.categoria !== categoria || monthKey(m) !== mes) continue;
    if (m.tipo === "Gasto" && normSub(m.subcategoria) === sub) bruto += Math.abs(m.monto);
    else if (m.tipo === "Ingreso") {
      const exact = normSub(m.subcategoria) === sub;
      const paired = pairMode && normSub(m.subcategoria) === ingresoBucket;
      if (exact || paired) {
        reembolso += m.monto;
        if (paired && !exact) reembolsoLabel = m.subcategoria;
      }
    }
  }
  return { bruto, reembolso, neto: bruto - reembolso, reembolsoLabel };
}

/** Si esta subcategoría de Gasto tiene un reembolso pareado (exacto o de
 * categoría "de a par") en el mes pedido o los 3 anteriores, arma el desglose
 * bruto/reembolso (promedio 3 meses) más si el reembolso de ESTE mes ya
 * llegó. null si no aplica — igual que subInfo().reembolso en Presupuesto,
 * para que el Dashboard muestre la misma apertura. */
function reembolsoInfoFor(categoria, subcategoria, mes) {
  const historyMonths = monthsBeforeExclusive(mes, 3);
  const allMonths = [...historyMonths, mes];
  const breakdowns = allMonths.map((mk) => gastoMonthlyBreakdown(categoria, subcategoria, mk, mes));
  if (!breakdowns.some((b) => b.reembolso !== 0)) return null;
  const hist = breakdowns.slice(0, historyMonths.length);
  const esteMes = breakdowns[breakdowns.length - 1];
  return {
    label: breakdowns.map((b) => b.reembolsoLabel).find(Boolean) || subcategoria,
    brutoAvg: hist.reduce((s, b) => s + b.bruto, 0) / historyMonths.length,
    montoAvg: hist.reduce((s, b) => s + b.reembolso, 0) / historyMonths.length,
    montoEsteMes: esteMes.reembolso,
    recibidoEsteMes: esteMes.reembolso !== 0,
  };
}

/** Gasto (o ingreso) real de una categoría en un mes. Para Gasto, NETO de
 * reembolsos: si hay un Ingreso con la MISMA categoría (y misma subcategoría,
 * si se especifica) ese mes, se descuenta — es tu propia convención para marcar
 * "esto me lo van a devolver" (ej. el café de Starbucks que te reembolsan
 * queda anotado también como Trabajo/Starbuck). subcategoria === undefined =>
 * toda la categoría junta. Un Ingreso nunca se neta contra gastos — solo aplica
 * cuando se pide el Gasto. Si la categoría es "de a par" (singleBucket en ambos
 * lados, ver arriba) también se descuenta el Ingreso aunque use otra etiqueta. */
function montoRealNeto(tipo, categoria, mes, subcategoria, anchorMes = mes) {
  if (tipo === "Gasto" && subcategoria !== undefined) return gastoMonthlyBreakdown(categoria, subcategoria, mes, anchorMes).neto;
  let total = 0;
  let reembolso = 0;
  for (const m of movimientos) {
    if (m.categoria !== categoria || monthKey(m) !== mes) continue;
    if (subcategoria !== undefined && normSub(m.subcategoria) !== normSub(subcategoria)) continue;
    if (m.tipo === tipo) total += Math.abs(m.monto);
    else if (tipo === "Gasto" && m.tipo === "Ingreso") reembolso += m.monto;
  }
  return total - reembolso;
}

/** anchorMes: mismo motivo que en gastoMonthlyBreakdown — la ventana que decide
 * si la categoría "es de a par" queda fija en el mes presupuestado, no en cada
 * uno de los 3 meses históricos que se están promediando. */
function avg3Real(tipo, categoria, subcategoria, mes) {
  const months = monthsBeforeExclusive(mes, 3);
  const totals = months.map((mk) => montoRealNeto(tipo, categoria, mk, subcategoria, mes));
  return totals.reduce((a, b) => a + b, 0) / 3;
}

/** Un Ingreso con la MISMA categoría+subcategoría que algún Gasto EN LOS MESES
 * RELEVANTES (los 3 de historial + el mes presupuestado) es un reembolso (tu
 * propia convención — ej. Trabajo/Starbuck) — ya se restó del lado del Gasto en
 * montoRealNeto. Contarlo TAMBIÉN acá lo sumaría dos veces. Acotado a esos meses
 * (no "toda la historia") para que una fila vieja y suelta no apague un ingreso
 * real recurrente (mismo criterio que Presupuesto.js). También cubre categorías
 * "de a par" con etiquetas distintas por lado (ver singleBucket). */
function esReembolsoDeGasto(categoria, subcategoria, mesesRelevantes) {
  const sub = normSub(subcategoria);
  const exact = movimientos.some(
    (m) => m.tipo === "Gasto" && m.categoria === categoria && normSub(m.subcategoria) === sub && mesesRelevantes.includes(monthKey(m))
  );
  if (exact) return true;
  const gastoBucket = singleBucket(categoria, mesesRelevantes, "Gasto");
  const ingresoBucket = singleBucket(categoria, mesesRelevantes, "Ingreso");
  return gastoBucket !== null && ingresoBucket !== null && ingresoBucket === sub;
}

/** Budgeted amount for one categoria+subcategoria: explicit override if fijado,
 * else the same 3-month-average proposal shown on the Presupuesto page. */
function budgetForSubcategoria(mes, categoria, subcategoria, tipo = "Gasto") {
  if (tipo === "Ingreso" && esReembolsoDeGasto(categoria, subcategoria, [...monthsBeforeExclusive(mes, 3), mes])) return 0;
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
  // Mapa normSub -> string representativa, para no contar "Pago prestamo" y
  // "Pago Prestamo" como dos subcategorías distintas (se sumaría el gasto 2 veces).
  const subs = new Map();
  for (const m of movimientos) {
    if (m.tipo === tipo && m.categoria === categoria && historyMonths.includes(monthKey(m))) {
      const raw = m.subcategoria || "";
      if (!subs.has(normSub(raw))) subs.set(normSub(raw), raw);
    }
  }
  for (const p of presupuestoRows) {
    if (p.mes === mes && p.tipo === tipo && p.categoria === categoria) {
      const raw = p.subcategoria || "";
      if (!subs.has(normSub(raw))) subs.set(normSub(raw), raw);
    }
  }
  if (subs.size === 0) return null;
  return [...subs.values()].reduce((s, sub) => s + budgetForSubcategoria(mes, categoria, sub, tipo), 0);
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
  // map ANTES de filter: hay que conservar el índice real para saber la fila
  // de la planilla que toca actualizar al marcar un pago.
  return rows
    .map((r, i) => ({
      fila: i + 2,
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
    }))
    .filter((m) => m.fecha);
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

/** Gasto neto por mes de una categoría (y opcionalmente subcategoría, con el
 * mismo sentinel "(sin subcategoría)" que usa el resto del dashboard), para las
 * mini-barras de tendencia. Mismo criterio de reembolso que montoRealNeto. */
function monthlyTotals(categoria, subSentinel) {
  const out = {};
  for (const m of movimientos) {
    if (m.categoria !== categoria) continue;
    if (subSentinel !== undefined && (m.subcategoria || "(sin subcategoría)") !== subSentinel) continue;
    const key = monthKey(m);
    if (m.tipo === "Gasto") out[key] = (out[key] || 0) + Math.abs(m.monto);
    else if (m.tipo === "Ingreso") out[key] = (out[key] || 0) - m.monto;
  }
  return out;
}

/** Línea de tendencia compacta (área + línea) para el nivel de CATEGORÍA — el
 * resumen "cómo se movió esto en general" al pinchar una categoría. Distinta
 * a propósito de las mini-barras de subcategoría (buildSparklineHTML): al ser
 * una línea, se reconoce de un vistazo cuál gráfico es "el principal" cuando
 * hay uno anidado adentro del otro. */
function buildTrendLineHTML(sixMonths, totalsByMonth) {
  const vals = sixMonths.map((k) => totalsByMonth[k] || 0);
  const max = Math.max(...vals, 0);
  const min = Math.min(...vals, 0);
  const range = max - min || 1;
  const w = 300;
  const h = 46;
  const padX = 3;
  const padY = 6;
  const stepX = (w - padX * 2) / (sixMonths.length - 1 || 1);
  const pts = vals.map((v, i) => [padX + stepX * i, padY + (h - padY * 2) * (1 - (v - min) / range)]);
  const fmt = (n) => n.toFixed(1);
  const lineD = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${fmt(x)},${fmt(y)}`).join(" ");
  const areaD = `${lineD} L${fmt(pts[pts.length - 1][0])},${h - padY} L${fmt(pts[0][0])},${h - padY} Z`;
  const gradId = `tlg${Math.random().toString(36).slice(2, 9)}`;
  const dots = pts
    .map(([x, y], i) => {
      const isLast = i === pts.length - 1;
      return `<circle cx="${fmt(x)}" cy="${fmt(y)}" r="${isLast ? 3.2 : 2}" fill="var(--series-1)" ${isLast ? "" : 'opacity=".5"'}><title>${MESES[Number(sixMonths[i].split("-")[1])]}: ${fmtCLP(vals[i])}</title></circle>`;
    })
    .join("");
  const labels = sixMonths
    .map((k, i) => {
      const [, mo] = k.split("-");
      const isLast = i === sixMonths.length - 1;
      return `<div class="trend-line-label${isLast ? " active" : ""}">${MESES[Number(mo)]}</div>`;
    })
    .join("");
  return `
    <div class="trend-line-wrap">
      <svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none">
        <defs>
          <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--series-1)" stop-opacity=".32"/>
            <stop offset="100%" stop-color="var(--series-1)" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <path d="${areaD}" fill="url(#${gradId})" stroke="none"/>
        <path d="${lineD}" fill="none" stroke="var(--series-1)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        ${dots}
      </svg>
      <div class="trend-line-labels">${labels}</div>
    </div>`;
}

/** Mini-barras de 6 meses (con etiquetas), MÁS CHICAS que el gráfico de línea de
 * categoría — para el nivel de SUBCATEGORÍA anidado adentro de una categoría ya
 * abierta. El estilo "nested" (más chico, con acento a la izquierda) las separa
 * visualmente del gráfico principal para que no se vea todo apilado igual. */
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
  return `<div class="spark spark-nested">${cols}</div>`;
}

const escapeAttr = (s) => String(s).replace(/"/g, "&quot;");

/** A clickable subcategory row; its own 6-month sparkline + transaction list build lazily on first click. */
function buildSubcategoryRow(cat, sub, subMonto, selectedKey) {
  const rowId = `sub-${cat}-${sub}`.replace(/[^a-zA-Z0-9]/g, "");
  const subReal = sub === "(sin subcategoría)" ? "" : sub;
  const subMeta = budgetForSubcategoria(selectedKey, cat, subReal);
  // Nota: la apertura de gasto+reembolso (bruto/reembolso/recibido-o-no) ya no
  // se muestra acá como resumen — vive en el detalle que se abre al pinchar la
  // fila (wireSubcategoryToggles ya incluye ahí los movimientos del reembolso
  // pareado). Acá se mantiene todo parejo: monto + "de $meta" siempre con la
  // misma forma, y una barra siempre presente (vacía si no hay presupuesto),
  // para que ninguna fila se vea distinta a las demás.
  const hasMeta = subMeta !== null && subMeta > 0;
  const pct = hasMeta ? Math.round((subMonto / subMeta) * 100) : null;
  return `
    <div class="category-row-top cat-clickable sub-clickable" data-cat="${escapeAttr(cat)}" data-sub="${escapeAttr(sub)}" data-key="${selectedKey}" data-target="${rowId}" style="padding:8px 0;font-size:13px;">
      <span style="color:var(--text-secondary)">${sub}</span>
      <span class="cat-amounts">${fmtCLP(subMonto)} <span class="meta">${hasMeta ? `de ${fmtCLP(subMeta)}` : "sin ppto."}</span></span>
    </div>
    <div class="bar-track bar-track-sub">${hasMeta ? `<div class="bar-fill${pct > 100 ? " over" : ""}" style="width:${Math.min(pct, 100)}%"></div>` : ""}</div>
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
        const subReal = sub === "(sin subcategoría)" ? "" : sub;
        const sparkline = buildSparklineHTML(
          monthsBackFrom(key, 6),
          monthlyTotals(cat, sub)
        );
        // Incluye los reembolsos junto a los gastos, para que se vea CONTRA QUÉ
        // se está netando el total de arriba — la subcategoría del reembolso
        // pareado puede tener otra etiqueta (ej. Cobro prestamo vs Pago Prestamo).
        const reembolso = reembolsoInfoFor(cat, subReal, key);
        const subsAMostrar = new Set([normSub(subReal)]);
        if (reembolso) subsAMostrar.add(normSub(reembolso.label));
        const items = movimientos
          .filter(
            (m) =>
              (m.tipo === "Gasto" || m.tipo === "Ingreso") &&
              m.categoria === cat &&
              subsAMostrar.has(normSub(m.subcategoria)) &&
              monthKey(m) === key
          )
          .sort((a, b) => (a.fecha < b.fecha ? 1 : -1))
          .map(
            (m) => `<div class="category-row-top" style="padding:5px 0;font-size:12px;">
              <span style="color:var(--text-muted)">
                ${formatFechaCorta(m.fecha)} · ${m.detalle || "—"}
                ${m.tipo === "Ingreso" ? '<span class="badge badge-good" style="margin-left:4px;">reembolso</span>' : ""}
              </span>
              <span class="cat-amounts ${m.tipo === "Ingreso" ? "income" : ""}">${m.tipo === "Ingreso" ? "−" : ""}${fmtCLP(Math.abs(m.monto))}</span>
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

  // Categorías (gasto neto de reembolsos) vs presupuesto — todas, sin recortar.
  // Solo se listan categorías con al menos un Gasto este mes (un reembolso solo,
  // sin gasto que reembolsar, no pinta acá — igual entra al Balance como ingreso).
  const categoriasConGasto = new Set(inMonth.filter((m) => m.tipo === "Gasto").map((m) => m.categoria));
  const byCat = {};
  for (const cat of categoriasConGasto) byCat[cat] = montoRealNeto("Gasto", cat, selectedKey);
  const sorted = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const list = $("categoryList");
  list.innerHTML = "";
  if (sorted.length === 0) {
    list.innerHTML = '<div class="skeleton no-spinner">Sin gastos este mes</div>';
  }
  for (const [cat, monto] of sorted) {
    const meta = budgetForCategoria(selectedKey, cat);
    const hasMeta = meta !== null && meta > 0;
    const pct = hasMeta ? Math.round((monto / meta) * 100) : null;
    const row = document.createElement("div");
    row.className = "category-row";
    row.style.setProperty("--cat-color", colorForCategoria(cat));

    const sparkline = buildTrendLineHTML(
      monthsBackFrom(selectedKey, 6),
      monthlyTotals(cat)
    );

    // Subcategorías de esta categoría, en el mes seleccionado — netas de reembolso.
    const subsConGasto = new Set(
      inMonth.filter((m) => m.tipo === "Gasto" && m.categoria === cat).map((m) => m.subcategoria || "(sin subcategoría)")
    );
    const bySub = {};
    for (const sub of subsConGasto) {
      bySub[sub] = montoRealNeto("Gasto", cat, selectedKey, sub === "(sin subcategoría)" ? "" : sub);
    }
    const subRows = Object.entries(bySub)
      .sort((a, b) => b[1] - a[1])
      .map(([sub, subMonto]) => buildSubcategoryRow(cat, sub, subMonto, selectedKey))
      .join("");

    row.innerHTML = `
      <div class="category-row-top cat-clickable">
        <span class="cat-name">${cat}</span>
        <span class="cat-amounts">${fmtCLP(monto)} <span class="meta">${hasMeta ? `de ${fmtCLP(meta)}` : "sin ppto."}</span></span>
      </div>
      <div class="bar-track">${hasMeta ? `<div class="bar-fill${pct > 100 ? " over" : ""}" style="width:${Math.min(pct, 100)}%"></div>` : ""}</div>
      <div class="cat-detail" hidden>
        <div>${sparkline}</div>
        <div style="margin-top:10px;">${subRows || '<div class="skeleton no-spinner" style="padding:8px 0;">Sin movimientos este mes</div>'}</div>
      </div>`;

    row.querySelector(".cat-clickable").addEventListener("click", () => {
      row.querySelector(".cat-detail").hidden = !row.querySelector(".cat-detail").hidden;
    });
    wireSubcategoryToggles(row);
    list.appendChild(row);
  }

  // Por pagar (global, no filtrado por mes). Neto CON SIGNO: un "por pagar"
  // positivo es plata que te deben (un préstamo que hiciste) y descuenta deuda,
  // no la suma. Sumarlo en absoluto inflaba la deuda al doble de esos montos.
  const pendientes = movimientos.filter((m) => m.estado === "Por pagar");
  const porPagar = -pendientes.reduce((s, m) => s + m.monto, 0);
  $("statPorPagar").textContent = fmtCLP(porPagar);

  // Liquidez neta real = saldo en cuentas - lo pendiente por pagar
  const totalCuentas = cuentas.reduce((s, c) => s + c.saldo, 0);
  const liquidez = totalCuentas - porPagar;

  renderLiquidezPresupuestada(selectedKey, liquidez);
  renderConciliacion(selectedKey);
  renderPorPagarDetail(pendientes);
}

/** Protagonista: con cuánto terminarías si cumples el presupuesto del mes filtrado.
 * La liquidez real de hoy queda como dato secundario debajo. */
function renderLiquidezPresupuestada(selectedKey, liquidezReal) {
  const grande = $("statLiquidezPpto");
  const linea = $("liquidezRealLine");
  const label = $("liquidezPptoLabel");
  const help = $("liquidezHelp");

  const ingresoPpto = totalBudgetForTipo("Ingreso", selectedKey);
  const gastoPpto = totalBudgetForTipo("Gasto", selectedKey);
  const hayPpto = ingresoPpto !== 0 || gastoPpto !== 0;

  if (!hayPpto) {
    label.textContent = "Liquidez neta real";
    grande.textContent = fmtCLP(liquidezReal);
    grande.className = "stat-value stat-value-hero " + (liquidezReal >= 0 ? "income" : "expense");
    linea.textContent = "Sin presupuesto para este mes";
    linea.style.color = "var(--text-muted)";
    help.textContent = "Saldo en cuentas menos lo pendiente por pagar.";
    return;
  }

  const [y, mo] = selectedKey.split("-");
  const nombreMes = `${MESES[Number(mo)]} ${y}`;

  // Un mes pasado no se puede "proyectar": la liquidez real de hoy ya incluye
  // todo lo que vino después. Mostramos la real y lo decimos.
  if (selectedKey < mesActual()) {
    label.textContent = "Liquidez neta real";
    grande.textContent = fmtCLP(liquidezReal);
    grande.className = "stat-value stat-value-hero " + (liquidezReal >= 0 ? "income" : "expense");
    linea.innerHTML = `${nombreMes} ya pasó`;
    linea.style.color = "var(--text-muted)";
    help.textContent = "La proyección solo aplica al mes en curso o a meses futuros.";
    return;
  }

  // Clave: la liquidez real ya trae los movimientos reales del mes (los pagados
  // bajaron el saldo, los por pagar subieron la deuda). Si le sumáramos el
  // presupuesto completo encima, ese mes se contaría dos veces. Entonces se
  // retrocede a la liquidez previa al mes y se aplica SOLO el presupuesto.
  const delMes = movimientos.filter((m) => monthKey(m) === selectedKey);
  const realIngresos = delMes.filter((m) => m.tipo === "Ingreso").reduce((s, m) => s + Math.abs(m.monto), 0);
  const realGastos = delMes.filter((m) => m.tipo === "Gasto").reduce((s, m) => s + Math.abs(m.monto), 0);
  const liquidezAntesDelMes = liquidezReal - (realIngresos - realGastos);

  const resultadoPpto = ingresoPpto - gastoPpto;
  const liquidezPpto = liquidezAntesDelMes + resultadoPpto;

  label.textContent = `Liquidez proyectada · ${nombreMes}`;
  grande.textContent = fmtCLP(liquidezPpto);
  grande.className = "stat-value stat-value-hero " + (liquidezPpto >= 0 ? "income" : "expense");

  linea.innerHTML = `Saldo actual: <strong>${fmtCLP(liquidezReal)}</strong>`;
  linea.style.color = liquidezReal >= 0 ? "var(--good)" : "var(--critical)";
  help.textContent = `Con cuánto cierras ${nombreMes} si cumples el presupuesto: al saldo actual se le quita lo real del mes (${fmtCLP(realIngresos - realGastos)}) y se le aplica el neto presupuestado (${fmtCLP(resultadoPpto)}).`;
}

function renderPorPagarDetail(pendientes) {
  const withDate = pendientes
    .map((m) => ({ ...m, venc: parseFechaVenc(m.fechaVencimiento) }))
    .filter((m) => m.venc);

  // Por período (mes de vencimiento)
  const byPeriod = {};
  for (const m of withDate) {
    const key = `${m.venc.getFullYear()}-${String(m.venc.getMonth() + 1).padStart(2, "0")}`;
    byPeriod[key] = (byPeriod[key] || 0) - m.monto; // con signo, igual que el total
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

  renderPagarTarjetas(pendientes);
}

/** Pagar un estado de cuenta: agrupa lo pendiente por tarjeta + fecha de
 * vencimiento (que es justo lo que llega en una factura), marca esos movimientos
 * como Pagado y registra la diferencia (comisiones, gastos administrativos) que
 * el banco agrega al facturar y que nunca calza con lo registrado. */
function renderPagarTarjetas(pendientes) {
  const cont = $("pagarTarjetas");
  cont.innerHTML = "";

  const grupos = {};
  for (const m of pendientes) {
    const medio = m.medioPago || "(sin medio de pago)";
    const venc = m.fechaVencimiento || "(sin fecha)";
    const k = `${medio}|||${venc}`;
    (grupos[k] ||= { medio, venc, movs: [] }).movs.push(m);
  }

  const porVenc = (a, b) => {
    const da = parseFechaVenc(a.venc), db = parseFechaVenc(b.venc);
    return da && db ? da - db : 0;
  };
  // Un total negativo es al revés de una deuda de tarjeta: es plata que TE deben
  // (un préstamo que hiciste), no plata que tú debes.
  const aPagar = Object.values(grupos).filter((g) => -g.movs.reduce((s, m) => s + m.monto, 0) >= 0).sort(porVenc);
  const aCobrar = Object.values(grupos).filter((g) => -g.movs.reduce((s, m) => s + m.monto, 0) < 0).sort(porVenc);

  if (aPagar.length === 0 && aCobrar.length === 0) {
    cont.innerHTML = '<div class="skeleton no-spinner">Nada pendiente</div>';
    return;
  }

  const seccion = (titulo, grupos_, esCobrar) => {
    if (grupos_.length === 0) return "";
    const filas = grupos_.map((g) => filaGrupo(g, esCobrar)).join("");
    return `<div class="card-title" style="margin:14px 0 6px;">${titulo}</div>${filas}`;
  };
  cont.innerHTML = seccion("Por cobrar", aCobrar, true) + seccion("Por pagar", aPagar, false);

  // Los data-target quedaron en el HTML recién insertado — engancha los clicks ahora.
  for (const g of [...aCobrar, ...aPagar]) {
    const id = g._id;
    const wrap = cont.querySelector(`[data-wrap="${id}"]`);
    const panel = cont.querySelector(`#${id}`);
    wrap.querySelector(".cat-clickable").addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      if (!panel.hidden && !panel.dataset.listo) {
        panel.dataset.listo = "1";
        const total = -g.movs.reduce((s, m) => s + m.monto, 0);
        if (total < 0) renderPanelCobrar(panel, g, Math.abs(total));
        else renderPanelPago(panel, g, total);
      }
    });
  }
}

function filaGrupo(g, esCobrar) {
  const total = Math.abs(-g.movs.reduce((s, m) => s + m.monto, 0));
  const id = `pg${++pagoUid}`;
  g._id = id;
  // El vencimiento va destacado: dos cuotas del mismo monto solo se distinguen por eso.
  const venc = parseFechaVenc(g.venc);
  const vencido = !esCobrar && venc && venc < new Date(new Date().toDateString());
  return `
    <div class="category-row" data-wrap="${id}">
      <div class="category-row-top cat-clickable" data-target="${id}">
        <span class="cat-name">${g.medio}</span>
        <span class="cat-amounts">${fmtCLP(total)}</span>
      </div>
      <div style="font-size:11.5px;margin-top:4px;display:flex;align-items:center;gap:7px;flex-wrap:wrap;">
        <span class="badge ${vencido ? "badge-critical" : "badge-muted"}">vence ${g.venc}</span>
        <span style="color:var(--text-muted)">${g.movs.length} movimiento${g.movs.length === 1 ? "" : "s"}</span>
      </div>
      <div class="sub-detail" id="${id}" hidden style="margin-top:10px;"></div>
    </div>`;
}

let pagoUid = 0;

/** La categoría/subcategoría más repetida del grupo, para prellenar los nuevos
 * movimientos con lo mismo que ya venías usando para este préstamo/cobro. */
function categoriaDominante(movs) {
  const cnt = {};
  for (const m of movs) {
    const k = `${m.categoria}|||${m.subcategoria || ""}`;
    cnt[k] = (cnt[k] || 0) + 1;
  }
  const [top] = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
  const [categoria, subcategoria] = top[0].split("|||");
  return { categoria, subcategoria };
}

/** Un grupo "por cobrar": no le debes a un banco, alguien te debe a ti (un
 * préstamo que hiciste). No aplica "¿cuánto pagaste?" — aplica registrar lo que
 * te van abonando, o aceptar que una parte no se va a cobrar. Ambas acciones
 * quedan como una fila que descuenta del pendiente (igual que ya hacían tus
 * propios "Recupero dinero" en el histórico) más el movimiento real que
 * corresponde: un ingreso si te pagaron, un gasto si lo das por perdido. */
function renderPanelCobrar(panel, grupo, totalCobrar) {
  const { categoria, subcategoria } = categoriaDominante(grupo.movs);
  const cuentasOpts = cuentas.map((c) => `<option value="${c.nombre}"></option>`).join("");
  const detalle = grupo.movs
    .slice()
    .sort((a, b) => (a.fecha < b.fecha ? 1 : -1))
    .map(
      (m) => `<div class="category-row-top" style="padding:5px 0;font-size:11.5px;">
        <span style="color:var(--text-secondary)">
          <strong>${m.detalle || m.categoria}</strong>
          <span style="color:var(--text-muted)"> · ${m.fecha}</span>
        </span>
        <span class="cat-amounts">${fmtCLP(Math.abs(m.monto))}</span>
      </div>`
    )
    .join("");

  panel.innerHTML = `
    <div style="font-size:11.5px;color:var(--text-muted);margin-bottom:6px;">
      <strong>${grupo.medio}</strong> te debe — historial de este préstamo/cobro:
    </div>
    ${detalle}

    <div style="display:flex;gap:8px;margin-top:14px;">
      <button class="btn-secondary tab-abono active" style="flex:1;">Registrar abono</button>
      <button class="btn-secondary tab-castigo" style="flex:1;">Castigar incobrable</button>
    </div>

    <div class="bloque-abono" style="margin-top:12px;">
      <label>¿Cuánto te abonaron?</label>
      <input type="number" inputmode="numeric" class="monto-abono" placeholder="0" value="${Math.round(totalCobrar)}">
      <label>¿En qué cuenta te llegó?</label>
      <input type="text" class="cuenta-abono" list="cuentasAbonoList" placeholder="Ej: Efectivo, Mercado Pago" autocomplete="off">
      <datalist id="cuentasAbonoList">${cuentasOpts}</datalist>
      <button class="btn-primary btn-registrar-abono" style="margin-top:14px;">Registrar abono</button>
    </div>

    <div class="bloque-castigo" hidden style="margin-top:12px;">
      <p style="font-size:11.5px;color:var(--text-muted);line-height:1.5;margin:0 0 8px;">
        Da por perdida esta parte de la deuda. Queda registrada como gasto real (así tu liquidez refleja
        la pérdida), y sale del pendiente por cobrar. No mueve el saldo de ninguna cuenta.
      </p>
      <label>¿Cuánto vas a castigar?</label>
      <input type="number" inputmode="numeric" class="monto-castigo" placeholder="0" value="${Math.round(totalCobrar)}">
      <button class="btn-primary btn-registrar-castigo" style="margin-top:14px;background:var(--critical);">Castigar como incobrable</button>
    </div>
  `;

  const tabAbono = panel.querySelector(".tab-abono");
  const tabCastigo = panel.querySelector(".tab-castigo");
  const bloqueAbono = panel.querySelector(".bloque-abono");
  const bloqueCastigo = panel.querySelector(".bloque-castigo");
  tabAbono.addEventListener("click", (e) => {
    e.stopPropagation();
    tabAbono.classList.add("active"); tabCastigo.classList.remove("active");
    bloqueAbono.hidden = false; bloqueCastigo.hidden = true;
  });
  tabCastigo.addEventListener("click", (e) => {
    e.stopPropagation();
    tabCastigo.classList.add("active"); tabAbono.classList.remove("active");
    bloqueCastigo.hidden = false; bloqueAbono.hidden = true;
  });

  /** Dos movimientos: uno que descuenta del pendiente (mismo mecanismo que ya
   * usa tu histórico), y el real (ingreso o gasto) que corresponde. */
  const registrarCobro = async (btn, { monto, tipoReal, detalleReal, medioReal }) => {
    if (!monto || monto <= 0) return showToast("Monto inválido", true);
    const textoOriginal = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Registrando…";
    const hoyISO = new Date().toISOString().slice(0, 10);
    const [yyyy, mm] = hoyISO.split("-");
    try {
      // 1) descuenta del pendiente por cobrar (queda dentro del mismo grupo)
      await window.SheetsApi.appendRow(
        "Movimientos!A:N",
        [hoyISO, yyyy, String(Number(mm)), "Gasto", categoria, subcategoria, grupo.medio, "Por pagar",
          -monto, detalleReal, grupo.venc, "", "", ""],
        "RAW"
      );
      // 2) el movimiento real: ingreso si te pagaron, gasto si lo diste por perdido.
      // Un castigo usa la subcategoría "Incobrable" — es una marca, no solo texto:
      // la Conciliación la excluye de "lo pagado", porque no salió plata de ningún
      // banco real (solo cuenta como pérdida en tu liquidez/presupuesto).
      const subReal = tipoReal === "Gasto" ? "Incobrable" : subcategoria;
      await window.SheetsApi.appendRow(
        "Movimientos!A:N",
        [hoyISO, yyyy, String(Number(mm)), tipoReal, categoria, subReal, medioReal, "Pagado",
          tipoReal === "Gasto" ? -monto : monto, detalleReal, "", "", "", ""],
        "RAW"
      );
      await loadData();
      renderStats($("monthSelect").value);
      renderPatrimonio();
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      btn.textContent = textoOriginal;
    }
  };

  panel.querySelector(".btn-registrar-abono").addEventListener("click", async (e) => {
    e.stopPropagation();
    const monto = Number(panel.querySelector(".monto-abono").value);
    const cuenta = panel.querySelector(".cuenta-abono").value.trim();
    if (!cuenta) return showToast("Falta la cuenta donde te llegó", true);
    if (!confirm(`Se registrará un abono de ${fmtCLP(monto)} recibido en ${cuenta}.\n\nRecuerda actualizar después el saldo real de esa cuenta en la pestaña Cuentas.\n\n¿Continuar?`)) return;
    await registrarCobro(e.currentTarget, {
      monto, tipoReal: "Ingreso", medioReal: cuenta, detalleReal: `Abono recibido de ${grupo.medio}`,
    });
  });

  panel.querySelector(".btn-registrar-castigo").addEventListener("click", async (e) => {
    e.stopPropagation();
    const monto = Number(panel.querySelector(".monto-castigo").value);
    if (!confirm(`Se castigará ${fmtCLP(monto)} como incobrable de ${grupo.medio} — quedará registrado como gasto real. ¿Continuar?`)) return;
    await registrarCobro(e.currentTarget, {
      monto, tipoReal: "Gasto", medioReal: grupo.medio, detalleReal: `Castigo incobrable ${grupo.medio}`,
    });
  });
}

function renderPanelPago(panel, grupo, total) {
  const detalle = grupo.movs
    .slice()
    .sort((a, b) => Math.abs(b.monto) - Math.abs(a.monto))
    .slice(0, 8)
    .map(
      (m) => `<div class="category-row-top" style="padding:5px 0;font-size:11.5px;">
        <span style="color:var(--text-secondary)">
          <strong>${m.detalle || m.categoria}</strong>
          <span style="color:var(--text-muted)"> · ${m.fecha}</span>
        </span>
        <span class="cat-amounts">${fmtCLP(Math.abs(m.monto))}</span>
      </div>`
    )
    .join("");
  const resto = grupo.movs.length > 8 ? `<div style="font-size:11px;color:var(--text-muted);padding-top:4px;">+ ${grupo.movs.length - 8} más…</div>` : "";

  panel.innerHTML = `
    <div style="font-size:11.5px;color:var(--text-muted);margin-bottom:6px;">
      Estado de cuenta de <strong>${grupo.medio}</strong> con vencimiento <strong>${grupo.venc}</strong>
    </div>
    ${detalle}${resto}
    <label style="margin-top:12px;">¿Cuánto pagaste?</label>
    <input type="number" inputmode="numeric" class="monto-pagado" value="${Math.round(total)}">
    <div class="dif-pago" style="font-size:12px;margin:8px 0;color:var(--text-muted);"></div>
    <div class="dif-destino" hidden>
      <label style="margin-top:4px;">La diferencia va como</label>
      <select class="destino-select">
        <option value="Costo tarjetas">Costo tarjetas (comisión / gasto administrativo)</option>
        <option value="Intereses">Intereses</option>
        <option value="Ajuste conciliación">Ajuste conciliación</option>
      </select>
    </div>
    <button class="btn-primary registrar-pago" style="margin-top:14px;">Registrar pago</button>`;

  const input = panel.querySelector(".monto-pagado");
  const difEl = panel.querySelector(".dif-pago");
  const destinoBox = panel.querySelector(".dif-destino");

  const refrescarDif = () => {
    const pagado = Number(input.value) || 0;
    const dif = pagado - total;
    destinoBox.hidden = Math.abs(dif) < 1;
    if (Math.abs(dif) < 1) {
      difEl.innerHTML = `<span class="badge badge-good">calza exacto</span>`;
    } else if (dif > 0) {
      difEl.innerHTML = `Pagaste <strong>${fmtCLP(dif)}</strong> de más — se registrará como gasto extra.`;
      difEl.style.color = "var(--serious)";
    } else {
      difEl.innerHTML = `Pagaste <strong>${fmtCLP(-dif)}</strong> de menos — se registrará como abono a favor.`;
      difEl.style.color = "var(--text-muted)";
    }
  };
  input.addEventListener("input", refrescarDif);
  refrescarDif();

  panel.querySelector(".registrar-pago").addEventListener("click", async (e) => {
    e.stopPropagation();
    const btn = e.currentTarget;
    const pagado = Number(input.value) || 0;
    const dif = Math.round(pagado - total);
    const destino = panel.querySelector(".destino-select").value;

    const msg = `${grupo.medio} · vencimiento ${grupo.venc}\n\n` +
      `Se marcarán ${grupo.movs.length} movimientos como Pagado (${fmtCLP(total)})` +
      (Math.abs(dif) >= 1 ? `\ny se registrará ${fmtCLP(Math.abs(dif))} como "${destino}".` : ".") +
      `\n\nRecuerda actualizar después el saldo de la cuenta desde donde pagaste.`;
    if (!confirm(msg)) return;

    btn.disabled = true;
    btn.textContent = "Registrando…";
    try {
      // 1) marcar los pendientes como pagados (columna H)
      await window.SheetsApi.batchUpdateValues(
        grupo.movs.map((m) => ({ range: `Movimientos!H${m.fila}`, values: [["Pagado"]] })),
        "RAW"
      );

      // 2) la comisión / diferencia como movimiento propio, ya pagado
      if (Math.abs(dif) >= 1) {
        const hoyISO = new Date().toISOString().slice(0, 10);
        const [yyyy, mm] = hoyISO.split("-");
        await window.SheetsApi.appendRow(
          "Movimientos!A:N",
          [
            hoyISO, yyyy, String(Number(mm)),
            dif > 0 ? "Gasto" : "Ingreso",
            destino, grupo.medio, grupo.medio, "Pagado",
            dif > 0 ? -Math.abs(dif) : Math.abs(dif),
            `Diferencia al pagar ${grupo.medio}`,
            "", "", "", "",
          ],
          "RAW"
        );
      }

      await loadData();
      renderStats($("monthSelect").value);
      renderPatrimonio();
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      btn.textContent = "Registrar pago";
    }
  });
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
  const saldoReal = cuentas.reduce((s, c) => s + c.saldo, 0);

  // Modelo acumulado (el mismo del Resumen original): la suma de TODO lo pagado
  // desde siempre debe igualar el saldo de las cuentas. Es inmune al mes en que
  // se hizo la compra: un "por pagar" entra al acumulado justo cuando se paga,
  // que es cuando la plata sale del banco. Conciliar por mes fallaba en cada
  // pago de tarjeta, porque se paga en un mes lo comprado en otro.
  // Excluye los castigos de incobrables: quedan Pagado (afectan tu liquidez y el
  // presupuesto como pérdida real), pero no salió plata de ninguna cuenta, así
  // que no deben entrar a la cuadratura contra el saldo bancario.
  const pagados = movimientos.filter(
    (m) => (m.estado || "").trim() === "Pagado" && m.subcategoria !== "Incobrable"
  );
  const esperado = pagados.reduce((s, m) => s + m.monto, 0);
  const ingresos = pagados.filter((m) => m.tipo === "Ingreso").reduce((s, m) => s + Math.abs(m.monto), 0);
  const gastos = pagados.filter((m) => m.tipo === "Gasto").reduce((s, m) => s + Math.abs(m.monto), 0);
  const diff = saldoReal - esperado;

  const abs = Math.abs(diff);
  let badge, clase;
  if (abs < 10) { badge = "conciliado"; clase = "badge-good"; }
  else if (abs < 1000) { badge = "diferencia menor"; clase = "badge-warning"; }
  else { badge = "revisar"; clase = "badge-critical"; }

  const fila = (etiqueta, valor, extra = "") =>
    `<div class="category-row-top" style="padding:7px 0;font-size:13.5px;${extra}">
      <span style="color:var(--text-secondary)">${etiqueta}</span>
      <span class="cat-amounts">${valor}</span>
    </div>`;

  body.innerHTML = `
    ${fila("Ingresos pagados (histórico)", `<span class="income">${fmtCLP(ingresos)}</span>`)}
    ${fila("− Gastos pagados (histórico)", `<span class="expense">${fmtCLP(gastos)}</span>`)}
    ${fila("= Saldo contable", `<strong>${fmtCLP(esperado)}</strong>`, "border-top:1px solid var(--grid);")}
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
      Compara <strong>todo lo pagado desde siempre</strong> contra el saldo real de tus cuentas.
      Lo que está "por pagar" no cuenta: aún no sale del banco. Cuando pagas una tarjeta,
      esos movimientos entran acá automáticamente.
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
  const [movRows, presRows, cuentasRows] = await Promise.all([
    window.SheetsApi.readRange("Movimientos!A2:N100000"),
    window.SheetsApi.readRange("Presupuesto!A2:E10000"),
    window.SheetsApi.readRange("Cuentas!A2:C1000"),
  ]);
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

  $("porPagarToggle").addEventListener("click", () => {
    const detail = $("porPagarDetail");
    detail.hidden = !detail.hidden;
    $("porPagarToggle").textContent = detail.hidden ? "Ver detalle por banco/tarjeta ▾" : "Ocultar ▴";
  });
}

init();
