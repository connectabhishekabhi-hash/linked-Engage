-- Create missing tables that prisma db push can't handle due to Supabase auth schema

-- UserAIProfile
CREATE TABLE IF NOT EXISTS "UserAIProfile" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "userId" TEXT NOT NULL,
  "writingStyle" TEXT,
  "toneDescription" TEXT,
  "exampleComment" TEXT,
  "language" TEXT,
  "negativeKeywords" TEXT,
  "additionalInstructions" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserAIProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserAIProfile_userId_key" UNIQUE ("userId"),
  CONSTRAINT "UserAIProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Campaign
CREATE TABLE IF NOT EXISTS "Campaign" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "targetPostUrl" TEXT NOT NULL,
  "triggerKeyword" TEXT NOT NULL,
  "messageTemplate" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "leadsTriggered" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Campaign_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "Campaign_userId_status_idx" ON "Campaign"("userId", "status");

-- ScheduledPost
CREATE TABLE IF NOT EXISTS "ScheduledPost" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "userId" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "scheduledFor" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "linkedinPostUrn" TEXT,
  "errorMessage" TEXT,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ScheduledPost_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ScheduledPost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- PostAnalytics
CREATE TABLE IF NOT EXISTS "PostAnalytics" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "userId" TEXT NOT NULL,
  "postUrn" TEXT NOT NULL,
  "postUrl" TEXT,
  "postPreview" TEXT,
  "viewerData" JSONB NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PostAnalytics_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PostAnalytics_userId_postUrn_key" UNIQUE ("userId", "postUrn"),
  CONSTRAINT "PostAnalytics_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- LeadSearch
CREATE TABLE IF NOT EXISTS "LeadSearch" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "userId" TEXT NOT NULL,
  "query" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "results" JSONB,
  "total" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadSearch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LeadSearch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
