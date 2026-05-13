import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/analytics — list all post analytics for current user
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const analytics = await prisma.postAnalytics.findMany({
    where: { userId: session.user.id },
    orderBy: { fetchedAt: "desc" },
    take: 20,
  });

  return NextResponse.json({ analytics });
}
