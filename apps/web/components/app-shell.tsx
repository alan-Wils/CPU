"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "../lib/auth";

const nav = [
  { href: "/", label: "Home" },
  { href: "/cultivation", label: "Cultivation" },
  { href: "/extraction", label: "Extraction" },
  { href: "/packaging", label: "Packaging" },
  { href: "/data-hub", label: "Data Hub" },
  { href: "/logs", label: "Logs" },
  { href: "/config", label: "Config" }
];

export function AppShell({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, clearSession } = useAuth();

  return (
    <main className="min-h-screen bg-[#020617] text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-5 md:px-6">
        <header className="mb-6 rounded-[22px] border border-slate-700/70 bg-gradient-to-r from-[#0a1533] via-[#101f44] to-[#22365d] p-4 shadow-[0_14px_34px_rgba(2,6,23,0.6)]">
          <nav className="mb-3 flex flex-wrap gap-2">
            {nav.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  className={`min-w-[140px] rounded-[14px] border px-4 py-2 text-center text-sm font-bold ${
                    active
                      ? "border-purple-400/80 bg-[#6d28d9] text-white shadow-[0_0_0_1px_rgba(167,139,250,0.4)]"
                      : "border-slate-600 bg-[#111d3d] text-slate-100 hover:bg-[#1a2a4f]"
                  }`}
                  href={item.href}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Link
              href="/admin"
              className={`min-w-[140px] rounded-[14px] border px-4 py-2 text-center text-sm font-bold ${
                pathname === "/admin"
                  ? "border-purple-400/80 bg-[#6d28d9] text-white"
                  : "border-slate-600 bg-[#111d3d] text-slate-100 hover:bg-[#1a2a4f]"
              }`}
            >
              Admin
            </Link>
            <button
              className="min-w-[96px] rounded-[14px] border border-red-400/70 bg-[#991b1b] px-4 py-2 text-sm font-bold text-white hover:bg-[#b91c1c]"
              onClick={() => {
                clearSession();
                router.push("/login");
              }}
              type="button"
            >
              Logout
            </button>
          </div>
        </header>

        <section className="mb-5 text-center">
          <h1 className="text-4xl font-extrabold tracking-tight text-white">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-slate-300">{subtitle}</p> : null}
        </section>
        {children}
      </div>
    </main>
  );
}
