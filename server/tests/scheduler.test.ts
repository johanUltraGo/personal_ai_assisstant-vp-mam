import { describe, it, expect } from "vitest";
import { start as startDailyJobs } from "../src/scheduler/dailyJobs";
import { start as startReminders } from "../src/scheduler/reminderScheduler";
import { start as startMorningList } from "../src/scheduler/morningListScheduler";

describe("schedulers", () => {
  it("daily jobs register in the school timezone and can be stopped", async () => {
    const tasks = [...startDailyJobs(), startReminders(), startMorningList()];
    expect(tasks).toHaveLength(4);
    for (const task of tasks) await task.stop();
  });
});
