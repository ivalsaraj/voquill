import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-opener";
import { GoogleDriveClient } from "../repos/google-drive.client";
import { produceAppState, getAppState } from "../store";
import { getUserPreferencesRepo } from "../repos";
import { showSnackbar, showErrorSnackbar } from "./app.actions";
import { startSyncScheduler } from "./sync-scheduler";

const CLIENT_ID = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID as string;
const SCOPE =
  "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/oauth2/v2/userinfo.email";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v2/userinfo";

async function storeTokens(
  accessToken: string,
  refreshToken: string,
): Promise<void> {
  await invoke("secure_store", {
    key: "google_drive_access_token",
    value: accessToken,
  });
  await invoke("secure_store", {
    key: "google_drive_refresh_token",
    value: refreshToken,
  });
}

async function loadTokens(): Promise<{
  accessToken: string;
  refreshToken: string;
} | null> {
  const accessToken = await invoke<string | null>("secure_get", {
    key: "google_drive_access_token",
  });
  const refreshToken = await invoke<string | null>("secure_get", {
    key: "google_drive_refresh_token",
  });
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
}

async function clearTokens(): Promise<void> {
  await invoke("secure_delete", { key: "google_drive_access_token" });
  await invoke("secure_delete", { key: "google_drive_refresh_token" });
}

export async function buildGoogleDriveClient(): Promise<GoogleDriveClient | null> {
  const tokens = await loadTokens();
  if (!tokens) return null;
  return new GoogleDriveClient(
    tokens.accessToken,
    tokens.refreshToken,
    CLIENT_ID,
  );
}

export async function connectGoogleDrive(): Promise<void> {
  try {
    const port = await invoke<number>("oauth_start_callback_server");
    const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;

    const verifierBytes = new Uint8Array(32);
    crypto.getRandomValues(verifierBytes);
    const codeVerifier = btoa(String.fromCharCode(...verifierBytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(codeVerifier),
    );
    const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");

    const stateBytes = new Uint8Array(16);
    crypto.getRandomValues(stateBytes);
    const csrfState = btoa(String.fromCharCode(...stateBytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", SCOPE);
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("state", csrfState);

    await open(authUrl.toString());

    const code = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("OAuth timeout after 5 minutes")),
        5 * 60 * 1000,
      );
      const unlisten = listen<{ code: string; state?: string }>(
        "google-oauth-code",
        (event) => {
          clearTimeout(timeout);
          unlisten.then((fn) => fn());
          if (event.payload.state !== csrfState) {
            reject(new Error("OAuth state mismatch — possible CSRF attack"));
            return;
          }
          resolve(event.payload.code);
        },
      );
    });

    const tokenRes = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: codeVerifier,
      }).toString(),
    });
    if (!tokenRes.ok)
      throw new Error(`Token exchange failed: ${tokenRes.status}`);
    const tokenData = await tokenRes.json();

    await storeTokens(tokenData.access_token, tokenData.refresh_token);

    const infoRes = await fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const info = await infoRes.json();
    const email: string = info.email;

    const prefs = getAppState().userPrefs;
    if (prefs) {
      const updated = {
        ...prefs,
        googleDriveEmail: email,
        googleDriveSyncMode:
          prefs.googleDriveSyncMode ?? ("event" as const),
        googleDriveSyncIntervalMinutes:
          prefs.googleDriveSyncIntervalMinutes ?? 15,
      };
      await getUserPreferencesRepo().setUserPreferences(updated);
      produceAppState((draft) => {
        draft.userPrefs = updated;
        draft.googleDriveSync.status = "idle";
        draft.googleDriveSync.errorMessage = null;
      });
    }

    showSnackbar(
      `Google Drive connected as ${email}`,
      { mode: "success" },
    );
  } catch (error) {
    produceAppState((draft) => {
      draft.googleDriveSync.status = "error";
      draft.googleDriveSync.errorMessage = String(error);
    });
    showErrorSnackbar(error);
  }
}

export async function disconnectGoogleDrive(): Promise<void> {
  await clearTokens();
  const prefs = getAppState().userPrefs;
  if (prefs) {
    const updated = {
      ...prefs,
      googleDriveEmail: null,
      googleDriveSyncMode: null,
      googleDriveSyncIntervalMinutes: null,
      googleDriveLastSyncedAt: null,
    };
    await getUserPreferencesRepo().setUserPreferences(updated);
    produceAppState((draft) => {
      draft.userPrefs = updated;
      draft.googleDriveSync.status = "idle";
      draft.googleDriveSync.errorMessage = null;
    });
  }
  showSnackbar("Google Drive disconnected");
}

export async function updateSyncMode(
  mode: "event" | "interval" | "manual",
  intervalMinutes?: number,
): Promise<void> {
  const prefs = getAppState().userPrefs;
  if (!prefs) return;
  const updated = {
    ...prefs,
    googleDriveSyncMode: mode,
    googleDriveSyncIntervalMinutes:
      intervalMinutes ?? prefs.googleDriveSyncIntervalMinutes ?? 15,
  };
  await getUserPreferencesRepo().setUserPreferences(updated);
  produceAppState((draft) => {
    draft.userPrefs = updated;
  });
  startSyncScheduler();
}
