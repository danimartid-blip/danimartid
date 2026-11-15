/* Pestaña "Vehículo" de Deuda: en cuánto se vende el auto de hoy, cuánto auto
 * aguantan tus números y qué opciones calzan.
 *
 * Los datos del auto, los precios de mercado y los candidatos viven en la
 * planilla (pestañas "Parametros" y "Vehiculos"): son personales o cambian con
 * el mercado, y el repo es público. Acá solo está la cuenta.
 *
 * Usa las piezas de deuda-soluciones.js (campos, chips, jugada, wirePanel) y los
 * mismos estadosActuales / cargaActual de la pestaña principal. */

const simAuto = { precio: null, escenario: "auto_venta_rapida", pieExtra: null, plazo: null };
const autoAbiertas = new Set();

const ESCENARIOS_VENTA = [
  ["auto_venta_rapida", "Venta rápida"],
  ["auto_publicar", "Al precio publicado"],
  ["auto_parte_pago", "En parte de pago"],
];

/** Dónde cae cada gasto del auto. Se mira la subcategoría de Movimientos. */
const GRUPOS_AUTO = [
  ["Combustible", /petr[oó]leo|bencina|combustible|di[eé]sel/],
  ["TAG y peajes", /tag|peaje|autopista/],
  ["Mantención y arreglos", /manten|arreglo|aline|balanc|neum|bater|repuesto|taller|rey[oó]n|freno|aceite|bandeja|pintura|desabolla/],
  ["Seguro", /seguro|soap/],
  ["Permiso y revisión técnica", /permiso|revisi[oó]n/],
  ["Estacionamiento y lavado", /estacion|lavado/],
];
const MESES_COSTO_AUTO = 12;
const MESES_FLUJO = 6;

/** Lo que te costó el auto en los últimos 12 meses cerrados, por grupo y neto
 * de reembolsos. Entra la categoría Vehículo completa y, de Gastos inusuales,
 * solo lo que dice "auto" o "permiso de circulación". Se salta lo que es de otra
 * persona (el permiso del papá) aunque esté en la misma categoría. */
function costosAuto() {
  const meses = Array.from({ length: MESES_COSTO_AUTO }, (_, k) => mesCerrado(k + 1));
  const grupos = new Map(GRUPOS_AUTO.map(([nombre]) => [nombre, 0]));
  grupos.set("Otros", 0);
  for (const m of movimientos) {
    if (!meses.includes(claveMes(m))) continue;
    const cat = norm(m.categoria);
    const sub = norm(m.subcategoria);
    const esAuto = cat === "vehículo" || cat === "vehiculo" || (cat === "gastos inusuales" && /\bauto\b|permiso de circulaci/.test(sub));
    if (!esAuto || /pap[aá]|mam[aá]/.test(sub)) continue;
    const grupo = (GRUPOS_AUTO.find(([, re]) => re.test(sub)) || ["Otros"])[0];
    // Gasto viene negativo e Ingreso (reembolso) positivo: restar el monto netea solo
    grupos.set(grupo, grupos.get(grupo) - m.monto);
  }
  const filas = [...grupos.entries()].map(([nombre, total]) => ({ nombre, mes: total / MESES_COSTO_AUTO })).filter((g) => Math.abs(g.mes) >= 500);
  return { filas, total: filas.reduce((s, g) => s + g.mes, 0) };
}

/** Lo que te sobró (o faltó) cada mes: lo que entró menos lo que salió, sin
 * contar los traspasos con tu propio ahorro (ni lo que guardaste ni lo que
 * sacaste) ni los castigos de incobrables, que no mueven plata. Es aproximado,
 * pero responde lo que importa acá: ¿hay espacio para una cuota nueva? */
function flujoLibre() {
  const meses = Array.from({ length: MESES_FLUJO }, (_, k) => mesCerrado(MESES_FLUJO - k));
  const porMes = new Map(meses.map((k) => [k, 0]));
  for (const m of movimientos) {
    const k = claveMes(m);
    if (!porMes.has(k)) continue;
    if (esTraspasoPropio(m) || norm(m.subcategoria) === "incobrable") continue;
    if (m.tipo === "Ingreso" || m.tipo === "Gasto") porMes.set(k, porMes.get(k) + m.monto);
  }
  const serie = meses.map((k) => ({ mes: k, flujo: porMes.get(k) }));
  return { serie, promedio: serie.reduce((s, x) => s + x.flujo, 0) / MESES_FLUJO };
}

/** Cuánto crédito soporta una cuota (valor presente de la cuota). */
function creditoParaCuota(cuota, tasaMensual, plazo) {
  return tasaMensual === 0 ? cuota * plazo : (cuota * (1 - Math.pow(1 + tasaMensual, -plazo))) / tasaMensual;
}

function nivelCuota(cuota, comoda, tope) {
  if (cuota <= 0) return ["hazlo", "Sin deuda"];
  if (cuota <= comoda) return ["hazlo", "Cuota cómoda"];
  if (cuota <= tope) return ["evalua", "Apretada"];
  return ["no", "No recomendable"];
}

function listaChequeo(titulo, items) {
  return `<div class="chequeo"><div class="chequeo-titulo">${titulo}</div><ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul></div>`;
}

window.renderVehiculo = function renderVehiculo() {
  const panel = $("panel-vehiculo");
  if (!panel || !cargaActual) return;
  wirePanel(panel, simAuto, autoAbiertas, window.renderVehiculo);

  const carga = cargaActual;
  const ingreso = carga.cubos.ingreso;
  const ventaRapida = Pnum("auto_venta_rapida", 0);
  const publicar = Pnum("auto_publicar", 0);
  const partePago = Pnum("auto_parte_pago", 0);
  const nombre = String(P("auto_nombre", "Tu auto"));
  const km = Pnum("auto_km", 0);
  const tasaMes = Pnum("auto_tasa_mensual", 0.0125);
  const comoda = ingreso * Pnum("auto_cuota_comoda_pct", 0.05);
  const tope = ingreso * Pnum("auto_cuota_tope_pct", 0.08);
  const transferencia = Pnum("auto_transferencia_pct", 0.015);

  const comparables = vehiculos.filter((v) => /compar/i.test(v.tipo));
  const candidatos = vehiculos.filter((v) => /candid|nuevo/i.test(v.tipo)).sort((a, b) => a.precio - b.precio);

  if (simAuto.plazo == null) simAuto.plazo = Pnum("auto_plazo", 36);
  if (simAuto.pieExtra == null) simAuto.pieExtra = Pnum("ahorro_disponible", 0);
  const plazo = Number(simAuto.plazo) || 36;
  const pieVenta = Pnum(simAuto.escenario, ventaRapida);
  const pie = pieVenta + (Number(simAuto.pieExtra) || 0);
  const alcanzaComoda = pie + creditoParaCuota(comoda, tasaMes, plazo);
  const alcanzaTope = pie + creditoParaCuota(tope, tasaMes, plazo);
  if (simAuto.precio == null) {
    // por defecto, el candidato más caro que todavía calza con la cuota cómoda
    const calzan = candidatos.filter((c) => c.precio <= alcanzaComoda);
    simAuto.precio = (calzan[calzan.length - 1] || candidatos[0] || { precio: Math.round(alcanzaComoda / 100000) * 100000 }).precio;
  }
  const precio = Number(simAuto.precio) || 0;
  const financiar = Math.max(0, precio - pie);
  const cuota = cuotaFrancesa(financiar, tasaMes * 12, plazo);
  const intereses = cuota * plazo - financiar;
  const nivel = nivelCuota(cuota, comoda, tope);
  const cargaNueva = ingreso ? ((carga.cuotas + cuota) / ingreso) * 100 : 0;
  const netaNueva = ingreso ? ((carga.neta + cuota) / ingreso) * 100 : 0;

  const costos = costosAuto();
  const flujo = flujoLibre();
  const arreglos = costos.filas.find((g) => g.nombre === "Mantención y arreglos");
  const maxFlujo = Math.max(1, ...flujo.serie.map((x) => Math.abs(x.flujo)));

  // ---------- 1. el auto de hoy ----------
  const hero = ventaRapida
    ? `
    <div class="card card-hero">
      <div class="hero-grid">
        <div class="hero-box hero-box-wide">
          <div class="hero-head"><span class="stat-label">Tu auto, vendido rápido</span></div>
          <div class="stat-value hero-num">${fmtCLP(ventaRapida)}</div>
          <div class="hero-estado">${esc(nombre)}${km ? ` · ${Math.round(km).toLocaleString("es-CL")} km` : ""}</div>
        </div>
        <div class="hero-box">
          <div class="hero-head"><span class="stat-label">Publícalo en</span></div>
          <div class="stat-value hero-num-sm">${fmtCLP(publicar)}</div>
          <div class="hero-estado">para tener margen</div>
        </div>
        <div class="hero-box">
          <div class="hero-head"><span class="stat-label">En parte de pago</span></div>
          <div class="stat-value hero-num-sm">${fmtCLP(partePago)}</div>
          <div class="hero-estado">automotora</div>
        </div>
      </div>
    </div>`
    : `
    <div class="card">
      <div class="card-title">Falta el valor de tu auto</div>
      <p class="card-sub">Carga en la pestaña Parametros de tu planilla las claves auto_nombre, auto_venta_rapida, auto_publicar y auto_parte_pago, o ponlo acá.</p>
      ${campoParam("auto_venta_rapida", "En cuánto lo vendes", "clp", 0)}
    </div>`;

  const porQue = `
    <div class="card">
      <div class="card-title">Por qué ese precio</div>
      ${P("auto_nota", "") ? `<p class="card-sub">${esc(P("auto_nota", ""))}</p>` : ""}
      ${
        comparables.length
          ? `<div class="stat-label" style="margin-top:4px;">Lo que hay publicado</div>
             ${comparables
               .map(
                 (v) => `
               <div class="rank-row">
                 <div class="rank-info">
                   <div class="rank-nombre">${esc(v.modelo)}</div>
                   <div class="rank-meta">${esc(v.años)} · ${Math.round(v.km).toLocaleString("es-CL")} km${v.ojo ? ` · ${esc(v.ojo)}` : ""}</div>
                 </div>
                 <div class="rank-valor"><strong>${fmtCLP(v.precio)}</strong></div>
               </div>`
               )
               .join("")}
             <p class="card-sub" style="margin:10px 0 0;">Son precios pedidos, no de cierre: un usado se negocia entre 5% y 10% abajo. ${esc(comparables[0].fuente)}</p>`
          : ""
      }
      <div class="campos-2">
        ${campoParam("auto_venta_rapida", "Venta rápida", "clp", 0)}
        ${campoParam("auto_publicar", "Publicado", "clp", 0)}
      </div>
    </div>`;

  // ---------- 2. lo que cuesta hoy ----------
  const costoHoy = `
    <div class="card">
      <div class="card-title">Lo que te cuesta tu auto hoy</div>
      <p class="card-sub">Promedio mensual de tus últimos ${MESES_COSTO_AUTO} meses, según lo que registraste.</p>
      ${costos.filas
        .sort((a, b) => b.mes - a.mes)
        .map(
          (g) => `
        <div class="costo-fila">
          <div class="kv"><span>${g.nombre}</span><strong>${fmtCLP(g.mes)}</strong></div>
          ${barra(costos.total > 0 ? (g.mes / costos.total) * 100 : 0)}
        </div>`
        )
        .join("")}
      <div class="kv kv-total"><span>Total al mes</span><strong>${fmtCLP(costos.total)}</strong></div>
      <p class="card-sub" style="margin:12px 0 0;">
        ${
          arreglos
            ? `En mantención y arreglos se te van <strong>${fmtCLP(arreglos.mes)}</strong> al mes (${fmtCLP(arreglos.mes * 12)} al año): esa es la línea que un auto más nuevo y confiable baja de verdad. `
            : ""
        }A cambio suben el permiso de circulación y el seguro, que dependen del valor del auto. Y si pasas de diésel a
        bencina, el combustible: una SUV 2.0 a bencina gasta cerca de 40% más por kilómetro; una híbrida, parecido a lo de hoy.
      </p>
    </div>`;

  // ---------- 3. cuánto aguantas ----------
  const capacidad = `
    <div class="card">
      <div class="card-title">Cuánta cuota aguantas</div>
      <div class="kv-lista" style="margin-top:0;">
        ${kv("Tu ingreso propio", `${fmtCLP(ingreso)} al mes`)}
        ${kv("Cuotas que ya tienes", `${fmtCLP(carga.cuotas)} · ${pct(carga.pctBruta)}`, carga.pctBruta > 40 ? "expense" : "")}
        ${kv("De eso sale de tu bolsillo", `${fmtCLP(carga.neta)} · ${pct(carga.pctNeta)}`)}
      </div>
      <div class="stat-label" style="margin-top:16px;">Lo que te sobró cada mes</div>
      <div class="flujo">
        ${flujo.serie
          .map(
            (x) => `
          <div class="flujo-col" title="${fmtCLP(x.flujo)}">
            <div class="flujo-slot"><div class="flujo-barra ${x.flujo < 0 ? "neg" : ""}" style="height:${Math.max(4, (Math.abs(x.flujo) / maxFlujo) * 100)}%"></div></div>
            <div class="flujo-valor ${x.flujo < 0 ? "expense" : "income"}">${fmtCorto(x.flujo).replace("$", "")}</div>
            <div class="spark-label">${MESES[Number(x.mes.slice(5))]}</div>
          </div>`
          )
          .join("")}
      </div>
      <div class="kv kv-total"><span>Promedio de ${MESES_FLUJO} meses</span><strong class="${flujo.promedio < 0 ? "expense" : "income"}">${fmtCLP(flujo.promedio)}</strong></div>
      <p class="card-sub" style="margin:12px 0 0;">
        ${
          flujo.promedio < 0
            ? `En promedio gastaste ${fmtCLP(-flujo.promedio)} al mes más de lo que te entró, y lo cubriste con tu ahorro. Hoy no hay
               espacio para una cuota: tendría que salir de lo que dejes de gastar en arreglos${arreglos ? ` (${fmtCLP(arreglos.mes)} al mes)` : ""} y de recortar otros gastos.`
            : flujo.promedio < comoda
              ? `Lo que entra y lo que sale están casi parejos (sin contar lo que mueves con tu ahorro). Una cuota nueva tendría
                 que salir de lo que dejes de gastar en arreglos${arreglos ? ` (${fmtCLP(arreglos.mes)} al mes)` : ""} y de recortar otros gastos.`
              : `En promedio te sobran ${fmtCLP(flujo.promedio)} al mes: hay espacio para una cuota moderada.`
        }
        ${carga.pctBruta > 40 ? ` Además el banco ya te ve en ${pct(carga.pctBruta)} de carga: es probable que te pidan más pie o te ofrezcan una tasa más alta.` : ""}
      </p>
      <div class="tramos">
        <div class="tramo tramo-ok"><span>Cuota cómoda</span><strong>hasta ${fmtCLP(comoda)}</strong><em>${pct(Pnum("auto_cuota_comoda_pct", 0.05) * 100, 0)} de tu ingreso</em></div>
        <div class="tramo tramo-justo"><span>Tope</span><strong>hasta ${fmtCLP(tope)}</strong><em>${pct(Pnum("auto_cuota_tope_pct", 0.08) * 100, 0)} de tu ingreso</em></div>
      </div>
    </div>`;

  // ---------- 4. simulador ----------
  const simulador = `
    <div class="card" id="simuladorAuto">
      <div class="card-title">Simula la compra</div>
      ${campoSim("precio", "Precio del auto", "clp", precio)}
      <div class="campo-etq" style="margin-top:14px;">Tu pie: cómo vendes el tuyo</div>
      ${chipsSim("escenario", ESCENARIOS_VENTA.map(([clave, texto]) => [clave, `${texto} · ${fmtCorto(Pnum(clave, 0))}`]), simAuto.escenario)}
      ${campoSim("pieExtra", "Más ahorro que pones de pie", "clp", Number(simAuto.pieExtra) || 0)}
      <div class="campo-etq" style="margin-top:14px;">Plazo</div>
      ${chipsSim("plazo", [12, 24, 36, 48].map((n) => [n, `${n} meses`]), plazo)}
      ${campoParam("auto_tasa_mensual", "Tasa mensual del crédito", "pct", 0.0125, "Los automotrices andan entre 0,8% y 2% mensual. Pon la que te coticen.")}

      <div class="resultado resultado-${nivel[0]}">
        <div class="resultado-top">
          <div>
            <div class="stat-label">Cuota</div>
            <div class="stat-value">${financiar > 0 ? fmtCLP(cuota) : "$0"}</div>
          </div>
          ${veredicto(nivel[0], nivel[1])}
        </div>
        <div class="kv-lista">
          ${kv("Pie", fmtCLP(pie))}
          ${kv("A financiar", fmtCLP(financiar))}
          ${financiar > 0 ? kv(`Intereses en ${plazo} meses`, fmtCLP(intereses), "expense") : ""}
          ${kv(`Impuesto de transferencia (${pct(transferencia * 100, 1)}, si es usado)`, fmtCLP(precio * transferencia))}
          ${kv("Carga que ve el banco", `${pct(carga.pctBruta)} → ${pct(cargaNueva)}`, cargaNueva > 40 ? "expense" : "")}
          ${kv("De tu bolsillo", `${pct(carga.pctNeta)} → ${pct(netaNueva)}`)}
        </div>
      </div>

      <div class="stat-label" style="margin-top:16px;">Hasta qué precio llegas a ${plazo} meses</div>
      <div class="kv-lista" style="margin-top:6px;">
        ${kv("Sin deuda", fmtCLP(pie), "income")}
        ${kv("Con cuota cómoda", fmtCLP(alcanzaComoda))}
        ${kv("Con el tope", fmtCLP(alcanzaTope))}
      </div>
    </div>`;

  // ---------- 5. candidatos ----------
  const tarjeta = (v) => {
    const falta = Math.max(0, v.precio - pie);
    const c = cuotaFrancesa(falta, tasaMes * 12, plazo);
    const n = nivelCuota(c, comoda, tope);
    const esNuevo = /nuevo/i.test(v.tipo);
    return `
      <div class="auto ${v.precio === precio ? "auto-elegido" : ""}">
        <div class="auto-top">
          <div style="min-width:0;">
            <div class="auto-modelo">${esc(v.modelo)}</div>
            <div class="rank-meta">${esNuevo ? "Nuevo" : `${esc(v.años)} · unos ${Math.round(v.km / 1000)} mil km`}</div>
          </div>
          <div class="auto-precio">${fmtCorto(v.precio)}</div>
        </div>
        <div class="auto-cuenta">
          ${veredicto(n[0], n[1])}
          <span>${falta > 0 ? `te faltan ${fmtCorto(falta)} · ${fmtCLP(c)} al mes` : "lo pagas con el pie"}</span>
        </div>
        ${v.porQue ? `<p class="auto-texto"><strong>A favor:</strong> ${esc(v.porQue)}</p>` : ""}
        ${v.ojo ? `<p class="auto-texto"><strong>Ojo:</strong> ${esc(v.ojo)}</p>` : ""}
        <button type="button" class="btn-link" data-chip="precio" data-valor="${v.precio}" data-scroll="simuladorAuto">Simular este</button>
      </div>`;
  };
  const listaCandidatos = candidatos.length
    ? `
    <div class="card">
      <div class="card-title">Opciones que calzan con lo que buscas</div>
      <p class="card-sub">
        SUV automáticas, de marcas con buena fama de confiabilidad y con menos kilómetros que el tuyo. El precio es la
        mediana de lo publicado; la cuota usa tu pie y el plazo del simulador. ${esc(candidatos[0].fuente)}
      </p>
      ${candidatos.map(tarjeta).join("")}
    </div>`
    : "";

  // ---------- 6. buenas prácticas ----------
  const chequeos = `
    <div class="card">
      <div class="card-title">Para hacerlo bien</div>
      ${listaChequeo("Antes de vender el tuyo", [
        "Véndelo recién cuando esté reparado y con la orden de trabajo cerrada: un auto con siniestro abierto no se vende.",
        "Junta las mantenciones y boletas: con muchos kilómetros, el historial es lo que sostiene el precio.",
        "Sé directo con el kilometraje y con el choque reparado. El comprador lo va a ver en el informe y en la revisión, y esconderlo bota la venta.",
        "Publica con fotos de día, limpio, y en dos portales a la vez. Si en 3 semanas no hay ofertas serias, baja al precio de venta rápida.",
        "La transferencia se hace en notaría o Registro Civil con pago por vale vista o transferencia confirmada. No entregues el auto antes.",
      ])}
      ${listaChequeo("Antes de comprar", [
        "Pide el informe del auto por patente (dueños anteriores, prendas, multas, kilometraje registrado) antes de ir a verlo.",
        "Revisión con un mecánico de tu confianza o servicio de inspección a domicilio: cuesta poco al lado de un motor o una caja.",
        "Prefiere motor aspirado con caja automática convencional o CVT de marca japonesa. Evita doble embrague con muchos kilómetros.",
        "Compara el crédito por costo total (CAE), no por la cuota. Y cotiza el crédito en tu banco antes de aceptar el de la automotora.",
        "Calcula el auto completo: cuota + seguro + permiso + combustible + mantención. La regla sana es no pasar de 4 años de plazo.",
      ])}
    </div>`;

  panel.innerHTML = `
    ${hero}
    ${ventaRapida ? porQue : ""}
    ${costoHoy}
    ${capacidad}
    ${simulador}
    ${listaCandidatos}
    ${chequeos}
    <p class="pie-supuestos">
      Los precios y candidatos salen de la pestaña Vehiculos de tu planilla, con avisos publicados en la fecha indicada:
      cambian todas las semanas. Los valores de tu auto y la tasa los puedes corregir acá y quedan guardados.
    </p>`;
  Anim.barras(panel);
};
