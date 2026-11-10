import { z } from "zod";
import { defineTool, registerTool } from "./tools";
import { planItemSchema, proposePlan } from "../services/planService";

registerTool(
  defineTool({
    name: "propose_day_plan",
    description:
      "Save a draft plan of time windows for one day (usually tomorrow) from the evening talk. Her screen shows it to edit and save; nothing is scheduled until she saves. Proposing again replaces the earlier draft.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["date", "items"],
      properties: {
        date: { type: "string", description: "YYYY-MM-DD" },
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["title", "start", "end"],
            properties: {
              title: { type: "string" },
              category: { type: "string" },
              notes: { type: "string" },
              start: { type: "string", description: "ISO 8601 with offset" },
              end: { type: "string", description: "ISO 8601 with offset" },
            },
          },
        },
      },
    },
    schema: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), items: z.array(planItemSchema).min(1) }),
    async run({ date, items }, ctx) {
      const plan = await proposePlan(ctx.conversationId, date, items);
      ctx.cards.push({ type: "plan", proposalId: plan.id });
      return { proposalId: plan.id, items: items.length, status: "Shown on her screen to edit and save. Not scheduled yet." };
    },
  })
);
