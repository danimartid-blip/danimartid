const $ = (id) => document.getElementById(id);

const MESES = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function fmtCLP(n) {
  const sign = n < 0 ? "-" : "";
  return sign + "$" + Math.round(Math.abs(n)).toLocaleString("es-CL");
}
function fmtUF(n, dec = 2) {
  return n.toLocaleString("es-CL", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + " UF";
}
function fmtCorto(n) {
  const abs = Math.abs(n);
  if (abs < 1e5) return fmtCLP(n);
  const sign = n < 0 ? "-" : "";
  const miles = Math.round(abs / 1000);
  if (miles < 1000) return `${sign}$${miles} mil`;
  return `${sign}$${(abs / 1e6).toFixed(1).replace(".", ",")}M`;
}
function pct(n, dec = 1) {
  return n.toLocaleString("es-CL", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + "%";
}

let creditos = [];
let movimientos = [];
let uf = null; // { valor, fecha }

/** Cada crédito vive en su propia moneda (UF los hipotecarios, pesos el de
 * consumo). Toda la matemática corre en la moneda del crédito y recién al
 * pintar se pasa a pesos con este factor. */
function factor(credito) {
  return credito.moneda === "UF" ? uf.valor : 1;
}
function enPesos(credito, monto) {
  return monto * factor(credito);
}
/** El monto en la moneda original, para mostrar debajo — solo aporta cuando la
 * moneda NO es peso (ver 1.545 UF al lado de $63 millones dice algo; ver
 * "$15.377.135 CLP" debajo de "$15.377.135" no dice nada). */
function enMoneda(credito, monto, dec = 2) {
  return credito.moneda === "UF" ? fmtUF(monto, dec) : "";
}

/** "01-03-2021" o "01/03/2021" -> Date */
function parseFecha(s) {
  const p = String(s || "").trim().split(/[-/]/);
  if (p.length !== 3) return null;
  const [d, m, y] = p.map(Number);
  if (!d || !m || !y) return null;
  const fecha = new Date(y, m - 1, d);
  return isNaN(fecha) ? null : fecha;
}
function mesLegible(fecha) {
  return `${MESES[fecha.getMonth() + 1]} ${fecha.getFullYear()}`;
}
/** Meses completos entre dos fechas (cuántas cuotas pasaron). */
function mesesEntre(desde, hasta) {
  return (hasta.getFullYear() - desde.getFullYear()) * 12 + (hasta.getMonth() - desde.getMonth());
}
function sumarMeses(fecha, n) {
  const d = new Date(fecha);
  d.setMonth(d.getMonth() + n);
  return d;
}

/** Cuota de un crédito francés: la que deja el saldo en cero en n meses. */
function cuotaFrancesa(saldo, tasaAnual, n) {
  const i = tasaAnual / 12;
  if (n <= 0) return 0;
  return i === 0 ? saldo / n : (saldo * i) / (1 - Math.pow(1 + i, -n));
}

/** Cuántos meses y cuánto interés faltan para liquidar un saldo pagando `cuota`
 * todos los meses. Se usa para el saldo de hoy y para simular un abono. */
function liquidar(saldo, tasaAnual, cuota) {
  const i = tasaAnual / 12;
  let s = saldo;
  let meses = 0;
  let interes = 0;
  while (s > 0.01 && meses < 1200) {
    const int = s * i;
    interes += int;
    s = s + int - Math.min(cuota, s + int);
    meses++;
  }
  return { meses, interes };
}

/** Amortiza desde el punto de referencia hasta hoy y sigue hasta el final.
 * Todo el cálculo vive acá; el resto de la página solo pinta.
 *
 * El punto de referencia es un saldo REAL a una fecha (el del certificado del
 * banco, o el del mes en que cambió la tasa). Nunca se estima desde cero: así
 * el saldo de hoy arrastra el número que dio el banco, no un supuesto. */
function estado(credito, hoy = new Date()) {
  const ref = parseFecha(credito.fechaReferencia);
  const pagadasDesdeRef = Math.max(0, Math.min(mesesEntre(ref, hoy), credito.cuotasRestantesRef));
  const i = credito.tasaActual / 12;

  let saldo = credito.saldoReferenciaUF;
  let enHoy = null;
  for (let k = 1; k <= credito.cuotasRestantesRef; k++) {
    const interes = saldo * i;
    const capital = Math.min(credito.dividendoUF - interes, saldo);
    saldo = Math.max(0, saldo - capital);
    if (k === pagadasDesdeRef) enHoy = { interes, capital, saldo };
  }
  // pagadasDesdeRef = 0 solo si la referencia cae en este mismo mes: todavía no
  // se paga ninguna cuota nueva, así que el saldo sigue siendo el de referencia.
  const actual = enHoy || {
    interes: credito.saldoReferenciaUF * i,
    capital: credito.dividendoUF - credito.saldoReferenciaUF * i,
    saldo: credito.saldoReferenciaUF,
  };
  const restantes = credito.cuotasRestantesRef - pagadasDesdeRef;

  return {
    saldo: actual.saldo,
    interes: actual.interes,
    capital: actual.capital,
    seguros: credito.segurosUF,
    dividendoTotal: credito.dividendoUF + credito.segurosUF,
    cuotasPagadas: credito.plazoCuotas - restantes,
    cuotasRestantes: restantes,
    avance: ((credito.capitalUF - actual.saldo) / credito.capitalUF) * 100,
    ultimaCuota: sumarMeses(ref, credito.cuotasRestantesRef),
    interesQueFalta: liquidar(actual.saldo, credito.tasaActual, credito.dividendoUF).interes,
  };
}

/** ¿Qué pasa si le meto un abono extra hoy? Dos caminos distintos: bajar el
 * plazo (se ahorra mucho interés) o bajar la cuota (alivia el mes). Devuelve
 * los dos, más lo que cobra el banco por prepagar. */
function simularPrepago(credito, est, montoCLP) {
  const extra = montoCLP / factor(credito);
  const nuevoSaldo = Math.max(0, est.saldo - extra);
  const conAbono = liquidar(nuevoSaldo, credito.tasaActual, credito.dividendoUF);
  const cuotaNueva = cuotaFrancesa(nuevoSaldo, credito.tasaActual, est.cuotasRestantes);

  return {
    mesesMenos: est.cuotasRestantes - conAbono.meses,
    interesAhorrado: est.interesQueFalta - conAbono.interes,
    cuotaNueva: cuotaNueva + credito.segurosUF,
    bajaCuota: est.dividendoTotal - (cuotaNueva + credito.segurosUF),
    // 30 días de interés (créditos en pesos) o 45 (reajustables), sobre lo abonado.
    comision: extra * credito.tasaActual * (credito.prepagoDias / 360),
  };
}

function barra(porcentaje, clase = "") {
  return `<div class="bar-track"><div class="bar-fill ${clase}" data-w="${Math.min(100, Math.max(0, porcentaje))}" style="width:0%"></div></div>`;
}

function render() {
  const estados = creditos.map((c) => ({ credito: c, est: estado(c) }));
  const sumar = (campo) => estados.reduce((s, e) => s + enPesos(e.credito, e.est[campo]), 0);

  // ---------- resumen ----------
  const deuda = sumar("saldo");
  const dividendo = sumar("dividendoTotal");
  const interes = sumar("interes");
  const capital = sumar("capital");
  const seguros = sumar("seguros");

  Anim.numero($("statDeuda"), deuda, fmtCorto);
  $("statDeuda").title = fmtCLP(deuda);
  $("statDeudaDetalle").textContent = `${creditos.length} créditos · ${fmtCLP(sumar("interesQueFalta"))} de interés por delante`;
  Anim.numero($("statDividendo"), dividendo, fmtCLP);
  Anim.numero($("statCapital"), capital, fmtCLP);
  $("statCapitalPct").textContent = `${pct((capital / dividendo) * 100, 0)} de lo que pagas`;
  $("ufHoy").textContent = `UF ${fmtCLP(uf.valor)} · ${uf.fecha}`;

  // ---------- apertura del mes ----------
  const trozos = [
    { label: "Capital", monto: capital, clase: "seg-capital", nota: "baja tu deuda" },
    { label: "Interés", monto: interes, clase: "seg-interes", nota: "se lo lleva el banco" },
    { label: "Seguros", monto: seguros, clase: "seg-seguros", nota: "desgravamen e incendio" },
  ].filter((t) => t.monto > 0);
  $("aperturaBar").innerHTML = trozos
    .map((t) => `<div class="apertura-seg ${t.clase}" style="width:${(t.monto / dividendo) * 100}%"></div>`)
    .join("");
  $("aperturaLeyenda").innerHTML = trozos
    .map(
      (t) => `
      <div class="apertura-item">
        <span class="legend-dot ${t.clase}"></span>
        <div>
          <div class="apertura-monto">${fmtCLP(t.monto)}</div>
          <div class="apertura-label">${t.label} · ${pct((t.monto / dividendo) * 100, 0)}</div>
          <div class="rank-meta">${t.nota}</div>
        </div>
      </div>`
    )
    .join("");

  renderRanking(estados);
  renderCreditos(estados);
  renderCargaFinanciera(dividendo);
  Anim.barras(document.body);
}

/** ¿A cuál le abono primero? La respuesta correcta es "al de tasa más alta", y
 * conviene decirlo con el número que la gente entiende: cuánto te ahorra al año
 * cada millón. OJO con comparar el interés total ahorrado entre créditos — el
 * hipotecario siempre gana esa comparación solo porque le quedan 20 años, no
 * porque rinda más. */
function renderRanking(estados) {
  const orden = [...estados].sort((a, b) => b.credito.tasaActual - a.credito.tasaActual);
  const mejor = orden[0];

  $("rankingBody").innerHTML =
    orden
      .map(({ credito, est }) => {
        const alAño = 1000000 * credito.tasaActual;
        const sim = simularPrepago(credito, est, 1000000);
        const esMejor = credito === mejor.credito;
        return `
        <div class="rank-row ${esMejor ? "rank-mejor" : ""}">
          <div style="min-width:0;">
            <div class="rank-nombre">${credito.nombre}${esMejor ? ' <span class="badge badge-ok">abona acá</span>' : ""}</div>
            <div class="rank-meta">
              ${pct(credito.tasaActual * 100, 2)} · quedan ${est.cuotasRestantes} cuotas ·
              te saca ${sim.mesesMenos} ${sim.mesesMenos === 1 ? "mes" : "meses"} de encima
            </div>
          </div>
          <div class="rank-valor">
            <strong class="${esMejor ? "income" : ""}">${fmtCLP(alAño)}</strong>
            <div class="rank-meta">al año</div>
          </div>
        </div>`;
      })
      .join("") +
    `<p class="card-sub" style="margin:12px 0 0;">
       Cuánto te ahorra cada <strong>$1.000.000</strong> que abones, por año. Es la tasa del crédito:
       abonar es una inversión que rinde exactamente eso, garantizado y sin impuestos.
       No mires el interés total ahorrado para elegir — el hipotecario siempre parece ganar
       porque le quedan 20 años, no porque rinda más.
     </p>`;
}

function renderCreditos(estados) {
  const cont = $("listaCreditos");
  cont.innerHTML = "";

  for (const { credito, est } of estados) {
    const card = document.createElement("div");
    card.className = "card";
    const cambio = parseFecha(credito.fechaCambioTasa);
    const subeTasa = credito.tasaActual > credito.tasaInicial;
    const enMonedaSaldo = enMoneda(credito, est.saldo, 1);
    const enMonedaDiv = enMoneda(credito, est.dividendoTotal, 4);

    card.innerHTML = `
      <div class="credito-head">
        <div style="min-width:0;">
          <div class="card-title" style="margin:0;">${credito.nombre}</div>
          <div class="rank-meta">
            ${credito.tipo} · ${credito.banco} ·
            ${credito.moneda === "UF" ? fmtUF(credito.capitalUF, 0) : fmtCLP(credito.capitalUF)} a ${credito.plazoCuotas} meses
          </div>
        </div>
        <div class="credito-tasa ${credito.tasaActual > 0.06 ? "expense" : ""}">${pct(credito.tasaActual * 100, 2)}</div>
      </div>

      <div class="credito-saldo">
        <div>
          <div class="stat-label">Debes hoy</div>
          <div class="stat-value hero-num-sm">${fmtCLP(enPesos(credito, est.saldo))}</div>
          ${enMonedaSaldo ? `<div class="rank-meta">${enMonedaSaldo}</div>` : ""}
        </div>
        <div style="text-align:right;">
          <div class="stat-label">Cuota</div>
          <div class="stat-value hero-num-sm">${fmtCLP(enPesos(credito, est.dividendoTotal))}</div>
          ${enMonedaDiv ? `<div class="rank-meta">${enMonedaDiv}</div>` : ""}
        </div>
      </div>

      ${barra(est.avance)}
      <div class="credito-meta">
        <span>${pct(est.avance)} pagado</span>
        <span>${est.cuotasPagadas} de ${credito.plazoCuotas} cuotas</span>
        <span>termina ${mesLegible(est.ultimaCuota)}</span>
      </div>

      ${
        subeTasa && cambio
          ? `<div class="aviso-tasa">
               <strong>Se te acabó la tasa fija en ${mesLegible(cambio)}.</strong>
               Pasaste de ${pct(credito.tasaInicial * 100, 2)} a ${pct(credito.tasaActual * 100, 2)}, y la cuota subió
               ${pct(((est.dividendoTotal / (cuotaFrancesa(credito.saldoReferenciaUF, credito.tasaInicial, credito.cuotasRestantesRef) + credito.segurosUF)) - 1) * 100)}.
             </div>`
          : ""
      }

      <div class="credito-detalle-toggle cat-clickable">
        <span>Ver el detalle y el prepago</span>
        <span class="chev">›</span>
      </div>
      <div class="cat-detail" hidden>
        <div class="detalle-grid">
          <div><div class="stat-label">Interés del mes</div><div class="dato">${fmtCLP(enPesos(credito, est.interes))}</div></div>
          <div><div class="stat-label">Capital del mes</div><div class="dato income">${fmtCLP(enPesos(credito, est.capital))}</div></div>
          ${est.seguros > 0 ? `<div><div class="stat-label">Seguros</div><div class="dato">${fmtCLP(enPesos(credito, est.seguros))}</div></div>` : ""}
          <div><div class="stat-label">Interés que falta</div><div class="dato expense">${fmtCLP(enPesos(credito, est.interesQueFalta))}</div></div>
        </div>
        <div class="prepago-tabla">
          <div class="prepago-titulo">Si abonas hoy, manteniendo la cuota:</div>
          ${[1000000, 3000000, 5000000]
            .map((monto) => {
              const sim = simularPrepago(credito, est, monto);
              return `
                <div class="prepago-fila">
                  <span class="prepago-monto">${fmtCLP(monto)}</span>
                  <span class="prepago-resultado">
                    <strong class="income">${sim.mesesMenos} meses menos</strong>
                    <span class="rank-meta">ahorras ${fmtCLP(enPesos(credito, sim.interesAhorrado))} · comisión ${fmtCLP(enPesos(credito, sim.comision))}</span>
                  </span>
                </div>`;
            })
            .join("")}
          <div class="rank-meta" style="margin-top:8px;">
            La otra opción es dejar el plazo y bajar la cuota: con ${fmtCLP(3000000)} quedaría en
            ${fmtCLP(enPesos(credito, simularPrepago(credito, est, 3000000).cuotaNueva))} al mes
            (${fmtCLP(enPesos(credito, simularPrepago(credito, est, 3000000).bajaCuota))} menos).
          </div>
        </div>
        ${credito.notas ? `<p class="card-sub" style="margin:12px 0 0;">${credito.notas}</p>` : ""}
      </div>
    `;

    const toggle = card.querySelector(".credito-detalle-toggle");
    const detalle = card.querySelector(".cat-detail");
    toggle.addEventListener("click", () => {
      detalle.hidden = !detalle.hidden;
      toggle.classList.toggle("abierto", !detalle.hidden);
    });
    cont.appendChild(card);
  }
}

const norm = (s) => (s || "").trim().toLowerCase();

/** Categorías donde un Ingreso es alguien devolviéndote una cuota (el arriendo
 * que cubre el dividendo, la mitad del préstamo). No es ingreso nuevo: baja el
 * costo de la deuda, y por eso se resta de las cuotas en vez de sumarse arriba.
 * Sumarlo a los ingresos Y restarlo de las cuotas sería contarlo dos veces. */
const CAT_DEVOLUCION_DEUDA = new Set(["dividendos", "pago prestamo"]);

/** Plata tuya cambiándose de bolsillo: retiros de tu propio ahorro o del bono.
 * Entra a la cuenta corriente, pero no es plata nueva — si contara como
 * ingreso, sacar del ahorro "mejoraría" tu carga financiera, que es al revés. */
function esTraspasoPropio(m) {
  return norm(m.categoria) === "ahorro" || norm(m.subcategoria).startsWith("retiro");
}

/** Un Ingreso con la MISMA categoría+subcategoría que un Gasto de la ventana es
 * un reembolso (la convención de Daniel), y ya está descontado del lado del
 * gasto. Contarlo además como ingreso lo cuenta dos veces. */
function esReembolsoDeGasto(m, ventana) {
  return movimientos.some(
    (g) =>
      g.tipo === "Gasto" &&
      norm(g.categoria) === norm(m.categoria) &&
      norm(g.subcategoria) === norm(m.subcategoria) &&
      ventana.includes(`${g.año}-${String(g.mes).padStart(2, "0")}`)
  );
}

/** Cuánto de tus ingresos se va en deuda. Dos cifras: la bruta (la que mira el
 * banco antes de prestarte de nuevo) y la neta, descontando lo que te devuelven
 * — que es la que vive tu bolsillo.
 *
 * Las cuotas salen de los créditos cargados, NO de los movimientos, así no se
 * cuenta dos veces lo que ya está más arriba en la página. Y del lado del
 * ingreso NO vale sumar todo lo que diga "Ingreso": hay que sacar reembolsos,
 * traspasos de ahorro propio y devoluciones de cuotas, o el ingreso se infla y
 * la carga sale artificialmente baja. */
function renderCargaFinanciera(cuotasCLP) {
  const MESES_PROMEDIO = 3;
  const MESES_VENTANA = 6; // ventana más ancha para reconocer un reembolso de una compra anterior
  const hoy = new Date();
  const mesesDesdeHoy = (n) => {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - n, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };
  const promedioMeses = Array.from({ length: MESES_PROMEDIO }, (_, k) => mesesDesdeHoy(k + 1));
  const ventana = Array.from({ length: MESES_VENTANA }, (_, k) => mesesDesdeHoy(k + 1));

  const key = (m) => `${m.año}-${String(m.mes).padStart(2, "0")}`;
  const cubos = { ingreso: 0, devolucion: 0, traspaso: 0, reembolso: 0 };
  for (const m of movimientos) {
    if (m.tipo !== "Ingreso" || !promedioMeses.includes(key(m))) continue;
    const monto = Math.abs(m.monto) / MESES_PROMEDIO;
    if (CAT_DEVOLUCION_DEUDA.has(norm(m.categoria))) cubos.devolucion += monto;
    else if (esTraspasoPropio(m)) cubos.traspaso += monto;
    else if (esReembolsoDeGasto(m, ventana)) cubos.reembolso += monto;
    else cubos.ingreso += monto;
  }

  const neta = cuotasCLP - cubos.devolucion;
  const pctBruta = cubos.ingreso ? (cuotasCLP / cubos.ingreso) * 100 : 0;
  const pctNeta = cubos.ingreso ? (neta / cubos.ingreso) * 100 : 0;

  const fuera = [
    [cubos.devolucion, "te devuelven del dividendo y del préstamo (ya se descuentan de las cuotas)"],
    [cubos.traspaso, "son retiros de tu propio ahorro, no plata nueva"],
    [cubos.reembolso, "son reembolsos que ya vienen descontados del gasto"],
  ].filter(([monto]) => monto > 0);

  $("cargaBody").innerHTML = `
    <div class="carga-fila">
      <div>
        <div class="stat-label">Lo que el banco ve</div>
        <div class="stat-value hero-num-sm ${pctBruta > 40 ? "expense" : ""}">${pct(pctBruta)}</div>
        <div class="rank-meta">${fmtCLP(cuotasCLP)} de cuotas</div>
      </div>
      <div>
        <div class="stat-label">Lo que pagas tú</div>
        <div class="stat-value hero-num-sm income">${pct(pctNeta)}</div>
        <div class="rank-meta">${fmtCLP(neta)}, ya descontado lo que te devuelven</div>
      </div>
    </div>
    ${barra(Math.min(pctBruta, 100), pctBruta > 40 ? "over" : "")}
    <div class="carga-base">
      <div>
        <div class="stat-label">Ingreso propio</div>
        <div class="dato">${fmtCLP(cubos.ingreso)}<span class="rank-meta"> al mes</span></div>
      </div>
      <div class="rank-meta">promedio de tus últimos ${MESES_PROMEDIO} meses cerrados</div>
    </div>
    <p class="card-sub" style="margin:10px 0 0;">
      Ese ingreso es solo plata que entra de verdad. Quedan fuera
      ${fuera.map(([monto, texto]) => `<strong>${fmtCLP(monto)}</strong> que ${texto}`).join("; ")}.
      Pasado el 40%, los bancos se ponen difíciles para prestarte de nuevo.
    </p>`;
}

async function obtenerUF() {
  const res = await fetch("https://mindicador.cl/api/uf");
  if (!res.ok) throw new Error("no se pudo consultar la UF");
  const data = await res.json();
  const punto = data.serie && data.serie[0];
  if (!punto) throw new Error("la API de la UF no devolvió datos");
  const d = new Date(punto.fecha);
  return { valor: punto.valor, fecha: `${d.getDate()} ${MESES[d.getMonth() + 1]} ${d.getFullYear()}` };
}

async function loadData() {
  // readRangeRaw: los decimales (tasas, UF) tienen que llegar como número, no
  // como el texto con coma que muestra la planilla.
  const [credRows, movRows] = await Promise.all([
    window.SheetsApi.readRangeRaw("Creditos!A2:S100"),
    window.SheetsApi.readRange("Movimientos!A2:N100000"),
  ]);

  creditos = credRows
    .filter((r) => r[0])
    .map((r) => ({
      nombre: r[0],
      tipo: r[1] || "Crédito",
      subcategoria: r[2] || "",
      banco: r[3] || "",
      operacion: r[4] || "",
      moneda: (r[5] || "CLP").toUpperCase(),
      capitalUF: Number(r[6]) || 0,
      fechaGiro: r[7] || "",
      plazoCuotas: Number(r[8]) || 0,
      tasaInicial: Number(r[9]) || 0,
      tasaActual: Number(r[10]) || 0,
      fechaCambioTasa: r[11] || "",
      fechaReferencia: r[12] || "",
      saldoReferenciaUF: Number(r[13]) || 0,
      cuotasRestantesRef: Number(r[14]) || 0,
      dividendoUF: Number(r[15]) || 0,
      segurosUF: Number(r[16]) || 0,
      prepagoDias: Number(r[17]) || 30,
      notas: r[18] || "",
    }));

  movimientos = movRows
    .map((r) => ({
      fecha: r[0],
      año: String(r[1] || "").trim(),
      mes: String(r[2] || "").trim(),
      tipo: r[3] || "",
      categoria: r[4] || "",
      subcategoria: r[5] || "",
      monto: Number(r[8]) || 0,
    }))
    .filter((m) => m.fecha);
}

async function init() {
  if (!window.SheetsAuth.requireAuthOrRedirect()) return;

  $("loadingSkeleton").hidden = false;
  try {
    const [, valorUF] = await Promise.all([loadData(), obtenerUF()]);
    uf = valorUF;
  } catch (err) {
    console.error(err);
    $("loadingSkeleton").textContent =
      "No se pudo cargar. Revisa tu conexión — los saldos en UF se calculan con el valor de hoy.";
    return;
  }
  $("loadingSkeleton").hidden = true;

  if (creditos.length === 0) {
    $("vacio").hidden = false;
    return;
  }
  $("content").hidden = false;
  render();
}

init();
