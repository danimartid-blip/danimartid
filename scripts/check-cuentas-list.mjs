import { google } from "googleapis";
import { getAuth } from "./auth.mjs";
const sheets = google.sheets({ version: "v4", auth: getAuth() });
const r = await sheets.spreadsheets.values.get({
  spreadsheetId: "1mUcDhTdKOa23oQpVdkY0QXDVZdKI0IK5qZxg1C4E-Zg", range: "Cuentas!A2:C100" });
(r.data.values||[]).forEach(row => console.log(row.join(" | ")));
