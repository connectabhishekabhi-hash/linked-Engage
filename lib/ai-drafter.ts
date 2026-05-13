import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export interface ScrapedPost {
  text:        string;
  url:         string;
  activityUrn: string;
}

export interface AIProfile {
  writingStyle?:           string | null;
  toneDescription?:        string | null;
  exampleComment?:         string | null;
  language?:               string | null;
  negativeKeywords?:       string | null;
  additionalInstructions?: string | null;
}

interface DraftInput {
  fullName: string;
  headline: string;
  bio:      string;
  posts:    ScrapedPost[];
  profile?: AIProfile | null; // personalised voice — optional
}

export interface GeneratedDrafts {
  comments:       string[]; // one per post, same order as posts[]
  connectionNote: string;
}

export async function generateDrafts(input: DraftInput): Promise<GeneratedDrafts> {
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const commentCount  = Math.max(1, input.posts.length);
  const p             = input.profile;

  // ── Build the voice/style instructions block ─────────────────────────────
  const voiceLines: string[] = [];

  if (p?.language) {
    voiceLines.push(`Language: Write in ${p.language}.`);
  }
  if (p?.writingStyle) {
    voiceLines.push(`Writing style: ${p.writingStyle}`);
  }
  if (p?.toneDescription) {
    voiceLines.push(`Tone: ${p.toneDescription}`);
  }
  if (p?.exampleComment) {
    voiceLines.push(
      `Here is an example comment the user has written — match this voice closely:\n"${p.exampleComment}"`
    );
  }
  if (p?.additionalInstructions) {
    voiceLines.push(`Additional instructions: ${p.additionalInstructions}`);
  }

  // ── Build the negative-keyword block ────────────────────────────────────
  let negativeBlock = "";
  if (p?.negativeKeywords?.trim()) {
    const keywords = p.negativeKeywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    if (keywords.length) {
      negativeBlock = `\nNEVER use any of the following words or phrases: ${keywords.map((k) => `"${k}"`).join(", ")}.`;
    }
  }

  const voiceBlock = voiceLines.length
    ? `\n── USER'S VOICE & STYLE ──\n${voiceLines.join("\n")}`
    : "";

  // ── Posts section ─────────────────────────────────────────────────────────
  const postsSection = input.posts.length > 0
    ? input.posts.map((p, i) => `Post ${i + 1}: ${p.text.slice(0, 400)}`).join("\n\n")
    : "No posts available";

  const prompt = `You are writing LinkedIn comments and a connection note on behalf of a real person.
Your output must sound exactly like that person — human, specific, never robotic or salesy.
${voiceBlock}

Rules for comments:
- Under 40 words each.
- Reference something SPECIFIC to that post — no generic praise like "great post" or "love this".
- Adds genuine insight, a relevant question, or a personal angle.
- Match the user's voice and style exactly if provided.${negativeBlock}

Rules for connection note:
- Under 300 characters.
- Reference something specific from their profile or posts.
- No pitch, no "I'd love to connect" clichés.
- Match the user's voice.${negativeBlock}

Return ONLY a valid JSON object — no markdown, no code fences, no extra text.
Shape: { "comments": [${Array.from({ length: commentCount }, (_, i) => `"comment for post ${i + 1}"`).join(", ")}], "connectionNote": "..." }

──── TARGET PERSON ────
Name: ${input.fullName}
Headline: ${input.headline}
Bio: ${input.bio?.slice(0, 300) || "Not available"}

${postsSection}`;

  const result  = await model.generateContent(prompt);
  const text    = result.response.text().trim();

  // Strip markdown code fences if Gemini wraps output
  const stripped  = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const jsonMatch = stripped.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    console.error("[ai-drafter] Gemini raw response:", text);
    throw new Error("No JSON found in Gemini response");
  }

  const parsed = JSON.parse(jsonMatch[0]) as { comments?: string[]; connectionNote?: string };

  const comments = input.posts.map((_, i) =>
    parsed.comments?.[i] ??
    parsed.comments?.[0] ??
    "Interesting perspective — what drove you to this approach?"
  );

  return {
    comments,
    connectionNote:
      parsed.connectionNote ??
      `Saw your work on ${input.headline} — would love to connect.`,
  };
}
