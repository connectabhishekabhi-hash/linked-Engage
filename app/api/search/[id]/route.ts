export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** GET /api/search/[id] — poll for status + results */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    const rows = await prisma.$queryRaw<any[]>`
      SELECT "id","userId","query","status","results","total","error","createdAt","updatedAt"
      FROM "LeadSearch"
      WHERE "id" = ${id} AND "userId" = ${session.user.id}
      LIMIT 1
    `;

    if (!rows.length)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ search: rows[0] });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}

/** DELETE /api/search/[id] */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    await prisma.$executeRaw`
      DELETE FROM "LeadSearch" WHERE "id" = ${id} AND "userId" = ${session.user.id}
    `;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
