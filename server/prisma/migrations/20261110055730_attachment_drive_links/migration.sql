-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Attachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT,
    "originalName" TEXT NOT NULL,
    "storedName" TEXT,
    "driveFileId" TEXT,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Attachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Attachment" ("createdAt", "id", "mimeType", "originalName", "size", "storedName", "taskId") SELECT "createdAt", "id", "mimeType", "originalName", "size", "storedName", "taskId" FROM "Attachment";
DROP TABLE "Attachment";
ALTER TABLE "new_Attachment" RENAME TO "Attachment";
CREATE UNIQUE INDEX "Attachment_storedName_key" ON "Attachment"("storedName");
CREATE INDEX "Attachment_taskId_idx" ON "Attachment"("taskId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
