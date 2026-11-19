import { promises as fs, createReadStream } from "fs";
import path from "path";
import { Readable } from "stream";
import { NotFoundError } from "../http/errors";

/**
 * Where attached photos and documents live. With SUPABASE_URL and
 * SUPABASE_SECRET_KEY set they go to a private Supabase Storage bucket
 * (SUPABASE_BUCKET, default "attachments"); otherwise to a folder on this
 * computer (ATTACHMENT_STORAGE_PATH, default ./uploads). Names are generated
 * by the app (uuid + ASCII name), never taken from a request.
 */
export interface FileStore {
  readonly where: "supabase" | "disk";
  put(name: string, content: Buffer, contentType: string): Promise<void>;
  get(name: string): Promise<Readable>;
  remove(name: string): Promise<void>;
}

class DiskStore implements FileStore {
  readonly where = "disk" as const;
  private root = path.resolve(process.env.ATTACHMENT_STORAGE_PATH || path.join(process.cwd(), "uploads"));

  async put(name: string, content: Buffer) {
    await fs.mkdir(this.root, { recursive: true });
    await fs.writeFile(path.join(this.root, name), content, { flag: "wx" });
  }

  async get(name: string) {
    const file = path.join(this.root, name);
    await fs.access(file).catch(() => {
      throw new NotFoundError("The attached file is missing from storage.");
    });
    return createReadStream(file);
  }

  async remove(name: string) {
    await fs.unlink(path.join(this.root, name)).catch(() => {});
  }
}

export class SupabaseStore implements FileStore {
  readonly where = "supabase" as const;
  private bucketReady: Promise<void> | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly key: string,
    private readonly bucket: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  /** New sb_secret_ keys go on the apikey header only; legacy service_role JWTs also as Bearer. */
  private headers(extra: Record<string, string> = {}) {
    const auth: Record<string, string> = { apikey: this.key };
    if (this.key.startsWith("eyJ")) auth.Authorization = `Bearer ${this.key}`;
    return { ...auth, ...extra };
  }

  private objectUrl(name: string) {
    return `${this.baseUrl}/storage/v1/object/${encodeURIComponent(this.bucket)}/${encodeURIComponent(name)}`;
  }

  private async failure(res: Response, action: string) {
    const body = await res.text().catch(() => "");
    // eslint-disable-next-line no-console
    console.error(`[supabase storage] ${action} failed:`, res.status, body.slice(0, 300));
    return new Error(`Could not ${action} the file in cloud storage (${res.status}).`);
  }

  /** Creates the private bucket the first time; "already exists" is fine. */
  private ensureBucket() {
    this.bucketReady ??= (async () => {
      const res = await this.fetchImpl(`${this.baseUrl}/storage/v1/bucket`, {
        method: "POST",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ id: this.bucket, name: this.bucket, public: false }),
      });
      if (res.ok) return;
      const text = await res.text().catch(() => "");
      if (res.status === 409 || /already exists|Duplicate/i.test(text)) return;
      this.bucketReady = null;
      // eslint-disable-next-line no-console
      console.error("[supabase storage] create bucket failed:", res.status, text.slice(0, 300));
      throw new Error(`Could not prepare cloud storage (${res.status}). Check SUPABASE_URL and SUPABASE_SECRET_KEY.`);
    })();
    return this.bucketReady;
  }

  async put(name: string, content: Buffer, contentType: string, options: { overwrite?: boolean } = {}) {
    await this.ensureBucket();
    const res = await this.fetchImpl(this.objectUrl(name), {
      method: "POST",
      headers: this.headers({ "Content-Type": contentType || "application/octet-stream", "x-upsert": options.overwrite ? "true" : "false" }),
      body: new Uint8Array(content),
    });
    if (!res.ok) throw await this.failure(res, "save");
  }

  /** Names of the objects at the top of the bucket (used for backup retention). */
  async list(): Promise<string[]> {
    await this.ensureBucket();
    const res = await this.fetchImpl(`${this.baseUrl}/storage/v1/object/list/${encodeURIComponent(this.bucket)}`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ prefix: "", limit: 1000, offset: 0, sortBy: { column: "name", order: "asc" } }),
    });
    if (!res.ok) throw await this.failure(res, "list");
    const items = (await res.json()) as { name: string }[];
    return items.map((i) => i.name);
  }

  async get(name: string) {
    const res = await this.fetchImpl(
      `${this.baseUrl}/storage/v1/object/authenticated/${encodeURIComponent(this.bucket)}/${encodeURIComponent(name)}`,
      { headers: this.headers() }
    );
    if (res.status === 404 || res.status === 400) {
      await res.body?.cancel().catch(() => {});
      throw new NotFoundError("The attached file is missing from storage.");
    }
    if (!res.ok || !res.body) throw await this.failure(res, "open");
    return Readable.fromWeb(res.body as any);
  }

  async remove(name: string) {
    const res = await this.fetchImpl(this.objectUrl(name), { method: "DELETE", headers: this.headers() });
    if (!res.ok && res.status !== 404) throw await this.failure(res, "delete");
  }
}

/** A private Supabase bucket for daily backups, when Supabase is configured. */
export function backupCloudStore(): SupabaseStore | null {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  return url && key ? new SupabaseStore(url, key, "backups") : null;
}

let store: FileStore | null = null;

/** The store chosen from the environment (read once). */
export function fileStore(): FileStore {
  if (store) return store;
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  store = url && key ? new SupabaseStore(url, key, process.env.SUPABASE_BUCKET?.trim() || "attachments") : new DiskStore();
  return store;
}
