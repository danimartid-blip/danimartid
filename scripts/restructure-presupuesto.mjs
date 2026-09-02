// Restructures Presupuesto from flat (Categoria, Monto_meta) to a proper monthly
// zero-based budget: Mes, Tipo, Categoria, Subcategoria, Monto.
// Seeds the CURRENT month's Gasto rows from the old flat category targets (a
// starting point the user can then edit per month going forward).
import { google } from "googleapis";
import { getAuth } from "./auth.mjs";

const NEW_SPREADSHEET_ID = "1mUcDhTdKOa23oQpVdkY0QXDVZdKI0IK5qZxg1C4E-Zg";

async function main() {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  const old = await sheets.spreadsheets.values.get({
    spreadsheetId: NEW_SPREADSHEET_ID,
    range: "Presupuesto!A2:B1000",
  });
  const oldRows = (old.data.values || []).filter((r) => r[0]);

  const now = new Date();
  const seedMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const newRows = oldRows.map(([categoria, monto]) => [seedMonth, "Gasto", categoria, "", Number(monto) || 0]);

  await sheets.spreadsheets.values.clear({
    spreadsheetId: NEW_SPREADSHEET_ID,
    range: "Presupuesto!A1:Z10000",
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: NEW_SPREADSHEET_ID,
    range: "Presupuesto!A1",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [["Mes", "Tipo", "Categoria", "Subcategoria", "Monto"], ...newRows],
    },
  });

  console.log(`Presupuesto reestructurado. Sembradas ${newRows.length} filas de Gasto en ${seedMonth} (subcategoría en blanco = meta general de la categoría).`);
}
main().catch((e) => { console.error(e); process.exit(1); });
