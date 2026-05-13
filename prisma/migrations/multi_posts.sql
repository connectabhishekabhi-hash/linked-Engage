-- Migration: multi_posts
-- Adds support for storing up to 3 scraped posts per lead
-- and linking each COMMENT draft to the specific post it was written for.

-- Store up to 3 posts per lead as a JSON array
-- Format: [{ "text": "...", "url": "...", "activityUrn": "urn:li:activity:..." }, ...]
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "scrapedPosts" JSONB;

-- Link each COMMENT draft to the specific post it was written for
-- Stores the activityUrn of the post this comment targets
ALTER TABLE "Draft" ADD COLUMN IF NOT EXISTS "postUrn" TEXT;
