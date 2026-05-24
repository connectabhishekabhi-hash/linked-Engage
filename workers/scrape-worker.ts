import "dotenv/config";
import { Worker, Job } from "bullmq";
import { redisConnection } from "../lib/queue";
// @ts-ignore — worker runs outside Next.js module resolution
import { prisma } from "../lib/prisma";
import { decryptCookie } from "../lib/crypto";
import { scrapeLinkedInProfile } from "../lib/scraper";
import { generateDrafts } from "../lib/ai-drafter";

interface ScrapeJobData {
  leadId: string;
  userId: string;
}

const worker = new Worker<ScrapeJobData>(
  "scrape-leads",
  async (job: Job<ScrapeJobData>) => {
    const { leadId, userId } = job.data;

    await prisma.lead.update({
      where: { id: leadId },
      data: { status: "SCRAPING" },
    });

    const account = await prisma.linkedInAccount.findUnique({ where: { userId } });

    if (!account?.isActive) {
      throw new Error("No active LinkedIn account for user");
    }

    const liAt = decryptCookie(account.encryptedCookie, account.cookieIv);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });

    const profile = await scrapeLinkedInProfile(liAt, lead.profileUrl);

    await prisma.lead.update({
      where: { id: leadId },
      data: {
        fullName: profile.fullName,
        headline: profile.headline,
        scrapedBio: profile.bio,
        scrapedPost: profile.latestPost,
        scrapedPostUrl: profile.latestPostUrl,
        status: "AWAITING_APPROVAL",
      },
    });

    const postList = profile.latestPost
      ? [{ text: profile.latestPost, url: profile.latestPostUrl ?? "", activityUrn: "" }]
      : [];

    const drafts = await generateDrafts({
      fullName: profile.fullName,
      headline: profile.headline,
      bio: profile.bio,
      posts: postList,
    });

    await Promise.all([
      prisma.draft.create({
        data: {
          leadId,
          type: "COMMENT",
          content: drafts.comments[0] ?? "Interesting take — what's the story behind this?",
          status: "AWAITING_APPROVAL",
        },
      }),
      prisma.draft.create({
        data: {
          leadId,
          type: "CONNECTION_REQUEST",
          content: drafts.connectionNote,
          status: "AWAITING_APPROVAL",
        },
      }),
    ]);

    console.log(`[worker] Completed lead ${leadId} — ${profile.fullName}`);
  },
  {
    connection: redisConnection,
    concurrency: 3,
    limiter: { max: 10, duration: 60_000 },
  }
);

worker.on("failed", async (job, err) => {
  console.error(`[worker] Job ${job?.id} failed: ${err.message}`);
  if (job?.data.leadId) {
    await prisma.lead.update({
      where: { id: job.data.leadId },
      data: { status: "FAILED", scrapedBio: `Error: ${err.message}` },
    });
  }
});

worker.on("completed", (job) => {
  console.log(`[worker] Job ${job.id} completed`);
});

console.log("[worker] Scrape worker started");
