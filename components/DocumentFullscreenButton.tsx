"use client";

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import {
  exitDocumentFullscreen,
  isDocumentFullscreen,
  requestDocumentFullscreen,
  setWantsFullscreen,
} from "@/lib/documentFullscreen";

type Props = {
  style?: CSSProperties;
  /** When false, nothing is rendered (e.g. SSR or unsupported). */
  enabled?: boolean;
};

/**
 * Toggles browser fullscreen (hides the Windows taskbar / macOS menu bar while active).
 * Persists intent in sessionStorage so navigation can try to re-enter fullscreen (see GlobalDocumentFullscreenButton).
 */
export default function DocumentFullscreenButton({ style, enabled = true }: Props) {
  const [active, setActive] = useState(false);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    const el = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
      mozRequestFullScreen?: () => Promise<void>;
    };
    const ok =
      typeof el.requestFullscreen === "function" ||
      typeof el.webkitRequestFullscreen === "function" ||
      typeof el.mozRequestFullScreen === "function";
    setSupported(ok);
  }, []);

  useEffect(() => {
    const sync = () => setActive(isDocumentFullscreen());
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    sync();
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);

  const toggle = useCallback(async () => {
    try {
      if (isDocumentFullscreen()) {
        setWantsFullscreen(false);
        await exitDocumentFullscreen();
      } else {
        await requestDocumentFullscreen();
        if (isDocumentFullscreen()) setWantsFullscreen(true);
      }
    } catch {
      /* Unsupported, denied, or not a user gesture */
    }
  }, []);

  if (!enabled || !supported) return null;

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      style={style}
      title={active ? "Exit full screen" : "Full screen (hides system taskbar)"}
      aria-label={active ? "Exit full screen" : "Enter full screen"}
      aria-pressed={active}
    >
      {active ? <CompressIcon /> : <ExpandIcon />}
    </button>
  );
}

function ExpandIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

function CompressIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 14v3a2 2 0 0 0 2 2h3M4 10V7a2 2 0 0 1 2-2h3M20 14v3a2 2 0 0 1-2 2h-3M20 10V7a2 2 0 0 0-2-2h-3" />
    </svg>
  );
}
