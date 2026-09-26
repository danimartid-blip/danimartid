// Google Identity Services (client-side OAuth) + thin Sheets API v4 helper.
// No backend, no client secret — token lives only in this browser's localStorage.

const TOKEN_KEY = "gsheets_token";
let tokenClient = null;
let tokenClientReady = null;

function loadStoredToken() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.expiresAt > Date.now() + 30_000) return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

function storeToken(tokenResponse) {
  const expiresAt = Date.now() + (Number(tokenResponse.expires_in) || 3300) * 1000;
  localStorage.setItem(
    TOKEN_KEY,
    JSON.stringify({ accessToken: tokenResponse.access_token, expiresAt })
  );
}

function waitForGis() {
  if (tokenClientReady) return tokenClientReady;
  tokenClientReady = new Promise((resolve, reject) => {
    const check = () => {
      if (window.google?.accounts?.oauth2) {
        resolve();
      } else {
        setTimeout(check, 100);
      }
    };
    check();
    setTimeout(() => reject(new Error("Google Identity Services no cargó")), 15000);
  });
  return tokenClientReady;
}

async function ensureTokenClient() {
  await waitForGis();
  if (!tokenClient) {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: window.APP_CONFIG.CLIENT_ID,
      scope: window.APP_CONFIG.SCOPES,
      callback: () => {}, // overridden per-call below
      // GIS avisa acá cuando el popup no se pudo abrir. Se delega al handler de
      // la llamada en curso (ver getAccessToken).
      error_callback: (err) => tokenClient?._onError?.(err),
    });
  }
  return tokenClient;
}

const ESPERA_LOGIN_MS = 60_000;

/** Returns a valid access token, prompting the Google login popup if needed.
 *
 * OJO con el camino de error: si el navegador BLOQUEA el popup (pasa en el
 * celular cuando la renovación no nace de un toque directo, ej. al recargar
 * datos después de guardar), GIS no llama nunca al callback. Sin el
 * error_callback y el timeout de abajo, esta promesa queda pendiente para
 * siempre y la pantalla se congela sin ningún error — un botón "Guardando…"
 * que no vuelve nunca. Pase lo que pase, esto resuelve o rechaza. */
async function getAccessToken({ interactive = true } = {}) {
  const cached = loadStoredToken();
  if (cached) return cached.accessToken;

  const client = await ensureTokenClient();
  return new Promise((resolve, reject) => {
    let timer = null;
    const terminar = (fn) => {
      clearTimeout(timer);
      client.callback = () => {};
      client._onError = null;
      fn();
    };
    timer = setTimeout(
      () => terminar(() => reject(new Error("Se venció la sesión de Google y no se pudo renovar. Recarga la página para volver a entrar."))),
      ESPERA_LOGIN_MS
    );
    client.callback = (resp) =>
      terminar(() => {
        if (resp.error) return reject(new Error(resp.error_description || resp.error));
        storeToken(resp);
        resolve(resp.access_token);
      });
    client._onError = (err) =>
      terminar(() => reject(new Error(err?.message || "No se pudo abrir el login de Google. Recarga la página.")));
    client.requestAccessToken({ prompt: interactive ? "" : "none" });
  });
}

function isLoggedIn() {
  return !!loadStoredToken();
}

function logout() {
  const cached = loadStoredToken();
  localStorage.removeItem(TOKEN_KEY);
  if (cached && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(cached.accessToken, () => {});
  }
}

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

async function sheetsFetch(path, options = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${SHEETS_BASE}/${window.APP_CONFIG.SPREADSHEET_ID}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sheets API ${res.status}: ${body}`);
  }
  return res.json();
}

/** Reads a range, returns { values: string[][] } (empty array if range is blank). */
async function readRange(range) {
  const data = await sheetsFetch(`/values/${encodeURIComponent(range)}`);
  return data.values || [];
}

/** Igual que readRange pero pidiendo los valores SIN formatear: los números
 * llegan como número de verdad y no como el texto que muestra la planilla.
 * Necesario para columnas con decimales — con el formato chileno, una tasa de
 * 0,03064 llega como el string "0,03064" y Number() de eso es NaN. */
async function readRangeRaw(range) {
  const data = await sheetsFetch(
    `/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`
  );
  return data.values || [];
}

/** Appends a single row to the end of a sheet/table.
 * mode "RAW" guarda los strings tal cual — necesario para valores como "2026-09",
 * que con USER_ENTERED Sheets interpreta como fecha y convierte a número de serie. */
async function appendRow(range, row, mode = "USER_ENTERED") {
  return sheetsFetch(
    `/values/${encodeURIComponent(range)}:append?valueInputOption=${mode}&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      body: JSON.stringify({ values: [row] }),
    }
  );
}

/** Appends varias filas al final de una sheet/tabla en UNA sola petición — más
 * rápido que llamar appendRow varias veces seguidas (ej. al generar de una
 * las cuotas futuras de una compra en cuotas). */
async function appendRows(range, rows, mode = "USER_ENTERED") {
  return sheetsFetch(
    `/values/${encodeURIComponent(range)}:append?valueInputOption=${mode}&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      body: JSON.stringify({ values: rows }),
    }
  );
}

/** Overwrites many ranges in one request. `data` = [{range, values}, ...].
 * Necesario para marcar decenas de movimientos como pagados de una sola vez. */
async function batchUpdateValues(data, mode = "RAW") {
  return sheetsFetch("/values:batchUpdate", {
    method: "POST",
    body: JSON.stringify({ valueInputOption: mode, data }),
  });
}

/** Overwrites a specific range (e.g. a single row) in place. */
async function updateRange(range, values, mode = "USER_ENTERED") {
  return sheetsFetch(
    `/values/${encodeURIComponent(range)}?valueInputOption=${mode}`,
    {
      method: "PUT",
      body: JSON.stringify({ values }),
    }
  );
}

/** sheetId (numérico) de cada pestaña, que `:batchUpdate` necesita y que no es
 * lo mismo que el nombre. Se pide una vez y queda cacheado. */
let sheetIdsCache = null;
async function sheetIdPorNombre(nombre) {
  if (!sheetIdsCache) {
    const data = await sheetsFetch("?fields=sheets.properties(sheetId,title)");
    sheetIdsCache = {};
    for (const s of data.sheets || []) sheetIdsCache[s.properties.title] = s.properties.sheetId;
  }
  const id = sheetIdsCache[nombre];
  if (id === undefined) throw new Error(`No existe la pestaña "${nombre}"`);
  return id;
}

const mismoValor = (a, b) => {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  return String(a ?? "").trim() === String(b ?? "").trim();
};

/** Borra UNA fila de una pestaña. Borrar corre todas las filas de abajo, así
 * que el número de fila que tenía la vista deja de servir: por eso `esperado`
 * ({ "I": monto, "J": detalle }, por letra de columna) se re-lee de la planilla
 * y se compara ANTES de borrar. Si no calza, no borra nada y avisa — es la
 * diferencia entre borrar lo que el usuario vio y borrar lo que quedó en ese
 * lugar. Quien llame tiene que recargar los datos después (las filas se
 * corrieron). Lee con UNFORMATTED_VALUE para que un monto no llegue con
 * separador de miles y falle la comparación por formato. */
async function deleteRow(tab, fila, esperado = null) {
  if (esperado) {
    const actual = (await readRangeRaw(`${tab}!A${fila}:N${fila}`))[0] || [];
    for (const [col, valor] of Object.entries(esperado)) {
      const i = col.toUpperCase().charCodeAt(0) - 65;
      if (!mismoValor(actual[i], valor)) {
        throw new Error(
          "Esa fila ya no es la misma en la planilla (alguien la movió o la editó). No se borró nada — recarga y vuelve a intentar."
        );
      }
    }
  }
  const sheetId = await sheetIdPorNombre(tab);
  return sheetsFetch(":batchUpdate", {
    method: "POST",
    body: JSON.stringify({
      requests: [
        { deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: fila - 1, endIndex: fila } } },
      ],
    }),
  });
}

/** Call at the top of a page's init(). Redirects to the login splash if not
 * authenticated, and returns false so the caller can bail out early. */
function requireAuthOrRedirect() {
  if (isLoggedIn()) return true;
  const here = location.pathname.split("/").pop() || "registro.html";
  location.replace(`login.html?next=${encodeURIComponent(here)}`);
  return false;
}

window.SheetsAuth = { getAccessToken, isLoggedIn, logout, requireAuthOrRedirect };
window.SheetsApi = { readRange, readRangeRaw, appendRow, appendRows, updateRange, batchUpdateValues, deleteRow };
