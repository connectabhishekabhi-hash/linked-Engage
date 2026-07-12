import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/leads/export — download all leads as CSV
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const leads = await prisma.lead.findMany({
    where: { userId: session.user.id },
    include: { drafts: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "desc" },
  });

  // Build CSV rows
  const headers = [
    "Name",
    "Profile URL",
    "Status",
    "Headline",
    "Bio",
    "Latest Post (excerpt)",
    "Post URL",
    "AI Comment Draft",
    "AI Connection Note",
    "Added On",
    "Updated On",
  ];

  const escape = (val: string | null | undefined) => {
    if (!val) return "";
    // Escape double-quotes and wrap in quotes if contains comma/newline/quote
    const str = val.replace(/"/g, '""');
    return `"${str}"`;
  };

  const rows = leads.map((lead: any) => {
    const comment = lead.drafts.find((d: any) => d.type === "COMMENT")?.content ?? "";
    const connNote = lead.drafts.find((d: any) => d.type === "CONNECTION_REQUEST")?.content ?? "";

    return [
      escape(lead.fullName),
      escape(lead.profileUrl),
      escape(lead.status),
      escape(lead.headline),
      escape(lead.scrapedBio),
      escape((lead.scrapedPost ?? "").slice(0, 200)),
      escape(lead.scrapedPostUrl),
      escape(comment),
      escape(connNote),
      escape(lead.createdAt.toISOString()),
      escape(lead.updatedAt.toISOString()),
    ].join(",");
  });

  const csv = [headers.join(","), ...rows].join("\r\n");

  const filename = `linkedengage-leads-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
