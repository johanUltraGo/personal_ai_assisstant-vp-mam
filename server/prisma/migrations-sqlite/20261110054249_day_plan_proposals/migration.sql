-- CreateTable
CREATE TABLE "DayPlanProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT,
    "planDate" TEXT NOT NULL,
    "itemsJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "savedAt" DATETIME
);
