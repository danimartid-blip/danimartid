# Finanzas — registro rápido + dashboard

App personal de finanzas: un formulario mobile-first para registrar movimientos en
segundos desde el celular, y un dashboard con métricas en vivo. Sin backend — el sitio es
estático y habla directo con la Google Sheets API desde el navegador (OAuth con tu propia
cuenta de Google).

- `index.html` — dashboard (balance del mes, gasto por categoría vs. presupuesto,
  tendencia, pendientes de pago).
- `registro.html` — formulario de registro rápido (agregable a la pantalla de inicio del
  celular).
- `js/sheets-auth.js` — login con Google (Identity Services) + helpers para leer/escribir
  en Sheets.
- `js/config.js` — IDs de configuración (Client ID de OAuth, ID de la planilla).
- `scripts/migrate.mjs` — script one-off que migró el histórico desde el Sheet original a
  la planilla nueva de esta app (no se vuelve a correr salvo re-sincronización manual).

## Datos

La app lee/escribe en una planilla de Google Sheets separada ("Finanzas App - DB"), no en
el Sheet financiero original del usuario, que queda intacto y solo se usó como fuente de
lectura para la migración inicial del histórico.

## Login

La cuenta de Google está en modo "Testing" en Google Cloud (solo el email del dueño puede
iniciar sesión). El token de acceso dura ~1 hora; pasado ese tiempo hay que volver a tocar
"Conectar con Google".
