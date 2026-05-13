-- Migration: Lead Search feature (idempotent — safe to re-run)
-- Run in Supabase SQL editor

-- 1. New JobType value
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'SEARCH';

-- 2. New columns on Lead
ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "profileImageUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "connectionDegree" TEXT;

-- 3. LeadSearchStatus enum
DO $$ BEGIN
  CREATE TYPE "LeadSearchStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4. LeadSearch table
CREATE TABLE IF NOT EXISTS "LeadSearch" (
  "id"        TEXT               NOT NULL DEFAULT gen_random_uuid()::text,
  "userId"    TEXT               NOT NULL,
  "query"     TEXT               NOT NULL,
  "status"    "LeadSearchStatus" NOT NULL DEFAULT 'PENDING',
  "results"   JSONB,
  "total"     INTEGER            NOT NULL DEFAULT 0,
  "error"     TEXT,
  "createdAt" TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadSearch_pkey" PRIMARY KEY ("id")
);

-- 5. Index
CREATE INDEX IF NOT EXISTS "LeadSearch_userId_idx" ON "LeadSearch"("userId");

-- 6. Foreign key (skip if already exists)
DO $$ BEGIN
  ALTER TABLE "LeadSearch"
    ADD CONSTRAINT "LeadSearch_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "app_users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
