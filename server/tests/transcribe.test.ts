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
