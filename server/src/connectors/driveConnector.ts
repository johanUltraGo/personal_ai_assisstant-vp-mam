import { Connector, ConnectorHealth, ConnectorNotConfiguredError } from "./connector";
import { BadRequestError } from "../http/errors";

/**
 * A Drive file read in full (spec §5: "reads a whole Drive file first").
 * Text-like files arrive as text; PDFs and images as base64 so Claude can
 * read them directly.
 */
export interface DriveFile {
  name: string;
  mimeType: string;
  kind: "text" | "pdf" | "image";
  text?: string;
  base64?: string;
}

/** Thin seam over the Google Drive API so tests need no network. */
export interface DriveClient {
  readFile(fileId: string): Promise<DriveFile>;
}

export const MAX_BINARY_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_CHARS = 400_000;

const GOOGLE_EXPORTS: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.presentation": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
};
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

function isTextType(mimeType: string) {
  return mimeType.startsWith("text/") || ["application/json", "application/csv"].includes(mimeType) || mimeType.endsWith("+xml");
}

/** Accepts a Drive/Docs link or a bare file id. */
export function driveFileIdFrom(urlOrId: string): string {
  const value = urlOrId.trim();
  const fromPath = value.match(/\/d\/([a-zA-Z0-9_-]{5,})/);
  if (fromPath) return fromPath[1];
  const fromQuery = value.match(/[?&]id=([a-zA-Z0-9_-]{5,})/);
  if (fromQuery) return fromQuery[1];
  if (/^[a-zA-Z0-9_-]{5,}$/.test(value)) return value;
  throw new BadRequestError("That does not look like a Google Drive link or file id.");
}

export class GoogleDriveApiClient implements DriveClient {
  constructor(private readonly accessToken: string | (() => Promise<string>)) {}

  async readFile(fileId: string): Promise<DriveFile> {
    const token = typeof this.accessToken === "string" ? this.accessToken : await this.accessToken();
    const headers = { Authorization: `Bearer ${token}` };
    const base = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`;
    const metadataResponse = await fetch(`${base}?fields=name,mimeType,size&supportsAllDrives=true`, { headers });
    if (!metadataResponse.ok) throw new Error(`Drive could not find that file (${metadataResponse.status}).`);
    const meta = (await metadataResponse.json()) as { name: string; mimeType: string; size?: string };

    const exportType = GOOGLE_EXPORTS[meta.mimeType];
    const kind: DriveFile["kind"] | undefined = exportType || isTextType(meta.mimeType)
      ? "text"
      : meta.mimeType === "application/pdf"
        ? "pdf"
        : IMAGE_TYPES.includes(meta.mimeType)
          ? "image"
          : undefined;
    if (!kind) throw new BadRequestError(`I can't read "${meta.name}" (${meta.mimeType}) yet. Docs, Sheets, Slides, text, PDF and photos work.`);
    if (kind !== "text" && Number(meta.size ?? 0) > MAX_BINARY_BYTES) {
      throw new BadRequestError(`"${meta.name}" is too large to read whole (over 10 MB).`);
    }

    const url = exportType
      ? `${base}/export?mimeType=${encodeURIComponent(exportType)}`
      : `${base}?alt=media&supportsAllDrives=true`;
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`Drive could not download "${meta.name}" (${response.status}).`);

    if (kind === "text") {
      const text = await response.text();
      if (text.length > MAX_TEXT_CHARS) throw new BadRequestError(`"${meta.name}" is too large to read whole.`);
      return { name: meta.name, mimeType: exportType ?? meta.mimeType, kind, text };
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_BINARY_BYTES) throw new BadRequestError(`"${meta.name}" is too large to read whole (over 10 MB).`);
    return { name: meta.name, mimeType: meta.mimeType, kind, base64: bytes.toString("base64") };
  }
}

/**
 * Google Drive connector (spec §7: "multiple accounts, full access,
 * including the school Drive"). Accounts are connected through Google sign-in
 * (see src/google/accounts.ts and src/connectors/registry.ts).
 */
export class DriveConnector implements Connector {
  readonly type = "drive";

  constructor(readonly accountLabel: string, private readonly client?: DriveClient) {}

  health(): ConnectorHealth {
    if (this.client) return { configured: true, detail: `Drive files are read from ${this.accountLabel}.` };
    return { configured: false, detail: "No Google account is connected for Drive." };
  }

  async readFile(fileId: string): Promise<DriveFile> {
    if (!this.client) {
      throw new ConnectorNotConfiguredError("Drive is not connected yet. Connect a Google account on the Connections screen.");
    }
    return this.client.readFile(fileId);
  }
}

/** Legacy single short-lived token from .env, used only when no account is connected. */
export function driveFromEnvironment(accountLabel = process.env.DRIVE_ACCOUNT_LABEL || "default") {
  const accessToken = process.env.GOOGLE_ACCESS_TOKEN;
  return new DriveConnector(accountLabel, accessToken ? new GoogleDriveApiClient(accessToken) : undefined);
}
