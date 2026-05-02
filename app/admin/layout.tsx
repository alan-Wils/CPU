"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isLoggedIn } from "@/lib/auth";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!isLoggedIn()) {
      const path = pathname || "/admin";
      const search =
        typeof window !== "undefined" ? window.location.search || "" : "";
      const next = encodeURIComponent(`${path}${search}`);
      router.replace(`/login?next=${next}`);
    }
  }, [mounted, pathname, router]);

  if (!mounted) {
    return (
      <main
        style={{
          minHeight: "40vh",
          background: "#020617",
          color: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <p style={{ color: "#94a3b8" }}>Loading…</p>
      </main>
    );
  }

  if (!isLoggedIn()) {
    return (
      <main
        style={{
          minHeight: "100vh",
          background: "#020617",
          color: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <p style={{ color: "#94a3b8" }}>Redirecting to sign in…</p>
      </main>
    );
  }

  return <>{children}</>;
}
