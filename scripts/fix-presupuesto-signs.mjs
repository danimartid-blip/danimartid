import { google } from "googleapis";
import { getAuth } from "./auth.mjs";
const sheets = google.sheets({ version: "v4", auth: getAuth() });
const NEW = "1mUcDhTdKOa23oQpVdkY0QXDVZdKI0IK5qZxg1C4E-Zg";

const resp = await sheets.spreadsheets.values.get({ spreadsheetId: NEW, range: "Presupuesto!A2:E10000" });
const rows = resp.data.values || [];

const negatives = [];
const fixedValues = rows.map((r, i) => {
  const monto = Number(r[4]);
  if (monto < 0) negatives.push(`fila ${i+2}: ${r[2]} / "${r[3]}" = ${monto} -> ${Math.abs(monto)}`);
  return [Math.abs(monto)];
});

console.log(`Filas con monto negativo encontradas: ${negatives.length}`);
negatives.forEach((n) => console.log("  " + n));

if (negatives.length > 0) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: NEW,
    range: `Presupuesto!E2:E${1 + rows.length}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: fixedValues },
  });
  console.log("Corregido: todos los montos ahora son positivos.");
} else {
  console.log("Nada que corregir.");
}
