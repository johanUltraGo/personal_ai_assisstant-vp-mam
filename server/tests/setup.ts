import "dotenv/config";
import { beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";

// Safety net: the tests below delete every table. Never let them near her data.
if (!process.env.DATABASE_URL?.endsWith("test.db")) {
  throw new Error(`Refusing to run tests against ${process.env.DATABASE_URL}; tests must use file:./test.db`);
}

beforeEach(async () => {
  // Tests run against prisma/test.db (see vitest.config.ts), reset between tests.
  await prisma.activityLog.deleteMany();
  await prisma.pushSubscription.deleteMany();
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
