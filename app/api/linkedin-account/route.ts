import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encryptCookie } from "@/lib/crypto";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { liAt } = await req.json();

  if (!liAt || typeof liAt !== "string" || liAt.trim().length < 20) {
    return NextResponse.json({ error: "Invalid cookie value" }, { status: 400 });
  }

  const { encrypted, iv } = encryptCookie(liAt.trim());

  await prisma.linkedInAccount.upsert({
    where: { userId: session.user.id },
    create: {
      userId: session.user.id,
      encryptedCookie: encrypted,
      cookieIv: iv,
      isActive: true,
      lastVerifiedAt: new Date(),
    },
    update: {
      encryptedCookie: encrypted,
      cookieIv: iv,
      isActive: true,
      lastVerifiedAt: new Date(),
    },
  });

  return NextResponse.json({ success: true });
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [account, user] = await Promise.all([
    prisma.linkedInAccount.findUnique({
      where: { userId: session.user.id },
      select: { isActive: true, lastVerifiedAt: true, linkedinProfileUrl: true, linkedinMemberId: true, tokenExpiry: true },
    }),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { apiToken: true },
    }),
  ]);

  return NextResponse.json({
    connected: !!account?.isActive,
    account,
    apiToken: user?.apiToken ?? null,
  });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.linkedInAccount.updateMany({
    where: { userId: session.user.id },
    data: { isActive: false },
  });

  return NextResponse.json({ success: true });
}
