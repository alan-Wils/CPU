"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "../lib/auth";

const PUBLIC_PATHS = new Set(["/login", "/accept-invite"]);

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { token, hydrated } = useAuth();
  useEffect(() => {
    if (!hydrated) return;
    if (!token && !PUBLIC_PATHS.has(pathname)) {
      router.replace("/login");
    }
  }, [token, hydrated, pathname, router]);

  if (!hydrated) {
    return <div className="p-8 text-cpu-muted">Loading session...</div>;
  }

  if (!token && !PUBLIC_PATHS.has(pathname)) {
    return null;
  }

  return <>{children}</>;
}
