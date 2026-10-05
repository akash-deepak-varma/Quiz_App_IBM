-- Per-user AI credentials. The key column holds AES-256-GCM ciphertext packed as
-- "v1.<iv>.<tag>.<ciphertext>" (src/lib/apiKeyCrypto.js), never a plaintext key.
--
-- RESTRICT on the user FK matches every other per-user table here (Streak, Favorite, Attempt).
-- Nothing in the app deletes a user, and the test harness clears this table explicitly
-- (test/setup/resetDb.js) rather than relying on a cascade.

-- CreateTable
CREATE TABLE "UserAiConfig" (
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "baseUrl" TEXT,
    "model" TEXT,
    "apiKeyCipher" TEXT,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "lastTestedAt" TIMESTAMP(3),
    "lastTestStatus" TEXT,
    "lastTestDetail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAiConfig_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "UserAiConfig" ADD CONSTRAINT "UserAiConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
