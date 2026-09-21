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
/** Meses completos entre dos fechas (cuántos dividendos pasaron). */
function mesesEntre(desde, hasta) {
  return (hasta.getFullYear() - desde.getFullYear()) * 12 + (hasta.getMonth() - desde.getMonth());
}
function sumarMeses(fecha, n) {
  const d = new Date(fecha);
  d.setMonth(d.getMonth() + n);
  return d;
}

/** Dividendo de un crédito francés: capital que se paga parejo mes a mes. */
function cuotaFrancesa(saldo, tasaAnual, n) {
  const i = tasaAnual / 12;
  if (n <= 0) return 0;
  return i === 0 ? saldo / n : (saldo * i) / (1 - Math.pow(1 + i, -n));
}

/** Amortiza hacia adelante desde el punto de referencia hasta hoy, y sigue
 * hasta el final. Todo el cálculo vive acá: el resto de la página solo pinta.
 *
 * El punto de referencia es un saldo REAL a una fecha (el del certificado del
 * banco, o el del mes en que cambió la tasa). Nunca se estima desde cero: así
 * el saldo de hoy arrastra el número que dio el banco, no un supuesto. */
function estado(credito, hoy = new Date()) {
  const ref = parseFecha(credito.fechaReferencia);
  const giro = parseFecha(credito.fechaGiro);
  const pagadasDesdeRef = Math.max(0, Math.min(mesesEntre(ref, hoy), credito.cuotasRestantesRef));
  const i = credito.tasaActual / 12;

  let saldo = credito.saldoReferenciaUF;
  let enHoy = null;
  const historia = [];
  for (let k = 1; k <= credito.cuotasRestantesRef; k++) {
    const interes = saldo * i;
    const capital = Math.min(credito.dividendoUF - interes, saldo);
    saldo = Math.max(0, saldo - capital);
    historia.push({ k, fecha: sumarMeses(ref, k), interes, capital, saldo });
    if (k === pagadasDesdeRef) enHoy = { interes, capital, saldo };
  }
  // pagadasDesdeRef = 0 solo si la referencia es este mismo mes: todavía no se
  // paga ninguna cuota nueva, así que el saldo sigue siendo el de referencia.
  const actual = enHoy || { interes: credito.saldoReferenciaUF * i, capital: 0, saldo: credito.saldoReferenciaUF };
  const restantes = credito.cuotasRestantesRef - pagadasDesdeRef;
  const interesQueFalta = historia.slice(pagadasDesdeRef).reduce((s, f) => s + f.interes, 0);

  return {
    saldoUF: actual.saldo,
    interesUF: actual.interes,
    capitalUF: actual.capital,
    segurosUF: credito.segurosUF,
    dividendoTotalUF: credito.dividendoUF + credito.segurosUF,
    cuotasPagadas: mesesEntre(giro, hoy) >= 0 ? credito.plazoCuotas - restantes : 0,
    cuotasRestantes: restantes,
    avance: ((credito.capitalUF - actual.saldo) / credito.capitalUF) * 100,
    ultimaCuota: sumarMeses(ref, credito.cuotasRestantesRef),
    interesQueFalta,
    historia,
  };
}

/** ¿Qué pasa si le meto un abono extra hoy? Dos caminos distintos:
 * bajar el plazo (se ahorra mucho interés) o bajar la cuota (alivia el mes).
 * Devuelve los dos, más lo que cobra el banco por prepagar. */
function simularPrepago(credito, est, montoCLP) {
  const extraUF = montoCLP / uf.valor;
  const i = credito.tasaActual / 12;
  const nuevoSaldo = Math.max(0, est.saldoUF - extraUF);

  // camino 1: misma cuota, menos meses
  let s = nuevoSaldo;
  let meses = 0;
  let interes = 0;
  while (s > 0.0001 && meses < 1200) {
    const int = s * i;
    s = s + int - Math.min(credito.dividendoUF, s + int);
    interes += int;
    meses++;
  }
  // camino 2: mismos meses, cuota más baja
  const cuotaNueva = cuotaFrancesa(nuevoSaldo, credito.tasaActual, est.cuotasRestantes);

  return {
    extraUF,
    mesesMenos: est.cuotasRestantes - meses,
    interesAhorrado: est.interesQueFalta - interes,
    cuotaNueva: cuotaNueva + credito.segurosUF,
    bajaCuota: est.dividendoTotalUF - (cuotaNueva + credito.segurosUF),
    comision: extraUF * credito.tasaActual * (credito.prepagoDias / 360),
  };
}

function barra(porcentaje, clase = "") {
  return `<div class="bar-track"><div class="bar-fill ${clase}" data-w="${Math.min(100, Math.max(0, porcentaje))}" style="width:0%"></div></div>`;
}

function render() {
  const estados = creditos.map((c) => ({ credito: c, est: estado(c) }));

  // ---------- resumen ----------
  const deudaUF = estados.reduce((s, e) => s + e.est.saldoUF, 0);
  const dividendoUF = estados.reduce((s, e) => s + e.est.dividendoTotalUF, 0);
  const interesUF = estados.reduce((s, e) => s + e.est.interesUF, 0);
  const capitalUF = estados.reduce((s, e) => s + e.est.capitalUF, 0);
  const segurosUF = estados.reduce((s, e) => s + e.est.segurosUF, 0);

  Anim.numero($("statDeuda"), deudaUF * uf.valor, fmtCorto);
  $("statDeuda").title = fmtCLP(deudaUF * uf.valor);
  $("statDeudaUF").textContent = fmtUF(deudaUF, 1);
  Anim.numero($("statDividendo"), dividendoUF * uf.valor, fmtCLP);
  Anim.numero($("statCapital"), capitalUF * uf.valor, fmtCLP);
  $("statCapitalPct").textContent = `${pct((capitalUF / dividendoUF) * 100, 0)} de lo que pagas`;

  $("ufHoy").textContent = `UF ${fmtCLP(uf.valor)} · ${uf.fecha}`;

  // apertura del dividendo del mes
  const trozos = [
    { label: "Capital", uf: capitalUF, clase: "seg-capital", nota: "se vuelve tuyo" },
    { label: "Interés", uf: interesUF, clase: "seg-interes", nota: "se lo lleva el banco" },
    { label: "Seguros", uf: segurosUF, clase: "seg-seguros", nota: "desgravamen e incendio" },
  ];
  $("aperturaBar").innerHTML = trozos
    .map((t) => `<div class="apertura-seg ${t.clase}" style="width:${(t.uf / dividendoUF) * 100}%"></div>`)
    .join("");
  $("aperturaLeyenda").innerHTML = trozos
    .map(
      (t) => `
      <div class="apertura-item">
        <span class="legend-dot ${t.clase}"></span>
        <div>
          <div class="apertura-monto">${fmtCLP(t.uf * uf.valor)}</div>
          <div class="apertura-label">${t.label} · ${pct((t.uf / dividendoUF) * 100, 0)}</div>
          <div class="rank-meta">${t.nota}</div>
        </div>
      </div>`
    )
    .join("");

  // ---------- un bloque por crédito ----------
  const cont = $("listaCreditos");
  cont.innerHTML = "";
  for (const { credito, est } of estados) {
    const card = document.createElement("div");
    card.className = "card";
    const cambio = parseFecha(credito.fechaCambioTasa);
    const subeTasa = credito.tasaActual > credito.tasaInicial;

    card.innerHTML = `
      <div class="credito-head">
        <div>
          <div class="card-title" style="margin:0;">${credito.nombre}</div>
          <div class="rank-meta">${credito.banco} · ${fmtUF(credito.capitalUF, 0)} a ${credito.plazoCuotas} meses</div>
        </div>
        <div class="credito-tasa ${subeTasa ? "expense" : ""}">${pct(credito.tasaActual * 100, 2)}</div>
      </div>

      <div class="credito-saldo">
        <div>
          <div class="stat-label">Debes hoy</div>
          <div class="stat-value hero-num-sm">${fmtCLP(est.saldoUF * uf.valor)}</div>
          <div class="rank-meta">${fmtUF(est.saldoUF, 1)}</div>
        </div>
        <div style="text-align:right;">
          <div class="stat-label">Dividendo</div>
          <div class="stat-value hero-num-sm">${fmtCLP(est.dividendoTotalUF * uf.valor)}</div>
          <div class="rank-meta">${fmtUF(est.dividendoTotalUF, 4)}</div>
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
               Pasaste de ${pct(credito.tasaInicial * 100, 2)} a ${pct(credito.tasaActual * 100, 2)},
               y el dividendo subió ${pct(((est.dividendoTotalUF / (cuotaFrancesa(credito.saldoReferenciaUF, credito.tasaInicial, credito.cuotasRestantesRef) + credito.segurosUF)) - 1) * 100)}.
             </div>`
          : ""
      }

      <div class="credito-detalle-toggle cat-clickable">
        <span>Ver el detalle de este mes y el prepago</span>
        <span class="chev">›</span>
      </div>
      <div class="cat-detail" hidden>
        <div class="detalle-grid">
          <div><div class="stat-label">Interés del mes</div><div class="dato">${fmtCLP(est.interesUF * uf.valor)}</div></div>
          <div><div class="stat-label">Capital del mes</div><div class="dato income">${fmtCLP(est.capitalUF * uf.valor)}</div></div>
          <div><div class="stat-label">Seguros</div><div class="dato">${fmtCLP(est.segurosUF * uf.valor)}</div></div>
          <div><div class="stat-label">Interés que falta</div><div class="dato expense">${fmtCLP(est.interesQueFalta * uf.valor)}</div></div>
        </div>
        <div class="prepago-tabla">
          <div class="prepago-titulo">Si abonas hoy, con la misma cuota:</div>
          ${[1000000, 3000000, 5000000]
            .map((monto) => {
              const sim = simularPrepago(credito, est, monto);
              return `
                <div class="prepago-fila">
                  <span class="prepago-monto">${fmtCLP(monto)}</span>
                  <span class="prepago-resultado">
                    <strong class="income">${sim.mesesMenos} meses menos</strong>
                    <span class="rank-meta">ahorras ${fmtCLP(sim.interesAhorrado * uf.valor)} · comisión ${fmtCLP(sim.comision * uf.valor)}</span>
                  </span>
                </div>`;
            })
            .join("")}
          <div class="rank-meta" style="margin-top:8px;">
            La otra opción es dejar el plazo y bajar la cuota: con ${fmtCLP(3000000)} quedaría en
            ${fmtCLP(simularPrepago(credito, est, 3000000).cuotaNueva * uf.valor)} al mes
            (${fmtCLP(simularPrepago(credito, est, 3000000).bajaCuota * uf.valor)} menos).
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

  renderCargaFinanciera(dividendoUF * uf.valor);
  Anim.barras(document.body);
}

/** Cuánto de tus ingresos se va en deuda. Dos cifras: la bruta (la que mira el
 * banco antes de prestarte de nuevo) y la neta, descontando los arriendos que
 * recibes y lo que te devuelven del préstamo — que es la que vive tu bolsillo. */
function renderCargaFinanciera(dividendosCLP) {
  const mesesRef = 3;
  const hoy = new Date();
  const claves = [];
  for (let k = 1; k <= mesesRef; k++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - k, 1);
    claves.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  const key = (m) => `${m.año}-${String(m.mes).padStart(2, "0")}`;
  const enMeses = movimientos.filter((m) => claves.includes(key(m)));

  const ingreso =
    enMeses.filter((m) => m.tipo === "Ingreso" && m.categoria !== "Dividendos" && m.categoria !== "Pago Prestamo")
      .reduce((s, m) => s + Math.abs(m.monto), 0) / mesesRef;

  const prestamo =
    enMeses.filter((m) => m.tipo === "Gasto" && m.categoria === "Pago Prestamo")
      .reduce((s, m) => s + Math.abs(m.monto), 0) / mesesRef;
  const devuelven =
    enMeses.filter((m) => m.tipo === "Ingreso" && (m.categoria === "Dividendos" || m.categoria === "Pago Prestamo"))
      .reduce((s, m) => s + Math.abs(m.monto), 0) / mesesRef;

  const bruta = dividendosCLP + prestamo;
  const neta = bruta - devuelven;
  const pctBruta = ingreso ? (bruta / ingreso) * 100 : 0;
  const pctNeta = ingreso ? (neta / ingreso) * 100 : 0;

  $("cargaBody").innerHTML = `
    <div class="carga-fila">
      <div>
        <div class="stat-label">Lo que el banco ve</div>
        <div class="stat-value hero-num-sm ${pctBruta > 40 ? "expense" : ""}">${pct(pctBruta)}</div>
        <div class="rank-meta">${fmtCLP(bruta)} de cuotas sobre ${fmtCLP(ingreso)} de ingreso</div>
      </div>
      <div>
        <div class="stat-label">Lo que pagas tú</div>
        <div class="stat-value hero-num-sm income">${pct(pctNeta)}</div>
        <div class="rank-meta">${fmtCLP(neta)}, descontando ${fmtCLP(devuelven)} que te devuelven</div>
      </div>
    </div>
    ${barra(Math.min(pctBruta, 100), pctBruta > 40 ? "over" : "")}
    <p class="card-sub" style="margin:10px 0 0;">
      Sobre el promedio de tus últimos ${mesesRef} meses cerrados. Por encima de 40% los bancos
      empiezan a ponerse difíciles para prestarte de nuevo.
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
    window.SheetsApi.readRangeRaw("Creditos!A2:Q100"),
    window.SheetsApi.readRange("Movimientos!A2:N100000"),
  ]);

  creditos = credRows
    .filter((r) => r[0])
    .map((r) => ({
      nombre: r[0],
      subcategoria: r[1] || "",
      banco: r[2] || "",
      operacion: r[3] || "",
      capitalUF: Number(r[4]) || 0,
      fechaGiro: r[5] || "",
      plazoCuotas: Number(r[6]) || 0,
      tasaInicial: Number(r[7]) || 0,
      tasaActual: Number(r[8]) || 0,
      fechaCambioTasa: r[9] || "",
      fechaReferencia: r[10] || "",
      saldoReferenciaUF: Number(r[11]) || 0,
      cuotasRestantesRef: Number(r[12]) || 0,
      dividendoUF: Number(r[13]) || 0,
      segurosUF: Number(r[14]) || 0,
      prepagoDias: Number(r[15]) || 45,
      notas: r[16] || "",
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
    $("loadingSkeleton").innerHTML =
      'No se pudo cargar. Revisa tu conexión — el saldo se calcula con el valor de la UF de hoy.';
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
