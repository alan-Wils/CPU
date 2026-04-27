"use client";

import { useEffect, useState } from "react";
import { canDeleteRecords } from "@/lib/permissions";

type DeleteButtonProps = {
  onClick: () => void;
  children?: React.ReactNode;
  title?: string;
  style?: React.CSSProperties;
};

export default function DeleteButton({
  onClick,
  children = "Delete",
  title = "Delete",
  style = {},
}: DeleteButtonProps) {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    setAllowed(canDeleteRecords());
  }, []);

  if (!allowed) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        background: "#7f1d1d",
        color: "#fecaca",
        border: "1px solid #ef4444",
        borderRadius: 10,
        padding: "8px 12px",
        fontWeight: 800,
        cursor: "pointer",
        ...style,
      }}
    >
      {children}
    </button>
  );
}
