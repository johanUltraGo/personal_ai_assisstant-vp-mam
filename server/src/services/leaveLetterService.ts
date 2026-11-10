export type LeaveAudience = "TEACHER" | "STUDENT";

export interface LeaveLetterInput {
  audience: LeaveAudience;
  names: string[];
  leaveDate: Date;
  reason?: string;
  schoolName?: string;
}

/**
 * Creates a reviewable leave notice. It intentionally does not send it:
 * callers must pass the returned text through the normal Prepare -> Send?
 * confirmation flow before any external message can leave the assistant.
 */
export function draftLeaveLetter(input: LeaveLetterInput) {
  if (!input.names.length || input.names.some((name) => !name.trim())) {
    throw new Error("At least one named teacher or student is required.");
  }
  if (input.audience === "STUDENT" && input.names.length > 2) {
    throw new Error("Student leave notices are limited to one or two named students.");
  }

  const names = input.names.map((name) => name.trim()).join(", ");
  const date = new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: process.env.SCHOOL_TIMEZONE ?? "Asia/Kolkata",
  }).format(input.leaveDate);
  const organisation = input.schoolName?.trim() || "the school";
  const reason = input.reason?.trim() ? ` Reason: ${input.reason.trim()}.` : "";

  if (input.audience === "TEACHER") {
    return {
      subject: `Teacher leave notice — ${date}`,
      body: `Dear Teachers,\n\n${names} will be on leave on ${date}.${reason}\n\nPlease make the necessary academic and duty arrangements.\n\nRegards,\nVice Principal\n${organisation}`,
    };
  }
  return {
    subject: `Student leave notice — ${date}`,
    body: `Dear Parent/Guardian,\n\nThis is to record that ${names} will be on leave on ${date}.${reason}\n\nRegards,\nVice Principal\n${organisation}`,
  };
}
