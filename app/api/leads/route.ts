import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function parseLinkedInProfileUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl.trim());
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== "https:" || (host !== "linkedin.com" && host !== "www.linkedin.com")) {
      return null;
    }

    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments[0] !== "in" || !segments[1]) return null;

    const vanityName = decodeURIComponent(segments[1]).trim();
    if (!/^[a-zA-Z0-9\-_%]+$/.test(vanityName)) return null;

    return {
      vanityName,
      profileUrl: `https://www.linkedin.com/in/${encodeURIComponent(vanityName)}/`,
    };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { urls } = (await req.json()) as { urls: string[] };

  if (!Array.isArray(urls) || urls.length === 0) {
    return NextResponse.json({ error: "Provide at least one URL" }, { status: 400 });
  }

  const profiles = urls
    .map(parseLinkedInProfileUrl)
    .filter((profile): profile is { vanityName: string; profileUrl: string } => Boolean(profile));

  if (profiles.length === 0) {
    return NextResponse.json(
      { error: "No valid LinkedIn profile URLs found" },
      { status: 400 }
    );
  }

  const uniqueProfiles = Array.from(
    new Map(profiles.map((profile: any) => [profile.profileUrl, profile])).values()
  );

  // Upsert leads
  const created = await prisma.$transaction(
    uniqueProfiles.map(({ profileUrl }) =>
      prisma.lead.upsert({
        where: { userId_profileUrl: { userId: session.user.id, profileUrl } },
        create: { userId: session.user.id, profileUrl, status: "PENDING" },
        update: { status: "PENDING" }, // allow re-queueing failed leads
      })
    )
  );

  const vanityByProfileUrl = new Map(
    uniqueProfiles.map((profile: any) => [profile.profileUrl, profile.vanityName])
  );

  // Create an ExtensionJob for each lead — extension picks these up via polling
  await prisma.extensionJob.createMany({
    data: created.map((lead: any) => ({
      userId:  session.user.id,
      leadId:  lead.id,
      type:    "SCRAPE",
      status:  "PENDING",
      payload: {
        vanityName: vanityByProfileUrl.get(lead.profileUrl) ?? "",
      },
    })),
    skipDuplicates: true,
  });

  return NextResponse.json({
    saved: created.length,
    message: `${created.length} lead(s) queued — open LinkedIn and the extension will process them automatically.`,
  });
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const leads = await prisma.lead.findMany({
    where: { userId: session.user.id },
    include: { drafts: { orderBy: { createdAt: "desc" } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ leads });
}

// DELETE /api/leads — flush all leads for the current user
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Cascade deletes drafts and extension jobs automatically
  const result = await prisma.lead.deleteMany({
    where: { userId: session.user.id },
  });

  return NextResponse.json({ deleted: result.count });
}
