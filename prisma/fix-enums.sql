-- Create missing PostgreSQL enum types that Prisma expects

DO $$ BEGIN
  CREATE TYPE "CampaignStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ScheduledPostStatus" AS ENUM ('PENDING', 'PUBLISHING', 'PUBLISHED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "LeadSearchStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Convert TEXT columns to proper enum types
ALTER TABLE "Campaign" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Campaign" ALTER COLUMN "status" TYPE "CampaignStatus" USING "status"::"CampaignStatus";
ALTER TABLE "Campaign" ALTER COLUMN "status" SET DEFAULT 'ACTIVE'::"CampaignStatus";

ALTER TABLE "ScheduledPost" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ScheduledPost" ALTER COLUMN "status" TYPE "ScheduledPostStatus" USING "status"::"ScheduledPostStatus";
ALTER TABLE "ScheduledPost" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"ScheduledPostStatus";

ALTER TABLE "LeadSearch" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "LeadSearch" ALTER COLUMN "status" TYPE "LeadSearchStatus" USING "status"::"LeadSearchStatus";
ALTER TABLE "LeadSearch" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"LeadSearchStatus";
