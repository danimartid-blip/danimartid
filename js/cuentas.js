const $ = (id) => document.getElementById(id);

function fmtCLP(n) {
  const sign = n < 0 ? "-" : "";
  return sign + "$" + Math.round(Math.abs(n)).toLocaleString("es-CL");
}

function daysAgo(isoDate) {
  if (!isoDate) return null;
  const then = new Date(isoDate);
  if (isNaN(then)) return null;
  const diff = Math.floor((Date.now() - then.getTime()) / 86400000);
  return diff;
}

function agoLabel(days) {
  if (days == null) return "sin fecha";
  if (days <= 0) return "hoy";
  if (days === 1) return "hace 1 día";
  return `hace ${days} días`;
}

function showToast(msg, isError = false) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast show" + (isError ? " error" : "");
  setTimeout(() => (t.className = "toast"), 2200);
}

let cuentas = []; // { row, nombre, saldo, fecha }

function render() {
  const total = cuentas.reduce((s, c) => s + c.saldo, 0);
  $("totalPatrimonio").textContent = fmtCLP(total);

  const list = $("accountList");
  list.innerHTML = "";
  for (const c of cuentas) {
    const days = daysAgo(c.fecha);
    const stale = days != null && days > 30;
    const row = document.createElement("div");
    row.className = "account-row";
    row.style.display = "block";
    row.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div class="account-name">${c.nombre}</div>
          <div class="account-meta">
            ${agoLabel(days)}
            ${stale ? '<span class="badge badge-warning">desactualizado</span>' : ""}
          </div>
        </div>
        <div class="account-actions">
          <div class="account-balance">${fmtCLP(c.saldo)}</div>
          <button class="btn-secondary" data-edit="${c.row}">Actualizar</button>
        </div>
      </div>
      <div class="inline-form" id="form-${c.row}" hidden>
        <input type="number" inputmode="numeric" placeholder="Saldo real hoy" id="input-${c.row}">
        <button class="btn-secondary" data-save="${c.row}">Guardar</button>
      </div>
    `;
    list.appendChild(row);
  }

  list.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = btn.dataset.edit;
      const form = $(`form-${row}`);
      form.hidden = !form.hidden;
      if (!form.hidden) $(`input-${row}`).focus();
    });
  });
  list.querySelectorAll("[data-save]").forEach((btn) => {
    btn.addEventListener("click", () => saveBalance(Number(btn.dataset.save)));
  });
}

async function saveBalance(rowNum) {
  const cuenta = cuentas.find((c) => c.row === rowNum);
  const input = $(`input-${rowNum}`);
  const nuevo = Number(input.value);
  if (!input.value || isNaN(nuevo)) {
    showToast("Ingresa un monto válido", true);
    return;
  }
  const anterior = cuenta.saldo;
  const diferencia = nuevo - anterior;
  const today = new Date().toISOString().slice(0, 10);

  try {
    // RAW: guarda fechas/textos tal cual, sin que Sheets los reinterprete.
    await window.SheetsApi.updateRange(`Cuentas!B${rowNum}:C${rowNum}`, [[nuevo, today]], "RAW");
    await window.SheetsApi.appendRow(
      "Conciliaciones!A:E",
      [today, cuenta.nombre, anterior, nuevo, diferencia],
      "RAW"
    );
    cuenta.saldo = nuevo;
    cuenta.fecha = today;
    render();
    showToast("Saldo actualizado ✓");
  } catch (err) {
    console.error(err);
    showToast("Error al guardar", true);
  }
}

async function loadData() {
  const rows = await window.SheetsApi.readRange("Cuentas!A2:C1000");
  cuentas = rows
    .map((r, i) => ({ row: i + 2, nombre: r[0], saldo: Number(r[1]) || 0, fecha: r[2] }))
    .filter((c) => c.nombre);
}

async function init() {
  if (!window.SheetsAuth.requireAuthOrRedirect()) return;

  $("loadingSkeleton").hidden = false;
  await loadData();
  $("loadingSkeleton").hidden = true;
  $("content").hidden = false;
  render();
}

init();
