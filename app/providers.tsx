"use client";

import { SessionProvider } from "next-auth/react";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider
      // Prevent aggressive refetching on tab focus which causes CLIENT_FETCH_ERROR
      // during dev server restarts (gets HTML instead of JSON)
      refetchOnWindowFocus={false}
      refetchInterval={5 * 60} // revalidate session every 5 minutes max
    >
      {children}
    </SessionProvider>
  );
}
