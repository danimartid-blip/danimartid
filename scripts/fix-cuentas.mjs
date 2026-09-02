// Rewrites Cuentas as a simple manually-tracked balance ledger (no auto-calc from
// movements — Medio_pago mixes real accounts with credit cards, so summing
// movements would silently produce wrong balances). Seeds with today's real
// balances (read once from the original Resumen, read-only).
import { google } from "googleapis";
import { getAuth } from "./auth.mjs";

const ORIGINAL_SPREADSHEET_ID = "1x4mPNBEPpd1o3m8X7gfQitEGLilp6iyjSbfa8PEdfmI";
const NEW_SPREADSHEET_ID = "1mUcDhTdKOa23oQpVdkY0QXDVZdKI0IK5qZxg1C4E-Zg";

function parseCLP(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return 0;
  const negative = s.startsWith("(") && s.endsWith(")");
  const digits = s.replace(/[^\d]/g, "");
  if (!digits) return 0;
  const n = parseInt(digits, 10);
  return negative ? -n : n;
}

async function main() {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  const resumenResp = await sheets.spreadsheets.values.get({
    spreadsheetId: ORIGINAL_SPREADSHEET_ID,
    range: "Resumen!A2:B9",
  });
  const today = new Date().toISOString().slice(0, 10);
  const rows = (resumenResp.data.values || [])
    .filter((r) => r[0])
    .map(([nombre, saldo]) => [String(nombre).trim(), parseCLP(saldo), today]);

  await sheets.spreadsheets.values.clear({
    spreadsheetId: NEW_SPREADSHEET_ID,
    range: "Cuentas!A1:Z1000",
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: NEW_SPREADSHEET_ID,
    range: "Cuentas!A1",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [["Cuenta", "Saldo_actual", "Fecha_actualizacion"], ...rows] },
  });

  console.log("Cuentas reescrita:");
  for (const [nombre, saldo] of rows) console.log(`  ${nombre}: ${saldo}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
