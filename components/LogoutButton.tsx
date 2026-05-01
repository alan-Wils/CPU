"use client";

import { useRouter } from "next/navigation";
import { clearAuthSession, getAuthUser } from "@/lib/auth";
import { useEffect, useState } from "react";

export default function LogoutButton() {
  const router = useRouter();
  const [showLogout, setShowLogout] = useState(false);

  useEffect(() => {
    const user = getAuthUser();
    setShowLogout(Boolean(user));
  }, []);

  function logout() {
    clearAuthSession();
    router.push("/login");
  }

  if (!showLogout) return null;

  return (
    <button
      type="button"
      onClick={logout}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(127, 29, 29, 0.65)",
        color: "#fecaca",
        border: "1px solid rgba(248, 113, 113, 0.55)",
        borderRadius: 999,
        padding: "8px 13px",
        fontWeight: 900,
        fontSize: 14,
        cursor: "pointer",
        marginLeft: 10,
      }}
    >
      Logout
    </button>
  );
}