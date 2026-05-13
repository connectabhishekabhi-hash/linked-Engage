-- LinkedEngage schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query

-- Enums
CREATE TYPE "LeadStatus" AS ENUM ('PENDING', 'SCRAPING', 'AWAITING_APPROVAL', 'ENGAGED', 'FAILED');
CREATE TYPE "DraftType"  AS ENUM ('COMMENT', 'CONNECTION_REQUEST', 'DIRECT_MESSAGE');
CREATE TYPE "DraftStatus" AS ENUM ('AWAITING_APPROVAL', 'APPROVED', 'EXECUTING', 'EXECUTED', 'FAILED');

-- App users (separate from Supabase auth.users)
CREATE TABLE IF NOT EXISTS "app_users" (
  "id"           TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "email"        TEXT        NOT NULL,
  "passwordHash" TEXT        NOT NULL,
  "name"         TEXT,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "app_users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "app_users_email_key" ON "app_users"("email");

-- LinkedIn session cookies (encrypted)
CREATE TABLE IF NOT EXISTS "LinkedInAccount" (
  "id"                 TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "userId"             TEXT        NOT NULL,
  "encryptedCookie"    TEXT        NOT NULL,
  "cookieIv"           TEXT        NOT NULL,
  "linkedinProfileUrl" TEXT,
  "isActive"           BOOLEAN     NOT NULL DEFAULT true,
  "lastVerifiedAt"     TIMESTAMPTZ,
  "createdAt"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "LinkedInAccount_pkey"   PRIMARY KEY ("id"),
  CONSTRAINT "LinkedInAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_users"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "LinkedInAccount_userId_key" ON "LinkedInAccount"("userId");

-- Leads
CREATE TABLE IF NOT EXISTS "Lead" (
  "id"             TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "userId"         TEXT         NOT NULL,
  "profileUrl"     TEXT         NOT NULL,
  "fullName"       TEXT,
  "headline"       TEXT,
  "scrapedBio"     TEXT,
  "scrapedPost"    TEXT,
  "scrapedPostUrl" TEXT,
  "status"         "LeadStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt"      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "updatedAt"      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT "Lead_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Lead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_users"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "Lead_userId_profileUrl_key" ON "Lead"("userId", "profileUrl");
CREATE INDEX IF NOT EXISTS "Lead_userId_status_idx" ON "Lead"("userId", "status");

-- Drafts
CREATE TABLE IF NOT EXISTS "Draft" (
  "id"           TEXT          NOT NULL DEFAULT gen_random_uuid()::text,
  "leadId"       TEXT          NOT NULL,
  "type"         "DraftType"   NOT NULL,
  "content"      TEXT          NOT NULL,
  "status"       "DraftStatus" NOT NULL DEFAULT 'AWAITING_APPROVAL',
  "executedAt"   TIMESTAMPTZ,
  "errorMessage" TEXT,
  "createdAt"    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "updatedAt"    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT "Draft_pkey"      PRIMARY KEY ("id"),
  CONSTRAINT "Draft_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE
);
