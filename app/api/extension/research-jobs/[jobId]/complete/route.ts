export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { qualifyCompany, analyzeWebsite, generateOpportunity, selectDecisionMaker } from "@/lib/ai-research";

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

    // Mark completed
    await (prisma as any).researchJob.update({
      where: { id: jobId },
      data: { status: "COMPLETED", result: body.result ?? {}, completedAt: new Date() },
    });

    // Process results based on job type
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
  if (!companies.length) return;

  let created = 0;
  for (const c of companies) {
    const domain = extractDomain(c.website || c.url || "");
    if (!domain) continue;

    try {
      await (prisma as any).researchCompany.upsert({
        where: { campaignId_domain: { campaignId: job.campaignId, domain } },
        create: {
          campaignId: job.campaignId,
          name: c.name || c.title || domain,
          domain,
          website: c.website || c.url || `https://${domain}`,
          location: c.location || null,
          description: c.description || c.snippet || null,
          sourceUrl: c.sourceUrl || null,
          sourceSnippet: c.snippet || null,
          researchStatus: "DISCOVERED",
        },
        update: {},
      });
      created++;
    } catch {
      // duplicate domain — skip
    }
  }

  // Update campaign counter
  const totalFound = await (prisma as any).researchCompany.count({
    where: { campaignId: job.campaignId },
  });
  await (prisma as any).researchCampaign.update({
    where: { id: job.campaignId },
    data: { companiesFound: totalFound },
  });

  // Check if all discovery jobs are done — if so, create EXTRACT_WEBSITE jobs
  const pendingDiscovery = await (prisma as any).researchJob.count({
    where: { campaignId: job.campaignId, type: "DISCOVER_COMPANIES", status: { in: ["PENDING", "CLAIMED"] } },
  });

  if (pendingDiscovery === 0) {
    const discovered = await (prisma as any).researchCompany.findMany({
      where: { campaignId: job.campaignId, researchStatus: "DISCOVERED" },
      select: { id: true, website: true },
    });

    if (discovered.length > 0) {
      const extractJobs = discovered.map((c: any) => ({
        campaignId: job.campaignId,
        companyId: c.id,
        type: "EXTRACT_WEBSITE",
        status: "PENDING",
        payload: { website: c.website },
      }));
      await (prisma as any).researchJob.createMany({ data: extractJobs });
      await (prisma as any).researchCampaign.update({
        where: { id: job.campaignId },
        data: { status: "RESEARCHING" },
      });
    }
  }
}

// ── EXTRACT_WEBSITE ─────────────────────────────────────────────────────────

async function handleExtractionResults(job: any, result: any) {
  if (!job.companyId) return;

  const content = result?.content ?? {};
  const services = result?.services ?? [];
  const location = result?.location || null;
  const estimatedSize = result?.estimatedSize || null;

  await (prisma as any).researchCompany.update({
    where: { id: job.companyId },
    data: {
      extractedContent: content,
      servicesOffered: services,
      location: location,
      estimatedSize: estimatedSize,
      researchStatus: "EXTRACTED",
    },
  });

  // Store evidence
  if (result?.evidence) {
    const evidenceData = result.evidence.map((e: any) => ({
      companyId: job.companyId,
      field: e.field,
      value: e.value,
      sourceUrl: e.sourceUrl || null,
      confidence: e.confidence || "VERIFIED",
    }));
    await (prisma as any).companyEvidence.createMany({ data: evidenceData });
  }

  // Check if all extractions done — trigger qualification
  const pendingExtract = await (prisma as any).researchJob.count({
    where: { campaignId: job.campaignId, type: "EXTRACT_WEBSITE", status: { in: ["PENDING", "CLAIMED"] } },
  });

  if (pendingExtract === 0) {
    await runQualification(job.campaignId);
  }
}

// ── AI QUALIFICATION (server-side, no extension needed) ─────────────────────

async function runQualification(campaignId: string) {
  const campaign = await (prisma as any).researchCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return;

  await (prisma as any).researchCampaign.update({
    where: { id: campaignId },
    data: { status: "QUALIFYING" },
  });

  const companies = await (prisma as any).researchCompany.findMany({
    where: { campaignId, researchStatus: "EXTRACTED" },
  });

  let qualified = 0;
  for (const company of companies) {
    try {
      const result = await qualifyCompany(company, campaign);
      await (prisma as any).researchCompany.update({
        where: { id: company.id },
        data: {
          qualificationStatus: result.status,
          qualificationScore: result.score,
          qualificationReason: result.reason,
          researchStatus: result.status === "DISQUALIFIED" ? "DISQUALIFIED" : "QUALIFIED",
        },
      });
      if (result.status === "QUALIFIED" || result.status === "MAYBE") qualified++;
    } catch (err: any) {
      console.error(`[qualify] Error for ${company.name}:`, err.message);
      await (prisma as any).researchCompany.update({
        where: { id: company.id },
        data: { researchStatus: "FAILED", errorMessage: err.message },
      });
    }
  }

  await (prisma as any).researchCampaign.update({
    where: { id: campaignId },
    data: { companiesQualified: qualified },
  });

  // Create FIND_DECISION_MAKER + CHECK_ADS jobs for qualified companies
  const qualifiedCompanies = await (prisma as any).researchCompany.findMany({
    where: { campaignId, qualificationStatus: { in: ["QUALIFIED", "MAYBE"] } },
    select: { id: true, name: true, domain: true },
  });

  const dmJobs = qualifiedCompanies.map((c: any) => ({
    campaignId,
    companyId: c.id,
    type: "FIND_DECISION_MAKER",
    status: "PENDING",
    payload: { companyName: c.name, domain: c.domain },
  }));

  const adsJobs = qualifiedCompanies.map((c: any) => ({
    campaignId,
    companyId: c.id,
    type: "CHECK_ADS",
    status: "PENDING",
    payload: { companyName: c.name, domain: c.domain },
  }));

  if (dmJobs.length > 0) {
    await (prisma as any).researchJob.createMany({ data: [...dmJobs, ...adsJobs] });
    await (prisma as any).researchCampaign.update({
      where: { id: campaignId },
      data: { status: "FINDING_CONTACTS" },
    });
  } else {
    await (prisma as any).researchCampaign.update({
      where: { id: campaignId },
      data: { status: "COMPLETED" },
    });
  }
}

// ── FIND_DECISION_MAKER ─────────────────────────────────────────────────────

async function handleDecisionMakerResults(job: any, result: any) {
  if (!job.companyId) return;

  const candidates = result?.candidates ?? [];
  const company = await (prisma as any).researchCompany.findUnique({
    where: { id: job.companyId },
  });

  if (candidates.length > 0 && company) {
    const aiResult = await selectDecisionMaker(candidates, company.name);
    if (aiResult.selected) {
      await (prisma as any).companyContact.create({
        data: {
          companyId: job.companyId,
          fullName: aiResult.selected.name,
          title: aiResult.selected.title,
          linkedinUrl: aiResult.selected.linkedinUrl || null,
          source: "google_search",
          confidence: aiResult.selected.confidence,
          isPrimary: true,
        },
      });

      // Update campaign counter
      const totalContacts = await (prisma as any).companyContact.count({
        where: { company: { campaignId: job.campaignId }, isPrimary: true },
      });
      await (prisma as any).researchCampaign.update({
        where: { id: job.campaignId },
        data: { contactsFound: totalContacts },
      });
    }
  }

  await (prisma as any).researchCompany.update({
    where: { id: job.companyId },
    data: { researchStatus: "CHECKING_ADS" },
  });

  // Check if all DM + ADS jobs done — trigger analysis
  await checkAndTriggerAnalysis(job.campaignId);
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

  await checkAndTriggerAnalysis(job.campaignId);
}

// ── Analysis trigger (runs after DM + ADS both complete) ────────────────────

async function checkAndTriggerAnalysis(campaignId: string) {
  const pendingDmAds = await (prisma as any).researchJob.count({
    where: {
      campaignId,
      type: { in: ["FIND_DECISION_MAKER", "CHECK_ADS"] },
      status: { in: ["PENDING", "CLAIMED"] },
    },
  });

  if (pendingDmAds > 0) return;

  // All DM + ADS done — run website analysis + opportunity generation (server-side AI)
  const campaign = await (prisma as any).researchCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return;

  await (prisma as any).researchCampaign.update({
    where: { id: campaignId },
    data: { status: "ANALYZING" },
  });

  const companies = await (prisma as any).researchCompany.findMany({
    where: { campaignId, qualificationStatus: { in: ["QUALIFIED", "MAYBE"] } },
  });

  for (const company of companies) {
    try {
      const analysis = await analyzeWebsite(company, campaign.industry);
      await (prisma as any).researchCompany.update({
        where: { id: company.id },
        data: {
          websiteStrengths: analysis.strengths,
          websiteWeaknesses: analysis.weaknesses,
          conversionIssues: analysis.conversionIssues,
          websiteAnalyzedAt: new Date(),
        },
      });

      const merged = {
        ...company,
        websiteStrengths: analysis.strengths,
        websiteWeaknesses: analysis.weaknesses,
        conversionIssues: analysis.conversionIssues,
      };
      const opp = await generateOpportunity(merged);
      await (prisma as any).researchCompany.update({
        where: { id: company.id },
        data: {
          opportunity: opp.opportunity,
          opportunityEvidence: opp.evidence,
          researchStatus: "COMPLETED",
        },
      });
    } catch (err: any) {
      console.error(`[analysis] Error for ${company.name}:`, err.message);
    }
  }

  await (prisma as any).researchCampaign.update({
    where: { id: campaignId },
    data: { status: "COMPLETED" },
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractDomain(url: string): string | null {
  try {
    if (!url.includes("://")) url = "https://" + url;
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    if (hostname === "google.com" || hostname === "facebook.com" || hostname === "linkedin.com" || hostname === "yelp.com") return null;
    return hostname || null;
  } catch {
    return null;
  }
}
