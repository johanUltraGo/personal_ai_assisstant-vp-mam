import { prisma } from "../db";

/**
 * Plain-language record of what the assistant and its jobs did (spec §9:
 * "explain what it is doing"). Logging must never break the action it
 * describes, so failures here are swallowed and reported to the console.
 */
export async function logActivity(kind: string, summary: string, ref?: { type: string; id: string }): Promise<void> {
  try {
    await prisma.activityLog.create({ data: { kind, summary, refType: ref?.type, refId: ref?.id } });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[activity] could not record:", kind, err);
  }
}

export function recentActivity(limit = 20) {
  return prisma.activityLog.findMany({ orderBy: { at: "desc" }, take: Math.min(Math.max(limit, 1), 200) });
}
