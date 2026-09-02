import { google } from "googleapis";
import { getAuth } from "./auth.mjs";

const NEW_SPREADSHEET_ID = "1mUcDhTdKOa23oQpVdkY0QXDVZdKI0IK5qZxg1C4E-Zg";

async function main() {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: NEW_SPREADSHEET_ID,
    range: "Movimientos!A2:C100000",
  });
  const rows = resp.data.values || [];
  const keys = new Map();
  for (const [fecha, año, mes] of rows) {
    const key = JSON.stringify({ año, mes });
    keys.set(key, (keys.get(key) || 0) + 1);
  }
  console.log(`Total filas: ${rows.length}`);
  console.log("Combinaciones únicas (año, mes) [raw]:");
  for (const [key, count] of [...keys.entries()].sort()) {
    console.log(`  ${key} -> ${count} filas`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
