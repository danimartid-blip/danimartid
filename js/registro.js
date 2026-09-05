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

async function loadOptions() {
  try {
    // E=Categoria F=Subcategoria G=Medio_pago H=Estado I=Monto J=Detalle K=Fecha_vencimiento
    const rows = await window.SheetsApi.readRange("Movimientos!E2:K100000");
    const categorias = [];
    const medios = [];
    categoriaSubMap = {};
    const diasPorMedio = {}; // medio -> { dia: veces }
    for (const row of rows) {
      const [cat, sub, medio, estado, , , venc] = row;
      if (cat) {
        categorias.push(cat);
        if (sub) (categoriaSubMap[cat] ||= new Set()).add(sub);
      }
      if (medio) medios.push(medio);
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
function actualizarVencSection() {
  const esPorPagar = state.estado === "Por pagar";
  $("vencSection").hidden = !esPorPagar;
  if (esPorPagar) renderVencChips();
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

function resetFormForNextEntry() {
  $("monto").value = "";
  $("detalle").value = "";
  $("monto").focus();
}

/** Convierte "2026-10-10" al formato que usa la planilla: "10-10-2026". */
function isoAVencimiento(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${Number(d)}-${Number(m)}-${y}`;
}

async function handleSubmit(e) {
  e.preventDefault();

  // Un "por pagar" sin vencimiento queda fuera del desglose por mes: no se permite.
  if (state.estado === "Por pagar" && !$("fechaVencimiento").value) {
    showToast("Un 'por pagar' necesita fecha de vencimiento", true);
    $("vencSection").hidden = false;
    renderVencChips();
    $("fechaVencimiento").focus();
    return;
  }

  const submitBtn = $("submitBtn");
  submitBtn.disabled = true;
  submitBtn.textContent = "Guardando…";

  try {
    const fecha = $("fecha").value; // YYYY-MM-DD
    const [yyyy, mm] = fecha.split("-");
    const monto = Number($("monto").value) || 0;
    const signedMonto = state.tipo === "Gasto" ? -Math.abs(monto) : Math.abs(monto);

    const row = [
      fecha,
      yyyy,
      String(Number(mm)),
      state.tipo,
      $("categoria").value.trim(),
      $("subcategoria").value.trim(),
      $("medioPago").value.trim(),
      state.estado,
      signedMonto,
      $("detalle").value.trim(),
      isoAVencimiento($("fechaVencimiento").value),
      $("cuotaDevengada").value || "",
      $("cuotasTotales").value || "",
      $("mesPagoOpcion").value.trim() || "",
    ];

    // RAW: la fecha se guarda tal cual la escribimos, sin reinterpretación de Sheets.
    await window.SheetsApi.appendRow("Movimientos!A:N", row, "RAW");
    showToast("Guardado ✓");
    resetFormForNextEntry();
    loadOptions(); // refresh datalists in case a new category was typed
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
  wireToggle("estadoToggle", "estado", "estado");
  $("estadoToggle").addEventListener("click", actualizarVencSection);
  $("medioPago").addEventListener("input", () => {
    if (!$("vencSection").hidden) renderVencChips();
  });
  $("categoria").addEventListener("change", updateSubcategorias);
  $("categoria").addEventListener("input", updateSubcategorias);
  $("toggleCuota").addEventListener("click", () => {
    const section = $("cuotaSection");
    section.hidden = !section.hidden;
    $("toggleCuota").textContent = section.hidden ? "+ ¿Es una cuota?" : "− Ocultar cuota";
  });
  $("form").addEventListener("submit", handleSubmit);
  $("form").hidden = false;
}

init();
