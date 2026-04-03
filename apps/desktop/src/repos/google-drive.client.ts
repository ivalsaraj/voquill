import { invoke } from "@tauri-apps/api/core";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export type DriveFile = { id: string; name: string; mimeType: string };

export class GoogleDriveClient {
  private accessToken: string;
  private readonly refreshToken: string;
  private readonly clientId: string;

  constructor(accessToken: string, refreshToken: string, clientId: string) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.clientId = clientId;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${this.accessToken}` };
  }

  private async refreshIfNeeded(response: Response): Promise<boolean> {
    if (response.status !== 401) return false;
    const body = new URLSearchParams({
      client_id: this.clientId,
      refresh_token: this.refreshToken,
      grant_type: "refresh_token",
    });
    const res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) throw new Error("Token refresh failed");
    const data = await res.json();
    this.accessToken = data.access_token;
    await invoke("secure_store", {
      key: "google_drive_access_token",
      value: this.accessToken,
    });
    return true;
  }

  private async fetchWithRefresh(
    url: string,
    init?: RequestInit,
  ): Promise<Response> {
    const headers = { ...(await this.authHeaders()), ...init?.headers };
    let res = await fetch(url, { ...init, headers });
    if (await this.refreshIfNeeded(res)) {
      const refreshedHeaders = {
        ...(await this.authHeaders()),
        ...init?.headers,
      };
      res = await fetch(url, { ...init, headers: refreshedHeaders });
    }
    return res;
  }

  async findFile(name: string, parentId: string): Promise<string | null> {
    const q = encodeURIComponent(
      `name='${name}' and '${parentId}' in parents and trashed=false`,
    );
    const res = await this.fetchWithRefresh(
      `${DRIVE_API}/files?q=${q}&fields=files(id,name)`,
    );
    if (!res.ok) throw new Error(`Drive list failed: ${res.status}`);
    const data = await res.json();
    return data.files?.[0]?.id ?? null;
  }

  async createFolder(name: string, parentId?: string): Promise<string> {
    const metadata: Record<string, unknown> = {
      name,
      mimeType: "application/vnd.google-apps.folder",
    };
    if (parentId) metadata.parents = [parentId];
    const res = await this.fetchWithRefresh(
      `${DRIVE_API}/files?fields=id`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(metadata),
      },
    );
    if (!res.ok) throw new Error(`Drive createFolder failed: ${res.status}`);
    const data = await res.json();
    return data.id as string;
  }

  async getOrCreateFolder(
    name: string,
    parentId?: string,
  ): Promise<string> {
    const q = parentId
      ? encodeURIComponent(
          `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        )
      : encodeURIComponent(
          `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        );
    const res = await this.fetchWithRefresh(
      `${DRIVE_API}/files?q=${q}&fields=files(id)`,
    );
    if (!res.ok) throw new Error(`Drive folder lookup failed: ${res.status}`);
    const data = await res.json();
    if (data.files?.length > 0) return data.files[0].id as string;
    return this.createFolder(name, parentId);
  }

  async readJson<T>(fileId: string): Promise<T | null> {
    const res = await this.fetchWithRefresh(
      `${DRIVE_API}/files/${fileId}?alt=media`,
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Drive read failed: ${res.status}`);
    return res.json() as Promise<T>;
  }

  async writeJson(
    name: string,
    parentId: string,
    content: unknown,
  ): Promise<string> {
    const existingId = await this.findFile(name, parentId);
    const body = JSON.stringify(content);

    if (existingId) {
      const res = await this.fetchWithRefresh(
        `${UPLOAD_API}/files/${existingId}?uploadType=media`,
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body },
      );
      if (!res.ok) throw new Error(`Drive update failed: ${res.status}`);
      return existingId;
    }

    const boundary = "voquill_boundary";
    const metadata = JSON.stringify({
      name,
      parents: [parentId],
      mimeType: "application/json",
    });
    const multipart =
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n` +
      `--${boundary}--`;

    const res = await this.fetchWithRefresh(
      `${UPLOAD_API}/files?uploadType=multipart&fields=id`,
      {
        method: "POST",
        headers: {
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body: multipart,
      },
    );
    if (!res.ok) throw new Error(`Drive create failed: ${res.status}`);
    const data = await res.json();
    return data.id as string;
  }
}
