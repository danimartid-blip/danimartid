// Trae los saldos de cuentas actualizados desde el Resumen del Sheet ORIGINAL
// (solo lectura) hacia la pestaña Cuentas de la app, y deja registro de cada
// cambio en Conciliaciones. Seguro de re-ejecutar: solo toca lo que cambió.
import { google } from "googleapis";
import { getAuth } from "./auth.mjs";

const ORIGINAL = "1x4mPNBEPpd1o3m8X7gfQitEGLilp6iyjSbfa8PEdfmI";
const NEW = "1mUcDhTdKOa23oQpVdkY0QXDVZdKI0IK5qZxg1C4E-Zg";

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
  const sheets = google.sheets({ version: "v4", auth: getAuth() });
  const hoy = new Date().toISOString().slice(0, 10);

  const [origResp, cuentasResp] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId: ORIGINAL, range: "Resumen!A2:B9" }),
    sheets.spreadsheets.values.get({ spreadsheetId: NEW, range: "Cuentas!A2:C1000" }),
  ]);

  const origen = (origResp.data.values || [])
    .filter((r) => r[0])
    .map(([nombre, saldo]) => ({ nombre: String(nombre).trim(), saldo: parseCLP(saldo) }));

  const actuales = (cuentasResp.data.values || [])
    .map((r, i) => ({ row: i + 2, nombre: (r[0] || "").trim(), saldo: Number(r[1]) || 0, fecha: r[2] }))
    .filter((c) => c.nombre);

  console.log("Comparación (original -> app):");
  const cambios = [];
  const nuevas = [];
  for (const o of origen) {
    const actual = actuales.find((c) => c.nombre === o.nombre);
    if (!actual) {
      nuevas.push(o);
      console.log(`  + ${o.nombre}: NUEVA (${o.saldo})`);
    } else if (actual.saldo !== o.saldo) {
      cambios.push({ ...o, row: actual.row, anterior: actual.saldo });
      console.log(`  ~ ${o.nombre}: ${actual.saldo} -> ${o.saldo}`);
    } else {
      console.log(`  = ${o.nombre}: sin cambios (${o.saldo})`);
    }
  }

  if (!cambios.length && !nuevas.length) {
    console.log("\nNada que actualizar.");
    return;
  }

  // RAW para que la fecha quede como texto y no como número de serie.
  for (const c of cambios) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: NEW,
      range: `Cuentas!B${c.row}:C${c.row}`,
      valueInputOption: "RAW",
      requestBody: { values: [[c.saldo, hoy]] },
    });
  }
  if (nuevas.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: NEW,
      range: "Cuentas!A:C",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: nuevas.map((n) => [n.nombre, n.saldo, hoy]) },
    });
  }

  const bitacora = cambios.map((c) => [hoy, c.nombre, c.anterior, c.saldo, c.saldo - c.anterior]);
  if (bitacora.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: NEW,
      range: "Conciliaciones!A:E",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: bitacora },
    });
  }

  console.log(`\nActualizadas: ${cambios.length} | Nuevas: ${nuevas.length}`);
  console.log("Registrado en Conciliaciones.");
}
main().catch((e) => { console.error(e); process.exit(1); });
