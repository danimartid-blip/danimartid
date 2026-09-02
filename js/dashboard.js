const $ = (id) => document.getElementById(id);

const MESES = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function fmtCLP(n) {
  const sign = n < 0 ? "-" : "";
  return sign + "$" + Math.round(Math.abs(n)).toLocaleString("es-CL");
}

let movimientos = []; // { fecha, año, mes, tipo, categoria, subcategoria, medioPago, estado, monto, detalle }
let presupuesto = {}; // categoria -> meta (number)
let cuentas = []; // { nombre, saldo }

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
    row.className = "category-row";
    row.innerHTML = `
      <div class="category-row-top">
        <span class="cat-name">${cat}</span>
        <span class="cat-amounts">${fmtCLP(monto)}${meta ? ` <span class="meta">/ ${fmtCLP(meta)}</span>` : ""}</span>
      </div>
      ${meta ? `<div class="bar-track"><div class="bar-fill${pct > 100 ? " over" : ""}" style="width:${Math.min(pct, 100)}%"></div></div>` : ""}`;
    list.appendChild(row);
  }

  // Por pagar (global, no filtrado por mes)
  const porPagar = movimientos
    .filter((m) => m.estado === "Por pagar")
    .reduce((s, m) => s + Math.abs(m.monto), 0);
  $("statPorPagar").textContent = fmtCLP(porPagar);
}

function renderPatrimonio() {
  const total = cuentas.reduce((s, c) => s + c.saldo, 0);
  $("statPatrimonio").textContent = fmtCLP(total);
  const mini = $("accountsMini");
  mini.innerHTML = "";
  const top = [...cuentas].sort((a, b) => b.saldo - a.saldo).slice(0, 4);
  for (const c of top) {
    const row = document.createElement("div");
    row.className = "category-row-top";
    row.style.padding = "4px 0";
    row.innerHTML = `<span style="color:var(--text-secondary)">${c.nombre}</span><span class="cat-amounts">${fmtCLP(c.saldo)}</span>`;
    mini.appendChild(row);
  }
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
  const tooltip = $("trendTooltip");
  if (keys.length < 2) {
    svg.innerHTML = "";
    return;
  }
  const w = 320, h = 120, pad = 8;
  const maxVal = Math.max(...keys.map((k) => Math.max(byMonth[k].ingresos, byMonth[k].gastos)), 1);
  const stepX = (w - pad * 2) / (keys.length - 1);
  const yOf = (v) => h - pad - (v / maxVal) * (h - pad * 2);
  const xOf = (i) => pad + i * stepX;
  const pointsFor = (field) => keys.map((k, i) => `${xOf(i)},${yOf(byMonth[k][field])}`).join(" ");

  const style = getComputedStyle(document.documentElement);
  const incomeColor = style.getPropertyValue("--income").trim();
  const expenseColor = style.getPropertyValue("--expense").trim();

  const hitAreas = keys
    .map((k, i) => `<rect x="${xOf(i) - stepX / 2}" y="0" width="${stepX}" height="${h}" fill="transparent" data-i="${i}"/>`)
    .join("");

  svg.innerHTML = `
    <polyline points="${pointsFor("ingresos")}" fill="none" stroke="${incomeColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    <polyline points="${pointsFor("gastos")}" fill="none" stroke="${expenseColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    ${hitAreas}
  `;

  const showTip = (i, clientX) => {
    const k = keys[i];
    const [y, mo] = k.split("-");
    const rect = svg.getBoundingClientRect();
    tooltip.innerHTML = `${MESES[Number(mo)]} ${y}<br>Ing: ${fmtCLP(byMonth[k].ingresos)}<br>Gas: ${fmtCLP(byMonth[k].gastos)}`;
    tooltip.style.left = `${clientX - rect.left}px`;
    tooltip.style.top = `${(yOf(Math.max(byMonth[k].ingresos, byMonth[k].gastos)) / h) * rect.height}px`;
    tooltip.classList.add("show");
  };
  const hideTip = () => tooltip.classList.remove("show");

  svg.querySelectorAll("rect[data-i]").forEach((rect) => {
    const i = Number(rect.dataset.i);
    rect.addEventListener("pointerenter", (e) => showTip(i, e.clientX));
    rect.addEventListener("pointermove", (e) => showTip(i, e.clientX));
  });
  svg.addEventListener("pointerleave", hideTip);
}

async function loadData() {
  const [movRows, presRows, cuentasRows] = await Promise.all([
    window.SheetsApi.readRange("Movimientos!A2:N100000"),
    window.SheetsApi.readRange("Presupuesto!A2:B1000"),
    window.SheetsApi.readRange("Cuentas!A2:C1000"),
  ]);
  movimientos = parseMovimientos(movRows);
  presupuesto = {};
  for (const [cat, meta] of presRows) {
    if (cat) presupuesto[cat] = Number(meta) || 0;
  }
  cuentas = cuentasRows
    .filter((r) => r[0])
    .map(([nombre, saldo]) => ({ nombre, saldo: Number(saldo) || 0 }));
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
  renderPatrimonio();

  $("monthSelect").addEventListener("change", (e) => renderStats(e.target.value));
}

init();
