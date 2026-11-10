import { describe, it, expect, afterEach, vi } from "vitest";
import { GoogleDriveApiClient, DriveConnector, driveFileIdFrom } from "../src/connectors/driveConnector";
import { runTool } from "../src/assistant/tools";
import "../src/assistant/registerFeatureTools";
import * as registry from "../src/connectors/registry";

function driveFetch(meta: { name: string; mimeType: string; size?: string }, body: Buffer | string) {
  return vi.fn(async (url: string) => {
    if (url.includes("fields=")) return new Response(JSON.stringify(meta), { status: 200 });
    return new Response(typeof body === "string" ? body : new Uint8Array(body), { status: 200 });
  });
}

describe("Drive documents", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("finds the file id in Drive links", () => {
    expect(driveFileIdFrom("https://docs.google.com/document/d/ABC123_x-y/edit?usp=sharing")).toBe("ABC123_x-y");
    expect(driveFileIdFrom("https://drive.google.com/open?id=XYZ789")).toBe("XYZ789");
    expect(driveFileIdFrom("PlainId_123")).toBe("PlainId_123");
  });

  it("exports Google Docs as text and Sheets as CSV", async () => {
    const fetchMock = driveFetch({ name: "Circular", mimeType: "application/vnd.google-apps.spreadsheet" }, "a,b");
    vi.stubGlobal("fetch", fetchMock);
    const file = await new GoogleDriveApiClient("token").readFile("S1");
    expect(file).toMatchObject({ kind: "text", text: "a,b", name: "Circular" });
    expect(String(fetchMock.mock.calls[1][0])).toContain("mimeType=text%2Fcsv");
  });

  it("returns PDFs as base64 for Claude to read", async () => {
    vi.stubGlobal("fetch", driveFetch({ name: "Notice.pdf", mimeType: "application/pdf", size: "4" }, Buffer.from("%PDF")));
    const file = await new GoogleDriveApiClient("token").readFile("P1");
    expect(file.kind).toBe("pdf");
    expect(Buffer.from(file.base64!, "base64").toString()).toBe("%PDF");
  });

  it("refuses files it cannot read whole", async () => {
    vi.stubGlobal("fetch", driveFetch({ name: "Big.pdf", mimeType: "application/pdf", size: String(20 * 1024 * 1024) }, ""));
    await expect(new GoogleDriveApiClient("token").readFile("B1")).rejects.toThrow(/too large/);
    vi.stubGlobal("fetch", driveFetch({ name: "x.zip", mimeType: "application/zip", size: "10" }, ""));
    await expect(new GoogleDriveApiClient("token").readFile("Z1")).rejects.toThrow(/can't read/);
  });

  it("gives the assistant a PDF as a document block", async () => {
    const connector = new DriveConnector("test", {
      readFile: async () => ({ name: "Notice.pdf", mimeType: "application/pdf", kind: "pdf", base64: "JVBERg==" }),
    });
    vi.spyOn(registry, "driveConnector").mockResolvedValue(connector);
    const result = await runTool("read_drive_document", { file: "https://drive.google.com/file/d/1AbCdEfGh_Notice/view" }, { conversationId: "c", inputMode: "TYPED", cards: [] });
    expect(result.isError).toBe(false);
    const blocks = result.content as any[];
    expect(blocks[0].type).toBe("text");
    expect(blocks[1]).toMatchObject({ type: "document", source: { type: "base64", media_type: "application/pdf" } });
  });
});
