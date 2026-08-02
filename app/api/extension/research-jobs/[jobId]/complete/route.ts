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
// PARALLEL: immediately create EXTRACT jobs for newly discovered companies
// Don't wait for all discovery jobs to finish

async function handleDiscoveryResults(job: any, result: any) {
  const companies = result?.companies ?? [];
  const newCompanyIds: string[] = [];

  for (const c of companies) {
    const domain = extractDomain(c.website || c.url || "");
    if (!domain) continue;

    try {
      const company = await (prisma as any).researchCompany.upsert({
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
      // Only create extract job for truly new companies (not duplicates)
      if (company.researchStatus === "DISCOVERED") {
        newCompanyIds.push(company.id);
      }
    } catch {
      // duplicate — skip
    }
  }

  // Update campaign counter
  const totalFound = await (prisma as any).researchCompany.count({
    where: { campaignId: job.campaignId },
  });
  await (prisma as any).researchCampaign.update({
    where: { id: job.campaignId },
    data: { companiesFound: totalFound, status: "RESEARCHING" },
  });

  // IMMEDIATELY create EXTRACT_WEBSITE jobs for new companies (don't wait for all discovery)
  if (newCompanyIds.length > 0) {
    const newCompanies = await (prisma as any).researchCompany.findMany({
      where: { id: { in: newCompanyIds } },
      select: { id: true, website: true, domain: true },
    });

    const extractJobs = newCompanies.map((c: any) => ({
      campaignId: job.campaignId,
      companyId: c.id,
      type: "EXTRACT_WEBSITE",
      status: "PENDING",
      payload: { website: c.website, domain: c.domain },
    }));
    if (extractJobs.length > 0) {
      await (prisma as any).researchJob.createMany({ data: extractJobs });
    }
  }
}

// ── EXTRACT_WEBSITE ─────────────────────────────────────────────────────────
// PARALLEL: immediately create FIND_DM + CHECK_ADS jobs for this company
// Don't wait for all extractions to finish

async function handleExtractionResults(job: any, result: any) {
  if (!job.companyId) return;

  const company = await (prisma as any).researchCompany.findUnique({
    where: { id: job.companyId },
  });
  if (!company) return;

  await (prisma as any).researchCompany.update({
    where: { id: job.companyId },
    data: {
      extractedContent: result?.content ?? null,
      servicesOffered: result?.services ?? [],
      location: result?.location || null,
      estimatedSize: result?.estimatedSize || null,
      qualificationStatus: "QUALIFIED",
      qualificationScore: 100,
      researchStatus: "QUALIFIED",
    },
  });

  // Store social links, emails, phones as evidence
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
      evidence.push({ companyId: job.companyId, field: "email", value: email, sourceUrl: job.payload?.website, confidence: "VERIFIED" });
    }
  }
  if (result?.phones?.length) {
    for (const phone of result.phones) {
      evidence.push({ companyId: job.companyId, field: "phone", value: phone, sourceUrl: job.payload?.website, confidence: "VERIFIED" });
    }
  }
  if (evidence.length > 0) {
    await (prisma as any).companyEvidence.createMany({ data: evidence });
  }

  // Update qualified count
  const qualifiedCount = await (prisma as any).researchCompany.count({
    where: { campaignId: job.campaignId, qualificationStatus: "QUALIFIED" },
  });
  await (prisma as any).researchCampaign.update({
    where: { id: job.campaignId },
    data: { companiesQualified: qualifiedCount, status: "FINDING_CONTACTS" },
  });

  // IMMEDIATELY create FIND_DM + CHECK_ADS for THIS company (parallel, don't wait)
  await (prisma as any).researchJob.createMany({
    data: [
      {
        campaignId: job.campaignId,
        companyId: job.companyId,
        type: "FIND_DECISION_MAKER",
        status: "PENDING",
        payload: { companyName: company.name, domain: company.domain },
      },
      {
        campaignId: job.campaignId,
        companyId: job.companyId,
        type: "CHECK_ADS",
        status: "PENDING",
        payload: { companyName: company.name, domain: company.domain },
      },
    ],
  });
}

// ── FIND_DECISION_MAKER ─────────────────────────────────────────────────────

async function handleDecisionMakerResults(job: any, result: any) {
  if (!job.companyId) return;

  const candidates = result?.candidates ?? [];
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

  await checkCampaignComplete(job.campaignId);
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

  await checkCampaignComplete(job.campaignId);
}

// ── Campaign completion check ───────────────────────────────────────────────
// Campaign is COMPLETED when zero jobs remain PENDING/CLAIMED across all types

async function checkCampaignComplete(campaignId: string) {
  const pending = await (prisma as any).researchJob.count({
    where: {
      campaignId,
      status: { in: ["PENDING", "CLAIMED"] },
    },
  });

  if (pending === 0) {
    // Mark remaining qualified companies as COMPLETED
    await (prisma as any).researchCompany.updateMany({
      where: { campaignId, qualificationStatus: "QUALIFIED", researchStatus: { not: "COMPLETED" } },
      data: { researchStatus: "COMPLETED" },
    });

    await (prisma as any).researchCampaign.update({
      where: { id: campaignId },
      data: { status: "COMPLETED" },
    });
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

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
    const blocked = ["google.com","facebook.com","linkedin.com","yelp.com",
      "youtube.com","wikipedia.org","twitter.com","instagram.com","tiktok.com",
      "reddit.com","pinterest.com","amazon.com","bbb.org","glassdoor.com",
      "indeed.com","crunchbase.com","bloomberg.com","tripadvisor.com","tripadvisor.in",
      "lusha.com","canstar.co.nz","yellowpages.com","yelp.co.nz","trustpilot.com"];
    if (blocked.some(b => hostname.endsWith(b))) return null;
    return hostname || null;
  } catch {
    return null;
  }
}
