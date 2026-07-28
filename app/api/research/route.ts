export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateSearchQueries } from "@/lib/ai-research";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { name, industry, location, companySize, services, exclusions, targetCount, additionalInstructions } = body;

    if (!name?.trim() || !industry?.trim() || !location?.trim())
      return NextResponse.json({ error: "Name, industry, and location are required" }, { status: 400 });

    const campaign = await (prisma as any).researchCampaign.create({
      data: {
        userId: session.user.id,
        name: name.trim(),
        industry: industry.trim(),
        location: location.trim(),
        companySize: companySize?.trim() || null,
        services: Array.isArray(services) ? services.filter(Boolean) : [],
        exclusions: Array.isArray(exclusions) ? exclusions.filter(Boolean) : [],
        targetCount: Math.min(Math.max(1, targetCount || 30), 100),
        additionalInstructions: additionalInstructions?.trim() || null,
        status: "DRAFT",
      },
    });

    return NextResponse.json({ campaign }, { status: 201 });
  } catch (err: any) {
    console.error("[research] POST error:", err);
    return NextResponse.json({ error: err?.message ?? "Failed to create campaign" }, { status: 500 });
  }
}

export async function GET(_req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const campaigns = await (prisma as any).researchCampaign.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return NextResponse.json({ campaigns });
  } catch (err: any) {
    console.error("[research] GET error:", err);
    return NextResponse.json({ campaigns: [] });
  }
}
