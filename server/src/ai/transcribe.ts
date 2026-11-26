/**
 * Speech to text for WhatsApp voice notes: Groq's free Whisper API
 * (GROQ_API_KEY from console.groq.com). Whisper understands Tamil, English
 * and both mixed; the assistant reads whichever comes back.
 */
export function transcriptionAvailable(): boolean {
  return !!process.env.GROQ_API_KEY?.trim();
}

export async function transcribeAudio(audio: Buffer, mimeType: string, fetchImpl: typeof fetch = fetch): Promise<string> {
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
