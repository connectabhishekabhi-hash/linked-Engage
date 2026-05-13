-- Phase 2: Campaigns, ScheduledPosts, PostAnalytics
-- Run this in your Supabase SQL editor

-- Enums
DO $$ BEGIN
  CREATE TYPE "CampaignStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ScheduledPostStatus" AS ENUM ('PENDING', 'PUBLISHING', 'PUBLISHED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Campaign table
CREATE TABLE IF NOT EXISTS "Campaign" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "userId"          TEXT NOT NULL REFERENCES "app_users"("id") ON DELETE CASCADE,
  "name"            TEXT NOT NULL,
  "targetPostUrl"   TEXT NOT NULL,
  "triggerKeyword"  TEXT NOT NULL,
  "messageTemplate" TEXT NOT NULL,
  "status"          "CampaignStatus" NOT NULL DEFAULT 'ACTIVE',
  "leadsTriggered"  INTEGER NOT NULL DEFAULT 0,
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "Campaign_userId_status_idx" ON "Campaign"("userId", "status");

-- ScheduledPost table
CREATE TABLE IF NOT EXISTS "ScheduledPost" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "userId"          TEXT NOT NULL REFERENCES "app_users"("id") ON DELETE CASCADE,
  "content"         TEXT NOT NULL,
  "scheduledFor"    TIMESTAMPTZ NOT NULL,
  "status"          "ScheduledPostStatus" NOT NULL DEFAULT 'PENDING',
  "linkedinPostUrn" TEXT,
  "errorMessage"    TEXT,
  "publishedAt"     TIMESTAMPTZ,
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "ScheduledPost_status_scheduledFor_idx" ON "ScheduledPost"("status", "scheduledFor");
CREATE INDEX IF NOT EXISTS "ScheduledPost_userId_idx" ON "ScheduledPost"("userId");

-- PostAnalytics table
CREATE TABLE IF NOT EXISTS "PostAnalytics" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "userId"      TEXT NOT NULL REFERENCES "app_users"("id") ON DELETE CASCADE,
  "postUrn"     TEXT NOT NULL,
  "postUrl"     TEXT,
  "postPreview" TEXT,
  "viewerData"  JSONB NOT NULL DEFAULT '{}',
  "fetchedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "PostAnalytics_userId_postUrn_key" ON "PostAnalytics"("userId", "postUrn");
CREATE INDEX IF NOT EXISTS "PostAnalytics_userId_idx" ON "PostAnalytics"("userId");
