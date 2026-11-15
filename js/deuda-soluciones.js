/* Pestaña "Soluciones" de Deuda: qué jugadas mejoran tus números y cuáles no.
 *
 * No trae opiniones sueltas: cada jugada se calcula con TUS créditos (los mismos
 * estadosActuales de la pestaña principal) y con supuestos de mercado que viven
 * en la pestaña "Parametros" de la planilla. Los supuestos se editan acá mismo y
 * se guardan en la planilla; el veredicto de cada jugada cambia con ellos.
 *
 * Reglas heredadas de deuda.js que acá también mandan:
 *  - la matemática corre en la moneda del crédito y se pasa a pesos al pintar;
 *  - "a cuál abonar" se decide por TASA, nunca por interés total ahorrado;
 *  - lo que te devuelven de una cuota (devolucionDe) no es ingreso: baja la cuota. */

/** Jugadas desplegadas (se conserva al volver a pintar) y valores de los
 * simuladores que NO se guardan en la planilla (son "qué pasa si"). */
const jugadasAbiertas = new Set(["abonar"]);
const sim = { abono: null, extraMes: 0, tasaObjetivo: null };

/* ---------- piezas de interfaz compartidas con Vehículo ---------- */

function veredicto(clase, texto) {
  return `<span class="veredicto v-${clase}">${texto}</span>`;
}
function kv(etiqueta, valor, clase = "") {
  return `<div class="kv"><span>${etiqueta}</span><strong class="${clase}">${valor}</strong></div>`;
}
function nota(texto) {
  return `<p class="jugada-nota">${texto}</p>`;
}

function mostrarCampo(valor, tipo) {
  if (tipo === "clp") return Math.round(valor).toLocaleString("es-CL");
  if (tipo === "pct") return String(+(valor * 100).toFixed(3)).replace(".", ",");
  return String(valor).replace(".", ",");
}
/** Lo tipeado -> número real. Acepta coma o punto como decimal en porcentajes;
 * en pesos saca todo lo que no sea dígito (los puntos de miles). */
function leerCampo(input) {
  const tipo = input.dataset.tipo;
  let s = input.value.trim();
  if (tipo === "clp") return Number(s.replace(/[^\d]/g, "")) || 0;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (tipo === "uf" && /^\d{1,3}\.\d{3}$/.test(s)) s = s.replace(".", "");
  const n = Number(s.replace(/[^\d.]/g, "")) || 0;
  return tipo === "pct" ? n / 100 : n;
}
const SUFIJO = { clp: "$", pct: "%", uf: "UF", num: "" };

/** Campo ligado a un supuesto de la planilla (data-param): al cambiarlo se
 * guarda en Parametros y se recalculan las dos pestañas. */
function campoParam(clave, etiqueta, tipo, porDefecto, ayuda = "") {
  const valor = Pnum(clave, porDefecto);
  return campo(`data-param="${clave}"`, etiqueta, tipo, valor, ayuda);
}
/** Campo de simulador (data-sim): cambia el "qué pasa si", no se guarda. */
function campoSim(clave, etiqueta, tipo, valor, ayuda = "") {
  return campo(`data-sim="${clave}"`, etiqueta, tipo, valor, ayuda);
}
function campo(atributo, etiqueta, tipo, valor, ayuda) {
  return `
    <label class="campo">
      <span class="campo-etq">${etiqueta}</span>
      <span class="campo-caja">
        ${tipo === "clp" ? `<span class="campo-suf">$</span>` : ""}
        <input type="text" inputmode="${tipo === "clp" ? "numeric" : "decimal"}" autocomplete="off"
               ${atributo} data-tipo="${tipo}" value="${mostrarCampo(valor, tipo)}">
        ${tipo !== "clp" && SUFIJO[tipo] ? `<span class="campo-suf">${SUFIJO[tipo]}</span>` : ""}
      </span>
      ${ayuda ? `<span class="campo-ayuda">${ayuda}</span>` : ""}
    </label>`;
}
/** Fila de botones para elegir un valor del simulador con un toque. */
function chipsSim(clave, opciones, actual) {
  return `<div class="chips">${opciones
    .map(
      ([valor, texto]) =>
        `<button type="button" class="chip${valor === actual ? " active" : ""}" data-chip="${clave}" data-valor="${valor}">${texto}</button>`
    )
    .join("")}</div>`;
}

/** Cablea un panel UNA vez (delegado): los campos se vuelven a crear en cada
 * pintada, así que los listeners van en el contenedor. `estado` es el objeto de
 * simulador de esa pestaña y `repintar` su render. */
function wirePanel(panel, estado, abiertas, repintar) {
  if (panel.dataset.wired) return;
  panel.dataset.wired = "1";

  panel.addEventListener("input", (e) => {
    const input = e.target;
    if (input.dataset.tipo !== "clp") return;
    // separador de miles mientras se escribe: "8000000" no se lee
    const n = input.value.replace(/[^\d]/g, "");
    input.value = n ? Number(n).toLocaleString("es-CL") : "";
  });

  panel.addEventListener("change", (e) => {
    const input = e.target;
    if (input.dataset.param) {
      const clave = input.dataset.param;
      const valor = leerCampo(input);
      parametros[clave] = { ...(parametros[clave] || { nota: "", fila: 0 }), valor };
      // un supuesto puede mover las dos pestañas (ej. el ahorro disponible)
      window.renderSoluciones();
      window.renderVehiculo();
      guardarParametro(clave, valor);
    } else if (input.dataset.sim) {
      estado[input.dataset.sim] = leerCampo(input);
      repintar();
    }
  });

  panel.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-chip]");
    if (chip) {
      const v = chip.dataset.valor;
      estado[chip.dataset.chip] = v !== "" && !isNaN(Number(v)) ? Number(v) : v;
      repintar();
      // "Simular este": el resultado está más arriba, hay que llevarte ahí
      if (chip.dataset.scroll) document.getElementById(chip.dataset.scroll)?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const cabeza = e.target.closest(".jugada-head");
    if (cabeza) {
      const id = cabeza.parentElement.dataset.jugada;
      if (abiertas.has(id)) abiertas.delete(id);
      else abiertas.add(id);
      const abierta = abiertas.has(id);
      cabeza.setAttribute("aria-expanded", String(abierta));
      cabeza.nextElementSibling.hidden = !abierta;
    }
  });
}

function jugada(abiertas, { id, titulo, ver, impacto, cuerpo }) {
  const abierta = abiertas.has(id);
  return `
    <section class="card jugada" data-jugada="${id}">
      <button type="button" class="jugada-head" aria-expanded="${abierta}">
        <span class="jugada-top">${veredicto(ver[0], ver[1])}<span class="macro-chev" aria-hidden="true"></span></span>
        <span class="jugada-titulo">${titulo}</span>
        <span class="jugada-impacto">${impacto}</span>
      </button>
      <div class="jugada-cuerpo" ${abierta ? "" : "hidden"}>${cuerpo}</div>
    </section>`;
}

/* ---------- cálculo ---------- */

const esHipotecario = (e) => /hipotec/i.test(e.credito.tipo);
const fechaEnMeses = (n) => mesLegible(sumarMeses(new Date(), n));
const duracion = (meses) => {
  const a = Math.floor(meses / 12);
  const m = meses % 12;
  if (a === 0) return `${m} ${m === 1 ? "mes" : "meses"}`;
  return `${a} ${a === 1 ? "año" : "años"}${m ? ` y ${m} ${m === 1 ? "mes" : "meses"}` : ""}`;
};

/** Lo que de verdad sale de tu bolsillo por este crédito cada mes. */
function costoNeto(e) {
  return Math.max(0, enPesos(e.credito, e.est.dividendoTotal) - devolucionDe(e.credito));
}

/** Avalancha: cada crédito sigue pagando su cuota; lo extra que pongas va al de
 * tasa más alta, y cuando uno se termina, la plata que liberaba (su cuota MENOS
 * lo que te devolvían por él) pasa al siguiente. Devuelve cuándo termina cada
 * uno y cuánto interés paga, para comparar contra el camino normal. */
function simularAvalancha(extraMensual) {
  const cs = [...estadosActuales]
    .sort((a, b) => b.credito.tasaActual - a.credito.tasaActual)
    .map((e) => ({
      credito: e.credito,
      est: e.est,
      saldo: e.est.saldo,
      i: e.credito.tasaActual / 12,
      cuota: e.credito.dividendoUF,
      f: factor(e.credito),
      liberada: costoNeto(e),
      meses: 0,
      interes: 0,
      vivo: e.est.saldo > 0.01,
    }));

  let mes = 0;
  while (cs.some((c) => c.vivo) && mes < 720) {
    mes++;
    // lo liberado por los que terminaron ANTES de este mes
    let extra = extraMensual + cs.filter((c) => !c.vivo && c.meses < mes).reduce((s, c) => s + c.liberada, 0);
    for (const c of cs) {
      if (!c.vivo) continue;
      const int = c.saldo * c.i;
      c.interes += int;
      c.saldo = c.saldo + int - Math.min(c.cuota, c.saldo + int);
    }
    for (const c of cs) {
      if (!c.vivo) continue;
      if (extra > 0) {
        const abono = Math.min(extra / c.f, c.saldo);
        c.saldo -= abono;
        extra -= abono * c.f;
      }
      if (c.saldo <= 0.01) {
        c.vivo = false;
        c.meses = mes;
      }
    }
  }
  return cs;
}

/** Portar un crédito a otra tasa manteniendo el plazo que queda. */
function portar(e, tasaAnual) {
  const nueva = cuotaFrancesa(e.est.saldo, tasaAnual, e.est.cuotasRestantes);
  const comision = e.est.saldo * e.credito.tasaActual * (e.credito.prepagoDias / 360);
  const baja = e.credito.dividendoUF - nueva;
  return { nueva, baja, comision, ahorro: baja * e.est.cuotasRestantes - comision };
}

/** La tasa anual bajo la cual portar deja plata después de pagar los costos. */
function tasaDeEquilibrio(e, costoExtra = 0) {
  let lo = 0;
  let hi = e.credito.tasaActual;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (enPesos(e.credito, portar(e, mid).ahorro) - costoExtra > 0) lo = mid;
    else hi = mid;
  }
  return lo;
}

/* ---------- las jugadas ---------- */

function jugadaAbonar(caro) {
  const { credito, est } = caro;
  const saldoCLP = enPesos(credito, est.saldo);
  const rinde = credito.tasaActual;
  const ahorroRinde = Pnum("ahorro_rendimiento_anual", 0.045);
  const disponible = Pnum("ahorro_disponible", 0);
  if (sim.abono == null) sim.abono = disponible > 0 ? Math.min(disponible, saldoCLP) : 1000000;
  const monto = Math.min(Math.max(0, sim.abono), saldoCLP);
  const total = monto >= saldoCLP - 1;
  const s = simularPrepago(credito, est, monto);
  const conviene = rinde > ahorroRinde;

  const resultado = total
    ? `${kv("Lo pagas completo", `${est.cuotasRestantes} cuotas menos`, "income")}
       ${kv("Interés que dejas de pagar", fmtCLP(enPesos(credito, est.interesQueFalta)), "income")}
       ${kv("Plata que liberas al mes", fmtCLP(costoNeto(caro)))}`
    : `${kv("Terminas antes", `${s.mesesMenos} ${s.mesesMenos === 1 ? "mes" : "meses"} menos`, "income")}
       ${kv("Interés que dejas de pagar", fmtCLP(enPesos(credito, s.interesAhorrado)), "income")}
       ${kv("O, si prefieres bajar la cuota", `${fmtCLP(enPesos(credito, s.cuotaNueva))} al mes (−${fmtCLP(enPesos(credito, s.bajaCuota))})`)}`;

  return {
    id: "abonar",
    ver: conviene ? ["hazlo", "Hazlo primero"] : ["evalua", "Evalúalo"],
    titulo: `Abonar al ${esc(credito.nombre.toLowerCase())}`,
    impacto: `Cada $1.000.000 que abones te ahorra <strong>${fmtCLP(1000000 * rinde)}</strong> al año`,
    cuerpo: `
      ${nota(
        `Es tu deuda más cara: ${pct(rinde * 100, 2)} al año. Abonar ahí es una inversión que rinde exactamente eso,
         segura y sin impuestos. Tu ahorro te rinde cerca de ${pct(ahorroRinde * 100, 1)}: ${
           conviene
             ? `cada peso guardado que no sea tu fondo de emergencia trabaja ${(rinde / ahorroRinde).toFixed(1).replace(".", ",")} veces más abonado acá.`
             : "en este caso el ahorro rinde más que el abono."
         }`
      )}
      ${campoSim("abono", "Si abono hoy", "clp", monto)}
      ${chipsSim(
        "abono",
        [
          [500000, "$500 mil"],
          [1000000, "$1M"],
          [3000000, "$3M"],
          [5000000, "$5M"],
          [Math.round(saldoCLP), "Todo"],
        ],
        monto
      )}
      <div class="kv-lista">
        ${resultado}
        ${kv("Comisión de prepago", fmtCLP(enPesos(credito, total ? est.saldo * credito.tasaActual * (credito.prepagoDias / 360) : s.comision)))}
      </div>
      ${campoParam("ahorro_rendimiento_anual", "Lo que rinde tu ahorro al año", "pct", 0.045)}
      ${nota("Antes de abonar, deja aparte un fondo de emergencia (3 meses de tus gastos fijos). Abonar no se puede deshacer.")}`,
  };
}

function jugadaAvalancha(caro) {
  const opciones = [0, 50000, 100000, 200000, 300000];
  const extra = Number(sim.extraMes) || 0;
  const cs = simularAvalancha(extra);
  let ahorroTotal = 0;
  const filas = cs
    .map((c) => {
      const antes = c.est.cuotasRestantes;
      const ahorro = enPesos(c.credito, c.est.interesQueFalta - c.interes);
      ahorroTotal += ahorro;
      const gana = antes - c.meses;
      return `
        <div class="plan-fila">
          <div>
            <div class="rank-nombre">${esc(c.credito.nombre)}</div>
            <div class="rank-meta">${
              gana > 0
                ? `termina ${fechaEnMeses(c.meses)} · antes ${fechaEnMeses(antes)}`
                : `termina ${fechaEnMeses(antes)}, igual que hoy`
            }</div>
          </div>
          <div class="rank-valor">
            <strong class="${gana > 0 ? "income" : ""}">${gana > 0 ? `${duracion(gana)} antes` : "—"}</strong>
            ${ahorro > 1000 ? `<div class="rank-meta">ahorras ${fmtCorto(ahorro)}</div>` : ""}
          </div>
        </div>`;
    })
    .join("");
  const liberada = costoNeto(caro);
  const sinExtra = simularAvalancha(0);
  const ahorroBase = sinExtra.reduce((s, c) => s + enPesos(c.credito, c.est.interesQueFalta - c.interes), 0);

  return {
    id: "avalancha",
    ver: ["hazlo", "Hazlo"],
    titulo: "Cuando termines uno, sigue con el siguiente",
    impacto: `Sin poner un peso más, ahorras <strong>${fmtCorto(ahorroBase)}</strong> de interés`,
    cuerpo: `
      ${nota(
        `El ${esc(caro.credito.nombre.toLowerCase())} termina en ${fechaEnMeses(caro.est.cuotasRestantes)}. Ese día se
         liberan ${fmtCLP(liberada)} al mes de tu bolsillo. Si en vez de gastarlos los mandas al crédito que sigue en
         tasa, la deuda se acorta sola. Es el mismo esfuerzo que haces hoy, sostenido.`
      )}
      <div class="campo-etq" style="margin-top:14px;">Y si además abono extra todos los meses</div>
      ${chipsSim("extraMes", opciones.map((o) => [o, o === 0 ? "Nada" : fmtCorto(o)]), extra)}
      <div class="plan">${filas}</div>
      <div class="kv-lista">${kv("Interés total que dejas de pagar", fmtCLP(ahorroTotal), "income")}</div>
      ${nota("Los créditos en UF están valorizados a la UF de hoy. Se ordena por tasa: primero el más caro, siempre.")}`,
  };
}

function jugadaRenegociar(hips) {
  if (hips.length < 2) return null;
  const orden = [...hips].sort((a, b) => b.credito.tasaActual - a.credito.tasaActual);
  const caroH = orden[0];
  const minima = orden[orden.length - 1].credito.tasaActual;
  if (caroH.credito.tasaActual - minima < 0.001) return null;
  if (sim.tasaObjetivo == null) sim.tasaObjetivo = minima;
  const objetivo = Math.min(sim.tasaObjetivo, caroH.credito.tasaActual);
  const { credito, est } = caroH;
  const nuevo = cuotaFrancesa(est.saldo, objetivo, est.cuotasRestantes);
  const bajaMes = enPesos(credito, credito.dividendoUF - nuevo);
  const interesNuevo = nuevo * est.cuotasRestantes - est.saldo;
  const ahorroTotal = enPesos(credito, est.interesQueFalta - interesNuevo);
  const base = orden[orden.length - 1].credito;

  return {
    id: "renegociar",
    ver: ["hazlo", "Pídelo"],
    titulo: `Pedir que te bajen la tasa del ${esc(credito.nombre)}`,
    impacto: `Si te la igualan a ${pct(minima * 100, 2)}: <strong>${fmtCLP(enPesos(credito, credito.dividendoUF - cuotaFrancesa(est.saldo, minima, est.cuotasRestantes)))}</strong> menos al mes`,
    cuerpo: `
      ${nota(
        `Tienes dos hipotecarios con tasas distintas: ${esc(base.nombre)} paga ${pct(minima * 100, 2)} y
         ${esc(credito.nombre)} paga ${pct(credito.tasaActual * 100, 2)}. Los dos pasaron a tasa variable, que se arma con la TAB
         más un margen (spread) que le suma el banco. Parte de la diferencia es ese margen, y ese margen se puede renegociar:
         pedirlo no cuesta nada.`
      )}
      ${campoSim("tasaObjetivo", "Si la tasa quedara en", "pct", objetivo)}
      <div class="kv-lista">
        ${kv("Dividendo", `${fmtCLP(enPesos(credito, nuevo + credito.segurosUF))} al mes`)}
        ${kv("Baja al mes", fmtCLP(bajaMes), "income")}
        ${kv("Al año", fmtCLP(bajaMes * 12), "income")}
        ${kv(`Interés total hasta ${mesLegible(est.ultimaCuota)}`, `${fmtCorto(ahorroTotal)} menos`, "income")}
      </div>
      ${nota(
        `Cómo pedirlo: pregunta en el banco cuál es el spread de cada crédito y pide por escrito que igualen el más alto al
         más bajo, diciendo que estás cotizando portabilidad. Si dicen que no, no pierdes nada. Cuánto se puede bajar depende
         de lo que diga tu escritura sobre cómo se fija la tasa variable.`
      )}`,
  };
}

function jugadaPortarHipotecarios(hips) {
  if (!hips.length) return null;
  const mercado = Pnum("hip_tasa_mercado", 0.0407);
  const costo = Pnum("hip_costo_operacion", 1000000);
  let extraMes = 0;
  const filas = hips
    .map((e) => {
      const aMercado = cuotaFrancesa(e.est.saldo, mercado, e.est.cuotasRestantes);
      const dif = enPesos(e.credito, aMercado - e.credito.dividendoUF);
      extraMes += dif;
      // cuánto tendría que bajar la tasa para recuperar los costos en 3 años
      const necesita = costo / 3 / enPesos(e.credito, e.est.saldo);
      return `
        <div class="plan-fila">
          <div>
            <div class="rank-nombre">${esc(e.credito.nombre)}</div>
            <div class="rank-meta">pagas ${pct(e.credito.tasaActual * 100, 2)} · conviene bajo ${pct(Math.max(0, e.credito.tasaActual - necesita) * 100, 2)}</div>
          </div>
          <div class="rank-valor">
            <strong class="${dif > 0 ? "expense" : "income"}">${dif > 0 ? "+" : "−"}${fmtCLP(Math.abs(dif))}</strong>
            <div class="rank-meta">al mes a ${pct(mercado * 100, 2)}</div>
          </div>
        </div>`;
    })
    .join("");
  const todosBajo = hips.every((e) => e.credito.tasaActual < mercado);

  return {
    id: "portar-hip",
    ver: todosBajo ? ["no", "No conviene hoy"] : ["evalua", "Cotiza"],
    titulo: "Llevar los hipotecarios a otro banco",
    impacto: todosBajo
      ? `Tus tasas están bajo el mercado: cambiarte te costaría <strong>${fmtCLP(extraMes)}</strong> más al mes`
      : `Al menos uno de tus créditos paga más que el mercado (${pct(mercado * 100, 2)})`,
    cuerpo: `
      ${nota(
        todosBajo
          ? `Hoy un hipotecario nuevo se da en promedio a ${pct(mercado * 100, 2)} en UF, y los dos tuyos pagan menos que eso.
             Portarlos o refinanciarlos sería cambiar una tasa buena por una peor, y además pagar los costos de la operación.`
          : `Hoy un hipotecario nuevo se da en promedio a ${pct(mercado * 100, 2)} en UF. Donde tu tasa sea más alta, vale la pena cotizar.`
      )}
      <div class="plan">${filas}</div>
      ${campoParam("hip_tasa_mercado", "Tasa promedio de mercado (UF, anual)", "pct", 0.0407, esc(parametros.hip_tasa_mercado?.nota || ""))}
      ${campoParam("hip_costo_operacion", "Costo de refinanciar (tasación, títulos, notaría, CBR)", "clp", 1000000)}
      ${nota(
        `"Conviene bajo" es la tasa que tendrían que ofrecerte para recuperar esos costos en 3 años. La portabilidad no
         paga impuesto de timbres, pero sí comisión de prepago (${hips[0].credito.prepagoDias} días de interés) y los gastos operacionales.
         Las tasas promocionales que publican los bancos suelen exigir vivienda nueva y subsidio a la tasa.`
      )}`,
  };
}

function jugadaRiesgoTasa(hips) {
  if (!hips.length) return null;
  const mercado = Pnum("hip_tasa_mercado", 0.0407);
  const sube = (puntos) =>
    hips.reduce(
      (s, e) => s + enPesos(e.credito, cuotaFrancesa(e.est.saldo, e.credito.tasaActual + puntos, e.est.cuotasRestantes) - e.credito.dividendoUF),
      0
    );
  const fijar = hips.reduce(
    (s, e) => s + Math.max(0, enPesos(e.credito, cuotaFrancesa(e.est.saldo, mercado, e.est.cuotasRestantes) - e.credito.dividendoUF)),
    0
  );
  const mas1 = sube(0.01);

  return {
    id: "riesgo-tasa",
    ver: ["info", "Vigílalo"],
    titulo: "Tus hipotecarios son de tasa variable",
    impacto: `Si la tasa sube 1 punto, pagas <strong>${fmtCLP(mas1)}</strong> más al mes`,
    cuerpo: `
      ${nota(
        `Se te acabó el período de tasa fija en los dos, y ahora la tasa se reajusta cada año según la TAB (la tasa a la que
         se prestan los bancos). Puede bajar o subir. Hoy pagas menos que una tasa fija nueva, así que fijarla sale caro;
         lo sano es saber cuánto te dolería una subida y tener ese colchón.`
      )}
      <div class="kv-lista">
        ${kv("Si sube 0,5 puntos", `+${fmtCLP(sube(0.005))} al mes`)}
        ${kv("Si sube 1 punto", `+${fmtCLP(mas1)} al mes`, "expense")}
        ${kv("Si sube 2 puntos", `+${fmtCLP(sube(0.02))} al mes`, "expense")}
        ${kv(`Fijarla hoy a tasa de mercado (${pct(mercado * 100, 2)})`, `+${fmtCLP(fijar)} al mes`)}
      </div>
      ${nota(
        `Fijar hoy equivale a pagar desde ya una subida de ${pct(
          (hips.reduce((s, e) => s + Math.max(0, mercado - e.credito.tasaActual) * enPesos(e.credito, e.est.saldo), 0) /
            hips.reduce((s, e) => s + enPesos(e.credito, e.est.saldo), 0)) *
            100,
          2
        ).replace("%", "")} puntos en promedio. Solo conviene si crees que la tasa va a subir más que eso y quedarse ahí.
         Revisa la fecha de reajuste de cada uno en el detalle de la primera pestaña.`
      )}`,
  };
}

function jugadaPortarConsumo(caro) {
  if (esHipotecario(caro)) return null;
  const { credito, est } = caro;
  const oferta = Pnum("consumo_tasa_oferta_mensual", 0.0089);
  const actualMes = credito.tasaActual / 12;
  const p = portar(caro, oferta * 12);
  const equilibrio = tasaDeEquilibrio(caro) / 12;
  const conviene = p.ahorro > 0;

  return {
    id: "portar-consumo",
    ver: conviene ? ["evalua", "Cotiza"] : ["no", "Tu tasa ya es buena"],
    titulo: `Portar el ${esc(credito.nombre.toLowerCase())}`,
    impacto: conviene
      ? `A ${pct(oferta * 100, 2)} mensual ahorras <strong>${fmtCLP(p.ahorro)}</strong> en lo que queda`
      : `Pagas ${pct(actualMes * 100, 2)} mensual: solo conviene bajo <strong>${pct(equilibrio * 100, 2)}</strong>`,
    cuerpo: `
      ${nota(
        `Tu crédito está a ${pct(actualMes * 100, 2)} mensual (${pct(credito.tasaActual * 100, 2)} anual). Para montos como el tuyo
         los bancos andan entre 0,9% y 1,5% mensual, y los comparadores muestran costos anuales (CAE) de 17% hacia arriba:
         estás en la parte buena. Cambiarte solo sirve si te ofrecen menos de ${pct(equilibrio * 100, 2)} mensual.`
      )}
      ${campoParam("consumo_tasa_oferta_mensual", "Tasa mensual que te ofrecen", "pct", 0.0089, "Pon acá la cotización real cuando la tengas.")}
      <div class="kv-lista">
        ${kv("Cuota nueva", `${fmtCLP(p.nueva)} al mes`)}
        ${kv("Baja al mes", fmtCLP(p.baja), p.baja > 0 ? "income" : "")}
        ${kv("Comisión de prepago", fmtCLP(p.comision))}
        ${kv(`Ahorro neto en ${est.cuotasRestantes} cuotas`, fmtCLP(p.ahorro), p.ahorro > 0 ? "income" : "expense")}
      </div>
      ${nota(
        `Compara por CAE y costo total, no por la cuota: una cuota más baja a más plazo casi siempre es más cara. Pide
         la cotización con el mismo plazo que te queda (${est.cuotasRestantes} meses) y sin seguros que no tengas hoy.`
      )}`,
  };
}

function jugadaConsolidar(caro, hips) {
  if (esHipotecario(caro) || !hips.length) return null;
  const { credito, est } = caro;
  const real = Pnum("fines_generales_tasa", 0.055);
  const inflacion = Pnum("inflacion_anual", 0.035);
  const nominal = real + inflacion;
  const costo = Pnum("hip_costo_operacion", 1000000);
  const mismaCuota = liquidar(est.saldo, nominal, credito.dividendoUF);
  const ahorro = est.interesQueFalta - mismaCuota.interes - costo;
  const cuota10 = cuotaFrancesa(est.saldo, nominal, 120);
  const interes10 = cuota10 * 120 - est.saldo;
  const conviene = ahorro > 500000;

  return {
    id: "consolidar",
    ver: conviene ? ["evalua", "Evalúalo"] : ["no", "No conviene"],
    titulo: "Meter el consumo dentro de un hipotecario",
    impacto: `Pagando lo mismo que hoy, ${ahorro > 0 ? `ganas apenas <strong>${fmtCLP(ahorro)}</strong>` : `pierdes <strong>${fmtCLP(-ahorro)}</strong>`}; a 10 años pagas <strong>${fmtCorto(interes10 - est.interesQueFalta)}</strong> más`,
    cuerpo: `
      ${nota(
        `La idea suena bien: cambiar un crédito al ${pct(credito.tasaActual * 100, 1)} por un hipotecario de fines generales
         con tu depto en garantía. Pero ese crédito va en UF: a UF + ${pct(real * 100, 1)} con inflación de ${pct(inflacion * 100, 1)}
         equivale a ${pct(nominal * 100, 1)} en pesos. La diferencia real es chica, y la operación cuesta.`
      )}
      <div class="kv-lista">
        ${kv("Interés que te falta hoy", fmtCLP(est.interesQueFalta))}
        ${kv("Con hipotecario, pagando la misma cuota", fmtCLP(mismaCuota.interes))}
        ${kv("Costo de la operación", fmtCLP(costo))}
        ${kv("Resultado", `${ahorro >= 0 ? "+" : "−"}${fmtCLP(Math.abs(ahorro))}`, ahorro > 0 ? "income" : "expense")}
        ${kv("Si lo estiras a 10 años", `cuota ${fmtCLP(cuota10)} · interés ${fmtCorto(interes10)}`, "expense")}
      </div>
      ${campoParam("fines_generales_tasa", "Tasa hipotecario fines generales (UF, anual)", "pct", 0.055)}
      ${campoParam("inflacion_anual", "Inflación esperada (anual)", "pct", 0.035)}
      ${nota(
        `El riesgo es el de siempre: la cuota baja, se siente alivio, y una deuda que terminaba en ${fechaEnMeses(est.cuotasRestantes)}
         se queda 10 o 15 años contigo, con tu casa en garantía. Te quedan ${est.cuotasRestantes} cuotas: mejor terminarlo.`
      )}`,
  };
}

function jugadaVender(caro, hips) {
  if (!hips.length) return null;
  // el depto propio: el hipotecario que más te cuesta de tu bolsillo
  const propio = [...hips].sort((a, b) => costoNeto(b) - costoNeto(a))[0];
  const { credito, est } = propio;
  const valorUF = Pnum("depto_valor_uf", 0);
  const corretaje = Pnum("depto_corretaje", 0.0238);
  const arriendo = Pnum("depto_arriendo", 0);
  const mercado = Pnum("hip_tasa_mercado", 0.0407);
  const saldo = enPesos(credito, est.saldo);
  const dividendo = enPesos(credito, est.dividendoTotal);

  const campos = `
    ${campoParam("depto_valor_uf", "En cuánto se vende", "uf", 0, esc(parametros.depto_valor_uf?.nota || "Ponlo según avisos de deptos iguales en tu edificio o una tasación."))}
    ${campoParam("depto_arriendo", "Arriendo de algo equivalente", "clp", 0)}`;

  if (!valorUF) {
    return {
      id: "vender",
      ver: ["info", "Falta un dato"],
      titulo: `Vender el ${esc(credito.nombre)}`,
      impacto: "Pon en cuánto se vende y te muestro qué te queda en la mano",
      cuerpo: campos,
    };
  }

  const valor = valorUF * uf.valor;
  const gastoVenta = valor * corretaje;
  const comision = enPesos(credito, est.saldo * credito.tasaActual * (credito.prepagoDias / 360));
  const enMano = valor - gastoVenta - saldo - comision;
  const otroEsCaro = caro.credito !== credito && !esHipotecario(caro);
  const saldoCaro = otroEsCaro ? enPesos(caro.credito, caro.est.saldo) : 0;
  const pagaCaro = otroEsCaro && enMano >= saldoCaro;
  const sobra = enMano - (pagaCaro ? saldoCaro : 0);
  const liberas = dividendo + (pagaCaro ? costoNeto(caro) : 0);
  const flujo = liberas - arriendo;
  // comprar otro: la misma deuda, a la tasa de hoy
  const dividendoNuevo = enPesos(credito, cuotaFrancesa(est.saldo, mercado, est.cuotasRestantes) + credito.segurosUF);
  const tasaPeor = mercado > credito.tasaActual;

  return {
    id: "vender",
    ver: ["info", "Decisión de vida"],
    titulo: `Vender el ${esc(credito.nombre)}`,
    impacto: `Te quedarían <strong>${fmtCorto(enMano)}</strong> en la mano${pagaCaro ? `, alcanza para pagar el ${esc(caro.credito.nombre.toLowerCase())}` : ""}`,
    cuerpo: `
      ${campos}
      <div class="kv-lista">
        ${kv("Precio de venta", fmtCLP(valor))}
        ${kv(`Corretaje y gastos (${pct(corretaje * 100, 1)})`, `−${fmtCLP(gastoVenta)}`)}
        ${kv("Pagar el hipotecario", `−${fmtCLP(saldo)}`)}
        ${kv("Comisión de prepago", `−${fmtCLP(comision)}`)}
        ${kv("Te queda en la mano", fmtCLP(enMano), enMano > 0 ? "income" : "expense")}
        ${pagaCaro ? kv(`Pagar el ${esc(caro.credito.nombre.toLowerCase())}`, `−${fmtCLP(saldoCaro)}`) : ""}
        ${pagaCaro ? kv("Te sobra", fmtCLP(sobra), "income") : ""}
      </div>
      <div class="kv-lista">
        ${kv("Dejas de pagar al mes", fmtCLP(liberas), "income")}
        ${arriendo ? kv("Pero pagas arriendo", `−${fmtCLP(arriendo)}`, "expense") : ""}
        ${arriendo ? kv("Cambio en tu mes", `${flujo >= 0 ? "+" : "−"}${fmtCLP(Math.abs(flujo))}`, flujo >= 0 ? "income" : "expense") : ""}
      </div>
      ${nota(
        `Lo que no se ve en el flujo: de tu dividendo, ${fmtCLP(enPesos(credito, est.capital))} al mes son capital, o sea ahorro
         que queda en tu depto. El arriendo es gasto entero. ${
           tasaPeor
             ? `Y si vendes para comprar otro, la tasa de ${pct(credito.tasaActual * 100, 2)} que tienes hoy no existe: por la misma deuda
                a ${pct(mercado * 100, 2)} pagarías ${fmtCLP(dividendoNuevo)} al mes (${fmtCLP(dividendoNuevo - dividendo)} más), aparte de
                corretaje, impuestos y gastos de la compra nueva.`
             : ""
         }`
      )}
      ${nota(
        `Vender tiene sentido si cambia tu vida (te mudas, necesitas otro tamaño, no puedes con el dividendo). Como jugada
         solo para bajar deuda es cara: cambias un dividendo a tasa baja, que en parte es ahorro, por un arriendo que es gasto
         entero. Tu deuda cara es el consumo, y esa se resuelve abonando.`
      )}`,
  };
}

function jugadaSeguros(hips) {
  const total = hips.reduce((s, e) => s + enPesos(e.credito, e.est.seguros), 0);
  if (total <= 0) return null;
  const ahorroPct = Pnum("seguros_ahorro_pct", 0.3);
  return {
    id: "seguros",
    ver: ["evalua", "Cotiza una vez"],
    titulo: "Los seguros de los hipotecarios",
    impacto: `Pagas <strong>${fmtCLP(total * 12)}</strong> al año en desgravamen e incendio`,
    cuerpo: `
      ${nota(
        `Dentro de cada dividendo van el seguro de desgravamen y el de incendio y sismo: ${fmtCLP(total)} al mes entre los dos
         créditos. La ley te deja contratarlos por fuera con otra compañía y endosarlos al banco, siempre que cubran lo mismo.`
      )}
      <div class="kv-lista">
        ${kv("Seguros al mes", fmtCLP(total))}
        ${kv("Al año", fmtCLP(total * 12))}
        ${kv(`Si consigues ${pct(ahorroPct * 100, 0)} menos`, `${fmtCLP(total * 12 * ahorroPct)} al año`, "income")}
      </div>
      ${campoParam("seguros_ahorro_pct", "Ahorro que supongo al cotizar por fuera", "pct", 0.3)}
      ${nota(
        `No es plata grande, pero es un trámite de una vez. Pide en el banco el detalle de la póliza colectiva (prima y coberturas)
         y cotiza lo mismo en un corredor. Si la colectiva del banco ya es barata, se deja como está.`
      )}`,
  };
}

function jugadaUF(hips) {
  const deudaUF = hips.filter((e) => e.credito.moneda === "UF").reduce((s, e) => s + e.est.saldo, 0);
  if (deudaUF <= 0) return null;
  const inflacion = Pnum("inflacion_anual", 0.035);
  const alAño = deudaUF * uf.valor * inflacion;
  const capitalAño = hips.filter((e) => e.credito.moneda === "UF").reduce((s, e) => s + enPesos(e.credito, e.est.capital), 0) * 12;
  return {
    id: "uf",
    ver: ["info", "Para saber"],
    titulo: "Tu deuda hipotecaria sube con la UF",
    impacto: `Con inflación de ${pct(inflacion * 100, 1)}, crece <strong>${fmtCorto(alAño)}</strong> al año en pesos`,
    cuerpo: `
      ${nota(
        `Debes ${fmtUF(deudaUF, 0)}. En UF la deuda baja todos los meses, pero en pesos cada UF vale más: con inflación de
         ${pct(inflacion * 100, 1)} el reajuste suma ${fmtCLP(alAño)} al año, mientras tus dividendos amortizan ${fmtCLP(capitalAño)} de capital.`
      )}
      <div class="kv-lista">
        ${kv("Capital que pagas al año", fmtCLP(capitalAño), "income")}
        ${kv("Reajuste de la UF al año", `+${fmtCLP(alAño)}`, "expense")}
        ${kv("Tu deuda en pesos", capitalAño > alAño ? `baja ${fmtCLP(capitalAño - alAño)} al año` : `sube ${fmtCLP(alAño - capitalAño)} al año`, capitalAño > alAño ? "income" : "expense")}
      </div>
      ${nota(
        `No es un problema mientras tu sueldo suba al menos con el IPC: el dividendo pesa lo mismo. Sirve para dos cosas: negociar
         el reajuste de sueldo cada año, y no asustarte si un mes ves que el saldo en pesos subió.`
      )}`,
  };
}

/* ---------- la pestaña ---------- */

window.renderSoluciones = function renderSoluciones() {
  const panel = $("panel-soluciones");
  if (!panel || !estadosActuales.length || !cargaActual) return;
  wirePanel(panel, sim, jugadasAbiertas, window.renderSoluciones);

  const estados = estadosActuales;
  const caro = [...estados].sort((a, b) => b.credito.tasaActual - a.credito.tasaActual)[0];
  const hips = estados.filter(esHipotecario);
  const suma = (campo) => estados.reduce((s, e) => s + enPesos(e.credito, e.est[campo]), 0);
  const costoMes = suma("interes") + suma("seguros");
  const capitalMes = suma("capital");
  const carga = cargaActual;
  const bajarPara40 = Math.max(0, carga.cuotas - carga.cubos.ingreso * 0.4);

  const jugadas = [
    jugadaAbonar(caro),
    jugadaAvalancha(caro),
    jugadaRenegociar(hips),
    jugadaPortarConsumo(caro),
    jugadaSeguros(hips),
    jugadaRiesgoTasa(hips),
    jugadaPortarHipotecarios(hips),
    jugadaConsolidar(caro, hips),
    jugadaVender(caro, hips),
    jugadaUF(hips),
  ].filter(Boolean);

  // El plan: las que tienen veredicto "hazlo", en el orden en que se muestran.
  const plan = jugadas.filter((j) => j.ver[0] === "hazlo").map((j) => `<li><strong>${j.titulo}.</strong> ${j.impacto}.</li>`);
  const noTocar = jugadas.filter((j) => j.ver[0] === "no").map((j) => j.titulo.toLowerCase());

  panel.innerHTML = `
    <div class="card card-hero">
      <div class="hero-grid">
        <div class="hero-box hero-box-wide">
          <div class="hero-head"><span class="stat-label">Lo que te cuesta la deuda al mes</span></div>
          <div class="stat-value hero-num">${fmtCLP(costoMes)}</div>
          <div class="hero-estado">interés y seguros · los otros ${fmtCLP(capitalMes)} son capital, quedan tuyos</div>
        </div>
        <div class="hero-box">
          <div class="hero-head"><span class="stat-label">Sale de tu bolsillo</span></div>
          <div class="stat-value hero-num-sm">${fmtCLP(carga.neta)}</div>
          <div class="hero-estado">${pct(carga.pctNeta)} de tu ingreso</div>
        </div>
        <div class="hero-box">
          <div class="hero-head"><span class="stat-label">Lo que ve el banco</span></div>
          <div class="stat-value hero-num-sm ${carga.pctBruta > 40 ? "expense" : ""}">${pct(carga.pctBruta)}</div>
          <div class="hero-estado">${bajarPara40 > 0 ? `sobre 40% por ${fmtCLP(bajarPara40)}` : "bajo el 40%"}</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">El plan, en corto</div>
      <ol class="plan-lista">${plan.join("")}</ol>
      ${
        noTocar.length
          ? `<p class="card-sub" style="margin:12px 0 0;">Lo que <strong>no</strong> conviene hoy: ${noTocar.join("; ")}. Abajo está el porqué de cada una, con tus números.</p>`
          : ""
      }
    </div>

    ${jugadas.map((j) => jugada(jugadasAbiertas, j)).join("")}

    <p class="pie-supuestos">
      Los cálculos usan tus créditos de la pestaña Deuda financiera y supuestos de mercado que puedes cambiar en cada
      tarjeta (quedan guardados en la pestaña Parametros de tu planilla). Son simulaciones para decidir, no una oferta:
      antes de firmar pide la cotización formal y compara el costo total.
    </p>`;
};
