-- Migration: add UserAIProfile table
-- Run this in your Supabase SQL editor

CREATE TABLE IF NOT EXISTS "UserAIProfile" (
  "id"                     TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "userId"                 TEXT NOT NULL,
  "writingStyle"           TEXT,
  "toneDescription"        TEXT,
  "exampleComment"         TEXT,
  "language"               TEXT,
  "negativeKeywords"       TEXT,
  "additionalInstructions" TEXT,
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserAIProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserAIProfile_userId_key" ON "UserAIProfile"("userId");

ALTER TABLE "UserAIProfile"
  ADD CONSTRAINT "UserAIProfile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "app_users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
