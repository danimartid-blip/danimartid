// Crea/recarga la pestaña "Creditos" de la planilla DB.
//
// Modelo: cada crédito se ancla en un PUNTO DE REFERENCIA verificable (saldo
// real a una fecha, cuántas cuotas quedaban desde ahí y a qué tasa). La app
// amortiza hacia adelante desde ese punto, así que el saldo de hoy nunca es una
// estimación suelta: sale de un número que salió del banco.
//
// Los montos van en la moneda del crédito (UF para los hipotecarios, pesos para
// el de consumo); la columna Moneda dice cuál es.
import { google } from "googleapis";
import { getAuth } from "./auth.mjs";

const SPREADSHEET_ID = "1mUcDhTdKOa23oQpVdkY0QXDVZdKI0IK5qZxg1C4E-Zg";
const sheets = google.sheets({ version: "v4", auth: getAuth() });

/** Tasa mensual que reproduce el saldo que muestra el banco tras k cuotas.
 * Se prefiere sobre la que sale de la anualidad (capital vs 55 cuotas) porque
 * calza exactamente con el saldo informado, sin arrastrar comisiones ni seguros
 * que estén metidos dentro de la cuota. */
function tasaPorSaldo(capital, cuota, k, saldo) {
  const saldoTras = (i) =>
    i === 0 ? capital - cuota * k : capital * Math.pow(1 + i, k) - cuota * ((Math.pow(1 + i, k) - 1) / i);
  let lo = 0;
  let hi = 0.2;
  for (let j = 0; j < 300; j++) {
    const mid = (lo + hi) / 2;
    if (saldoTras(mid) < saldo) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// Crédito de consumo: no hay contrato a mano, así que la tasa se deriva de lo
// que muestra la banca en línea (monto otorgado, cuota, cuotas pagadas y monto
// pendiente). Reproduce el saldo informado al peso.
const CONSUMO = { capital: 19356351, cuota: 460346, plazo: 55, pagadas: 14, saldo: 15377135 };
const tasaConsumoMensual = tasaPorSaldo(CONSUMO.capital, CONSUMO.cuota, CONSUMO.pagadas, CONSUMO.saldo);
const tasaConsumo = Number((tasaConsumoMensual * 12).toFixed(6));
console.log(`Tasa del consumo derivada: ${(tasaConsumoMensual * 100).toFixed(4)}% mensual = ${(tasaConsumo * 100).toFixed(2)}% anual\n`);

const CABECERA = [
  "Nombre", "Tipo", "Subcategoria", "Banco", "Operacion", "Moneda", "Capital",
  "Fecha_giro", "Plazo_cuotas", "Tasa_inicial", "Tasa_actual", "Fecha_cambio_tasa",
  "Fecha_referencia", "Saldo_referencia", "Cuotas_restantes_ref", "Dividendo",
  "Seguros", "Prepago_dias", "Notas",
];

const FILAS = [
  [
    "Departamento Cerrillos", "Hipotecario", "Departamento Cerrillos", "Santander", "00350336500011225520",
    "UF", 1887, "01-03-2021", 300, 0.013, 0.03064, "01-04-2026",
    "01-03-2026", 1573.7324, 243, 8.6997, 0.7395, 45,
    "Tasa mixta: 1,30% fija los primeros 5 años desde el giro, variable despues. Seguros: desgravamen 0,1661 + incendio/sismo 0,5734 UF. Saldo de referencia validado contra el certificado de liquidacion del banco (1.601,9875 UF tras la cuota 52, al 08-10-2025). Vence 01-06-2046.",
  ],
  [
    "Casa Ciudad Satélite", "Hipotecario", "Casa Maipú", "Santander", "Escritura 30-06-2021 (portabilidad)",
    "UF", 2175, "30-06-2021", 237, 0.0195, 0.02224, "01-08-2026",
    "01-07-2026", 1725.631, 180, 11.2832, 0.7531, 45,
    "Portabilidad con subrogacion. Dos mutuos: 2.096 UF vivienda + 72 UF fines generales; el capital incluye los intereses capitalizados de los 3 meses de gracia. Tasa 1,95% fija 5 años, despues variable = TAB 360 dias + 1,35 puntos, que se reajusta CADA AÑO (proximo cambio: julio 2027). Vence jul-2041.",
  ],
  [
    "Crédito de consumo", "Consumo", "Pago Prestamo", "Santander", "",
    "CLP", CONSUMO.capital, "09-07-2025", CONSUMO.plazo, tasaConsumo, tasaConsumo, "",
    "04-09-2026", CONSUMO.saldo, CONSUMO.plazo - CONSUMO.pagadas, CONSUMO.cuota, 0, 30,
    `Tasa fija en pesos, derivada de la banca en linea: otorgado ${CONSUMO.capital.toLocaleString("es-CL")} el 09-07-2025, ${CONSUMO.plazo} cuotas de ${CONSUMO.cuota.toLocaleString("es-CL")}, ${CONSUMO.pagadas} pagadas y saldo ${CONSUMO.saldo.toLocaleString("es-CL")} al 04-09-2026. La tasa derivada reproduce ese saldo al peso exacto. Vence 04-02-2030. Comision de prepago: 30 dias de interes (credito no reajustable).`,
  ],
];

const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
if (meta.data.sheets.some((s) => s.properties.title === "Creditos")) {
  console.log("La pestaña 'Creditos' ya existe — se limpia y se recarga.");
  await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: "Creditos!A1:Z100" });
} else {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: "Creditos" } } }] },
  });
  console.log("Pestaña 'Creditos' creada.");
}

// RAW siempre: si no, Sheets reinterpreta "01-03-2021" como fecha.
await sheets.spreadsheets.values.update({
  spreadsheetId: SPREADSHEET_ID,
  range: "Creditos!A1",
  valueInputOption: "RAW",
  requestBody: { values: [CABECERA, ...FILAS] },
});

const check = await sheets.spreadsheets.values.get({
  spreadsheetId: SPREADSHEET_ID, range: "Creditos!A1:S10", valueRenderOption: "UNFORMATTED_VALUE",
});
console.log(`\nEscritas ${check.data.values.length - 1} filas:\n`);
for (const r of check.data.values.slice(1)) {
  console.log(`  ${String(r[0]).padEnd(24)} ${r[1].padEnd(12)} ${r[5]}  saldo ref ${r[13]}  tasa ${(Number(r[10]) * 100).toFixed(2)}%`);
}
