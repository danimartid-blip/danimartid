const $ = (id) => document.getElementById(id);

let state = { tipo: "Gasto", estado: "Pagado" };

function showToast(msg, isError = false) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast show" + (isError ? " error" : "");
  setTimeout(() => (t.className = "toast"), 2200);
}

function wireToggle(containerId, dataAttr, stateKey) {
  const container = $(containerId);
  container.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      container.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state[stateKey] = btn.dataset[dataAttr];
    });
  });
}

function fillDatalist(id, values) {
  const dl = $(id);
  dl.innerHTML = "";
  [...new Set(values.filter(Boolean))].sort().forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v;
    dl.appendChild(opt);
  });
}

let categoriaSubMap = {};
let diaVencPorMedio = {}; // "Limited" -> 10 (día del mes en que suele vencer)
let historialPorMedio = {}; // "Limited" -> [{fecha, estado, monto, detalle}, ...]

/** Acepta "3/9/2026" o "2026-09-03" y devuelve un Date comparable (o null). */
function parseAnyFecha(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (s.includes("/")) {
    const [d, m, y] = s.split("/");
    return new Date(Number(y), Number(m) - 1, Number(d));
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-");
    return new Date(Number(y), Number(m) - 1, Number(d));
  }
  return null;
}

let cuentasReales = new Set(); // nombres normalizados de tus cuentas (Cuentas!A) — lo demás es "tarjeta de crédito"

/** Un medio de pago tipo "Limited USD" está en dólares — el monto se ingresa
 * en USD y se convierte solo a CLP con el dólar del día de la compra. */
function esMedioUSD(medio) {
  return /usd/i.test(medio || "");
}

/** "2026-09-10" -> "10-09-2026" (formato que usa mindicador.cl). */
function isoADiaMesAño(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

const dolarCache = new Map(); // "DD-MM-YYYY" -> valor

/** Dólar observado (mindicador.cl) para la fecha pedida. Los fines de semana
 * y feriados no publican valor nuevo, así que si no hay dato ese día se
 * retrocede día por día (hasta 7) al último hábil. null si falla la consulta
 * (sin internet, API caída, etc.) — nunca se inventa un valor. */
async function obtenerDolar(fechaISO) {
  let d = new Date(`${fechaISO}T00:00:00`);
  for (let i = 0; i < 7; i++) {
    const key = isoADiaMesAño(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    if (dolarCache.has(key)) return { valor: dolarCache.get(key), fechaUsada: key };
    try {
      const res = await fetch(`https://mindicador.cl/api/dolar/${key}`);
      if (res.ok) {
        const data = await res.json();
        const valor = data.serie && data.serie[0] && data.serie[0].valor;
        if (valor) {
          dolarCache.set(key, valor);
          return { valor, fechaUsada: key };
        }
      }
    } catch (err) {
      console.error("Error consultando dólar:", err);
      return null; // sin internet o API caída — no seguir reintentando en loop
    }
    d.setDate(d.getDate() - 1); // sin dato ese día (finde/feriado): probar el anterior
  }
  return null;
}

/** Estado de la conversión USD->CLP vigente para lo que hay tipeado ahora
 * mismo — se recalcula solo (ver actualizarUsdHint) y handleSubmit lo usa tal
 * cual, para no volver a pedirle la tasa a la API justo al guardar. Guarda
 * montoUsd (el número exacto tipeado, no el redondeado) para poder confirmar
 * en handleSubmit que sigue correspondiendo a lo que hay en el campo. */
let conversionUsdActual = null; // { fechaISO, montoUsd, valor, montoClp } | null

/** Refresca la etiqueta de Monto y el cuadrito de conversión según el medio
 * de pago y la fecha elegidos. Se llama al tipear medio/monto/fecha. */
async function actualizarUsdHint() {
  const medio = $("medioPago").value.trim();
  const hint = $("usdHint");
  const label = $("montoLabel");

  if (!esMedioUSD(medio)) {
    label.textContent = "Monto";
    hint.hidden = true;
    conversionUsdActual = null;
    return;
  }

  label.textContent = "Monto (USD)";
  const montoUsd = Number($("monto").value);
  const fechaISO = $("fecha").value || todayISO();

  if (!montoUsd) {
    hint.hidden = true;
    conversionUsdActual = null;
    return;
  }

  hint.hidden = false;
  hint.className = "usd-hint";
  hint.textContent = "Buscando el dólar del día…";

  const dolar = await obtenerDolar(fechaISO);
  // Si mientras esperábamos la respuesta el usuario ya cambió el medio/monto/
  // fecha, esta respuesta quedó vieja — no pisar lo que se esté mostrando ahora.
  if ($("medioPago").value.trim() !== medio || $("monto").value != montoUsd || $("fecha").value !== fechaISO) return;

  if (!dolar) {
    hint.className = "usd-hint usd-hint-error";
    hint.textContent = "No se pudo obtener el dólar del día (¿sin internet?). Poné el monto en CLP directamente si preferís.";
    conversionUsdActual = null;
    return;
  }

  const montoClp = Math.round(montoUsd * dolar.valor);
  const [dd, mm, yyyy] = dolar.fechaUsada.split("-");
  hint.textContent = `≈ ${fmtCLP(montoClp)} CLP · dólar $${dolar.valor.toLocaleString("es-CL")} del ${dd}/${mm}/${yyyy}`;
  conversionUsdActual = { fechaISO, montoUsd, valor: dolar.valor, montoClp };
}

async function loadOptions() {
  try {
    // A=Fecha E=Categoria F=Subcategoria G=Medio_pago H=Estado I=Monto J=Detalle K=Fecha_vencimiento
    const [rows, cuentasRows] = await Promise.all([
      window.SheetsApi.readRange("Movimientos!A2:K100000"),
      window.SheetsApi.readRange("Cuentas!A2:A100"),
    ]);
    cuentasReales = new Set(cuentasRows.filter((r) => r[0]).map((r) => r[0].trim().toLowerCase()));
    const categorias = [];
    const medios = [];
    categoriaSubMap = {};
    historialPorMedio = {};
    const diasPorMedio = {}; // medio -> { dia: veces }
    for (const row of rows) {
      const [fecha, , , , cat, sub, medio, estado, monto, detalle, venc] = row;
      if (cat) {
        categorias.push(cat);
        if (sub) (categoriaSubMap[cat] ||= new Set()).add(sub);
      }
      if (medio) {
        medios.push(medio);
        (historialPorMedio[medio] ||= []).push({
          fecha, estado: (estado || "").trim(), monto: Number(monto) || 0, detalle: detalle || cat || "",
        });
      }
      // aprende el día de vencimiento típico de cada tarjeta
      if (medio && (estado || "").trim() === "Por pagar" && venc) {
        const dia = Number(String(venc).trim().split(/[-/]/)[0]);
        if (dia >= 1 && dia <= 31) {
          (diasPorMedio[medio] ||= {});
          diasPorMedio[medio][dia] = (diasPorMedio[medio][dia] || 0) + 1;
        }
      }
    }
    diaVencPorMedio = {};
    for (const [medio, dias] of Object.entries(diasPorMedio)) {
      diaVencPorMedio[medio] = Number(Object.entries(dias).sort((a, b) => b[1] - a[1])[0][0]);
    }
    fillDatalist("categoriaList", categorias);
    fillDatalist("medioPagoList", medios);
  } catch (err) {
    console.error("No se pudieron cargar categorías existentes:", err);
  }
}

/** Próximas fechas de vencimiento sugeridas, según el día en que suele vencer
 * el medio de pago elegido (Limited el 10, Cencosud el 4, etc.). */
function proximosVencimientos(medio, cuantos = 3) {
  const dia = diaVencPorMedio[medio] || 10;
  const hoy = new Date();
  const out = [];
  let y = hoy.getFullYear();
  let m = hoy.getMonth();
  if (hoy.getDate() > dia) m++; // ya pasó este mes, parte del siguiente
  for (let i = 0; i < cuantos; i++) {
    const d = new Date(y, m + i, dia);
    out.push(d);
  }
  return out;
}

const MESES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function renderVencChips() {
  const cont = $("vencChips");
  const medio = $("medioPago").value.trim();
  cont.innerHTML = "";
  for (const d of proximosVencimientos(medio)) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "venc-chip";
    btn.textContent = `${d.getDate()} ${MESES_CORTO[d.getMonth()]}`;
    btn.dataset.iso = iso;
    btn.addEventListener("click", () => {
      $("fechaVencimiento").value = iso;
      cont.querySelectorAll(".venc-chip").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
    cont.appendChild(btn);
  }
}

/** El campo de vencimiento solo aplica (y es obligatorio) para "Por pagar". */
let estadoTocadoManualmente = false;

/** Débito/efectivo (una cuenta real, con saldo en la pestaña Cuentas) siempre
 * es Pagado — la plata ya salió. Crédito (cualquier medio que NO sea una de tus
 * cuentas) siempre es Por pagar — factura después. Se pisa solo hasta que el
 * usuario toque el toggle de Estado a mano una vez; ahí se respeta su elección. */
function actualizarEstadoPorMedio() {
  if (estadoTocadoManualmente) return;
  const medio = $("medioPago").value.trim();
  if (!medio) return;

  const esCredito = !cuentasReales.has(medio.toLowerCase());
  const destino = esCredito ? "Por pagar" : "Pagado";
  if (state.estado === destino) return;

  state.estado = destino;
  $("estadoToggle").querySelectorAll("button").forEach((b) => b.classList.remove("active"));
  $("estadoToggle").querySelector(`[data-estado="${destino}"]`).classList.add("active");
  actualizarVencSection();
  actualizarLabelEstado();
}

/** Puro rótulo: un Gasto pendiente es "Por pagar", un Ingreso pendiente es
 * "Por cobrar" — misma lógica, distinta palabra según de qué lado estás. El
 * valor guardado en la planilla sigue siendo siempre "Por pagar" (así no se
 * rompe ningún filtro existente); esto solo cambia lo que el botón dice.
 *
 * También cambia el rótulo de "Detalle": en un Ingreso "Por cobrar", ese campo
 * es donde va el nombre de quién te debe (ej. "Cobro a Gabi", "Prestamo pana
 * Beto") — Medio_pago sigue siendo la cuenta real de siempre (Banco Chile,
 * Mercado Pago...), NO se reutiliza. Sin esta pista, un Detalle vago como
 * "Compra starbuck lunes pm" no dice quién debe, y el Dashboard no tiene otra
 * forma de saberlo. */
function actualizarLabelEstado() {
  $("btnPorPagar").textContent = state.tipo === "Ingreso" ? "Por cobrar" : "Por pagar";
  const esPorCobrar = state.tipo === "Ingreso" && state.estado === "Por pagar";
  $("labelDetalle").textContent = esPorCobrar ? "Detalle (¿quién te debe?)" : "Detalle";
  $("detalle").placeholder = esPorCobrar ? "Ej: Cobro a Esteban" : "Ej: Supermercado Lider";
}

function actualizarVencSection() {
  const esPorPagar = state.estado === "Por pagar";
  $("vencSection").hidden = !esPorPagar;
  if (esPorPagar) renderVencChips();
}

const MESES_CORTO2 = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function fechaLegible(raw) {
  const d = parseAnyFecha(raw);
  if (!d) return raw;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const dias = Math.round((hoy - d) / 86400000);
  if (dias === 0) return "hoy";
  if (dias === 1) return "ayer";
  if (dias > 1 && dias < 7) return `hace ${dias}d`;
  return `${d.getDate()} ${MESES_CORTO2[d.getMonth()]}`;
}

/** El objetivo: que abras la tarjeta en el celu, veas su lista de compras, y
 * sepas al toque hasta dónde ya está cargado en la app sin tener que adivinar. */
function renderUltimosMovimientos() {
  const medio = $("medioPago").value.trim();
  const box = $("ultimosMovMedio");
  if (!medio) { box.hidden = true; return; }

  // Orden por fecha de CONTABILIZACIÓN (cuándo lo cargaste vos, o sea el orden
  // de fila en la sheet — las filas nuevas siempre se agregan al final) y no
  // por fecha de documento — si cargás hoy una compra atrasada del 26/08,
  // igual queda arriba de todo, como lo último que registraste.
  const hist = (historialPorMedio[medio] || []).slice(-6).reverse();

  if (hist.length === 0) {
    box.hidden = true;
    return;
  }

  box.hidden = false;
  box.innerHTML = `
    <div class="card-title" style="margin-bottom:8px;">Últimos registrados en ${medio}</div>
    ${hist
      .map(
        (m) => `<div class="category-row-top" style="padding:5px 0;font-size:12.5px;">
          <span style="color:var(--text-secondary)">
            <strong>${fechaLegible(m.fecha)}</strong> · ${m.detalle}
            ${m.estado === "Por pagar" ? '<span class="badge badge-muted" style="margin-left:4px;">por pagar</span>' : ""}
          </span>
          <span class="cat-amounts">${fmtCLP(Math.abs(m.monto))}</span>
        </div>`
      )
      .join("")}
  `;
}

function fmtCLP(n) {
  const sign = n < 0 ? "-" : "";
  return sign + "$" + Math.round(Math.abs(n)).toLocaleString("es-CL");
}

function updateSubcategorias() {
  const cat = $("categoria").value.trim();
  const subs = categoriaSubMap[cat] ? [...categoriaSubMap[cat]] : [];
  fillDatalist("subcategoriaList", subs);
}

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

/** Borra TODO el formulario tras guardar — la fecha vuelve a hoy, Tipo y Estado
 * a su default, y el foco queda en Medio de pago (primer campo del flujo). */
function resetFormForNextEntry() {
  $("monto").value = "";
  $("categoria").value = "";
  $("subcategoria").value = "";
  $("medioPago").value = "";
  $("detalle").value = "";
  $("fecha").value = todayISO();
  $("fechaVencimiento").value = "";
  $("cuotasTotales").value = "";
  $("cuotaDevengada").value = "";
  $("mesPagoOpcion").value = "";

  const tipoBtn = $("tipoToggle").querySelector('[data-type="Gasto"]');
  $("tipoToggle").querySelectorAll("button").forEach((b) => b.classList.remove("active"));
  tipoBtn.classList.add("active");
  state.tipo = "Gasto";
  actualizarLabelEstado();

  const estadoBtn = $("estadoToggle").querySelector('[data-estado="Pagado"]');
  $("estadoToggle").querySelectorAll("button").forEach((b) => b.classList.remove("active"));
  estadoBtn.classList.add("active");
  state.estado = "Pagado";
  estadoTocadoManualmente = false; // vuelve a auto-elegirse según el próximo medio de pago
  actualizarVencSection(); // oculta la sección de vencimiento (ya no aplica, quedó en Pagado)

  $("cuotaSection").hidden = true;
  $("toggleCuota").textContent = "+ ¿Es una cuota?";

  $("ultimosMovMedio").hidden = true;
  $("montoLabel").textContent = "Monto";
  $("usdHint").hidden = true;
  conversionUsdActual = null;
  $("medioPago").focus();
}

/** Convierte "2026-10-10" al formato que usa la planilla: "10-10-2026". */
function isoAVencimiento(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${Number(d)}-${Number(m)}-${y}`;
}

/** Ningún movimiento debe quedar incompleto: un campo vacío rompe después los
 * agrupados (por medio de pago, por categoría, por vencimiento). Valida con
 * trim, porque el `required` del navegador acepta puros espacios. */
function validarFormulario() {
  const obligatorios = [
    ["monto", "el monto"],
    ["fecha", "la fecha"],
    ["categoria", "la categoría"],
    ["subcategoria", "la subcategoría"],
    ["medioPago", "el medio de pago"],
    ["detalle", "el detalle"],
  ];
  for (const [id, nombre] of obligatorios) {
    if (!String($(id).value).trim()) {
      showToast(`Falta ${nombre}`, true);
      $(id).focus();
      return false;
    }
  }
  if (Number($("monto").value) === 0) {
    showToast("El monto no puede ser cero", true);
    $("monto").focus();
    return false;
  }
  // Un "por pagar" sin vencimiento queda fuera del desglose por mes.
  if (state.estado === "Por pagar" && !$("fechaVencimiento").value) {
    showToast("Un 'por pagar' necesita fecha de vencimiento", true);
    $("vencSection").hidden = false;
    renderVencChips();
    $("fechaVencimiento").focus();
    return false;
  }
  // Si abrió la sección de cuotas, que la complete.
  if (!$("cuotaSection").hidden) {
    for (const [id, nombre] of [["cuotasTotales", "el total de cuotas"], ["cuotaDevengada", "la cuota actual"]]) {
      if (!String($(id).value).trim()) {
        showToast(`Falta ${nombre}`, true);
        $(id).focus();
        return false;
      }
    }
  }
  return true;
}

async function handleSubmit(e) {
  e.preventDefault();
  if (!validarFormulario()) return;

  const submitBtn = $("submitBtn");
  submitBtn.disabled = true;
  submitBtn.textContent = "Guardando…";

  try {
    const fecha = $("fecha").value; // YYYY-MM-DD
    const [yyyy, mm] = fecha.split("-");
    const medioPago = $("medioPago").value.trim();
    const montoIngresado = Number($("monto").value) || 0;
    const categoria = $("categoria").value.trim();
    const subcategoria = $("subcategoria").value.trim();
    let detalle = $("detalle").value.trim();
    const vencIso = $("fechaVencimiento").value; // "" si no aplica
    const cuotaActual = Number($("cuotaDevengada").value) || 0;
    const cuotasTotal = Number($("cuotasTotales").value) || 0;
    const mesPagoOpcion = $("mesPagoOpcion").value.trim() || "";

    // Medio en USD (ej. "Limited USD"): lo que se tipeó en Monto es dólares,
    // hay que guardar el equivalente en CLP (todo el resto de la app asume
    // pesos). No convertir "a ciegas": si la conversión vigente no
    // corresponde EXACTO a lo tipeado ahora (cambiaste el monto/fecha después
    // de que se calculó, o la consulta a la API falló), mejor frenar que
    // guardar un monto en dólares como si fueran pesos chilenos.
    let montoParaGuardar = montoIngresado;
    if (esMedioUSD(medioPago)) {
      if (!conversionUsdActual || conversionUsdActual.fechaISO !== fecha || conversionUsdActual.montoUsd !== montoIngresado) {
        showToast("Esperá a que se calcule el dólar del día antes de guardar", true);
        submitBtn.disabled = false;
        submitBtn.textContent = "Guardar";
        return;
      }
      montoParaGuardar = conversionUsdActual.montoClp;
      detalle = `${detalle} (USD ${montoIngresado} @ $${conversionUsdActual.valor.toLocaleString("es-CL")})`.trim();
    }
    const signedMonto = state.tipo === "Gasto" ? -Math.abs(montoParaGuardar) : Math.abs(montoParaGuardar);

    const row = [
      fecha, yyyy, String(Number(mm)), state.tipo, categoria, subcategoria, medioPago, state.estado,
      signedMonto, detalle, isoAVencimiento(vencIso), cuotaActual || "", cuotasTotal || "", mesPagoOpcion,
    ];
    const rows = [row];

    // Cuotas futuras: si esta es la cuota N de M (con M > N) y tiene fecha de
    // vencimiento, se generan de una vez las cuotas N+1..M como Por pagar, un
    // mes después cada una (mismo día) — así se ve de entrada todo el
    // compromiso en vez de tener que acordarse de cargarlo mes a mes.
    let cuotasFuturasCreadas = 0;
    if (!$("cuotaSection").hidden && cuotasTotal > cuotaActual && vencIso) {
      const faltantes = cuotasTotal - cuotaActual;
      // Freno ante un typo (ej. escribir "30" cuotas en vez de "3") — crear
      // por accidente 2+ años de filas sería difícil de deshacer a mano.
      if (faltantes > 24 && !confirm(`Esto va a crear ${faltantes} cuotas futuras (una por mes). ¿Seguro que ${cuotasTotal} es el total de cuotas correcto?`)) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Guardar";
        return;
      }
      for (let n = cuotaActual + 1; n <= cuotasTotal; n++) {
        const d = new Date(`${vencIso}T00:00:00`);
        d.setMonth(d.getMonth() + (n - cuotaActual));
        const y2 = d.getFullYear();
        const m2 = d.getMonth() + 1;
        const iso2 = `${y2}-${String(m2).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        rows.push([
          iso2, String(y2), String(m2), state.tipo, categoria, subcategoria, medioPago, "Por pagar",
          signedMonto, detalle, isoAVencimiento(iso2), n, cuotasTotal, mesPagoOpcion,
        ]);
        cuotasFuturasCreadas++;
      }
    }

    // RAW: la fecha se guarda tal cual la escribimos, sin reinterpretación de Sheets.
    await window.SheetsApi.appendRows("Movimientos!A:N", rows, "RAW");
    showToast(cuotasFuturasCreadas > 0 ? `Guardado ✓ (+ ${cuotasFuturasCreadas} cuota(s) futura(s))` : "Guardado ✓");
    resetFormForNextEntry();
    await loadOptions(); // refresh datalists in case a new category was typed
  } catch (err) {
    console.error(err);
    showToast("Error al guardar", true);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Guardar";
  }
}

async function init() {
  if (!window.SheetsAuth.requireAuthOrRedirect()) return;

  $("loadingSkeleton").hidden = false;
  await loadOptions();
  $("loadingSkeleton").hidden = true;

  $("fecha").value = todayISO();
  wireToggle("tipoToggle", "type", "tipo");
  $("tipoToggle").addEventListener("click", actualizarLabelEstado);
  wireToggle("estadoToggle", "estado", "estado");
  $("estadoToggle").addEventListener("click", () => {
    estadoTocadoManualmente = true; // el usuario decidió — se deja de auto-elegir por el medio
    actualizarVencSection();
    actualizarLabelEstado();
  });
  $("medioPago").addEventListener("input", () => {
    actualizarEstadoPorMedio(); // débito/cuenta real -> Pagado, tarjeta de crédito -> Por pagar
    if (!$("vencSection").hidden) renderVencChips();
    renderUltimosMovimientos();
    actualizarUsdHint();
  });
  $("monto").addEventListener("input", actualizarUsdHint);
  $("fecha").addEventListener("change", actualizarUsdHint);
  $("categoria").addEventListener("change", updateSubcategorias);
  $("categoria").addEventListener("input", updateSubcategorias);
  $("toggleCuota").addEventListener("click", () => {
    const section = $("cuotaSection");
    section.hidden = !section.hidden;
    $("toggleCuota").textContent = section.hidden ? "+ ¿Es una cuota?" : "− Ocultar cuota";
  });
  $("form").addEventListener("submit", handleSubmit);
  $("form").hidden = false;
  actualizarLabelEstado();
  $("medioPago").focus(); // primer campo del flujo: pinchas la tarjeta y ves de una el recordatorio
}

init();
