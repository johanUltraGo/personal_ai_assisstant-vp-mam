import { z } from "zod";
import { defineTool, registerTool } from "./tools";
import { draftLeaveLetter } from "../services/leaveLetterService";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

registerTool(
  defineTool({
    name: "draft_leave_letter",
    description:
      "Draft a teacher or student leave notice for a date or range. Weekends and school-calendar holidays are left out automatically. Returns the text only; to send it, find the recipient (e.g. the teachers' group) and call prepare_message.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["audience", "names", "fromDate"],
      properties: {
        audience: { type: "string", enum: ["TEACHER", "STUDENT"] },
        names: { type: "array", items: { type: "string" }, description: "Teachers, or one or two students" },
        fromDate: { type: "string", description: "YYYY-MM-DD" },
        toDate: { type: "string", description: "YYYY-MM-DD, if more than one day" },
        reason: { type: "string" },
      },
    },
    schema: z.object({ audience: z.enum(["TEACHER", "STUDENT"]), names: z.array(z.string().min(1)).min(1), fromDate: isoDate, toDate: isoDate.optional(), reason: z.string().optional() }),
    async run(input) {
      return draftLeaveLetter({ ...input, schoolName: process.env.SCHOOL_NAME });
    },
  })
);
