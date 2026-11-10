import { DateTime } from "luxon";
import { z } from "zod";
import { defineTool, registerTool } from "./tools";
import { eventsBetween } from "../services/calendarService";
import { schoolTimezone } from "../services/morningListService";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

registerTool(
  defineTool({
    name: "get_school_calendar",
    description: "School calendar events and holidays between two dates (inclusive).",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["from", "to"],
      properties: { from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string", description: "YYYY-MM-DD" } },
    },
    schema: z.object({ from: isoDate, to: isoDate }),
    async run({ from, to }) {
      const zone = schoolTimezone();
      const events = await eventsBetween(
        DateTime.fromISO(from, { zone }).startOf("day").toJSDate(),
        DateTime.fromISO(to, { zone }).plus({ days: 1 }).startOf("day").toJSDate()
      );
      return events.map((e) => ({
        id: e.id,
        name: e.eventName,
        date: DateTime.fromJSDate(e.eventDate, { zone }).toISODate(),
        type: e.type,
        parentsNotified: !!e.notifiedAt,
      }));
    },
  })
);
