// BORRÓN Y CUENTA NUEVA: reconstruye la base de la app desde el Sheet ORIGINAL,
// que es la fuente de verdad y está cuadrada. Reemplaza Movimientos y Cuentas,
// y ancla SaldoMensual de forma que septiembre concilie exacto.
// El original NUNCA se escribe, solo se lee.
import { google } from "googleapis";
import { getAuth } from "./auth.mjs";

const ORIG = "1x4mPNBEPpd1o3m8X7gfQitEGLilp6iyjSbfa8PEdfmI";
const NEW = "1mUcDhTdKOa23oQpVdkY0QXDVZdKI0IK5qZxg1C4E-Zg";

const f = (n) => "$" + Math.round(n).toLocaleString("es-CL");

function parseCLP(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const neg = s.startsWith("(") && s.endsWith(")");
  const d = s.replace(/[^\d]/g, "");
  if (!d) return "";
  return neg ? -parseInt(d, 10) : parseInt(d, 10);
}

// Orden de columnas en BD (origen)
const BD = ["Fecha", "Año", "Mes", "Tipo", "Categoria", "Subcategoria", "Medio_pago",
  "Estado_pago", "Fecha_vencimiento", "Monto", "Detalle",
  "Cuota_devengada", "Cuotas_totales", "Mes_pago_opcion"];
const idx = Object.fromEntries(BD.map((h, i) => [h, i]));

const MOV_HEADERS = ["Fecha", "Año", "Mes", "Tipo", "Categoria", "Subcategoria", "Medio_pago",
  "Estado_pago", "Monto", "Detalle",
  "Fecha_vencimiento", "Cuota_devengada", "Cuotas_totales", "Mes_pago_opcion"];

/** Año/Mes se recalculan desde Fecha: las columnas del original traían filas corruptas. */
function añoMesDe(fecha) {
  const s = String(fecha ?? "").trim();
  const slash = s.split("/");
  const dash = s.split("-");
  if (slash.length === 3) return [slash[2], String(Number(slash[1]))];
  if (dash.length === 3) return [dash[0], String(Number(dash[1]))];
  return ["", ""];
}

async function main() {
  const sheets = google.sheets({ version: "v4", auth: getAuth() });

  console.log("1/6  Leyendo el original (solo lectura)…");
  const [bdResp, resumenResp] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId: ORIG, range: "BD!A2:N100000" }),
    sheets.spreadsheets.values.get({ spreadsheetId: ORIG, range: "Resumen!A2:B9" }),
  ]);
  const bdRows = (bdResp.data.values || []).filter((r) => r[0]);
  console.log(`     BD: ${bdRows.length} filas`);

  const movimientos = bdRows.map((row) => {
    const g = (n) => row[idx[n]] ?? "";
    const [año, mes] = añoMesDe(g("Fecha"));
    return [
      g("Fecha"), año, mes, g("Tipo"), g("Categoria"), g("Subcategoria"), g("Medio_pago"),
      g("Estado_pago"), parseCLP(g("Monto")), g("Detalle"),
      g("Fecha_vencimiento"), g("Cuota_devengada"), g("Cuotas_totales"), g("Mes_pago_opcion"),
    ];
  });

  const cuentas = (resumenResp.data.values || [])
    .filter((r) => r[0])
    .map(([nombre, saldo]) => [String(nombre).trim(), parseCLP(saldo) || 0]);
  const totalCuentas = cuentas.reduce((s, c) => s + c[1], 0);
  console.log(`     Cuentas: ${cuentas.length} · total ${f(totalCuentas)}`);

  console.log("2/6  Reemplazando Movimientos…");
  await sheets.spreadsheets.values.clear({ spreadsheetId: NEW, range: "Movimientos!A2:N100000" });
  await sheets.spreadsheets.values.update({
    spreadsheetId: NEW,
    range: "Movimientos!A1",
    valueInputOption: "RAW",
    requestBody: { values: [MOV_HEADERS, ...movimientos] },
  });

  console.log("3/6  Reemplazando Cuentas…");
  const hoy = new Date().toISOString().slice(0, 10);
  await sheets.spreadsheets.values.clear({ spreadsheetId: NEW, range: "Cuentas!A2:C1000" });
  await sheets.spreadsheets.values.update({
    spreadsheetId: NEW,
    range: "Cuentas!A1",
    valueInputOption: "RAW",
    requestBody: { values: [["Cuenta", "Saldo_actual", "Fecha_actualizacion"], ...cuentas.map((c) => [...c, hoy])] },
  });

  console.log("4/6  Calculando el ancla del mes en curso…");
  const d = new Date();
  const mesAct = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const pagadosDelMes = movimientos.filter((m) => `${m[1]}-${String(m[2]).padStart(2, "0")}` === mesAct && String(m[7]).trim() === "Pagado");
  const ing = pagadosDelMes.filter((m) => m[3] === "Ingreso").reduce((s, m) => s + Math.abs(Number(m[8]) || 0), 0);
  const gas = pagadosDelMes.filter((m) => m[3] === "Gasto").reduce((s, m) => s + Math.abs(Number(m[8]) || 0), 0);
  const ancla = totalCuentas - ing + gas;
  console.log(`     ${mesAct}: ingresos pagados ${f(ing)} · gastos pagados ${f(gas)}`);
  console.log(`     ancla saldo inicial = ${f(ancla)}`);

  console.log("5/6  Reescribiendo SaldoMensual…");
  await sheets.spreadsheets.values.clear({ spreadsheetId: NEW, range: "SaldoMensual!A2:B200" });
  await sheets.spreadsheets.values.update({
    spreadsheetId: NEW,
    range: "SaldoMensual!A1",
    valueInputOption: "RAW",
    requestBody: { values: [["Mes", "Saldo_inicial"], [mesAct, ancla]] },
  });

  console.log("6/6  Verificando la conciliación…");
  const esperado = ancla + ing - gas;
  console.log(`\n=== RESULTADO ===`);
  console.log(`  Movimientos:        ${movimientos.length}`);
  console.log(`  Saldo inicial:      ${f(ancla)}`);
  console.log(`  + ingresos pagados: ${f(ing)}`);
  console.log(`  - gastos pagados:   ${f(gas)}`);
  console.log(`  = esperado:         ${f(esperado)}`);
  console.log(`  saldo real:         ${f(totalCuentas)}`);
  console.log(`  DIFERENCIA:         ${f(totalCuentas - esperado)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
