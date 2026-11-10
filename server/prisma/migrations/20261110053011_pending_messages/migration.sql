-- AlterTable
ALTER TABLE "CalendarEvent" ADD COLUMN "decidedAt" DATETIME;
ALTER TABLE "CalendarEvent" ADD COLUMN "decision" TEXT;

-- AlterTable
ALTER TABLE "MessageSent" ADD COLUMN "fromAccount" TEXT;
ALTER TABLE "MessageSent" ADD COLUMN "handoffUrl" TEXT;
ALTER TABLE "MessageSent" ADD COLUMN "pendingMessageId" TEXT;

-- CreateTable
CREATE TABLE "PendingMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channel" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "recipientName" TEXT NOT NULL,
    "recipientKind" TEXT NOT NULL,
    "recipientAddress" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "calendarEventId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "cancelledAt" DATETIME
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Contact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL DEFAULT 'PERSON',
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "whatsappNumber" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Contact" ("createdAt", "displayName", "email", "id", "whatsappNumber") SELECT "createdAt", "displayName", "email", "id", "whatsappNumber" FROM "Contact";
DROP TABLE "Contact";
ALTER TABLE "new_Contact" RENAME TO "Contact";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
