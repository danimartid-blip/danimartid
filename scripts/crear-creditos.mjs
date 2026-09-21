// Crea la pestaña "Creditos" de la planilla DB y carga los dos hipotecarios,
// con los datos leídos de las escrituras y verificados contra los pagos reales.
//
// Modelo: cada crédito se ancla en un PUNTO DE REFERENCIA verificable (saldo
// conocido a una fecha, cuántas cuotas quedaban desde ahí y a qué tasa). La app
// amortiza hacia adelante desde ese punto, así que el saldo de hoy nunca es una
// estimación suelta: sale de un número que salió del banco.
import { google } from "googleapis";
import { getAuth } from "./auth.mjs";

const SPREADSHEET_ID = "1mUcDhTdKOa23oQpVdkY0QXDVZdKI0IK5qZxg1C4E-Zg";
const sheets = google.sheets({ version: "v4", auth: getAuth() });

const CABECERA = [
  "Nombre", "Subcategoria", "Banco", "Operacion", "Capital_UF", "Fecha_giro",
  "Plazo_cuotas", "Tasa_inicial", "Tasa_actual", "Fecha_cambio_tasa",
  "Fecha_referencia", "Saldo_referencia_UF", "Cuotas_restantes_ref",
  "Dividendo_UF", "Seguros_UF", "Prepago_dias", "Notas",
];

const FILAS = [
  [
    "Departamento Cerrillos", "Departamento Cerrillos", "Santander", "00350336500011225520",
    1887, "01-03-2021", 300, 0.013, 0.03064, "01-04-2026",
    "01-03-2026", 1573.7324, 243, 8.6997, 0.7395, 45,
    "Tasa mixta: 1,30% fija los primeros 5 años desde el giro, variable después. Seguros: desgravamen 0,1661 + incendio/sismo 0,5734. Saldo de referencia validado contra el certificado de liquidacion del banco (1.601,9875 UF tras la cuota 52, al 08-10-2025). Vence 01-06-2046.",
  ],
  [
    "Casa Ciudad Satélite", "Casa Maipú", "Santander", "Escritura 30-06-2021 (portabilidad)",
    2175, "30-06-2021", 237, 0.0195, 0.02224, "01-08-2026",
    "01-07-2026", 1725.631, 180, 11.2832, 0.7531, 45,
    "Portabilidad con subrogacion. Dos mutuos: 2.096 UF vivienda + 72 UF fines generales; el capital incluye los intereses capitalizados de los 3 meses de gracia. Tasa 1,95% fija 5 años, despues variable = TAB 360 dias + 1,35 puntos, que se reajusta CADA AÑO (proximo cambio: julio 2027). Vence jul-2041.",
  ],
];

const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
const existente = meta.data.sheets.find((s) => s.properties.title === "Creditos");

if (existente) {
  console.log("La pestaña 'Creditos' ya existe — se limpia y se recarga.");
  await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: "Creditos!A1:Z100" });
} else {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: "Creditos" } } }] },
  });
  console.log("Pestaña 'Creditos' creada.");
}

// RAW siempre: si no, Sheets reinterpreta "01-03-2021" como fecha y rompe el texto.
await sheets.spreadsheets.values.update({
  spreadsheetId: SPREADSHEET_ID,
  range: "Creditos!A1",
  valueInputOption: "RAW",
  requestBody: { values: [CABECERA, ...FILAS] },
});

const check = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "Creditos!A1:Q5" });
console.log(`\nEscritas ${check.data.values.length - 1} filas:\n`);
for (const fila of check.data.values.slice(1)) {
  console.log(`  ${fila[0]} — capital ${fila[4]} UF, saldo ref ${fila[11]} UF, tasa ${(Number(fila[8]) * 100).toFixed(3)}%`);
}
