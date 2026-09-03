// Repara la pestaña Presupuesto:
//  - convierte los "mes" guardados como número de serie de fecha de vuelta a "YYYY-MM"
//  - elimina duplicados (mismo mes+tipo+categoria+subcategoria), conservando el ÚLTIMO
//  - saca filas de prueba y filas en blanco, dejando el rango compacto
// El guardado desde la app ahora usa RAW, así que esto no debería volver a pasar.
import { google } from "googleapis";
import { getAuth } from "./auth.mjs";

const NEW = "1mUcDhTdKOa23oQpVdkY0QXDVZdKI0IK5qZxg1C4E-Zg";

function normalizeMes(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
    if (!isNaN(d)) return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  const d = new Date(s);
  if (!isNaN(d)) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return s;
}

async function main() {
  const sheets = google.sheets({ version: "v4", auth: getAuth() });
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: NEW, range: "Presupuesto!A2:E10000" });
  const rows = resp.data.values || [];
  console.log(`Filas leídas: ${rows.length}`);

  const byKey = new Map(); // el último gana
  let descartadas = 0;
  for (const r of rows) {
    const mes = normalizeMes(r[0]);
    const tipo = (r[1] || "").trim();
    const categoria = (r[2] || "").trim();
    const subcategoria = (r[3] || "").trim();
    const monto = Number(r[4]) || 0;
    if (!mes || !categoria || categoria.startsWith("ZZ_TEST")) { descartadas++; continue; }
    byKey.set(`${mes}|${tipo}|${categoria}|${subcategoria}`, [mes, tipo, categoria, subcategoria, monto]);
  }

  const limpias = [...byKey.values()];
  console.log(`Descartadas (vacías/prueba): ${descartadas}`);
  console.log(`Filas finales tras deduplicar: ${limpias.length}`);
  limpias.forEach((r) => console.log(`  ${r[0]} | ${r[1]} | ${r[2]} / "${r[3]}" = ${r[4]}`));

  await sheets.spreadsheets.values.clear({ spreadsheetId: NEW, range: "Presupuesto!A2:E10000" });
  if (limpias.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: NEW,
      range: "Presupuesto!A2",
      valueInputOption: "RAW", // clave: RAW evita que "2026-09" se vuelva fecha
      requestBody: { values: limpias },
    });
  }
  console.log("\nPresupuesto reparado.");
}
main().catch((e) => { console.error(e); process.exit(1); });
