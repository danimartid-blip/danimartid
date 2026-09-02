// One-off migration: creates a NEW Google Sheet ("Finanzas App - DB") and copies
// historical data from the user's ORIGINAL sheet (read-only, never modified) into it.
//
// Usage: npm run migrate

import { google } from "googleapis";
import { getAuth } from "./auth.mjs";

const ORIGINAL_SPREADSHEET_ID = "1x4mPNBEPpd1o3m8X7gfQitEGLilp6iyjSbfa8PEdfmI";

const MOVIMIENTOS_HEADERS = [
  "Fecha", "Año", "Mes", "Tipo", "Categoria", "Subcategoria", "Medio_pago",
  "Estado_pago", "Monto", "Detalle",
  "Fecha_vencimiento", "Cuota_devengada", "Cuotas_totales", "Mes_pago_opcion",
];
// Column order in the ORIGINAL BD tab (source), mapped to the same field names above.
const BD_HEADERS = [
  "Fecha", "Año", "Mes", "Tipo", "Categoria", "Subcategoria", "Medio_pago",
  "Estado_pago", "Fecha_vencimiento", "Monto", "Detalle",
  "Cuota_devengada", "Cuotas_totales", "Mes_pago_opcion",
];

const PRESUPUESTO_HEADERS = ["Categoria", "Monto_meta"];

function parseCLP(raw) {
  if (raw == null) return "";
  const s = String(raw).trim();
  if (s === "") return "";
  const negative = s.startsWith("(") && s.endsWith(")");
  const digits = s.replace(/[^\d]/g, "");
  if (digits === "") return "";
  const n = parseInt(digits, 10);
  return negative ? -n : n;
}

async function main() {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  console.log("1/5 Leyendo BD del sheet original (solo lectura)...");
  const bdResp = await sheets.spreadsheets.values.get({
    spreadsheetId: ORIGINAL_SPREADSHEET_ID,
    range: "BD!A2:N100000",
  });
  const bdRows = bdResp.data.values || [];
  console.log(`   -> ${bdRows.length} filas encontradas en BD`);

  // Reorder BD columns (Fecha_vencimiento is col I in BD) into the new Movimientos order
  // (Fecha_vencimiento moved to the end, with the other 3 cuota fields).
  const bdIdx = Object.fromEntries(BD_HEADERS.map((h, i) => [h, i]));
  const movimientosRows = bdRows.map((row) => {
    const get = (name) => row[bdIdx[name]] ?? "";
    return [
      get("Fecha"), get("Año"), get("Mes"), get("Tipo"), get("Categoria"),
      get("Subcategoria"), get("Medio_pago"), get("Estado_pago"),
      parseCLP(get("Monto")), get("Detalle"),
      get("Fecha_vencimiento"), get("Cuota_devengada"), get("Cuotas_totales"),
      get("Mes_pago_opcion"),
    ];
  });

  console.log("2/5 Leyendo bloque de presupuesto en Resumen (solo lectura)...");
  const resumenResp = await sheets.spreadsheets.values.get({
    spreadsheetId: ORIGINAL_SPREADSHEET_ID,
    range: "Resumen!A15:J200",
  });
  const resumenRows = resumenResp.data.values || [];
  const presupuestoRows = [];
  for (const row of resumenRows) {
    const catRaw = row[0];
    if (!catRaw || !String(catRaw).trim()) break; // end of block
    if (!String(catRaw).startsWith("Total ")) continue;
    const categoria = String(catRaw).replace(/^Total\s+/, "").trim();
    const meta = parseCLP(row[9]); // column J
    presupuestoRows.push([categoria, meta]);
  }
  console.log(`   -> ${presupuestoRows.length} categorías de presupuesto encontradas`);

  console.log("3/5 Creando spreadsheet nuevo 'Finanzas App - DB'...");
  const createResp = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: "Finanzas App - DB" },
      sheets: [
        { properties: { title: "Movimientos" } },
        { properties: { title: "Presupuesto" } },
      ],
    },
  });
  const newSpreadsheetId = createResp.data.spreadsheetId;
  console.log(`   -> Creado: ${newSpreadsheetId}`);

  console.log("4/5 Escribiendo encabezados y datos...");
  await sheets.spreadsheets.values.update({
    spreadsheetId: newSpreadsheetId,
    range: "Movimientos!A1",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [MOVIMIENTOS_HEADERS] },
  });
  if (movimientosRows.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: newSpreadsheetId,
      range: "Movimientos!A2",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: movimientosRows },
    });
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId: newSpreadsheetId,
    range: "Presupuesto!A1",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [PRESUPUESTO_HEADERS] },
  });
  if (presupuestoRows.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: newSpreadsheetId,
      range: "Presupuesto!A2",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: presupuestoRows },
    });
  }

  console.log("5/5 Verificando...");
  const verify = await sheets.spreadsheets.values.get({
    spreadsheetId: newSpreadsheetId,
    range: "Movimientos!A2:A100000",
  });
  const writtenCount = (verify.data.values || []).length;

  console.log("\n=== LISTO ===");
  console.log(`Filas migradas a Movimientos: ${writtenCount} (original BD: ${bdRows.length})`);
  console.log(`Categorías en Presupuesto: ${presupuestoRows.length}`);
  console.log(`Spreadsheet ID: ${newSpreadsheetId}`);
  console.log(`URL: https://docs.google.com/spreadsheets/d/${newSpreadsheetId}/edit`);
  if (writtenCount !== bdRows.length) {
    console.log("⚠️  El conteo no coincide, revisar manualmente.");
  }
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
