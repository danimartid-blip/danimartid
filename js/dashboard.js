const $ = (id) => document.getElementById(id);

const MESES = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function fmtCLP(n) {
  const sign = n < 0 ? "-" : "";
  return sign + "$" + Math.round(Math.abs(n)).toLocaleString("es-CL");
}

let movimientos = []; // { fecha, año, mes, tipo, categoria, subcategoria, medioPago, estado, monto, detalle }
let presupuesto = {}; // categoria -> meta (number)

function parseMovimientos(rows) {
  return rows
    .filter((r) => r[0]) // has fecha
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
    }));
}

function monthKey(m) {
  return `${m.año}-${String(m.mes).padStart(2, "0")}`;
}

function populateMonthSelect() {
  const keys = [...new Set(movimientos.map(monthKey))].sort().reverse();
  const select = $("monthSelect");
  select.innerHTML = "";
  for (const key of keys) {
    const [y, m] = key.split("-");
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = `${MESES[Number(m)]} ${y}`;
    select.appendChild(opt);
  }
  return keys[0];
}

function renderStats(selectedKey) {
  const inMonth = movimientos.filter((m) => monthKey(m) === selectedKey);
  const ingresos = inMonth.filter((m) => m.tipo === "Ingreso").reduce((s, m) => s + m.monto, 0);
  const gastos = inMonth.filter((m) => m.tipo === "Gasto").reduce((s, m) => s + Math.abs(m.monto), 0);
  const neto = ingresos - gastos;

  $("statIngresos").textContent = fmtCLP(ingresos);
  $("statGastos").textContent = fmtCLP(gastos);
  const netoEl = $("statNeto");
  netoEl.textContent = fmtCLP(neto);
  netoEl.className = "stat-value " + (neto >= 0 ? "income" : "expense");

  // Categorías (gasto) vs presupuesto
  const byCat = {};
  for (const m of inMonth) {
    if (m.tipo !== "Gasto") continue;
    byCat[m.categoria] = (byCat[m.categoria] || 0) + Math.abs(m.monto);
  }
  const sorted = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const list = $("categoryList");
  list.innerHTML = "";
  if (sorted.length === 0) {
    list.innerHTML = '<div class="skeleton">Sin gastos este mes</div>';
  }
  for (const [cat, monto] of sorted) {
    const meta = presupuesto[cat];
    const pct = meta ? Math.round((monto / meta) * 100) : null;
    const row = document.createElement("div");
    row.innerHTML = `
      <div class="category-row" style="display:block;">
        <div style="display:flex;justify-content:space-between;">
          <span>${cat}</span>
          <span>${fmtCLP(monto)}${meta ? ` <span style="color:var(--text-muted)">/ ${fmtCLP(meta)}</span>` : ""}</span>
        </div>
        ${meta ? `<div class="bar-track"><div class="bar-fill${pct > 100 ? " over" : ""}" style="width:${Math.min(pct, 100)}%"></div></div>` : ""}
      </div>`;
    list.appendChild(row);
  }

  // Por pagar (global, no filtrado por mes)
  const porPagar = movimientos
    .filter((m) => m.estado === "Por pagar")
    .reduce((s, m) => s + Math.abs(m.monto), 0);
  $("statPorPagar").textContent = fmtCLP(porPagar);
}

function renderTrend() {
  const byMonth = {};
  for (const m of movimientos) {
    const key = monthKey(m);
    byMonth[key] ||= { ingresos: 0, gastos: 0 };
    if (m.tipo === "Ingreso") byMonth[key].ingresos += m.monto;
    else byMonth[key].gastos += Math.abs(m.monto);
  }
  const keys = Object.keys(byMonth).sort().slice(-9);
  const svg = $("trendChart");
  if (keys.length < 2) {
    svg.innerHTML = "";
    return;
  }
  const w = 320, h = 120, pad = 6;
  const maxVal = Math.max(...keys.map((k) => Math.max(byMonth[k].ingresos, byMonth[k].gastos)), 1);
  const stepX = (w - pad * 2) / (keys.length - 1);
  const y = (v) => h - pad - (v / maxVal) * (h - pad * 2);
  const pointsFor = (field) =>
    keys.map((k, i) => `${pad + i * stepX},${y(byMonth[k][field])}`).join(" ");

  const style = getComputedStyle(document.documentElement);
  const incomeColor = style.getPropertyValue("--income").trim();
  const expenseColor = style.getPropertyValue("--expense").trim();

  svg.innerHTML = `
    <polyline points="${pointsFor("ingresos")}" fill="none" stroke="${incomeColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    <polyline points="${pointsFor("gastos")}" fill="none" stroke="${expenseColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  `;
}

async function loadData() {
  const [movRows, presRows] = await Promise.all([
    window.SheetsApi.readRange("Movimientos!A2:N100000"),
    window.SheetsApi.readRange("Presupuesto!A2:B1000"),
  ]);
  movimientos = parseMovimientos(movRows);
  presupuesto = {};
  for (const [cat, meta] of presRows) {
    if (cat) presupuesto[cat] = Number(meta) || 0;
  }
}

async function init() {
  if (!window.SheetsAuth.isLoggedIn()) {
    $("loginGate").hidden = false;
    $("loginBtn").addEventListener("click", async () => {
      try {
        await window.SheetsAuth.getAccessToken();
        location.reload();
      } catch {
        alert("No se pudo conectar con Google");
      }
    });
    return;
  }

  $("loadingSkeleton").hidden = false;
  await loadData();
  $("loadingSkeleton").hidden = true;
  $("dashboard").hidden = false;

  const defaultKey = populateMonthSelect();
  renderStats(defaultKey);
  renderTrend();

  $("monthSelect").addEventListener("change", (e) => renderStats(e.target.value));
}

init();
