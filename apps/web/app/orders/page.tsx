import { redirect } from "next/navigation";

/**
 * Wholesale **Orders** live in the NexBatch app (repo-root Next.js). This workspace (`@cpu/web`)
 * is a lightweight satellite; when `NEXT_PUBLIC_NEXBATCH_APP_URL` is set (e.g. production Vercel URL for NexBatch),
 * `/orders` here forwards users to the canonical screen.
 */
export default function CpuWebOrdersPage() {
  const base = (process.env.NEXT_PUBLIC_NEXBATCH_APP_URL || "").trim().replace(/\/+$/, "");
  if (base)
    redirect(`${base}/orders`);

  return (
    <main style={{ padding: 32, fontFamily: "system-ui,sans-serif", maxWidth: 640, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22 }}>Orders</h1>
      <p style={{ lineHeight: 1.55, color: "#334155" }}>
        LeafLink wholesale orders are available in the main NexBatch application. Run that app locally (typically on
        port 3000), open <code>/orders</code>, and set <code>NEXT_PUBLIC_NEXBATCH_APP_URL</code> in this package if you want this route to
        redirect automatically.
      </p>
    </main>
  );
}
