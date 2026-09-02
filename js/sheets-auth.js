// Google Identity Services (client-side OAuth) + thin Sheets API v4 helper.
// No backend, no client secret — token lives only in this browser's sessionStorage.

const TOKEN_KEY = "gsheets_token";
let tokenClient = null;
let tokenClientReady = null;

function loadStoredToken() {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
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
  sessionStorage.setItem(
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
    });
  }
  return tokenClient;
}

/** Returns a valid access token, prompting the Google login popup if needed. */
async function getAccessToken({ interactive = true } = {}) {
  const cached = loadStoredToken();
  if (cached) return cached.accessToken;

  const client = await ensureTokenClient();
  return new Promise((resolve, reject) => {
    client.callback = (resp) => {
      if (resp.error) {
        reject(new Error(resp.error_description || resp.error));
        return;
      }
      storeToken(resp);
      resolve(resp.access_token);
    };
    client.requestAccessToken({ prompt: interactive ? "" : "none" });
  });
}

function isLoggedIn() {
  return !!loadStoredToken();
}

function logout() {
  const cached = loadStoredToken();
  sessionStorage.removeItem(TOKEN_KEY);
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

/** Appends a single row to the end of a sheet/table. */
async function appendRow(range, row) {
  return sheetsFetch(
    `/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      body: JSON.stringify({ values: [row] }),
    }
  );
}

/** Overwrites a specific range (e.g. a single row) in place. */
async function updateRange(range, values) {
  return sheetsFetch(
    `/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      body: JSON.stringify({ values }),
    }
  );
}

window.SheetsAuth = { getAccessToken, isLoggedIn, logout };
window.SheetsApi = { readRange, appendRow, updateRange };
