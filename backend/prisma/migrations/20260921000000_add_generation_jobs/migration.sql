-- Quiz generation becomes a durable job of independently recoverable batches.
--
-- `Question_quizId_idx` is dropped because the new unique constraint on ("quizId", "orderIndex")
-- covers quizId lookups as its leading column -- the same trade already made on UserBadge and
-- Favorite. The constraint itself is the point: nothing stopped two rows in one quiz sharing an
-- orderIndex, which a concurrent writer makes far more likely than the old single-shot insert did.

-- DropIndex
DROP INDEX "Question_quizId_idx";

-- CreateTable
CREATE TABLE "QuizGeneration" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "notes" TEXT,
    "difficulty" TEXT NOT NULL,
    "typeMixJson" TEXT,
    "tagsJson" TEXT,
    "provider" TEXT NOT NULL,
    "requested" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "generated" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "planJson" TEXT,
    "contextMode" TEXT,
    "model" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "failureCategory" TEXT,
    "failureReason" TEXT,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "quizId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "QuizGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationBatch" (
    "id" TEXT NOT NULL,
    "generationId" TEXT NOT NULL,
    "batchKey" TEXT NOT NULL,
    "typesJson" TEXT NOT NULL,
    "requested" INTEGER NOT NULL,
    "accepted" INTEGER NOT NULL DEFAULT 0,
    "rejected" INTEGER NOT NULL DEFAULT 0,
    "dupes" INTEGER NOT NULL DEFAULT 0,
    "attempt" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "failureCategory" TEXT,
    "failureReason" TEXT,
    "durationMs" INTEGER,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GenerationBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedQuestion" (
    "id" TEXT NOT NULL,
    "generationId" TEXT NOT NULL,
    "batchKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "optionsJson" TEXT,
    "starterCode" TEXT,
    "correctAnswer" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "orderIndex" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratedQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuizGeneration_quizId_key" ON "QuizGeneration"("quizId");

-- CreateIndex
CREATE INDEX "QuizGeneration_userId_idx" ON "QuizGeneration"("userId");

-- CreateIndex
CREATE INDEX "QuizGeneration_status_createdAt_idx" ON "QuizGeneration"("status", "createdAt");

-- CreateIndex
CREATE INDEX "GenerationBatch_generationId_idx" ON "GenerationBatch"("generationId");

-- CreateIndex
CREATE INDEX "GeneratedQuestion_generationId_idx" ON "GeneratedQuestion"("generationId");

-- CreateIndex
CREATE UNIQUE INDEX "Question_quizId_orderIndex_key" ON "Question"("quizId", "orderIndex");

-- AddForeignKey
ALTER TABLE "QuizGeneration" ADD CONSTRAINT "QuizGeneration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizGeneration" ADD CONSTRAINT "QuizGeneration_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationBatch" ADD CONSTRAINT "GenerationBatch_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "QuizGeneration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedQuestion" ADD CONSTRAINT "GeneratedQuestion_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "QuizGeneration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
