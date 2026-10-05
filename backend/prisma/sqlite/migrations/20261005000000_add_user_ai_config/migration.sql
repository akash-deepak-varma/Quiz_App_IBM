-- See the PostgreSQL lineage's copy of this migration for the rationale. The only difference is
-- shape: SQLite takes PRIMARY KEY inline and cannot ALTER TABLE ... ADD CONSTRAINT, which is why
-- the two lineages are hand-maintained separately (scripts/syncSqliteSchema.mjs header).

-- CreateTable
CREATE TABLE "UserAiConfig" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "baseUrl" TEXT,
    "model" TEXT,
    "apiKeyCipher" TEXT,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "lastTestedAt" DATETIME,
    "lastTestStatus" TEXT,
    "lastTestDetail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserAiConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
