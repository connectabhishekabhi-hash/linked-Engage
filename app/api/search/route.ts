export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { randomUUID } from "crypto";

/**
 * POST /api/search
 * Creates a LeadSearch row (raw SQL — works before prisma generate) + queues SEARCH job.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const {
      query,
      searchUrl         = "",   // pre-built LinkedIn URL from buildSearchUrl()
      start             = 0,
      count             = 30,
      connectionDegrees = [],
      titleFilter       = "",
      excludeFilter     = "",
    } = await req.json();
    if (!query?.trim())
      return NextResponse.json({ error: "Search query required" }, { status: 400 });

    const searchId = randomUUID();
    const now      = new Date();

    // Raw SQL — works even before `prisma generate` sees the new model
    try {
      await prisma.$executeRaw`
        INSERT INTO "LeadSearch" ("id","userId","query","status","total","createdAt","updatedAt")
        VALUES (${searchId}, ${session.user.id}, ${query.trim()}, 'RUNNING', 0, ${now}, ${now})
      `;
    } catch (dbErr: any) {
      if (
        dbErr.message?.includes("LeadSearch") ||
        dbErr.message?.includes("does not exist") ||
        dbErr.code === "42P01"
      ) {
        return NextResponse.json(
          { error: "Search table not found. Run prisma/migrations/add_lead_search.sql in Supabase first." },
          { status: 503 }
        );
      }
      throw dbErr;
    }

    // ExtensionJob requires a leadId FK — reuse any existing lead or create a placeholder
    let dummyLeadId: string;
    const anyLead = await prisma.lead.findFirst({
      where:  { userId: session.user.id },
      select: { id: true },
    });
    if (anyLead) {
      dummyLeadId = anyLead.id;
    } else {
      const placeholder = await prisma.lead.create({
        data: {
          userId:     session.user.id,
          profileUrl: `https://www.linkedin.com/__search_placeholder__/${searchId}`,
          status:     "PENDING",
        },
      });
      dummyLeadId = placeholder.id;
    }

    // Use raw SQL — Prisma's generated JobType enum doesn't include SEARCH
    // until `prisma generate` is re-run after the migration.
    const jobId      = randomUUID();
    const payloadJson = JSON.stringify({
      query:      query.trim(),
      searchUrl,              // exact URL for the extension to open
      start,
      count,
      searchId,
      connectionDegrees,
      titleFilter,            // for client-side post-filtering in the extension
      excludeFilter,          // for client-side post-filtering in the extension
    });
    await prisma.$executeRaw`
      INSERT INTO "ExtensionJob" ("id","userId","leadId","type","status","payload","createdAt","updatedAt")
      VALUES (
        ${jobId},
        ${session.user.id},
        ${dummyLeadId},
        'SEARCH'::"JobType",
        'PENDING'::"JobStatus",
        ${payloadJson}::jsonb,
        NOW(), NOW()
      )
    `;

    return NextResponse.json({ searchId }, { status: 201 });
  } catch (err: any) {
    console.error("[search] POST error:", err);
    return NextResponse.json(
      { error: `Server error: ${err?.message ?? "Unknown"}` },
      { status: 500 }
    );
  }
}

/** GET /api/search — list recent searches */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const searches = await prisma.$queryRaw<any[]>`
      SELECT "id","query","status","total","createdAt"
      FROM "LeadSearch"
      WHERE "userId" = ${session.user.id}
      ORDER BY "createdAt" DESC
      LIMIT 20
    `;
    return NextResponse.json({ searches });
  } catch {
    return NextResponse.json({ searches: [] });
  }
}
