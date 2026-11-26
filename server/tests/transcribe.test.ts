import { describe, it, expect } from "vitest";
import { transcribeAudio } from "../src/ai/transcribe";

describe("voice note transcription", () => {
  it("sends the audio to Groq Whisper and returns the text", async () => {
    process.env.GROQ_API_KEY = "test-key";
    let seen: any;
    const fake = (async (url: string, init: any) => {
      seen = { url, auth: init.headers.Authorization, file: init.body.get("file"), model: init.body.get("model") };
      return new Response(JSON.stringify({ text: " remind me at 4 " }), { status: 200 });
    }) as unknown as typeof fetch;
    const text = await transcribeAudio(Buffer.from("ogg"), "audio/ogg; codecs=opus", fake);
    expect(text).toBe("remind me at 4");
    expect(seen.url).toContain("api.groq.com");
    expect(seen.auth).toBe("Bearer test-key");
    expect(seen.file.name).toBe("voice.ogg");
    expect(seen.model).toBe("whisper-large-v3");
    delete process.env.GROQ_API_KEY;
  });
});

describe("voice note transcription with Gemini", () => {
  it("uses Gemini when only a Gemini key is set", async () => {
    process.env.GEMINI_API_KEY = "g-key";
    let seen: any;
    const fake = (async (url: string, init: any) => {
      seen = { url, key: init.headers["x-goog-api-key"], body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "What is on Friday?" }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await transcribeAudio(Buffer.from("ogg"), "audio/ogg; codecs=opus", fake)).toBe("What is on Friday?");
    expect(seen.url).toContain("generativelanguage.googleapis.com");
    expect(seen.key).toBe("g-key");
    expect(seen.body.contents[0].parts[1].inline_data.mime_type).toBe("audio/ogg");
    delete process.env.GEMINI_API_KEY;
  });
});
