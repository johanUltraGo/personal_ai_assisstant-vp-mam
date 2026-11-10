import "dotenv/config";
import { beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";

beforeEach(async () => {
  // Tests run against the local dev SQLite file, reset between tests.
  // This is a throwaway dev database, not Supabase/production data.
  await prisma.activityLog.deleteMany();
  await prisma.conversationMessage.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.dayPlanConfirmation.deleteMany();
  await prisma.dayPlanProposal.deleteMany();
  await prisma.googleAccount.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.reminderLog.deleteMany();
  await prisma.reminder.deleteMany();
  await prisma.taskHistory.deleteMany();
  await prisma.task.deleteMany();
  await prisma.messageSent.deleteMany();
  await prisma.pendingMessage.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.calendarEvent.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});
