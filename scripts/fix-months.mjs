// Recomputes Año/Mes for every row in Movimientos from the Fecha column (DD/MM/YYYY),
// instead of trusting the original sheet's Año/Mes columns (which had ~86 corrupted
// rows reading "08-ppto" due to a broken formula upstream).
import { google } from "googleapis";
import { getAuth } from "./auth.mjs";

const NEW_SPREADSHEET_ID = "1mUcDhTdKOa23oQpVdkY0QXDVZdKI0IK5qZxg1C4E-Zg";

async function main() {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: NEW_SPREADSHEET_ID,
    range: "Movimientos!A2:A100000",
  });
  const fechas = resp.data.values || [];

  let fixed = 0;
  const values = fechas.map(([fecha]) => {
    if (!fecha) return ["", ""];
    const s = String(fecha).trim();
    // Historical rows: DD/MM/YYYY. Rows written by the app's <input type="date">: YYYY-MM-DD.
    const slash = s.split("/");
    const dash = s.split("-");
    let yyyy, mm;
    if (slash.length === 3) [, mm, yyyy] = slash;
    else if (dash.length === 3) [yyyy, mm] = dash;
    else return ["", ""];
    if (!mm || !yyyy) return ["", ""];
    fixed++;
    return [yyyy, String(Number(mm))];
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: NEW_SPREADSHEET_ID,
    range: `Movimientos!B2:C${1 + values.length}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });

  console.log(`Filas recalculadas: ${fixed} / ${fechas.length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
