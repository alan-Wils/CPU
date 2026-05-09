"use client";

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";

type DocWithFs = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void>;
};

type ElWithFs = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void>;
  mozRequestFullScreen?: () => Promise<void>;
};

function isFullscreenDoc(): boolean {
  if (typeof document === "undefined") return false;
  const d = document as DocWithFs;
  return Boolean(document.fullscreenElement || d.webkitFullscreenElement);
}

async function enterFullscreen(): Promise<void> {
  const el = document.documentElement as ElWithFs;
  if (typeof el.requestFullscreen === "function") {
    await el.requestFullscreen();
    return;
  }
  if (typeof el.webkitRequestFullscreen === "function") {
    await el.webkitRequestFullscreen();
    return;
  }
  if (typeof el.mozRequestFullScreen === "function") {
    await el.mozRequestFullScreen();
  }
}

async function exitFullscreen(): Promise<void> {
  const d = document as DocWithFs;
  if (document.fullscreenElement && typeof document.exitFullscreen === "function") {
    await document.exitFullscreen();
    return;
  }
  if (d.webkitFullscreenElement && typeof d.webkitExitFullscreen === "function") {
    await d.webkitExitFullscreen();
  }
}

type Props = {
  style?: CSSProperties;
  /** When false, nothing is rendered (e.g. SSR or unsupported). */
  enabled?: boolean;
};

/**
 * Toggles browser fullscreen (hides the Windows taskbar / macOS menu bar while active).
 * Must be triggered by a user gesture; browsers may ignore programmatic fullscreen otherwise.
 */
export default function DocumentFullscreenButton({ style, enabled = true }: Props) {
  const [active, setActive] = useState(false);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    const el = document.documentElement as ElWithFs;
    const ok =
      typeof el.requestFullscreen === "function" ||
      typeof el.webkitRequestFullscreen === "function" ||
      typeof el.mozRequestFullScreen === "function";
    setSupported(ok);
  }, []);

  useEffect(() => {
    const sync = () => setActive(isFullscreenDoc());
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
      if (isFullscreenDoc()) await exitFullscreen();
      else await enterFullscreen();
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
