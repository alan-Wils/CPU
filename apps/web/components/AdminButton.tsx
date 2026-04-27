"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getAuthUser } from "@/lib/auth";

export default function AdminButton() {
  const [showAdmin, setShowAdmin] = useState(false);

  useEffect(() => {
    const user = getAuthUser();
    const role = String(user?.role || "").toUpperCase();

    setShowAdmin(role === "ADMIN" || role === "OWNER");
  }, []);

  if (!showAdmin) return null;

  return (
    <Link
      href="/admin"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        textDecoration: "none",
        background: "rgba(168, 85, 247, 0.18)",
        color: "#d8b4fe",
        border: "1px solid rgba(168, 85, 247, 0.45)",
        borderRadius: 999,
        padding: "8px 13px",
        fontWeight: 900,
        fontSize: 14,
        marginLeft: 10,
      }}
    >
      Admin
    </Link>
  );
}
