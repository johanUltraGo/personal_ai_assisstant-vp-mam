CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT,
    "originalName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Attachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Attachment_storedName_key" ON "Attachment"("storedName");
CREATE INDEX "Attachment_taskId_idx" ON "Attachment"("taskId");
