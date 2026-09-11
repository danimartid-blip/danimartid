const $ = (id) => document.getElementById(id);

const MESES = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const HORMIGA_TOPE = 5000;

function fmtCLP(n) {
  const sign = n < 0 ? "-" : "";
  return sign + "$" + Math.round(Math.abs(n)).toLocaleString("es-CL");
}

/** Los totales del período acumulan varios meses y llegan a 8 dígitos, que no
 * caben en el cuadrito. Se abrevian a millones / miles; el monto exacto queda
 * en el title del elemento para quien quiera el detalle. */
function fmtCorto(n) {
  const abs = Math.abs(n);
  if (abs < 1e5) return fmtCLP(n); // hasta 6 dígitos entra completo
  const sign = n < 0 ? "-" : "";
  const miles = Math.round(abs / 1000);
  if (miles < 1000) return `${sign}$${miles} mil`;
  return `${sign}$${(abs / 1e6).toFixed(1).replace(".", ",")}M`;
}

let movimientos = [];
let periodoMeses = 6;

function monthKey(m) {
  return `${m.año}-${String(m.mes).padStart(2, "0")}`;
}
function mesActual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function normSub(s) {
  return (s || "").trim().toLowerCase();
}

/** Filas que no son consumo real y ensucian cualquier ranking: cargos
 * duplicados que después se reversaron, castigos de incobrables y los ajustes
 * de conciliación. Se sacan de TODAS las métricas de esta página. */
const SUB_RUIDO = new Set(["duplicado", "incobrable", "ajuste"]);
const CAT_RUIDO = new Set(["ajuste conciliación", "ajuste conciliacion"]);
function esRuido(m) {
  return SUB_RUIDO.has(normSub(m.subcategoria)) || CAT_RUIDO.has(normSub(m.categoria));
}

/** Acepta "3/9/2026" y "2026-09-03". Mediodía para que el día de la semana no
 * se corra por zona horaria. */
function parseFecha(raw) {
  const s = String(raw || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d, 12);
  }
  if (s.includes("/")) {
    const [d, m, y] = s.split("/").map(Number);
    if (d && m && y) return new Date(y, m - 1, d, 12);
  }
  return null;
}

function mesesDelPeriodo() {
  const todos = [...new Set(movimientos.map(monthKey))].filter((k) => k <= mesActual()).sort();
  return todos.slice(-periodoMeses);
}

/** Días transcurridos del período: los meses completos enteros, y el mes en
 * curso solo hasta hoy (si no, el promedio diario sale siempre bajo). */
function diasDelPeriodo(meses) {
  const hoy = new Date();
  return meses.reduce((s, k) => {
    const [y, m] = k.split("-").map(Number);
    if (k === mesActual()) return s + hoy.getDate();
    return s + new Date(y, m, 0).getDate();
  }, 0);
}

/** Gasto por subcategoría, NETO de reembolso, y cuántas compras fueron.
 * El neteo sigue la convención de siempre: un Ingreso con la misma
 * categoría+subcategoría descuenta del gasto (ej. Trabajo/Starbuck), y en una
 * categoría "de a par" (un solo bucket de gasto y uno de ingreso, con
 * etiquetas distintas, ej. Pago Prestamo / Cobro prestamo) también.
 * OJO: el CONTEO no se netea — si compraste el café y te lo devolvieron, la
 * compra igual pasó, y eso es justo lo que mide esta página. */
function gastoPorSub(meses) {
  const enPeriodo = movimientos.filter((m) => meses.includes(monthKey(m)) && !esRuido(m));

  const gasto = new Map(); // "categoria|||normSub" -> { categoria, sub, bruto, n, meses:Set }
  for (const m of enPeriodo) {
    if (m.tipo !== "Gasto") continue;
    const k = `${m.categoria}|||${normSub(m.subcategoria)}`;
    const e = gasto.get(k) || { categoria: m.categoria, sub: m.subcategoria || "(sin subcategoría)", bruto: 0, reembolso: 0, n: 0, meses: new Set() };
    e.bruto += Math.abs(m.monto);
    e.n++;
    e.meses.add(monthKey(m));
    gasto.set(k, e);
  }

  const ingreso = new Map(); // mismo key -> monto
  const ingresoPorCat = new Map(); // categoria -> Map(normSub -> monto)
  for (const m of enPeriodo) {
    if (m.tipo !== "Ingreso") continue;
    const k = `${m.categoria}|||${normSub(m.subcategoria)}`;
    ingreso.set(k, (ingreso.get(k) || 0) + Math.abs(m.monto));
    if (!ingresoPorCat.has(m.categoria)) ingresoPorCat.set(m.categoria, new Map());
    const porSub = ingresoPorCat.get(m.categoria);
    porSub.set(normSub(m.subcategoria), (porSub.get(normSub(m.subcategoria)) || 0) + Math.abs(m.monto));
  }

  // Match exacto (misma etiqueta en ambos lados)
  for (const [k, e] of gasto) {
    if (ingreso.has(k)) e.reembolso += ingreso.get(k);
  }
  // "De a par": la categoría tiene UN solo bucket de gasto y UN solo bucket de
  // ingreso, con etiquetas distintas — no hay ambigüedad sobre qué netea qué.
  const gastoPorCat = new Map();
  for (const e of gasto.values()) {
    if (!gastoPorCat.has(e.categoria)) gastoPorCat.set(e.categoria, []);
    gastoPorCat.get(e.categoria).push(e);
  }
  for (const [cat, buckets] of gastoPorCat) {
    const ing = ingresoPorCat.get(cat);
    if (!ing || buckets.length !== 1 || ing.size !== 1) continue;
    const [subIng, montoIng] = [...ing][0];
    if (normSub(buckets[0].sub) === subIng) continue; // ya lo tomó el match exacto
    buckets[0].reembolso += montoIng;
  }

  for (const e of gasto.values()) e.neto = e.bruto - e.reembolso;
  return [...gasto.values()];
}

/** Categorías donde "ahorrar" no tiene sentido: son compromisos ya tomados
 * (deuda, diezmo, seguros, plata para la mamá) o directamente no son consumo
 * (ahorro). Se muestran igual en el resto de la página, pero quedan fuera del
 * cálculo de margen — sugerir "gastá menos en el dividendo" sería ruido. */
const CAT_COMPROMETIDA = new Set([
  "dividendos", "pago prestamo", "diezmo", "seguros", "mamá", "mama",
  "ahorro", "intereses", "costo tarjetas", "ofrendas",
]);

/** Gasto bruto por subcategoría y por mes: { "cat|||sub": { categoria, sub, porMes } } */
function gastoPorSubYMes(meses) {
  const out = new Map();
  for (const m of movimientos) {
    if (m.tipo !== "Gasto" || esRuido(m) || !meses.includes(monthKey(m))) continue;
    const k = `${m.categoria}|||${normSub(m.subcategoria)}`;
    const e = out.get(k) || { categoria: m.categoria, sub: m.subcategoria || "(sin subcategoría)", porMes: {} };
    e.porMes[monthKey(m)] = (e.porMes[monthKey(m)] || 0) + Math.abs(m.monto);
    out.set(k, e);
  }
  return [...out.values()];
}

/** Margen de ahorro por subcategoría: promedio mensual menos el mes más barato
 * en que sí hubo gasto. Solo para lo recurrente — en algo que pasó una vez, el
 * "mejor mes" no significa nada. */
function oportunidadesDeAhorro(meses) {
  const minMeses = Math.max(3, meses.length - 2);
  return gastoPorSubYMes(meses)
    .filter((e) => !CAT_COMPROMETIDA.has(normSub(e.categoria)))
    .map((e) => {
      const valores = meses.map((k) => e.porMes[k] || 0);
      const conGasto = valores.filter((v) => v > 0);
      const prom = valores.reduce((a, b) => a + b, 0) / meses.length;
      const mejor = conGasto.length ? Math.min(...conGasto) : 0;
      return { ...e, mesesCon: conGasto.length, prom, mejor, margen: prom - mejor };
    })
    .filter((e) => e.mesesCon >= minMeses && e.margen > 5000)
    .sort((a, b) => b.margen - a.margen);
}

function filaRanking(e, valorHtml, subtexto) {
  return `<div class="rank-row">
    <div class="rank-info">
      <div class="rank-name">${e.categoria} <span class="rank-sub">${e.sub}</span></div>
      <div class="rank-meta">${subtexto}</div>
    </div>
    <div class="rank-valor">${valorHtml}</div>
  </div>`;
}

function render() {
  const meses = mesesDelPeriodo();
  if (meses.length === 0) return;

  const enPeriodo = movimientos.filter((m) => meses.includes(monthKey(m)) && !esRuido(m));
  const subs = gastoPorSub(meses);

  const gastoTotal = subs.reduce((s, e) => s + e.neto, 0);
  const ingresoTotal = enPeriodo
    .filter((m) => m.tipo === "Ingreso")
    .reduce((s, m) => s + Math.abs(m.monto), 0);
  const reembolsoTotal = subs.reduce((s, e) => s + e.reembolso, 0);
  const dias = diasDelPeriodo(meses);

  const ingresoNeto = ingresoTotal - reembolsoTotal;
  Anim.numero($("statGasto"), gastoTotal, fmtCorto);
  Anim.numero($("statIngreso"), ingresoNeto, fmtCorto);
  $("statGasto").title = fmtCLP(gastoTotal);
  $("statIngreso").title = fmtCLP(ingresoNeto);
  Anim.numero($("statPromedioDia"), gastoTotal / dias, fmtCLP);
  $("promedioDetalle").textContent = `por día · ${dias} días · ${meses.length} ${meses.length === 1 ? "mes" : "meses"}`;

  // ---- ¿Dónde puedo ahorrar? ----
  const oportunidades = oportunidadesDeAhorro(meses);
  const margenTotal = oportunidades.reduce((s, e) => s + e.margen, 0);
  Anim.numero($("ahorroMes"), margenTotal, fmtCLP);
  Anim.numero($("ahorroAnio"), margenTotal * 12, fmtCLP);
  const maxMargen = oportunidades.length ? oportunidades[0].margen : 1;
  $("ahorroLista").innerHTML = oportunidades.length
    ? oportunidades
        .slice(0, 8)
        .map(
          (e) => `<div class="ahorro-op">
            <div class="ahorro-top">
              <span>${e.categoria} <span class="rank-sub">${e.sub}</span></span>
              <span class="cat-amounts income">${fmtCLP(e.margen)}</span>
            </div>
            <div class="bar-track"><div class="bar-fill" data-w="${Math.round((e.margen / maxMargen) * 100)}" style="width:0%"></div></div>
            <div class="rank-meta">gastás ${fmtCLP(e.prom)} al mes · tu mejor mes fue ${fmtCLP(e.mejor)}</div>
          </div>`
        )
        .join("")
    : '<div class="skeleton no-spinner">Sin gastos recurrentes suficientes para comparar</div>';
  $("ahorroNota").textContent =
    "Quedan fuera del cálculo las categorías que ya son compromisos o no son consumo: " +
    "dividendos, préstamo, diezmo, ofrendas, seguros, Mamá, ahorro, intereses y costo de tarjetas.";

  // ---- Suscripciones ----
  const minSusc = Math.max(3, Math.ceil(meses.length * 0.6));
  const suscripciones = gastoPorSubYMes(meses)
    .filter((e) => normSub(e.categoria) === "plataformas")
    .map((e) => {
      const valores = meses.map((k) => e.porMes[k] || 0);
      return { ...e, mesesCon: valores.filter((v) => v > 0).length, mensual: valores.reduce((a, b) => a + b, 0) / meses.length };
    })
    .filter((e) => e.mesesCon >= minSusc)
    .sort((a, b) => b.mensual - a.mensual);
  const totalSusc = suscripciones.reduce((s, e) => s + e.mensual, 0);
  $("suscripciones").innerHTML = suscripciones.length
    ? `<div class="ahorro-hero" style="margin-bottom:12px;">
         <div><div class="stat-label">Al mes</div><div class="stat-value" style="font-size:21px;">${fmtCLP(totalSusc)}</div></div>
         <div><div class="stat-label">Al año</div><div class="stat-value" style="font-size:21px;">${fmtCLP(totalSusc * 12)}</div></div>
       </div>` +
      suscripciones
        .map(
          (e) => `<div class="rank-row">
            <div class="rank-info">
              <div class="rank-name">${e.sub}</div>
              <div class="rank-meta">${e.mesesCon} de ${meses.length} meses</div>
            </div>
            <div class="rank-valor"><strong>${fmtCLP(e.mensual)}</strong><div class="rank-meta">al mes</div></div>
          </div>`
        )
        .join("")
    : '<div class="skeleton no-spinner">Sin suscripciones recurrentes detectadas</div>';

  // ---- ¿Se disparó algo? ----
  // Se compara el último mes CERRADO (el en curso está a medias y siempre
  // parecería que bajó todo) contra el promedio de los 3 anteriores.
  const cerrados = meses.filter((k) => k !== mesActual());
  const ultimo = cerrados[cerrados.length - 1];
  const previos = cerrados.slice(-4, -1);
  const alertas = ultimo && previos.length
    ? gastoPorSubYMes(meses)
        .map((e) => {
          const actual = e.porMes[ultimo] || 0;
          const base = previos.reduce((s, k) => s + (e.porMes[k] || 0), 0) / previos.length;
          return { ...e, actual, base, delta: actual - base };
        })
        .filter((e) => e.base > 10000 && e.actual > e.base * 1.3)
        .sort((a, b) => b.delta - a.delta)
        .slice(0, 6)
    : [];
  const [, moUlt] = (ultimo || "-").split("-");
  $("alertas").innerHTML = alertas.length
    ? alertas
        .map(
          (e) => `<div class="rank-row">
            <div class="rank-info">
              <div class="rank-name">${e.categoria} <span class="rank-sub">${e.sub}</span></div>
              <div class="rank-meta">${MESES[Number(moUlt)]}: ${fmtCLP(e.actual)} · antes venía en ${fmtCLP(e.base)}</div>
            </div>
            <div class="rank-valor"><strong class="expense">+${fmtCLP(e.delta)}</strong></div>
          </div>`
        )
        .join("")
    : `<div class="skeleton no-spinner">Nada se disparó${ultimo ? ` en ${MESES[Number(moUlt)]}` : ""} — todo dentro de lo habitual</div>`;

  // ---- Tus rituales ----
  const porDetalle = new Map();
  for (const m of enPeriodo) {
    if (m.tipo !== "Gasto" || !m.detalle) continue;
    const k = normSub(m.detalle);
    const e = porDetalle.get(k) || { txt: m.detalle, n: 0, monto: 0 };
    e.n++;
    e.monto += Math.abs(m.monto);
    porDetalle.set(k, e);
  }
  const rituales = [...porDetalle.values()]
    .filter((e) => e.n >= Math.max(4, meses.length))
    .sort((a, b) => b.monto - a.monto)
    .slice(0, 8);
  $("rituales").innerHTML = rituales.length
    ? rituales
        .map(
          (e) => `<div class="rank-row">
            <div class="rank-info">
              <div class="rank-name">${e.txt}</div>
              <div class="rank-meta">${e.n} veces · ${fmtCLP(e.monto / e.n)} cada vez</div>
            </div>
            <div class="rank-valor"><strong>${fmtCLP(e.monto / meses.length)}</strong><div class="rank-meta">al mes</div></div>
          </div>`
        )
        .join("")
    : '<div class="skeleton no-spinner">Sin compras repetidas suficientes</div>';

  // ---- Tasa de ahorro mes a mes ----
  const ahorroEl = $("tasaAhorro");
  ahorroEl.innerHTML = meses
    .map((k) => {
      const delMes = enPeriodo.filter((m) => monthKey(m) === k);
      const ing = delMes.filter((m) => m.tipo === "Ingreso").reduce((s, m) => s + Math.abs(m.monto), 0);
      const gas = delMes.filter((m) => m.tipo === "Gasto").reduce((s, m) => s + Math.abs(m.monto), 0);
      const neto = ing - gas;
      const pct = ing ? Math.round((neto / ing) * 100) : 0;
      const [y, mo] = k.split("-");
      const incompleto = k === mesActual();
      const ancho = Math.min(Math.abs(pct), 100);
      return `<div class="ahorro-row">
        <div class="ahorro-top">
          <span>${MESES[Number(mo)]} ${y}${incompleto ? ' <span class="badge badge-muted">mes en curso</span>' : ""}</span>
          <span class="cat-amounts ${neto >= 0 ? "income" : "expense"}">${fmtCLP(neto)} · ${pct}%</span>
        </div>
        <div class="bar-track"><div class="bar-fill${neto < 0 ? " over" : ""}" data-w="${ancho}" style="width:0%"></div></div>
      </div>`;
    })
    .join("");

  // ---- Fijo vs variable ----
  const umbral = Math.max(2, meses.length - 1); // presente en casi todos los meses
  const fijos = subs.filter((e) => e.meses.size >= umbral);
  const montoFijo = fijos.reduce((s, e) => s + e.neto, 0);
  const montoVariable = gastoTotal - montoFijo;
  const pctFijo = gastoTotal ? Math.round((montoFijo / gastoTotal) * 100) : 0;
  $("splitFijo").style.width = `${pctFijo}%`;
  $("montoFijo").textContent = fmtCLP(montoFijo);
  $("montoVariable").textContent = fmtCLP(montoVariable);
  $("pctFijo").textContent = `${pctFijo}%`;
  $("pctVariable").textContent = `${100 - pctFijo}%`;
  $("listaFijos").innerHTML =
    `<div class="stat-label" style="margin-bottom:6px;">Los que se repiten todos los meses</div>` +
    fijos
      .sort((a, b) => b.neto - a.neto)
      .slice(0, 8)
      .map((e) => filaRanking(e, `<strong>${fmtCLP(e.neto / meses.length)}</strong><div class="rank-meta">al mes</div>`, `${e.meses.size} de ${meses.length} meses · ${e.n} compras`))
      .join("");

  // ---- Rankings ----
  $("rankingFrecuencia").innerHTML = subs
    .slice()
    .sort((a, b) => b.n - a.n)
    .slice(0, 10)
    .map((e) => filaRanking(e, `<strong>${e.n}</strong><div class="rank-meta">compras</div>`, `ticket ${fmtCLP(e.bruto / e.n)} · total ${fmtCLP(e.neto)}`))
    .join("");

  $("rankingMonto").innerHTML = subs
    .slice()
    .sort((a, b) => b.neto - a.neto)
    .slice(0, 10)
    .map((e) => filaRanking(e, `<strong>${fmtCLP(e.neto)}</strong>`, `${e.n} compras · ticket ${fmtCLP(e.bruto / e.n)}`))
    .join("");

  // ---- Hormiga ----
  const gastosPeriodo = enPeriodo.filter((m) => m.tipo === "Gasto");
  const hormiga = gastosPeriodo.filter((m) => Math.abs(m.monto) < HORMIGA_TOPE);
  const montoHormiga = hormiga.reduce((s, m) => s + Math.abs(m.monto), 0);
  const brutoPeriodo = gastosPeriodo.reduce((s, m) => s + Math.abs(m.monto), 0);
  const pctCompras = gastosPeriodo.length ? Math.round((hormiga.length / gastosPeriodo.length) * 100) : 0;
  const pctMonto = brutoPeriodo ? Math.round((montoHormiga / brutoPeriodo) * 100) : 0;
  $("hormiga").innerHTML = `
    <div class="dual-stat">
      <div>
        <div class="stat-label">Compras chicas</div>
        <div class="stat-value" style="font-size:21px;">${hormiga.length}</div>
        <div class="rank-meta">${pctCompras}% de todas tus compras</div>
      </div>
      <div>
        <div class="stat-label">Suman</div>
        <div class="stat-value" style="font-size:21px;">${fmtCLP(montoHormiga)}</div>
        <div class="rank-meta">${pctMonto}% de tu gasto</div>
      </div>
    </div>
    <p class="card-sub" style="margin-top:12px;margin-bottom:0;">
      ${pctMonto <= 5
        ? "Son muchas compras pero poca plata: la fuga no está acá."
        : "Acá sí hay plata: vale la pena mirarlo."}
    </p>`;

  // ---- Día de la semana ----
  const porDia = Array.from({ length: 7 }, () => ({ n: 0, monto: 0 }));
  for (const m of gastosPeriodo) {
    const d = parseFecha(m.fecha);
    if (!d) continue;
    porDia[d.getDay()].n++;
    porDia[d.getDay()].monto += Math.abs(m.monto);
  }
  const maxN = Math.max(...porDia.map((d) => d.n), 1);
  const orden = [1, 2, 3, 4, 5, 6, 0]; // lunes primero
  $("porDia").innerHTML = `<div class="spark spark-nested">${orden
    .map((i) => {
      const alto = Math.max(4, Math.round((porDia[i].n / maxN) * 100));
      return `<div class="spark-col" title="${DIAS[i]}: ${porDia[i].n} compras · ${fmtCLP(porDia[i].monto)}">
        <div class="spark-bar-slot"><div class="spark-bar" style="height:${alto}%"></div></div>
        <div class="spark-label">${DIAS[i].slice(0, 3)}</div>
      </div>`;
    })
    .join("")}</div>`;

  // ---- Reembolsos y costo de tarjetas ----
  const costoTarjetas = subs
    .filter((e) => normSub(e.categoria) === "costo tarjetas")
    .reduce((s, e) => s + e.neto, 0);
  $("extras").innerHTML = `
    <div class="rank-row">
      <div class="rank-info">
        <div class="rank-name">Te reembolsaron</div>
        <div class="rank-meta">gastos que alguien te devolvió</div>
      </div>
      <div class="rank-valor"><strong class="income">${fmtCLP(reembolsoTotal)}</strong></div>
    </div>
    <div class="rank-row">
      <div class="rank-info">
        <div class="rank-name">Costo de tarjetas</div>
        <div class="rank-meta">comisiones e intereses · ${gastoTotal ? ((costoTarjetas / gastoTotal) * 100).toFixed(1) : 0}% de tu gasto</div>
      </div>
      <div class="rank-valor"><strong class="expense">${fmtCLP(costoTarjetas)}</strong></div>
    </div>`;

  Anim.barras($("content"));
}

async function loadData() {
  const rows = await window.SheetsApi.readRange("Movimientos!A2:N100000");
  movimientos = rows
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
    }))
    .filter((m) => m.fecha && m.categoria);
}

async function init() {
  if (!window.SheetsAuth.requireAuthOrRedirect()) return;

  $("loadingSkeleton").hidden = false;
  await loadData();
  $("loadingSkeleton").hidden = true;
  $("content").hidden = false;
  render();

  $("periodoSelect").addEventListener("change", (e) => {
    periodoMeses = Number(e.target.value);
    render();
  });
}

init();
