import { describe, it, expect, vi } from "vitest";
import { SupabaseStore } from "../src/services/fileStorage";
import { NotFoundError } from "../src/http/errors";

function fakeSupabase(responses: Record<string, () => Response>) {
  const calls: { method: string; url: string; headers: Record<string, string>; body?: unknown }[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ method, url, headers: init.headers as Record<string, string>, body: init.body });
    const key = `${method} ${new URL(url).pathname}`;
    const make = Object.entries(responses).find(([k]) => key.startsWith(k))?.[1];
    return make ? make() : new Response("unexpected", { status: 500 });
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

describe("Supabase Storage for attachments", () => {
  it("creates the private bucket once, then uploads with the secret key on the apikey header", async () => {
    const { calls, fetchImpl } = fakeSupabase({
      "POST /storage/v1/bucket": () => new Response(JSON.stringify({ name: "attachments" }), { status: 200 }),
      "POST /storage/v1/object/attachments/": () => new Response(JSON.stringify({ Key: "x" }), { status: 200 }),
    });
    const store = new SupabaseStore("https://abc.supabase.co/", "sb_secret_test", "attachments", fetchImpl);
    await store.put("1-photo.jpg", Buffer.from("jpeg"), "image/jpeg");
    await store.put("2-notice.pdf", Buffer.from("pdf"), "application/pdf");

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST https://abc.supabase.co/storage/v1/bucket",
      "POST https://abc.supabase.co/storage/v1/object/attachments/1-photo.jpg",
      "POST https://abc.supabase.co/storage/v1/object/attachments/2-notice.pdf",
    ]);
    expect(JSON.parse(String(calls[0].body))).toEqual({ id: "attachments", name: "attachments", public: false });
    expect(calls[1].headers).toMatchObject({ apikey: "sb_secret_test", "Content-Type": "image/jpeg", "x-upsert": "false" });
    expect(calls[1].headers.Authorization).toBeUndefined();
  });

  it("accepts an existing bucket and sends a legacy service_role key as Bearer too", async () => {
    const { calls, fetchImpl } = fakeSupabase({
      "POST /storage/v1/bucket": () => new Response(JSON.stringify({ error: "Duplicate", message: "The resource already exists" }), { status: 400 }),
      "POST /storage/v1/object/": () => new Response("{}", { status: 200 }),
    });
    const store = new SupabaseStore("https://abc.supabase.co", "eyJlegacy", "attachments", fetchImpl);
    await store.put("a.txt", Buffer.from("a"), "text/plain");
    expect(calls[1].headers).toMatchObject({ apikey: "eyJlegacy", Authorization: "Bearer eyJlegacy" });
  });

  it("downloads from the private bucket and reports a missing file as not found", async () => {
    const { calls, fetchImpl } = fakeSupabase({
      "GET /storage/v1/object/authenticated/attachments/here.txt": () => new Response("hello", { status: 200 }),
      "GET /storage/v1/object/authenticated/attachments/gone.txt": () => new Response('{"error":"not_found"}', { status: 404 }),
    });
    const store = new SupabaseStore("https://abc.supabase.co", "sb_secret_test", "attachments", fetchImpl);
    const chunks: Buffer[] = [];
    for await (const chunk of await store.get("here.txt")) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe("hello");
    await expect(store.get("gone.txt")).rejects.toThrow(NotFoundError);
    expect(calls[0].url).toBe("https://abc.supabase.co/storage/v1/object/authenticated/attachments/here.txt");
  });
});
