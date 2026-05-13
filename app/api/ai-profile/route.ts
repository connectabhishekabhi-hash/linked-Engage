export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/ai-profile — fetch the current user's AI writing profile
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const profile = await (prisma.userAIProfile as any).findUnique({
      where: { userId: session.user.id },
    });
    return NextResponse.json({ profile: profile ?? null });
  } catch {
    return NextResponse.json({ profile: null });
  }
}

// PUT /api/ai-profile — create or update the AI writing profile
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const {
    writingStyle,
    toneDescription,
    exampleComment,
    language,
    negativeKeywords,
    additionalInstructions,
  } = await req.json();

  try {
    const profile = await (prisma.userAIProfile as any).upsert({
      where:  { userId: session.user.id },
      create: {
        userId: session.user.id,
        writingStyle:           writingStyle?.trim()            || null,
        toneDescription:        toneDescription?.trim()         || null,
        exampleComment:         exampleComment?.trim()          || null,
        language:               language?.trim()                || null,
        negativeKeywords:       negativeKeywords?.trim()        || null,
        additionalInstructions: additionalInstructions?.trim()  || null,
      },
      update: {
        writingStyle:           writingStyle?.trim()            || null,
        toneDescription:        toneDescription?.trim()         || null,
        exampleComment:         exampleComment?.trim()          || null,
        language:               language?.trim()                || null,
        negativeKeywords:       negativeKeywords?.trim()        || null,
        additionalInstructions: additionalInstructions?.trim()  || null,
      },
    });
    return NextResponse.json({ profile });
  } catch (err: any) {
    console.error("[ai-profile] PUT error:", err);
    return NextResponse.json({ error: "Failed to save profile." }, { status: 500 });
  }
}
