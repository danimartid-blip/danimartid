// Safe incremental sync: appends to Movimientos any row that exists in the
// ORIGINAL BD (read-only) but not yet in Movimientos, matched by content (not
// position), so it's safe to re-run any time and won't duplicate or touch
// anything already in the app's DB. Does NOT handle edits to already-migrated
// rows (only additions) — confirmed with the user this sync is append-only.
import { google } from "googleapis";
import { getAuth } from "./auth.mjs";

const ORIGINAL_SPREADSHEET_ID = "1x4mPNBEPpd1o3m8X7gfQitEGLilp6iyjSbfa8PEdfmI";
const NEW_SPREADSHEET_ID = "1mUcDhTdKOa23oQpVdkY0QXDVZdKI0IK5qZxg1C4E-Zg";

const BD_HEADERS = [
  "Fecha", "Año", "Mes", "Tipo", "Categoria", "Subcategoria", "Medio_pago",
  "Estado_pago", "Fecha_vencimiento", "Monto", "Detalle",
  "Cuota_devengada", "Cuotas_totales", "Mes_pago_opcion",
];
const bdIdx = Object.fromEntries(BD_HEADERS.map((h, i) => [h, i]));

function parseCLP(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const negative = s.startsWith("(") && s.endsWith(")");
  const digits = s.replace(/[^\d]/g, "");
  if (!digits) return "";
  const n = parseInt(digits, 10);
  return negative ? -n : n;
}

function keyOf(fecha, categoria, subcategoria, monto, detalle) {
  return [fecha, categoria, subcategoria, monto, detalle].join("|");
}

async function main() {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  console.log("Leyendo BD original (solo lectura)...");
  const bdResp = await sheets.spreadsheets.values.get({
    spreadsheetId: ORIGINAL_SPREADSHEET_ID,
    range: "BD!A2:N100000",
  });
  const bdRows = bdResp.data.values || [];

  console.log("Leyendo Movimientos actuales de la app...");
  const movResp = await sheets.spreadsheets.values.get({
    spreadsheetId: NEW_SPREADSHEET_ID,
    range: "Movimientos!A2:N100000",
  });
  const movRows = movResp.data.values || [];

  const existingKeys = new Set(
    movRows.map((r) => keyOf(r[0], r[4], r[5], Number(r[8]) || 0, r[9]))
  );

  const nuevas = [];
  for (const row of bdRows) {
    const get = (name) => row[bdIdx[name]] ?? "";
    const monto = parseCLP(get("Monto"));
    const key = keyOf(get("Fecha"), get("Categoria"), get("Subcategoria"), monto || 0, get("Detalle"));
    if (existingKeys.has(key)) continue;
    nuevas.push([
      get("Fecha"), get("Año"), get("Mes"), get("Tipo"), get("Categoria"),
      get("Subcategoria"), get("Medio_pago"), get("Estado_pago"),
      monto, get("Detalle"),
      get("Fecha_vencimiento"), get("Cuota_devengada"), get("Cuotas_totales"),
      get("Mes_pago_opcion"),
    ]);
  }

  console.log(`Filas nuevas detectadas: ${nuevas.length}`);
  if (nuevas.length === 0) {
    console.log("Nada que traspasar.");
    return;
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: NEW_SPREADSHEET_ID,
    range: "Movimientos!A2",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: nuevas },
  });
  console.log(`${nuevas.length} filas agregadas a Movimientos.`);

  // Recalcula Año/Mes desde Fecha para TODAS las filas (igual que fix-months.mjs),
  // por si alguna fila nueva viene con Año/Mes inconsistente.
  const all = await sheets.spreadsheets.values.get({
    spreadsheetId: NEW_SPREADSHEET_ID,
    range: "Movimientos!A2:A100000",
  });
  const fechas = all.data.values || [];
  const values = fechas.map(([fecha]) => {
    if (!fecha) return ["", ""];
    const s = String(fecha).trim();
    const slash = s.split("/");
    const dash = s.split("-");
    let yyyy, mm;
    if (slash.length === 3) [, mm, yyyy] = slash;
    else if (dash.length === 3) [yyyy, mm] = dash;
    else return ["", ""];
    if (!mm || !yyyy) return ["", ""];
    return [yyyy, String(Number(mm))];
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: NEW_SPREADSHEET_ID,
    range: `Movimientos!B2:C${1 + values.length}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });
  console.log("Año/Mes recalculados para todas las filas.");
}
main().catch((e) => { console.error(e); process.exit(1); });
