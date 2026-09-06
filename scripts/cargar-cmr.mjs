// Carga el estado de cuenta CMR (facturación 24/08/2026) como "Por pagar".
// Fecha del movimiento: 1/9/2026 · Vencimiento: 10-9-2026 · Medio: CMR
import { google } from "googleapis";
import { getAuth } from "./auth.mjs";

const NEW = "1mUcDhTdKOa23oQpVdkY0QXDVZdKI0IK5qZxg1C4E-Zg";
const FECHA = "1/9/2026";
const VENC = "10-9-2026";
const MEDIO = "CMR";

// [categoria, subcategoria, monto, detalle]  — monto en positivo, se firma abajo
const CARGOS = [
  ["Vehículo", "Estacionamiento", 1700, "Parking mall plaza 30-07"],
  ["Vehículo", "Estacionamiento", 1600, "Parking mall plaza 08-08"],
  ["Vehículo", "Estacionamiento", 850, "Parking mall plaza 11-08"],
  ["Vehículo", "Estacionamiento", 1300, "Parking mall plaza 22-08"],
  ["Vehículo", "Estacionamiento", 1150, "Parking mall plaza 23-08"],
  ["Vehículo", "Estacionamiento", 950, "Parking mall plaza 24-08"],
  ["Costo tarjetas", "CMR", 1308, "Seguro desgravamen 11-12"],
];

async function main() {
  const sheets = google.sheets({ version: "v4", auth: getAuth() });
  const f = (n) => "$" + Math.round(n).toLocaleString("es-CL");

  const filas = CARGOS.map(([cat, sub, monto, det]) => [
    FECHA, "2026", "9", "Gasto", cat, sub, MEDIO, "Por pagar", -monto, det, VENC, "", "", "",
  ]);

  const total = CARGOS.reduce((s, c) => s + c[2], 0);
  console.log("Se cargarán:");
  CARGOS.forEach(([cat, sub, monto, det]) => console.log(`  ${f(monto)}  ${cat}/${sub}  · ${det}`));
  console.log(`  ─────────────`);
  console.log(`  TOTAL: ${f(total)}   (el estado de cuenta dice $8.850 → ${f(total - 8850)} de diferencia)`);

  await sheets.spreadsheets.values.append({
    spreadsheetId: NEW,
    range: "Movimientos!A:N",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: filas },
  });
  console.log(`\n${filas.length} movimientos agregados.`);

  // verificación: releer lo que quedó
  const r = await sheets.spreadsheets.values.get({ spreadsheetId: NEW, range: "Movimientos!A2:N100000" });
  const cmr = (r.data.values || []).filter((x) => (x[6] || "").trim() === "CMR" && (x[7] || "").trim() === "Por pagar");
  const neto = -cmr.reduce((s, x) => s + (Number(x[8]) || 0), 0);
  console.log(`\nVerificación — "Por pagar" de CMR en la planilla: ${cmr.length} movimientos, ${f(neto)}`);
  cmr.forEach((x) => console.log(`  ${x[0]} | ${x[4]}/${x[5]} | ${f(Math.abs(Number(x[8]) || 0))} | venc ${x[10]} | ${x[9]}`));
}
main().catch((e) => { console.error(e); process.exit(1); });
