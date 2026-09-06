// Corrige el pago de Cencosud: se marcó pagada la cuota 2/2 (vence 4-10) en vez
// de la 1/2 (vence 4-9), que es la que factura el estado de cuenta de septiembre.
import { google } from "googleapis";
import { getAuth } from "./auth.mjs";

const NEW = "1mUcDhTdKOa23oQpVdkY0QXDVZdKI0IK5qZxg1C4E-Zg";

async function main() {
  const sheets = google.sheets({ version: "v4", auth: getAuth() });
  const f = (n) => "$" + Math.round(n).toLocaleString("es-CL");

  const r = await sheets.spreadsheets.values.get({ spreadsheetId: NEW, range: "Movimientos!A2:N100000" });
  const ms = (r.data.values || [])
    .map((x, i) => ({ fila: i + 2, fecha: x[0], medio: (x[6] || "").trim(), estado: (x[7] || "").trim(),
      monto: Number(x[8]) || 0, det: x[9] || "", venc: (x[10] || "").trim() }))
    .filter((m) => m.fecha);

  const cuota1 = ms.find((m) => m.medio === "Cencosud" && m.venc === "4-9-2026");
  const cuota2 = ms.find((m) => m.medio === "Cencosud" && m.venc === "4-10-2026");

  if (!cuota1 || !cuota2) {
    console.log("No encontré las dos cuotas esperadas. Nada que hacer.");
    return;
  }
  console.log("Antes:");
  console.log(`  fila ${cuota1.fila} | venc ${cuota1.venc} | ${cuota1.estado} | ${f(cuota1.monto)} | ${cuota1.det}`);
  console.log(`  fila ${cuota2.fila} | venc ${cuota2.venc} | ${cuota2.estado} | ${f(cuota2.monto)} | ${cuota2.det}`);

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: NEW,
    requestBody: {
      valueInputOption: "RAW",
      data: [
        { range: `Movimientos!H${cuota1.fila}`, values: [["Pagado"]] },
        { range: `Movimientos!H${cuota2.fila}`, values: [["Por pagar"]] },
      ],
    },
  });

  const r2 = await sheets.spreadsheets.values.get({
    spreadsheetId: NEW, range: `Movimientos!A${Math.min(cuota1.fila, cuota2.fila)}:K${Math.max(cuota1.fila, cuota2.fila)}` });
  console.log("\nDespués:");
  (r2.data.values || []).forEach((x, i) => {
    const fila = Math.min(cuota1.fila, cuota2.fila) + i;
    if ((x[6] || "").trim() === "Cencosud") console.log(`  fila ${fila} | venc ${x[10]} | ${x[7]} | ${f(Number(x[8]) || 0)} | ${x[9]}`);
  });
}
main().catch((e) => { console.error(e); process.exit(1); });
