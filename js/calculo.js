// Lógica de cálculo COMPARTIDA entre el Dashboard y Registrar: qué cuenta como gasto
// real, cuánto hay presupuestado y cuánto llevas consumido. Vive aparte para que las
// dos pantallas lean EXACTAMENTE los mismos números (antes estaba dentro de
// dashboard.js; no se copió, se movió). Son scripts clásicos: comparten el ámbito
// global, así que dashboard.js y registro.js usan estas funciones sin importarlas.
// Se carga ANTES que dashboard.js / registro.js. No toca el DOM.

let movimientos = []; // { fecha, año, mes, tipo, categoria, subcategoria, medioPago, estado, monto, detalle }
let presupuestoRows = []; // { mes, tipo, categoria, subcategoria, monto }
let cuentas = []; // { nombre, saldo }

/** Filas que son el CONTRA-ASIENTO de un cobro (el Gasto negativo que baja un
 * "por cobrar" cuando te abonan o castigás). No son gasto real: la plata nunca
 * salió, solo se está cancelando algo que te debían. Contarlas como gasto
 * inflaba el mes al doble en cada castigo (un castigo de $20.000 se leía como
 * $40.000) y subía la liquidez al castigar, que es justo al revés. Se recalcula
 * en loadData, con separarPendientes. */
let filasDeHilo = new Set();

/** Filas de TRASPASO con el ahorro que se anulan entre sí dentro del mes: el
 * "Retiro Ahorro/Bono" (Ingreso) y el Gasto de Ahorro con que lo devuelves. Tus
 * ahorros no están en la planilla, así que sacar plata y volver a meterla es
 * solo cambiarla de bolsillo: no es ingreso ni es gasto, y no puede aparecer
 * como "gastaste de más" en una categoría sin presupuesto. Se recalcula en
 * loadData con emparejarTraspasosAhorro. */
let filasTraspaso = new Set();

/** Fila que no cuenta como ingreso/gasto real del mes: el contra-asiento de un
 * cobro o un traspaso con el ahorro ya devuelto. (El basurero sigue mirando solo
 * filasDeHilo: un traspaso sí se puede borrar a mano.) */
const esFilaAparte = (fila) => filasDeHilo.has(fila) || filasTraspaso.has(fila);

/** Lo que de verdad queda por cobrar de un Ingreso pendiente que abrió un cobro:
 * su monto menos lo ya abonado o castigado (los contra-asientos de filasDeHilo).
 * Sin esto, al saldarse un préstamo el Ingreso original ($1M) y el pago recibido
 * ($1M) se leían los dos como reembolso del mismo Gasto — $2M devueltos de un
 * préstamo de $1M, con la liquidez $1M más abajo. fila -> monto vivo. */
let ingresoVivo = new Map();
const montoIngresoVivo = (m) => (ingresoVivo.has(m.fila) ? ingresoVivo.get(m.fila) : m.monto);

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
    if (esFilaAparte(m.fila)) continue; // contra-asiento de un cobro o traspaso con el ahorro
    if (m.tipo === "Gasto" && normSub(m.subcategoria) === sub) bruto += Math.abs(m.monto);
    else if (m.tipo === "Ingreso") {
      const exact = normSub(m.subcategoria) === sub;
      const paired = pairMode && normSub(m.subcategoria) === ingresoBucket;
      if (exact || paired) {
        reembolso += montoIngresoVivo(m);
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
 * toda la categoría junta (suma de cada subcategoría de Gasto presente ese
 * mes, cada una neta de SU propio reembolso validado — nunca "todo el Ingreso
 * de la categoría resta del Gasto" sin más: eso rompía con categorías como
 * Sueldo, donde el sueldo real de un mes sin ningún Gasto quedaba restando y
 * daba un "gasto" negativo absurdo). Un Ingreso nunca se neta contra gastos —
 * solo aplica cuando se pide el Gasto. */
function montoRealNeto(tipo, categoria, mes, subcategoria, anchorMes = mes) {
  if (tipo === "Gasto" && subcategoria !== undefined) return gastoMonthlyBreakdown(categoria, subcategoria, mes, anchorMes).neto;
  if (tipo === "Gasto") {
    const gastoSubs = new Set();
    for (const m of movimientos)
      if (m.tipo === "Gasto" && m.categoria === categoria && monthKey(m) === mes && !esFilaAparte(m.fila))
        gastoSubs.add(m.subcategoria || "");
    let total = 0;
    for (const sub of gastoSubs) total += gastoMonthlyBreakdown(categoria, sub, mes, anchorMes).neto;
    return total;
  }
  // Ingreso: sin neteo (un Ingreso nunca se neta contra Ingresos). Si se pide
  // una subcategoría puntual, se filtra por ella igual que del lado Gasto —
  // sin este filtro, CUALQUIER subcategoría de Ingreso devolvía el total de
  // toda la categoría (ej. "Cuenta remunerada" mostraba lo mismo que
  // "Sueldo"), inflando el presupuesto de Ingreso al sumar cada subcategoría.
  // Los que son reembolso de un Gasto (Dividendo, Préstamo, Trabajo/Starbuck...)
  // se excluyen: ya se restaron del lado del Gasto, contarlos también acá
  // los duplicaría y los mostraría como si fueran ingreso nuevo.
  let total = 0;
  for (const m of movimientos) {
    if (m.categoria !== categoria || monthKey(m) !== mes || m.tipo !== tipo) continue;
    if (esFilaAparte(m.fila)) continue;
    if (subcategoria !== undefined && normSub(m.subcategoria) !== normSub(subcategoria)) continue;
    if (esMovReembolso(m, anchorMes)) continue;
    total += Math.abs(m.monto);
  }
  return total;
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

/** Azúcar sobre esReembolsoDeGasto con la ventana de 4 meses ya armada
 * (anchorMes fijo, mismo criterio que gastoMonthlyBreakdown). */
function esSubcatReembolso(categoria, subcategoria, anchorMes) {
  return esReembolsoDeGasto(categoria, subcategoria, [...monthsBeforeExclusive(anchorMes, 3), anchorMes]);
}

/** Un movimiento de Ingreso que es reembolso de un Gasto — para excluirlo de la
 * apertura "Ingresos" del Dashboard (ver montoRealNeto y buildCategoryList).
 * Ya está restado del lado del Gasto; mostrarlo TAMBIÉN como Ingreso aparte
 * (ej. Dividendo, Préstamo, Trabajo) confunde: parece plata nueva y en
 * realidad es la vuelta de un gasto que ya se contó. */
function esMovReembolso(m, anchorMes) {
  return m.tipo === "Ingreso" && esSubcatReembolso(m.categoria, m.subcategoria, anchorMes);
}

/** Budgeted amount for one categoria+subcategoria: explicit override if fijado,
 * else the same 3-month-average proposal shown on the Presupuesto page. */
function budgetForSubcategoria(mes, categoria, subcategoria, tipo = "Gasto") {
  if (tipo === "Ingreso" && esReembolsoDeGasto(categoria, subcategoria, [...monthsBeforeExclusive(mes, 3), mes])) return 0;
  // Comparación normalizada aunque canonizar() ya haya pasado: es la misma
  // regla que usa presupuesto.js (findExplicit), y que acá fuera exacta hacía
  // que las dos páginas leyeran distinto el MISMO dato.
  // Si hay más de una fila para la misma línea (duplicado en la planilla), gana
  // la que tiene monto: un 0 casi siempre es un placeholder, y quedarse con él
  // apagaba el presupuesto de esa línea sin avisar — pasó con Entel Hogar.
  const filas = presupuestoRows.filter(
    (p) =>
      p.mes === mes &&
      p.tipo === tipo &&
      normSub(p.categoria) === normSub(categoria) &&
      normSub(p.subcategoria) === normSub(subcategoria)
  );
  const row = filas.find((p) => p.monto !== 0) || filas[0];
  return row ? row.monto : avg3Real(tipo, categoria, subcategoria, mes);
}

/** Subcategorías de una categoría/tipo que valen presupuesto: actividad real
 * en los 3 meses previos, o ya tienen una fila fijada este mes — sin importar
 * si YA tuvieron gasto real este mes puntual. Se usa tanto para sumar el total
 * de la categoría (budgetForCategoria) como para, en el Dashboard, mostrar la
 * subcategoría igual aunque este mes todavía no se haya cargado nada ("esto
 * lo tenés presupuestado, todavía no lo pagaste"). Devuelve las etiquetas
 * representativas (deduplicadas por normSub, ver montoRealNeto). */
function subcategoriasConPresupuesto(mes, categoria, tipo = "Gasto") {
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
  return [...subs.values()];
}

/** Sum across all of a categoria's subcategorias (explicit-or-average each), matching
 * the Presupuesto page's "category = sum of its subcategorias" rule. Null only when
 * the categoria has no subcategorias with any recent activity at all. */
function budgetForCategoria(mes, categoria, tipo = "Gasto") {
  const subs = subcategoriasConPresupuesto(mes, categoria, tipo);
  if (subs.length === 0) return null;
  return subs.reduce((s, sub) => s + budgetForSubcategoria(mes, categoria, sub, tipo), 0);
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

/** Neteo por grupo (medio de pago + fecha de vencimiento) de lo "Por pagar".
 * No se clasifica movimiento a movimiento: un préstamo que hiciste arrastra
 * además las filas que lo van bajando (abonos que te pagaron, castigos por
 * incobrable), que son negativas pero NO son deuda tuya. Ej.: préstamo de
 * $100.000 − $50.000 que te devolvieron − $30.000 castigados = $20.000 que te
 * siguen debiendo, y ni un peso de "por pagar". */
function netosPorGrupo(movs) {
  const porGrupo = {};
  for (const m of movs) {
    const k = `${m.medioPago || "(sin medio de pago)"}|||${(m.fechaVencimiento || "").trim()}`;
    porGrupo[k] = (porGrupo[k] || 0) - m.monto; // positivo = debés, negativo = te deben
  }
  return Object.values(porGrupo);
}
const sumaPagar = (movs) => netosPorGrupo(movs).filter((n) => n > 0).reduce((s, n) => s + n, 0);

/** Quién te debe, sacado del texto del Detalle — no hay campo propio para la
 * persona (Medio_pago es la cuenta real). Se le quitan los prefijos con que
 * quedan escritos estos movimientos ("Cobro a Gabi", "Prestamo pana Beto"). */
const PREFIJOS_COBRO = [
  /^cobro\s+(a|de)\s+/i, /^cobro\s+/i, /^abono\s+recibido\s+de\s+/i, /^abono\s+de\s+/i,
  /^prestamo\s+(pana|a)\s+/i, /^préstamo\s+(pana|a)\s+/i, /^recupero\s+dinero\s+/i,
  /^castigo\s+incobrable\s+/i, /^devoluci[oó]n\s+(de\s+)?/i, /^pago\s+(de\s+)?/i,
];
const GENERICAS_COBRO = /^(pr[eé]stamo|cobro|devoluci[oó]n|abono|pago|deuda|cuota)s?$/i;
function personaDeDetalle(m) {
  let s = (m.detalle || "").trim();
  for (const re of PREFIJOS_COBRO) {
    const corto = s.replace(re, "");
    if (corto !== s) { s = corto.trim(); break; }
  }
  s = s.replace(/\s*\([^)]*\)\s*$/, "").trim(); // "Beto (Daniel)" -> "Beto"

  // "Cobro prestamo" no dice a quién: sobra solo "prestamo" y la ficha mostraba
  // un cobro llamado "prestamo". Si lo que queda es una palabra genérica, la
  // persona está en la subcategoría ("Prestamo Manu" -> "Manu").
  if (!s || GENERICAS_COBRO.test(s)) {
    const sub = (m.subcategoria || "").trim();
    const sinPrefijo = sub.replace(/^pr[eé]stamo\s+(a\s+|de\s+)?/i, "").trim();
    return sinPrefijo || sub || m.categoria;
  }
  return s;
}

/** Cómo se escribe la baja de un cobro: la app genera "Abono recibido de X" y
 * "Castigo incobrable X"; a mano quedaron "Recupero dinero X" y "Prestamo pana X". */
const PALABRAS_BAJA = /abono|castigo|incobrable|recupero|pr[eé]stamo/i;

const mismoGrupoCobro = (a, b) =>
  a.categoria === b.categoria &&
  normSub(a.subcategoria) === normSub(b.subcategoria) &&
  a.medioPago === b.medioPago &&
  (a.fechaVencimiento || "").trim() === (b.fechaVencimiento || "").trim();

/** ¿El texto nombra a esa persona como palabra entera? ("ric" no debe calzar
 * dentro de "fabricación"). */
function nombraA(texto, key) {
  const t = " " + texto.replace(/[^a-z0-9áéíóúüñ]+/gi, " ") + " ";
  return t.includes(" " + key + " ");
}

const llaveEstadoCuenta = (m) => `${normSub(m.medioPago)}|||${(m.fechaVencimiento || "").trim()}`;

/** Misma definición de "crédito" que usa registro.js: cualquier medio que NO sea
 * una de tus cuentas (con saldo en la pestaña Cuentas) es una tarjeta. */
const esCuentaReal = (medio) => cuentas.some((c) => normSub(c.nombre) === normSub(medio));

const esCreditoDeTarjeta = (m, estadosDeCuenta) =>
  !esCuentaReal(m.medioPago) && estadosDeCuenta.has(llaveEstadoCuenta(m));

/** Separa lo pendiente en dos mundos que no se mezclan:
 *
 *   hilos  = lo que te deben, UNO POR PERSONA. Arranca en un Ingreso pendiente
 *            ("Cobro a Gabi") y arrastra las filas Gasto que lo van bajando
 *            (abonos que te pagaron, castigos por incobrable).
 *   deuda  = lo tuyo por pagar de verdad (tarjetas), que se sigue agrupando por
 *            medio de pago + vencimiento, que es como llega el estado de cuenta.
 *
 * Antes todo iba junto en un solo grupo medio+vencimiento: si Gabi, Esteban y
 * Ric te debían por la misma tarjeta y el mismo vencimiento, se veían como UN
 * número y el abono de uno bajaba la deuda de los otros. Por eso ahora el cobro
 * se agrupa por persona: es la única forma de saber quién te queda debiendo.
 *
 * Un Gasto pendiente cae en un hilo si lo nombra en el Detalle; si no, si calza
 * con un único hilo por categoría+subcategoría+medio+vencimiento (así entran
 * los castigos viejos, que quedaron escritos como "Castigo incobrable Banco
 * Chile" sin el nombre de la persona). Lo que no cae en ningún hilo es deuda. */
function separarPendientes(pendientes) {
  // Estados de cuenta reales: grupos medio+vencimiento con compras de verdad.
  const estadosDeCuenta = new Set(
    pendientes
      .filter((m) => m.tipo !== "Ingreso" && !PALABRAS_BAJA.test(m.detalle || ""))
      .map(llaveEstadoCuenta)
  );

  const hilos = new Map();
  const creditos = [];
  for (const m of pendientes) {
    if (m.tipo !== "Ingreso") continue;

    // Un Ingreso pendiente sobre una TARJETA que tiene su estado de cuenta es una
    // nota de crédito / devolución: NO es plata que te debe una persona, es un
    // descuento de ESE estado de cuenta. Va con la deuda, neteada contra las
    // compras de su grupo — igual que cuando todo se agrupaba por medio y
    // vencimiento. Si se trata como cobro, una devolución + la compra que la
    // reemplaza (que es un cambio, no un gasto nuevo) mueven la Liquidez.
    if (esCreditoDeTarjeta(m, estadosDeCuenta)) {
      creditos.push(m);
      continue;
    }

    const persona = personaDeDetalle(m);
    const k = normSub(persona);
    if (!hilos.has(k)) hilos.set(k, { persona, movs: [] });
    hilos.get(k).movs.push(m);
  }

  const deuda = [];
  for (const m of pendientes) {
    if (m.tipo === "Ingreso") continue;

    // Un Gasto solo baja un cobro si HABLA como una baja (abono, castigo,
    // recupero, préstamo). Antes bastaba con compartir categoría, subcategoría,
    // medio y vencimiento — y una compra normal con tarjeta que caía en el mismo
    // grupo que una devolución por cobrar (Shopping/Paris/Cencosud) quedaba
    // "abonando" el cobro: desaparecía de la deuda y del gasto del mes.
    if (!PALABRAS_BAJA.test(m.detalle || "")) {
      deuda.push(m);
      continue;
    }

    const texto = normSub(m.detalle);
    const candidatos = [...hilos.entries()].filter(([, h]) =>
      h.movs.some((o) => o.tipo === "Ingreso" && mismoGrupoCobro(o, m))
    );
    let k = null;
    if (candidatos.length === 1) k = candidatos[0][0];
    else if (candidatos.length > 1) {
      // Varios cobros comparten grupo (ej. Gabi y Esteban): decide quién nombra.
      const nombrado = candidatos.filter(([key]) => nombraA(texto, key));
      if (nombrado.length === 1) k = nombrado[0][0];
    } else {
      // Nadie calza por grupo (se corrigió el vencimiento de un solo lado): si el
      // detalle nombra a UNA persona con cobro abierto, es de ella.
      const nombrado = [...hilos.keys()].filter((key) => key && nombraA(texto, key));
      if (nombrado.length === 1) k = nombrado[0];
    }
    if (k) hilos.get(k).movs.push(m);
    else deuda.push(m);
  }
  deuda.push(...creditos);
  return { hilos: [...hilos.values()], deuda };
}

/** Por cada cobro abierto, cuánto de su Ingreso original sigue sin cobrar: el
 * monto menos los ABONOS del hilo, descontados en orden.
 *
 * Los castigos NO se descuentan: no entró plata, y la pérdida ya quedó anotada
 * aparte como Gasto "Incobrable". Si además se sacara el Ingreso original, esa
 * pérdida se contaría dos veces. Un abono es distinto: la plata sí entró y quedó
 * como otro Ingreso, así que el original tiene que dejar de contar. */
function ingresosVivosDeHilos(hilos) {
  const out = new Map();
  for (const h of hilos) {
    let bajas = h.movs
      .filter((m) => m.tipo !== "Ingreso" && !/castigo|incobrable/i.test(m.detalle || ""))
      .reduce((s, m) => s + Math.abs(m.monto), 0);
    for (const m of h.movs.filter((x) => x.tipo === "Ingreso")) {
      const quita = Math.min(m.monto, bajas);
      bajas -= quita;
      if (quita > 0) out.set(m.fila, m.monto - quita);
    }
  }
  return out;
}

/** Empareja los retiros del ahorro con lo que se devuelve al ahorro, para que
 * esa ida y vuelta no cuente como ingreso ni como gasto.
 *
 * Retiro = Ingreso con subcategoría "Retiro ..." (Retiro Ahorro, Retiro Bono).
 * Devolución = Gasto de categoría Ahorro en la subcategoría genérica "Bono" o
 * "Ahorro" (los dos bolsillos de los retiros); los aportes planificados (Ahorro
 * Benja, Navidad, Perfume...) NO son devoluciones y siguen contando.
 *
 * Una devolución se empareja con retiros del MISMO mes o del anterior, solo si
 * calza exacto: con un retiro, o con los retiros más antiguos sumados. Una
 * devolución parcial no se toca (se sigue viendo como gasto) hasta que calce. */
function emparejarTraspasosAhorro(movs) {
  const pagados = movs.filter((m) => m.estado === "Pagado" && !esFilaAparte(m.fila));
  const retiros = pagados.filter((m) => m.tipo === "Ingreso" && /^retiro/.test(normSub(m.subcategoria)));
  const vueltas = pagados.filter(
    (m) => m.tipo === "Gasto" && normSub(m.categoria) === "ahorro" && ["bono", "ahorro"].includes(normSub(m.subcategoria))
  );
  const usados = new Set();
  const out = new Set();
  const mesAnterior = (k) => monthsBeforeExclusive(k, 1)[0];
  for (const v of vueltas.sort((a, b) => a.fila - b.fila)) {
    const k = monthKey(v);
    const pozo = retiros
      .filter((r) => !usados.has(r.fila) && (monthKey(r) === k || monthKey(r) === mesAnterior(k)))
      .sort((a, b) => a.fila - b.fila);
    const monto = Math.abs(v.monto);
    let elegidos = pozo.filter((r) => Math.abs(r.monto) === monto).slice(0, 1);
    if (!elegidos.length) {
      let acum = 0;
      const prefijo = [];
      for (const r of pozo) {
        prefijo.push(r);
        acum += Math.abs(r.monto);
        if (acum === monto) { elegidos = prefijo; break; }
        if (acum > monto) break;
      }
    }
    if (!elegidos.length) continue;
    out.add(v.fila);
    for (const r of elegidos) { usados.add(r.fila); out.add(r.fila); }
  }
  return out;
}

/** Arma todo el estado de cálculo a partir de las filas crudas de la planilla —
 * el mismo proceso en Dashboard y Registrar: parsear, unificar etiquetas y marcar
 * las filas que no son gasto/ingreso real (contra-asientos de cobros, traspasos
 * con el ahorro). `presRows`/`cuentasRows` son las filas de Presupuesto!A2:E y
 * Cuentas!A2:C. */
function prepararCalculo(movRows, presRows, cuentasRows) {
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

  // Unifica etiquetas que solo difieren en mayúsculas/espacios ANTES de que
  // cualquier cálculo las compare exacto (ver window.Etiquetas en config.js).
  const canon = window.Etiquetas.canonizar(movimientos, presupuestoRows);

  const { hilos } = separarPendientes(movimientos.filter((m) => m.estado === "Por pagar"));
  filasDeHilo = new Set(hilos.flatMap((h) => h.movs.filter((m) => m.tipo !== "Ingreso").map((m) => m.fila)));
  ingresoVivo = ingresosVivosDeHilos(hilos);
  filasTraspaso = emparejarTraspasosAhorro(movimientos);
  return { hilos, canon };
}

/** Presupuesto vs. consumo de un mes para Registrar: cuánto hay presupuestado y
 * cuánto llevas gastado, con los MISMOS números que muestra el Dashboard en
 * "Gasto por categoría" (neto de reembolsos, sin contra-asientos de cobros ni
 * traspasos con el ahorro, presupuesto fijado o promedio de 3 meses).
 *   subcategoria omitida  -> toda la categoría (budgetForCategoria / montoRealNeto)
 *   subcategoria dada     -> solo esa línea (budgetForSubcategoria / neto del mes)
 * `conReembolso` avisa que la línea suele devolverse (Starbuck, Casa Maipú...): su
 * presupuesto está guardado NETO, así que un gasto bruto la hace ver más pasada
 * de lo que quedará cuando llegue el reembolso. */
function consumoPresupuesto(categoria, subcategoria, mes) {
  if (subcategoria === undefined) {
    return {
      meta: budgetForCategoria(mes, categoria, "Gasto") || 0,
      consumido: montoRealNeto("Gasto", categoria, mes),
      conReembolso: false,
    };
  }
  return {
    meta: budgetForSubcategoria(mes, categoria, subcategoria, "Gasto"),
    consumido: gastoMonthlyBreakdown(categoria, subcategoria, mes).neto,
    conReembolso: reembolsoInfoFor(categoria, subcategoria, mes) !== null,
  };
}
