// Reuses the OAuth token already granted to the local gdrive MCP server
// (same Google Cloud project/consent screen, "spreadsheets" scope).
//
// Deliberately reads client_id/client_secret/token from files OUTSIDE this repo
// (this repo is public — never hardcode or commit credentials here).
import fs from "fs";
import os from "os";
import { google } from "googleapis";

const CREDS_DIR = `${os.homedir()}\\.claude\\gdrive-mcp`;

export function getAuth() {
  const keys = JSON.parse(fs.readFileSync(`${CREDS_DIR}\\gcp-oauth.keys.json`, "utf-8")).installed;
  const savedCreds = JSON.parse(fs.readFileSync(`${CREDS_DIR}\\.gdrive-server-credentials.json`, "utf-8"));
  const oauth2Client = new google.auth.OAuth2(keys.client_id, keys.client_secret);
  oauth2Client.setCredentials(savedCreds);
  return oauth2Client;
}
