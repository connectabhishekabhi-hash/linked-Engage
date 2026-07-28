-- Research Engine Migration
-- Run this in Supabase SQL Editor

-- Enums
DO $$ BEGIN
  CREATE TYPE "ResearchCampaignStatus" AS ENUM (
    'DRAFT', 'DISCOVERING', 'RESEARCHING', 'QUALIFYING',
    'FINDING_CONTACTS', 'ANALYZING', 'COMPLETED', 'PAUSED', 'FAILED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ResearchCompanyStatus" AS ENUM (
    'DISCOVERED', 'EXTRACTING', 'EXTRACTED', 'QUALIFYING', 'QUALIFIED',
    'DISQUALIFIED', 'RESEARCHING_CONTACTS', 'CHECKING_ADS', 'ANALYZING',
    'COMPLETED', 'FAILED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ResearchJobType" AS ENUM (
    'DISCOVER_COMPANIES', 'EXTRACT_WEBSITE', 'QUALIFY_COMPANY',
    'FIND_DECISION_MAKER', 'CHECK_ADS', 'ANALYZE_WEBSITE', 'GENERATE_OPPORTUNITY'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ResearchJobStatus" AS ENUM (
    'PENDING', 'CLAIMED', 'RUNNING', 'COMPLETED', 'FAILED', 'RETRY'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ResearchCampaign
CREATE TABLE IF NOT EXISTS "ResearchCampaign" (
  "id"                     TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "userId"                 TEXT NOT NULL,
  "name"                   TEXT NOT NULL,
  "industry"               TEXT NOT NULL,
  "location"               TEXT NOT NULL,
  "companySize"            TEXT,
  "services"               TEXT[] DEFAULT '{}',
  "exclusions"             TEXT[] DEFAULT '{}',
  "targetCount"            INTEGER NOT NULL DEFAULT 30,
  "additionalInstructions" TEXT,
  "status"                 "ResearchCampaignStatus" NOT NULL DEFAULT 'DRAFT',
  "companiesFound"         INTEGER NOT NULL DEFAULT 0,
  "companiesQualified"     INTEGER NOT NULL DEFAULT 0,
  "contactsFound"          INTEGER NOT NULL DEFAULT 0,
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResearchCampaign_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ResearchCampaign_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "ResearchCampaign_userId_status_idx" ON "ResearchCampaign"("userId", "status");

-- ResearchCompany
CREATE TABLE IF NOT EXISTS "ResearchCompany" (
  "id"                   TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "campaignId"           TEXT NOT NULL,
  "name"                 TEXT NOT NULL,
  "domain"               TEXT,
  "website"              TEXT,
  "location"             TEXT,
  "estimatedSize"        TEXT,
  "servicesOffered"      TEXT[] DEFAULT '{}',
  "description"          TEXT,
  "sourceUrl"            TEXT,
  "sourceSnippet"        TEXT,
  "qualificationStatus"  TEXT,
  "qualificationScore"   INTEGER,
  "qualificationReason"  TEXT,
  "googleAdsStatus"      TEXT,
  "googleAdsEvidence"    TEXT,
  "metaAdsStatus"        TEXT,
  "metaAdsEvidence"      TEXT,
  "adsCheckedAt"         TIMESTAMP(3),
  "websiteStrengths"     TEXT[] DEFAULT '{}',
  "websiteWeaknesses"    TEXT[] DEFAULT '{}',
  "conversionIssues"     TEXT[] DEFAULT '{}',
  "websiteAnalyzedAt"    TIMESTAMP(3),
  "opportunity"          TEXT,
  "opportunityEvidence"  TEXT,
  "extractedContent"     JSONB,
  "researchStatus"       "ResearchCompanyStatus" NOT NULL DEFAULT 'DISCOVERED',
  "errorMessage"         TEXT,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResearchCompany_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ResearchCompany_campaignId_fkey" FOREIGN KEY ("campaignId")
    REFERENCES "ResearchCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ResearchCompany_campaignId_domain_key" ON "ResearchCompany"("campaignId", "domain");
CREATE INDEX IF NOT EXISTS "ResearchCompany_campaignId_researchStatus_idx" ON "ResearchCompany"("campaignId", "researchStatus");
CREATE INDEX IF NOT EXISTS "ResearchCompany_campaignId_qualificationStatus_idx" ON "ResearchCompany"("campaignId", "qualificationStatus");

-- CompanyContact
CREATE TABLE IF NOT EXISTS "CompanyContact" (
  "id"          TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "companyId"   TEXT NOT NULL,
  "fullName"    TEXT NOT NULL,
  "title"       TEXT,
  "linkedinUrl" TEXT,
  "source"      TEXT,
  "confidence"  TEXT,
  "isPrimary"   BOOLEAN NOT NULL DEFAULT false,
  "leadId"      TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompanyContact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CompanyContact_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "ResearchCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "CompanyContact_companyId_idx" ON "CompanyContact"("companyId");

-- CompanyEvidence
CREATE TABLE IF NOT EXISTS "CompanyEvidence" (
  "id"         TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "companyId"  TEXT NOT NULL,
  "field"      TEXT NOT NULL,
  "value"      TEXT NOT NULL,
  "sourceUrl"  TEXT,
  "confidence" TEXT,
  "checkedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompanyEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CompanyEvidence_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "ResearchCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "CompanyEvidence_companyId_idx" ON "CompanyEvidence"("companyId");

-- ResearchJob
CREATE TABLE IF NOT EXISTS "ResearchJob" (
  "id"          TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "campaignId"  TEXT NOT NULL,
  "companyId"   TEXT,
  "type"        "ResearchJobType" NOT NULL,
  "status"      "ResearchJobStatus" NOT NULL DEFAULT 'PENDING',
  "payload"     JSONB NOT NULL DEFAULT '{}',
  "result"      JSONB,
  "error"       TEXT,
  "retryCount"  INTEGER NOT NULL DEFAULT 0,
  "maxRetries"  INTEGER NOT NULL DEFAULT 2,
  "claimedAt"   TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResearchJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ResearchJob_campaignId_fkey" FOREIGN KEY ("campaignId")
    REFERENCES "ResearchCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "ResearchJob_campaignId_status_idx" ON "ResearchJob"("campaignId", "status");
CREATE INDEX IF NOT EXISTS "ResearchJob_status_createdAt_idx" ON "ResearchJob"("status", "createdAt");

-- Add researchCompanyId to Lead (optional FK for research-sourced leads)
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "researchCompanyId" TEXT;
