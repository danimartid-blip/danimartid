import { google } from "googleapis";
import { getAuth } from "./auth.mjs";
const sheets = google.sheets({ version: "v4", auth: getAuth() });
const [movR, pptoR, cuentasR] = await Promise.all([
  sheets.spreadsheets.values.get({ spreadsheetId: "1mUcDhTdKOa23oQpVdkY0QXDVZdKI0IK5qZxg1C4E-Zg", range: "Movimientos!A2:N100000" }),
  sheets.spreadsheets.values.get({ spreadsheetId: "1mUcDhTdKOa23oQpVdkY0QXDVZdKI0IK5qZxg1C4E-Zg", range: "Presupuesto!A2:F1000" }),
  sheets.spreadsheets.values.get({ spreadsheetId: "1mUcDhTdKOa23oQpVdkY0QXDVZdKI0IK5qZxg1C4E-Zg", range: "Cuentas!A2:C100" }),
]);
const movimientos = (movR.data.values||[]).filter(x=>x[0]).map(x=>({
  año:String(x[1]||"").trim(), mes:String(x[2]||"").trim(), tipo:x[3]||"", categoria:x[4]||"", subcategoria:x[5]||"", estado:(x[7]||"").trim(), monto:Number(x[8])||0, fechaVencimiento:x[10]||"" }));
const presupuestoRows = (pptoR.data.values||[]).filter(r=>r[0]).map(r=>({mes:r[0],tipo:r[1],categoria:r[2],subcategoria:r[3]||"",monto:Number(r[4])||0}));
const cuentas = (cuentasR.data.values||[]).filter(r=>r[0]).map(r=>({nombre:r[0],saldo:Number(r[1])||0}));
const f = n => (n<0?"-":"")+"$"+Math.abs(Math.round(n)).toLocaleString("es-CL");
function monthKey(m){ return `${m.año}-${String(m.mes).padStart(2,"0")}`; }
function normSub(s){ return (s||"").trim().toLowerCase(); }
function monthsBeforeExclusive(mes, n) {
  const [y, m] = mes.split("-").map(Number);
  const out = [];
  for (let i = n; i >= 1; i--) { const d = new Date(y, m - 1 - i, 1); out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); }
  return out;
}
function singleBucket(categoria, meses, tipo) {
  const set = new Set();
  for (const m of movimientos) if (m.tipo===tipo && m.categoria===categoria && meses.includes(monthKey(m)) && m.monto!==0) set.add(normSub(m.subcategoria));
  return set.size===1 ? [...set][0] : null;
}
function gastoMonthlyBreakdown(categoria, subcategoria, mes, anchorMes=mes) {
  const sub = normSub(subcategoria);
  const ventana = [...monthsBeforeExclusive(anchorMes,3), anchorMes];
  const gastoBucket = singleBucket(categoria, ventana, "Gasto"), ingresoBucket = singleBucket(categoria, ventana, "Ingreso");
  const pairMode = gastoBucket!==null && ingresoBucket!==null && gastoBucket===sub;
  let bruto=0, reembolso=0;
  for (const m of movimientos) {
    if (m.categoria!==categoria || monthKey(m)!==mes) continue;
    if (m.tipo==="Gasto" && normSub(m.subcategoria)===sub) bruto += Math.abs(m.monto);
    else if (m.tipo==="Ingreso") { const exact=normSub(m.subcategoria)===sub; const paired=pairMode&&normSub(m.subcategoria)===ingresoBucket; if(exact||paired) reembolso+=m.monto; }
  }
  return { bruto, reembolso, neto: bruto-reembolso };
}
function montoRealNeto(tipo, categoria, mes, subcategoria, anchorMes = mes) {
  if (tipo === "Gasto" && subcategoria !== undefined) return gastoMonthlyBreakdown(categoria, subcategoria, mes, anchorMes).neto;
  if (tipo === "Gasto") {
    const gastoSubs = new Set();
    for (const m of movimientos) if (m.tipo === "Gasto" && m.categoria === categoria && monthKey(m) === mes) gastoSubs.add(m.subcategoria || "");
    let total = 0;
    for (const sub of gastoSubs) total += gastoMonthlyBreakdown(categoria, sub, mes, anchorMes).neto;
    return total;
  }
  let total = 0;
  for (const m of movimientos) if (m.categoria===categoria && monthKey(m)===mes && m.tipo===tipo) total += Math.abs(m.monto);
  return total;
}
function esReembolsoDeGasto(categoria, subcategoria, mesesRelevantes) {
  const sub = normSub(subcategoria);
  const exact = movimientos.some(m=>m.tipo==="Gasto"&&m.categoria===categoria&&normSub(m.subcategoria)===sub&&mesesRelevantes.includes(monthKey(m)));
  if (exact) return true;
  const gb=singleBucket(categoria,mesesRelevantes,"Gasto"), ib=singleBucket(categoria,mesesRelevantes,"Ingreso");
  return gb!==null&&ib!==null&&ib===sub;
}
function budgetForSubcategoria(mes, categoria, subcategoria, tipo="Gasto") {
  if (tipo==="Ingreso" && esReembolsoDeGasto(categoria, subcategoria, [...monthsBeforeExclusive(mes,3), mes])) return 0;
  const row = presupuestoRows.find(p=>p.mes===mes&&p.tipo===tipo&&p.categoria===categoria&&p.subcategoria===subcategoria);
  return row ? row.monto : avg3Real(tipo, categoria, subcategoria, mes);
}
function avg3Real(tipo, categoria, subcategoria, mes) {
  const months = monthsBeforeExclusive(mes, 3);
  const totals = months.map(mk => montoRealNeto(tipo, categoria, mk, subcategoria, mes));
  return totals.reduce((a,b)=>a+b,0)/3;
}
function subcategoriasConPresupuesto(mes, categoria, tipo="Gasto") {
  const historyMonths = monthsBeforeExclusive(mes, 3);
  const subs = new Map();
  for (const m of movimientos) if (m.tipo===tipo && m.categoria===categoria && historyMonths.includes(monthKey(m))) { const raw=m.subcategoria||""; if(!subs.has(normSub(raw))) subs.set(normSub(raw),raw); }
  for (const p of presupuestoRows) if (p.mes===mes && p.tipo===tipo && p.categoria===categoria) { const raw=p.subcategoria||""; if(!subs.has(normSub(raw))) subs.set(normSub(raw),raw); }
  return [...subs.values()];
}
function budgetForCategoria(mes, categoria, tipo="Gasto") {
  const subs = subcategoriasConPresupuesto(mes, categoria, tipo);
  if (subs.length===0) return null;
  return subs.reduce((s,sub)=>s+budgetForSubcategoria(mes,categoria,sub,tipo),0);
}
function categoriasForTipo(tipo, mes) {
  const historyMonths = monthsBeforeExclusive(mes, 3);
  const all = new Set();
  for (const m of movimientos) if (m.tipo===tipo) all.add(m.categoria);
  for (const p of presupuestoRows) if (p.tipo===tipo) all.add(p.categoria);
  return [...all].filter(cat => {
    const hasHistory = movimientos.some(m=>m.tipo===tipo&&m.categoria===cat&&historyMonths.includes(monthKey(m)));
    const hasFijado = presupuestoRows.some(p=>p.mes===mes&&p.tipo===tipo&&p.categoria===cat);
    return hasHistory||hasFijado;
  });
}
function totalBudgetForTipo(tipo, mes) {
  return categoriasForTipo(tipo, mes).reduce((s,cat)=>s+budgetForCategoria(mes,cat,tipo),0);
}

const selectedKey = "2026-09";
console.log("=== Probando montoRealNeto categoria-wide para TODAS las categorías (buscando errores) ===");
const allCats = [...new Set(movimientos.map(m=>m.categoria))];
let errores = 0;
for (const cat of allCats) {
  try {
    const v = montoRealNeto("Gasto", cat, selectedKey);
    if (isNaN(v)) { console.log(`  NaN en categoria="${cat}"`); errores++; }
  } catch (err) {
    console.log(`  ERROR en categoria="${cat}":`, err.message);
    errores++;
  }
}
console.log(`Total errores/NaN: ${errores} de ${allCats.length} categorías`);

console.log("\n=== totalBudgetForTipo (usado en Liquidez) ===");
try {
  const ingresoPpto = totalBudgetForTipo("Ingreso", selectedKey);
  const gastoPpto = totalBudgetForTipo("Gasto", selectedKey);
  console.log("ingresoPpto:", f(ingresoPpto));
  console.log("gastoPpto:", f(gastoPpto));
} catch (err) {
  console.log("ERROR en totalBudgetForTipo:", err.message, err.stack);
}

console.log("\n=== Desglose de ingresoPpto por categoría (buscando inflación) ===");
const catsIngreso = categoriasForTipo("Ingreso", selectedKey);
const contrib = catsIngreso.map(cat => ({ cat, monto: budgetForCategoria(selectedKey, cat, "Ingreso") })).sort((a,b)=>b.monto-a.monto);
contrib.forEach(({cat, monto}) => { if (Math.abs(monto) > 100000) console.log(`  ${cat}: ${f(monto)}`); });

console.log("\n=== Liquidez proyectada completa para 2026-09 ===");
const cuentasTotal = cuentas.reduce((s,c)=>s+c.saldo,0);
function parseFechaVenc(s) {
  if (!s) return null;
  const parts = String(s).trim().split(/[-/]/);
  if (parts.length !== 3) return null;
  const [d, m, y] = parts.map(Number);
  if (!d || !m || !y) return null;
  const date = new Date(y, m - 1, d);
  return isNaN(date) ? null : date;
}
const hoy = new Date();
const cutoffPronto = new Date(hoy); cutoffPronto.setDate(cutoffPronto.getDate()+40);
const pendientes = movimientos.filter(m => m.estado === "Por pagar");
const pendientesPronto = pendientes.filter(m => { const d = parseFechaVenc(m.fechaVencimiento); return !d || d<=cutoffPronto; });
const porPagarPronto = -pendientesPronto.reduce((s,m)=>s+m.monto,0);
const liquidezReal = cuentasTotal - porPagarPronto;

const delMes = movimientos.filter(m => monthKey(m)===selectedKey);
const realIngresos = delMes.filter(m=>m.tipo==="Ingreso").reduce((s,m)=>s+Math.abs(m.monto),0);
const realGastos = delMes.filter(m=>m.tipo==="Gasto").reduce((s,m)=>s+Math.abs(m.monto),0);
const liquidezAntesDelMes = liquidezReal - (realIngresos - realGastos);
const ingresoPpto = totalBudgetForTipo("Ingreso", selectedKey);
const gastoPpto = totalBudgetForTipo("Gasto", selectedKey);
const resultadoPpto = ingresoPpto - gastoPpto;
const liquidezPpto = liquidezAntesDelMes + resultadoPpto;
console.log("liquidezReal (saldo actual):", f(liquidezReal));
console.log("realIngresos del mes:", f(realIngresos), "| realGastos del mes:", f(realGastos));
console.log("liquidezAntesDelMes:", f(liquidezAntesDelMes));
console.log("ingresoPpto:", f(ingresoPpto), "| gastoPpto:", f(gastoPpto), "| resultadoPpto:", f(resultadoPpto));
console.log("LIQUIDEZ PROYECTADA FINAL:", f(liquidezPpto));

console.log("\n=== Desglose de Sueldo/Ingreso por subcategoría (buscando el inflador) ===");
const subsSueldo = subcategoriasConPresupuesto(selectedKey, "Sueldo", "Ingreso");
for (const sub of subsSueldo) {
  const monto = budgetForSubcategoria(selectedKey, "Sueldo", sub, "Ingreso");
  const esReemb = esReembolsoDeGasto("Sueldo", sub, [...monthsBeforeExclusive(selectedKey,3), selectedKey]);
  console.log(`  "${sub}": ${f(monto)} ${esReemb ? "(excluido, reembolso)" : ""}`);
}
