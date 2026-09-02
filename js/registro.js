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

async function loadOptions() {
  try {
    const rows = await window.SheetsApi.readRange("Movimientos!E2:G100000");
    const categorias = [];
    const medios = [];
    categoriaSubMap = {};
    for (const row of rows) {
      const [cat, sub, medio] = row;
      if (cat) {
        categorias.push(cat);
        if (sub) {
          (categoriaSubMap[cat] ||= new Set()).add(sub);
        }
      }
      if (medio) medios.push(medio);
    }
    fillDatalist("categoriaList", categorias);
    fillDatalist("medioPagoList", medios);
  } catch (err) {
    console.error("No se pudieron cargar categorías existentes:", err);
  }
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

async function handleSubmit(e) {
  e.preventDefault();
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
      $("fechaVencimiento").value || "",
      $("cuotaDevengada").value || "",
      $("cuotasTotales").value || "",
      $("mesPagoOpcion").value.trim() || "",
    ];

    await window.SheetsApi.appendRow("Movimientos!A:N", row);
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
  if (!window.SheetsAuth.isLoggedIn()) {
    $("loginGate").hidden = false;
    $("loginBtn").addEventListener("click", async () => {
      try {
        await window.SheetsAuth.getAccessToken();
        location.reload();
      } catch (err) {
        showToast("No se pudo conectar", true);
      }
    });
    return;
  }

  $("loadingSkeleton").hidden = false;
  await loadOptions();
  $("loadingSkeleton").hidden = true;

  $("fecha").value = todayISO();
  wireToggle("tipoToggle", "type", "tipo");
  wireToggle("estadoToggle", "estado", "estado");
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
