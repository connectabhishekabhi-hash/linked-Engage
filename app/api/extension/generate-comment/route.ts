/**
 * POST /api/extension/generate-comment
 * ─────────────────────────────────────
 * Called by the Chrome extension (content.js → background.js relay)
 * when the user clicks "Draft with AI" on a LinkedIn comment box.
 *
 * Authenticates via the extension token, loads the user's AI profile,
 * merges with popup preferences, calls Gemini, returns a single comment.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const runtime = "nodejs";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");

  if (!token) {
    return NextResponse.json({ error: "Missing auth token" }, { status: 401 });
  }

  // Auth: find user by extension token (without aiProfile first)
  const user = await prisma.user.findFirst({
    where: { extensionToken: token },
    select: { id: true },
  });

  if (!user) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  // Try to load AI profile — table may not exist yet (migration pending)
  let profile: {
    writingStyle?: string | null;
    toneDescription?: string | null;
    exampleComment?: string | null;
    language?: string | null;
    negativeKeywords?: string | null;
    additionalInstructions?: string | null;
  } | null = null;

  try {
    profile = await prisma.userAIProfile.findUnique({
      where: { userId: user.id },
    });
  } catch {
    // Table doesn't exist yet — proceed without AI profile
    console.log("[generate-comment] UserAIProfile table not available, using defaults");
  }

  // ── Parse request body ────────────────────────────────────────────────────
  const body = await req.json();
  const {
    authorName = "Unknown",
    authorHeadline = "",
    postText = "",
    preferences = {},
  } = body;

  if (!postText.trim()) {
    return NextResponse.json({ error: "Post text is empty" }, { status: 400 });
  }

  const {
    length = "standard",
    tone = "professional",
    useEmojis = false,
    askQuestion = false,
  } = preferences;
  const voiceLines: string[] = [];

  if (profile?.language) voiceLines.push(`Language: Write in ${profile.language}.`);
  if (profile?.writingStyle) voiceLines.push(`Writing style: ${profile.writingStyle}`);
  if (profile?.toneDescription) voiceLines.push(`Tone: ${profile.toneDescription}`);
  if (profile?.exampleComment) {
    voiceLines.push(
      `Here is an example comment the user has written — match this voice closely:\n"${profile.exampleComment}"`
    );
  }
  if (profile?.additionalInstructions) {
    voiceLines.push(`Additional instructions: ${profile.additionalInstructions}`);
  }

  let negativeBlock = "";
  if (profile?.negativeKeywords?.trim()) {
    const keywords = profile.negativeKeywords
      .split(",")
      .map((k: string) => k.trim())
      .filter(Boolean);
    if (keywords.length) {
      negativeBlock = `\nNEVER use any of the following words or phrases: ${keywords.map((k: string) => `"${k}"`).join(", ")}.`;
    }
  }

  const voiceBlock = voiceLines.length
    ? `\n── USER'S VOICE & STYLE ──\n${voiceLines.join("\n")}`
    : "";

  // ── Length + tone from popup prefs ────────────────────────────────────────
  const lengthGuide = length === "brief"
    ? "Keep the comment to 1 sentence (under 20 words)."
    : "Keep the comment to 2-3 sentences (under 40 words).";

  const toneGuide = `Tone: ${tone}. Write in a ${tone} manner.`;

  const emojiGuide = useEmojis
    ? "You may use 1-2 relevant emojis."
    : "Do NOT use any emojis.";

  const questionGuide = askQuestion
    ? "End the comment with a thoughtful, open-ended question."
    : "Do not end with a question.";

  const prompt = `You are writing a LinkedIn comment on behalf of a real person.
Your output must sound exactly like that person — human, specific, never robotic or salesy.
${voiceBlock}

Rules:
- ${lengthGuide}
- ${toneGuide}
- ${emojiGuide}
- ${questionGuide}
- Reference something SPECIFIC from the post — no generic praise like "great post" or "love this".
- Add genuine insight, a relevant question, or a personal angle.${negativeBlock}

Return ONLY the comment text — no quotes, no labels, no markdown, no explanation.

──── POST CONTEXT ────
Author: ${authorName}
${authorHeadline ? `Headline: ${authorHeadline}` : ""}
Post: ${postText.slice(0, 600)}`;

  // ── Call Gemini ───────────────────────────────────────────────────────────
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(prompt);
    let comment = result.response.text().trim();

    // Strip any accidental markdown wrapping
    comment = comment
      .replace(/^```[\s\S]*?\n/, "")
      .replace(/\n```$/, "")
      .replace(/^["']|["']$/g, "")
      .trim();

    return NextResponse.json({ comment });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown Gemini error";
    console.error("[generate-comment] Gemini error:", message);
    return NextResponse.json(
      { error: `AI generation failed: ${message}` },
      { status: 500 }
    );
  }
}
