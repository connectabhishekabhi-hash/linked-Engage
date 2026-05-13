-- Run this in Supabase SQL Editor

-- New ENUMs
DO $$ BEGIN
  CREATE TYPE "JobType"   AS ENUM ('SCRAPE', 'COMMENT', 'CONNECTION_REQUEST');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'CLAIMED', 'COMPLETED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- New columns on app_users
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS "apiToken"       TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS "extensionToken" TEXT UNIQUE;

-- New columns on "Lead"
ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "profileUrn"    TEXT,
  ADD COLUMN IF NOT EXISTS "activityUrn"   TEXT;

-- ExtensionJob table
CREATE TABLE IF NOT EXISTS "ExtensionJob" (
  id            TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId"      TEXT        NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  "leadId"      TEXT        NOT NULL REFERENCES "Lead"(id)    ON DELETE CASCADE,
  type          "JobType"   NOT NULL,
  status        "JobStatus" NOT NULL DEFAULT 'PENDING',
  payload       JSONB       NOT NULL DEFAULT '{}',
  result        JSONB,
  error         TEXT,
  "claimedAt"   TIMESTAMPTZ,
  "completedAt" TIMESTAMPTZ,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_extjob_user_status ON "ExtensionJob" ("userId", status);
CREATE INDEX IF NOT EXISTS idx_extjob_status_created ON "ExtensionJob" (status, "createdAt");

-- Auto-generate apiToken for existing users
UPDATE app_users
SET "apiToken" = encode(gen_random_bytes(24), 'hex')
WHERE "apiToken" IS NULL;
