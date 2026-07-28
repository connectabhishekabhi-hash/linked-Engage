import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || "");

function getModel() {
  return genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
}

function parseJSON(text: string): any {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = match ? match[1].trim() : text.trim();
  return JSON.parse(raw);
}

// ── Stage 1: Generate search queries from campaign ICP ───────────────────────

export async function generateSearchQueries(campaign: {
  industry: string;
  location: string;
  companySize?: string | null;
  services: string[];
  exclusions: string[];
  targetCount: number;
  additionalInstructions?: string | null;
}): Promise<string[]> {
  const model = getModel();
  const prompt = `You are a lead researcher. Generate Google search queries to find companies matching this ICP.

Industry: ${campaign.industry}
Location: ${campaign.location}
Company Size: ${campaign.companySize || "Any"}
Services/Keywords: ${campaign.services.join(", ") || "General"}
Exclusions: ${campaign.exclusions.join(", ") || "None"}
Target: ${campaign.targetCount} prospects
${campaign.additionalInstructions ? `Additional: ${campaign.additionalInstructions}` : ""}

Generate 8-12 varied Google search queries. Mix:
- Industry + location combinations
- Specific service + city combinations
- "near me" style queries for major cities in the location
- Niche sub-categories of the industry

Return ONLY a JSON array of strings. Example:
["solar installation companies Texas", "residential solar installers Austin TX"]`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  return parseJSON(text);
}

// ── Stage 2: Qualify a company against campaign criteria ──────────────────────

export async function qualifyCompany(
  company: {
    name: string;
    website?: string | null;
    location?: string | null;
    description?: string | null;
    servicesOffered: string[];
    extractedContent?: any;
  },
  campaign: {
    industry: string;
    location: string;
    companySize?: string | null;
    services: string[];
    exclusions: string[];
    additionalInstructions?: string | null;
  }
): Promise<{
  status: "QUALIFIED" | "MAYBE" | "DISQUALIFIED";
  score: number;
  reason: string;
  matchingCriteria: string[];
  missingInfo: string[];
}> {
  const model = getModel();
  const content = company.extractedContent
    ? JSON.stringify(company.extractedContent).slice(0, 4000)
    : "No website content extracted";

  const prompt = `Evaluate this company against the target ICP. Be strict but fair.

COMPANY:
Name: ${company.name}
Website: ${company.website || "Unknown"}
Location: ${company.location || "Unknown"}
Description: ${company.description || "None"}
Services Found: ${company.servicesOffered.join(", ") || "None"}
Website Content Summary: ${content}

TARGET ICP:
Industry: ${campaign.industry}
Location: ${campaign.location}
Company Size: ${campaign.companySize || "Any"}
Target Services: ${campaign.services.join(", ") || "General"}
Exclusions: ${campaign.exclusions.join(", ") || "None"}
${campaign.additionalInstructions ? `Additional: ${campaign.additionalInstructions}` : ""}

Rules:
- Do NOT fabricate information. If something cannot be verified, list it under missingInfo.
- Score 0-100 based on how well the company matches.
- DISQUALIFIED if it clearly doesn't match (wrong industry, is a manufacturer not installer, is a national corporation when we want local, etc.)
- MAYBE if there's not enough info to decide
- QUALIFIED if it matches well

Return ONLY JSON:
{
  "status": "QUALIFIED" | "MAYBE" | "DISQUALIFIED",
  "score": 0-100,
  "reason": "one paragraph explanation",
  "matchingCriteria": ["matches found"],
  "missingInfo": ["things we couldn't verify"]
}`;

  const result = await model.generateContent(prompt);
  return parseJSON(result.response.text());
}

// ── Stage 3: Analyze website for marketing/CRO opportunities ─────────────────

export async function analyzeWebsite(
  company: {
    name: string;
    website?: string | null;
    servicesOffered: string[];
    extractedContent?: any;
  },
  campaignIndustry: string
): Promise<{
  strengths: string[];
  weaknesses: string[];
  conversionIssues: string[];
}> {
  const model = getModel();
  const content = company.extractedContent
    ? JSON.stringify(company.extractedContent).slice(0, 5000)
    : "No content available";

  const prompt = `Analyze this ${campaignIndustry} company's website from a performance marketing perspective.

Company: ${company.name}
Website: ${company.website || "Unknown"}
Services: ${company.servicesOffered.join(", ")}
Website Content: ${content}

Evaluate for:
- CTA quality (weak, generic, or strong)
- Lead capture (forms, quote requests, phone CTAs)
- Landing page quality (dedicated service pages vs generic)
- Trust signals (reviews, certifications, awards)
- Mobile experience signals
- Conversion journey clarity
- Offer positioning
- Location/service-area targeting

Be honest. If the website appears strong, say so. Do NOT manufacture problems.
Only list issues you can observe from the provided content.

Return ONLY JSON:
{
  "strengths": ["specific strengths observed"],
  "weaknesses": ["specific weaknesses observed"],
  "conversionIssues": ["specific conversion problems"]
}`;

  const result = await model.generateContent(prompt);
  return parseJSON(result.response.text());
}

// ── Stage 4: Generate personalized marketing opportunity ─────────────────────

export async function generateOpportunity(
  company: {
    name: string;
    website?: string | null;
    servicesOffered: string[];
    websiteStrengths: string[];
    websiteWeaknesses: string[];
    conversionIssues: string[];
    googleAdsStatus?: string | null;
    metaAdsStatus?: string | null;
  }
): Promise<{
  opportunity: string;
  evidence: string;
}> {
  const model = getModel();
  const prompt = `Create ONE concise, personalized marketing opportunity for this company.

Company: ${company.name}
Website: ${company.website || "Unknown"}
Services: ${company.servicesOffered.join(", ")}
Website Strengths: ${company.websiteStrengths.join(", ") || "None identified"}
Website Weaknesses: ${company.websiteWeaknesses.join(", ") || "None identified"}
Conversion Issues: ${company.conversionIssues.join(", ") || "None identified"}
Google Ads: ${company.googleAdsStatus || "Unknown"}
Meta Ads: ${company.metaAdsStatus || "Unknown"}

Rules:
- Reference something SPECIFIC discovered during research
- Do NOT use generic statements like "you could improve your digital marketing"
- Keep it to 2-3 sentences max
- If the website appears strong, acknowledge that and suggest optimization rather than fixing

Return ONLY JSON:
{
  "opportunity": "the personalized observation/pitch angle",
  "evidence": "the specific evidence supporting this observation"
}`;

  const result = await model.generateContent(prompt);
  return parseJSON(result.response.text());
}

// ── Stage 5: Select best decision-maker from candidates ──────────────────────

export async function selectDecisionMaker(
  candidates: { name: string; title: string; source: string; linkedinUrl?: string }[],
  companyName: string
): Promise<{
  selected: { name: string; title: string; linkedinUrl?: string; confidence: string; reason: string } | null;
}> {
  if (!candidates.length) return { selected: null };

  const model = getModel();
  const prompt = `Select the best decision-maker to contact at ${companyName} for a performance marketing pitch.

Candidates:
${candidates.map((c, i) => `${i + 1}. ${c.name} - ${c.title} (source: ${c.source})${c.linkedinUrl ? ` [LinkedIn: ${c.linkedinUrl}]` : ""}`).join("\n")}

Priority order:
1. Founder / Co-Founder
2. CEO / Owner / President
3. Head of Marketing / Marketing Director / CMO
4. Senior growth/sales/marketing decision-maker

Select ONE person. If none are clearly relevant, return null.

Return ONLY JSON:
{
  "selected": {
    "name": "Full Name",
    "title": "Their Title",
    "linkedinUrl": "url or null",
    "confidence": "HIGH" | "MEDIUM" | "LOW",
    "reason": "why this person"
  }
}
Or if none suitable: {"selected": null}`;

  const result = await model.generateContent(prompt);
  return parseJSON(result.response.text());
}
