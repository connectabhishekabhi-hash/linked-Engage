-- Add monitorAllPosts and autoConnect columns to Campaign table
-- Make targetPostUrl, triggerKeyword, messageTemplate nullable

ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "monitorAllPosts" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "autoConnect" BOOLEAN NOT NULL DEFAULT false;

-- Make existing required columns nullable for auto-monitor campaigns
ALTER TABLE "Campaign" ALTER COLUMN "targetPostUrl" DROP NOT NULL;
ALTER TABLE "Campaign" ALTER COLUMN "triggerKeyword" DROP NOT NULL;
ALTER TABLE "Campaign" ALTER COLUMN "messageTemplate" DROP NOT NULL;
