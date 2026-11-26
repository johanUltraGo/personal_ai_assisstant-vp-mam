/**
 * Speech to text for WhatsApp voice notes: Groq's free Whisper API
 * (GROQ_API_KEY from console.groq.com) or Google Gemini (GEMINI_API_KEY). Whisper understands Tamil, English
 * and both mixed; the assistant reads whichever comes back.
 */
export function transcriptionAvailable(): boolean {
  return !!(process.env.GROQ_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim());
}

/** Google Gemini (free key from aistudio.google.com) listens to the audio and writes it down. */
async function transcribeWithGemini(audio: Buffer, mimeType: string, key: string, fetchImpl: typeof fetch): Promise<string> {
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash";
  const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ parts: [
        { text: "Transcribe this voice note from a school Vice Principal exactly as spoken. She may speak Tamil, English or both; write English words in English and Tamil words in Tamil script. Reply with the transcript only." },
        { inline_data: { mime_type: mimeType.split(";")[0] || "audio/ogg", data: audio.toString("base64") } },
      ] }],
    }),
  });
  if (!response.ok) throw new Error(`Transcription failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
  const body = (await response.json()) as any;
  return (body.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("").trim();
}

export async function transcribeAudio(audio: Buffer, mimeType: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const gemini = process.env.GEMINI_API_KEY?.trim();
  if (!process.env.GROQ_API_KEY?.trim() && gemini) return transcribeWithGemini(audio, mimeType, gemini, fetchImpl);
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) throw new Error("Voice notes are not set up (GROQ_API_KEY).");
  const form = new FormData();
  const ext = /mpeg|mp3/.test(mimeType) ? "mp3" : /mp4|m4a|aac/.test(mimeType) ? "m4a" : "ogg";
  form.append("file", new Blob([new Uint8Array(audio)], { type: mimeType.split(";")[0] || "audio/ogg" }), `voice.${ext}`);
  form.append("model", process.env.GROQ_WHISPER_MODEL?.trim() || "whisper-large-v3");
  form.append("response_format", "json");
  form.append("prompt", "School Vice Principal speaking Tamil and English: reminders, teachers, parents, timetable, circular, assessment.");
  const response = await fetchImpl("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!response.ok) throw new Error(`Transcription failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
  const body = (await response.json()) as { text?: string };
  return (body.text ?? "").trim();
}
