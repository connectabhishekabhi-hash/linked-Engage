export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const user = await prisma.user.findFirst({ where: { extensionToken: token } });
    if (!user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const { jobId } = await params;
    const body = await req.json();

    const job = await (prisma as any).researchJob.findFirst({
      where: { id: jobId, campaign: { userId: user.id } },
      include: { campaign: true },
    });
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    await (prisma as any).researchJob.update({
      where: { id: jobId },
      data: { status: "COMPLETED", result: body.result ?? {}, completedAt: new Date() },
    });

    switch (job.type) {
      case "DISCOVER_COMPANIES":
        await handleDiscoveryResults(job, body.result);
        break;
      case "EXTRACT_WEBSITE":
        await handleExtractionResults(job, body.result);
        break;
      case "FIND_DECISION_MAKER":
        await handleDecisionMakerResults(job, body.result);
        break;
      case "CHECK_ADS":
        await handleAdsResults(job, body.result);
        break;
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[research-jobs/complete] error:", err);
    return NextResponse.json({ error: err?.message ?? "Failed" }, { status: 500 });
  }
}

// ── DISCOVER_COMPANIES ──────────────────────────────────────────────────────

async function handleDiscoveryResults(job: any, result: any) {
  const companies = result?.companies ?? [];
  if (!companies.length) {
    await checkStageComplete(job.campaignId, "DISCOVER_COMPANIES", "RESEARCHING", createExtractJobs);
    return;
  }

  for (const c of companies) {
    const domain = extractDomain(c.website || c.url || "");
    if (!domain) continue;

    try {
      await (prisma as any).researchCompany.upsert({
        where: { campaignId_domain: { campaignId: job.campaignId, domain } },
        create: {
          campaignId: job.campaignId,
          name: c.name || domain,
          domain,
          website: `https://${domain}`,
          description: c.snippet || null,
          sourceUrl: c.sourceUrl || null,
          researchStatus: "DISCOVERED",
        },
        update: {},
      });
    } catch {
      // duplicate — skip
    }
  }

  const totalFound = await (prisma as any).researchCompany.count({
    where: { campaignId: job.campaignId },
  });
  await (prisma as any).researchCampaign.update({
    where: { id: job.campaignId },
    data: { companiesFound: totalFound },
  });

  await checkStageComplete(job.campaignId, "DISCOVER_COMPANIES", "RESEARCHING", createExtractJobs);
}

async function createExtractJobs(campaignId: string) {
  const discovered = await (prisma as any).researchCompany.findMany({
    where: { campaignId, researchStatus: "DISCOVERED" },
    select: { id: true, website: true, domain: true },
  });

  if (discovered.length === 0) {
    await (prisma as any).researchCampaign.update({
      where: { id: campaignId },
      data: { status: "COMPLETED" },
    });
    return;
  }

  const jobs = discovered.map((c: any) => ({
    campaignId,
    companyId: c.id,
    type: "EXTRACT_WEBSITE",
    status: "PENDING",
    payload: { website: c.website, domain: c.domain },
  }));
  await (prisma as any).researchJob.createMany({ data: jobs });
}

// ── EXTRACT_WEBSITE ─────────────────────────────────────────────────────────

async function handleExtractionResults(job: any, result: any) {
  if (!job.companyId) return;

  await (prisma as any).researchCompany.update({
    where: { id: job.companyId },
    data: {
      extractedContent: result?.content ?? null,
      servicesOffered: result?.services ?? [],
      location: result?.location || null,
      estimatedSize: result?.estimatedSize || null,
      researchStatus: "EXTRACTED",
      // Store social links and contact info in extractedContent
    },
  });

  // Store social links as evidence
  const evidence: any[] = [];
  if (result?.socials) {
    for (const [platform, url] of Object.entries(result.socials)) {
      if (url) {
        evidence.push({
          companyId: job.companyId,
          field: `social_${platform}`,
          value: url as string,
          sourceUrl: result?.website || job.payload?.website,
          confidence: "VERIFIED",
        });
      }
    }
  }
  if (result?.emails?.length) {
    for (const email of result.emails) {
      evidence.push({
        companyId: job.companyId,
        field: "email",
        value: email,
        sourceUrl: result?.website || job.payload?.website,
        confidence: "VERIFIED",
      });
    }
  }
  if (result?.phones?.length) {
    for (const phone of result.phones) {
      evidence.push({
        companyId: job.companyId,
        field: "phone",
        value: phone,
        sourceUrl: result?.website || job.payload?.website,
        confidence: "VERIFIED",
      });
    }
  }
  if (evidence.length > 0) {
    await (prisma as any).companyEvidence.createMany({ data: evidence });
  }

  // When all extractions done → create CHECK_ADS + FIND_DECISION_MAKER jobs
  await checkStageComplete(job.campaignId, "EXTRACT_WEBSITE", "FINDING_CONTACTS", createRefineJobs);
}

async function createRefineJobs(campaignId: string) {
  const companies = await (prisma as any).researchCompany.findMany({
    where: { campaignId, researchStatus: "EXTRACTED" },
    select: { id: true, name: true, domain: true },
  });

  if (companies.length === 0) {
    await (prisma as any).researchCampaign.update({
      where: { id: campaignId },
      data: { status: "COMPLETED" },
    });
    return;
  }

  // Mark all extracted companies as QUALIFIED (no AI gate — everything goes through)
  await (prisma as any).researchCompany.updateMany({
    where: { campaignId, researchStatus: "EXTRACTED" },
    data: { qualificationStatus: "QUALIFIED", qualificationScore: 100, researchStatus: "QUALIFIED" },
  });

  await (prisma as any).researchCampaign.update({
    where: { id: campaignId },
    data: { companiesQualified: companies.length },
  });

  const dmJobs = companies.map((c: any) => ({
    campaignId,
    companyId: c.id,
    type: "FIND_DECISION_MAKER",
    status: "PENDING",
    payload: { companyName: c.name, domain: c.domain },
  }));

  const adsJobs = companies.map((c: any) => ({
    campaignId,
    companyId: c.id,
    type: "CHECK_ADS",
    status: "PENDING",
    payload: { companyName: c.name, domain: c.domain },
  }));

  await (prisma as any).researchJob.createMany({ data: [...dmJobs, ...adsJobs] });
}

// ── FIND_DECISION_MAKER ─────────────────────────────────────────────────────

async function handleDecisionMakerResults(job: any, result: any) {
  if (!job.companyId) return;

  const candidates = result?.candidates ?? [];

  // Pick the best candidate without AI — prioritize by title
  const selected = pickBestCandidate(candidates);

  if (selected) {
    await (prisma as any).companyContact.create({
      data: {
        companyId: job.companyId,
        fullName: selected.name,
        title: selected.title,
        linkedinUrl: selected.linkedinUrl || null,
        source: "google_search",
        confidence: "HIGH",
        isPrimary: true,
      },
    });

    const totalContacts = await (prisma as any).companyContact.count({
      where: { company: { campaignId: job.campaignId }, isPrimary: true },
    });
    await (prisma as any).researchCampaign.update({
      where: { id: job.campaignId },
      data: { contactsFound: totalContacts },
    });
  }

  await checkStageComplete(job.campaignId, "FIND_DECISION_MAKER", null, () => checkAllRefineComplete(job.campaignId));
}

// ── CHECK_ADS ───────────────────────────────────────────────────────────────

async function handleAdsResults(job: any, result: any) {
  if (!job.companyId) return;

  await (prisma as any).researchCompany.update({
    where: { id: job.companyId },
    data: {
      googleAdsStatus: result?.googleAds?.status || "UNKNOWN",
      googleAdsEvidence: result?.googleAds?.evidence || null,
      metaAdsStatus: result?.metaAds?.status || "UNKNOWN",
      metaAdsEvidence: result?.metaAds?.evidence || null,
      adsCheckedAt: new Date(),
    },
  });

  await checkStageComplete(job.campaignId, "CHECK_ADS", null, () => checkAllRefineComplete(job.campaignId));
}

async function checkAllRefineComplete(campaignId: string) {
  const pendingRefine = await (prisma as any).researchJob.count({
    where: {
      campaignId,
      type: { in: ["FIND_DECISION_MAKER", "CHECK_ADS"] },
      status: { in: ["PENDING", "CLAIMED"] },
    },
  });

  if (pendingRefine === 0) {
    // Mark all qualified companies as COMPLETED
    await (prisma as any).researchCompany.updateMany({
      where: { campaignId, qualificationStatus: { in: ["QUALIFIED", "MAYBE"] } },
      data: { researchStatus: "COMPLETED" },
    });

    await (prisma as any).researchCampaign.update({
      where: { id: campaignId },
      data: { status: "COMPLETED" },
    });
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function checkStageComplete(
  campaignId: string,
  jobType: string,
  nextStatus: string | null,
  onComplete: (campaignId: string) => Promise<void>
) {
  const pending = await (prisma as any).researchJob.count({
    where: { campaignId, type: jobType, status: { in: ["PENDING", "CLAIMED"] } },
  });

  if (pending === 0) {
    if (nextStatus) {
      await (prisma as any).researchCampaign.update({
        where: { id: campaignId },
        data: { status: nextStatus },
      });
    }
    await onComplete(campaignId);
  }
}

function pickBestCandidate(candidates: any[]): any | null {
  if (!candidates.length) return null;

  const priorityTitles = [
    /founder/i, /co-founder/i, /ceo/i, /owner/i, /president/i,
    /director/i, /managing/i, /chief/i, /head/i, /vp/i,
  ];

  for (const pattern of priorityTitles) {
    const match = candidates.find((c: any) => pattern.test(c.title));
    if (match) return match;
  }

  return candidates[0];
}

function extractDomain(url: string): string | null {
  try {
    if (!url.includes("://")) url = "https://" + url;
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    const blocked = ["google.com", "facebook.com", "linkedin.com", "yelp.com",
      "youtube.com", "wikipedia.org", "twitter.com", "instagram.com", "tiktok.com",
      "reddit.com", "pinterest.com", "amazon.com", "bbb.org", "glassdoor.com",
      "indeed.com", "crunchbase.com", "bloomberg.com"];
    if (blocked.some(b => hostname.endsWith(b))) return null;
    return hostname || null;
  } catch {
    return null;
  }
}
