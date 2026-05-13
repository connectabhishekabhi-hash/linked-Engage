-- Add official LinkedIn OAuth token fields to LinkedInAccount
ALTER TABLE "LinkedInAccount" ADD COLUMN IF NOT EXISTS "accessToken"      TEXT;
ALTER TABLE "LinkedInAccount" ADD COLUMN IF NOT EXISTS "tokenExpiry"      TIMESTAMPTZ;
ALTER TABLE "LinkedInAccount" ADD COLUMN IF NOT EXISTS "linkedinMemberId" TEXT;
