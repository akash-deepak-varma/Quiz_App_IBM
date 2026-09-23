-- CreateTable
CREATE TABLE "Org" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Quiz" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "providerUsed" TEXT NOT NULL,
    "sourceNotes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Quiz_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Quiz_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quizId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "optionsJson" TEXT,
    "starterCode" TEXT,
    "correctAnswer" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    CONSTRAINT "Question_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Attempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quizId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "score" REAL,
    "xp" REAL NOT NULL DEFAULT 0,
    "timeSpentSeconds" INTEGER,
    CONSTRAINT "Attempt_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Attempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AnswerLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "userAnswer" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,
    "scoreFraction" REAL NOT NULL,
    "aiFeedback" TEXT,
    CONSTRAINT "AnswerLog_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AnswerLog_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Streak" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "lastActiveDate" TEXT,
    CONSTRAINT "Streak_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Badge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "ruleJson" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "UserBadge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "badgeId" TEXT NOT NULL,
    "earnedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserBadge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UserBadge_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "Badge" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Favorite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Favorite_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuizGeneration" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "lockedAt" DATETIME,
    "lockedBy" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "quizId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    CONSTRAINT "QuizGeneration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "QuizGeneration_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GenerationBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GenerationBatch_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "QuizGeneration" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GeneratedQuestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "generationId" TEXT NOT NULL,
    "batchKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "optionsJson" TEXT,
    "starterCode" TEXT,
    "correctAnswer" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "orderIndex" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GeneratedQuestion_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "QuizGeneration" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_TopicTags" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_TopicTags_A_fkey" FOREIGN KEY ("A") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_TopicTags_B_fkey" FOREIGN KEY ("B") REFERENCES "Topic" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Topic_name_key" ON "Topic"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE INDEX "Quiz_userId_idx" ON "Quiz"("userId");

-- CreateIndex
CREATE INDEX "Quiz_topicId_idx" ON "Quiz"("topicId");

-- CreateIndex
CREATE UNIQUE INDEX "Question_quizId_orderIndex_key" ON "Question"("quizId", "orderIndex");

-- CreateIndex
CREATE INDEX "Attempt_userId_idx" ON "Attempt"("userId");

-- CreateIndex
CREATE INDEX "Attempt_quizId_idx" ON "Attempt"("quizId");

-- CreateIndex
CREATE INDEX "Attempt_completedAt_idx" ON "Attempt"("completedAt");

-- CreateIndex
CREATE INDEX "AnswerLog_attemptId_idx" ON "AnswerLog"("attemptId");

-- CreateIndex
CREATE INDEX "AnswerLog_questionId_idx" ON "AnswerLog"("questionId");

-- CreateIndex
CREATE INDEX "UserBadge_badgeId_idx" ON "UserBadge"("badgeId");

-- CreateIndex
CREATE UNIQUE INDEX "UserBadge_userId_badgeId_key" ON "UserBadge"("userId", "badgeId");

-- CreateIndex
CREATE INDEX "Favorite_quizId_idx" ON "Favorite"("quizId");

-- CreateIndex
CREATE UNIQUE INDEX "Favorite_userId_quizId_key" ON "Favorite"("userId", "quizId");

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
CREATE UNIQUE INDEX "_TopicTags_AB_unique" ON "_TopicTags"("A", "B");

-- CreateIndex
CREATE INDEX "_TopicTags_B_index" ON "_TopicTags"("B");
