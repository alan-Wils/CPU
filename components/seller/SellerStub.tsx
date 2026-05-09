"use client";

import Link from "next/link";

export default function SellerStub(props: {
  title: string;
  description?: string;
  primaryAction?: { href: string; label: string };
  secondaryAction?: { href: string; label: string };
}) {
  return (
    <div style={{ maxWidth: 820 }}>
      <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, color: "#f8fafc" }}>{props.title}</h1>
      {props.description ? (
        <p style={{ margin: "14px 0 0", color: "#94a3b8", lineHeight: 1.65, fontSize: 15 }}>{props.description}</p>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 22 }}>
        {props.primaryAction ? (
          <Link
            href={props.primaryAction.href}
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "12px 18px",
              borderRadius: 14,
              border: "1px solid rgba(167,139,250,0.55)",
              background: "linear-gradient(135deg, rgba(91,33,182,0.45), rgba(30,41,59,0.95))",
              color: "#fff",
              fontWeight: 800,
              textDecoration: "none",
            }}
          >
            {props.primaryAction.label}
          </Link>
        ) : null}
        {props.secondaryAction ? (
          <Link
            href={props.secondaryAction.href}
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "12px 18px",
              borderRadius: 14,
              border: "1px solid rgba(148,163,184,0.35)",
              background: "rgba(15,23,42,0.85)",
              color: "#e2e8f0",
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            {props.secondaryAction.label}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
