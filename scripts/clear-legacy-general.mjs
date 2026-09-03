import { google } from "googleapis";
import { getAuth } from "./auth.mjs";
const sheets = google.sheets({ version: "v4", auth: getAuth() });
const NEW = "1mUcDhTdKOa23oQpVdkY0QXDVZdKI0IK5qZxg1C4E-Zg";

const resp = await sheets.spreadsheets.values.get({ spreadsheetId: NEW, range: "Presupuesto!A2:E10000" });
const rows = resp.data.values || [];

// These are exactly the 25 rows seeded from the OLD flat Ppto column
// (mes=2026-09, tipo=Gasto, subcategoria blank). Clear them so the app falls
// back to computing each one's real 3-month average instead — avoids double
// counting once real per-subcategoria averages are already summed.
const toClear = [];
rows.forEach((r, i) => {
  if (r[0] === "2026-09" && r[1] === "Gasto" && !r[3]) toClear.push(i + 2);
});

console.log(`Filas 'General' de septiembre a limpiar: ${toClear.length}`);
for (const rowNum of toClear) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: NEW,
    range: `Presupuesto!A${rowNum}:E${rowNum}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [["", "", "", "", ""]] },
  });
}
console.log("Listo.");
