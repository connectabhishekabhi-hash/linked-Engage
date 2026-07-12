import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import ApprovalInbox from "@/components/ApprovalInbox";

async function getDashboardData(userId: string) {
  const [leads, account] = await Promise.all([
    prisma.lead.findMany({
      where: {
        userId,
        status: { in: ["AWAITING_APPROVAL", "ENGAGED", "FAILED", "SCRAPING"] },
      },
      include: { drafts: { orderBy: { createdAt: "desc" } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.linkedInAccount.findUnique({
      where: { userId },
      select: { isActive: true },
    }),
  ]);

  return { leads, isConnected: !!account?.isActive };
}

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");

  const { leads, isConnected } = await getDashboardData(session.user.id);
  const typedLeads = leads as any[];

  const stats = {
    scraping: typedLeads.filter((l) => l.status === "SCRAPING").length,
    awaiting: typedLeads.filter((l) => l.status === "AWAITING_APPROVAL").length,
    engaged:  typedLeads.filter((l) => l.status === "ENGAGED").length,
  };

  const inboxLeads = typedLeads.filter((l) => l.status === "AWAITING_APPROVAL");

  return (
    <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Inbox</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Review and send AI-drafted comments & connection requests
        </p>
      </div>

      {/* LinkedIn not connected warning */}
      {!isConnected && (
        <div className="flex items-start gap-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
          <span className="text-amber-500 mt-0.5">⚠</span>
          <div>
            <p className="text-sm font-medium text-amber-800">LinkedIn not connected</p>
            <p className="text-xs text-amber-600 mt-0.5">
              Actions will fail until you{" "}
              <Link href="/dashboard/settings" className="underline font-medium">
                connect your session
              </Link>
              .
            </p>
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Scraping",       value: stats.scraping, color: "text-blue-600",  bg: "bg-blue-50  border-blue-100"  },
          { label: "Awaiting Review",value: stats.awaiting, color: "text-amber-600", bg: "bg-amber-50 border-amber-100" },
          { label: "Engaged",        value: stats.engaged,  color: "text-green-600", bg: "bg-green-50 border-green-100" },
        ].map((s) => (
          <div key={s.label} className={`rounded-2xl p-4 text-center border ${s.bg}`}>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className={`text-xs font-medium mt-0.5 ${s.color} opacity-80`}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Inbox */}
      <ApprovalInbox leads={inboxLeads as Parameters<typeof ApprovalInbox>[0]["leads"]} />
    </div>
  );
}
