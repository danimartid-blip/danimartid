// Crea la pestaña SaldoMensual: el saldo con el que ARRANCA cada mes.
// Es el ancla de la conciliación: saldo_inicial + pagados del mes = saldo esperado hoy.
// Se siembra septiembre con $1.293.950, que es la suma real de las cuentas al 1-sep
// (migrada del Resumen del sheet original ese día).
import { google } from "googleapis";
import { getAuth } from "./auth.mjs";

const NEW = "1mUcDhTdKOa23oQpVdkY0QXDVZdKI0IK5qZxg1C4E-Zg";

async function main() {
  const sheets = google.sheets({ version: "v4", auth: getAuth() });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: NEW });
  const existe = meta.data.sheets.some((s) => s.properties.title === "SaldoMensual");
  if (!existe) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: NEW,
      requestBody: { requests: [{ addSheet: { properties: { title: "SaldoMensual" } } }] },
    });
    console.log("Pestaña SaldoMensual creada.");
  } else {
    console.log("La pestaña SaldoMensual ya existía.");
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: NEW,
    range: "SaldoMensual!A1",
    valueInputOption: "RAW",
    requestBody: { values: [["Mes", "Saldo_inicial"], ["2026-09", 1293950]] },
  });

  console.log("Sembrado: 2026-09 = 1293950");
}
main().catch((e) => { console.error(e); process.exit(1); });
