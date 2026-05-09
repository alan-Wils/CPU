"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";

/**
 * Chrome / Edge fire `beforeinstallprompt` when the page meets PWA install criteria. The event has a non-standard
 * `prompt()` + `userChoice` API that isn't in lib.dom; declare it locally rather than ambient-augmenting Window.
 */
type BeforeInstallPromptEvent = Event & {
  readonly platforms: ReadonlyArray<string>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
};

type Platform = "ios" | "android" | "desktop";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

/**
 * True when the page is rendered inside an installed PWA shell (Chromium / desktop) or pinned to the iOS Home Screen.
 * `display-mode: standalone` covers Chromium PWAs across desktop and Android; `navigator.standalone` covers iOS.
 */
function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  const navStandalone = (window.navigator as { standalone?: boolean }).standalone;
  return navStandalone === true;
}

/**
 * Small "Install App" affordance for the NexBatch homepage. Uses the native `beforeinstallprompt` flow on Chromium /
 * Edge; falls back to a platform-aware instructions modal on iOS Safari, Firefox, etc. Hides itself once the app is
 * installed and re-hides on the `appinstalled` event.
 */
export default function InstallAppButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [platform, setPlatform] = useState<Platform>("desktop");
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPlatform(detectPlatform());
    setInstalled(detectStandalone());

    const onBeforeInstallPrompt = (ev: Event) => {
      // Block Chrome's native mini-info bar so we own the surface; cache the event for our own button click.
      ev.preventDefault();
      setDeferred(ev as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setInstalled(true);
      setDeferred(null);
      setFallbackOpen(false);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt as EventListener);
    window.addEventListener("appinstalled", onAppInstalled);

    /** Catch the install -> standalone transition that some Android browsers do without firing `appinstalled`. */
    const standaloneMql = window.matchMedia?.("(display-mode: standalone)");
    const onModeChange = () => setInstalled(detectStandalone());
    standaloneMql?.addEventListener?.("change", onModeChange);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt as EventListener);
      window.removeEventListener("appinstalled", onAppInstalled);
      standaloneMql?.removeEventListener?.("change", onModeChange);
    };
  }, []);

  const handleClick = useCallback(async () => {
    if (deferred) {
      setBusy(true);
      try {
        await deferred.prompt();
        await deferred.userChoice.catch(() => null);
      } catch {
        /* user-aborted prompts throw on some browsers; safe to ignore */
      } finally {
        setDeferred(null);
        setBusy(false);
      }
      return;
    }
    setFallbackOpen(true);
  }, [deferred]);

  if (installed) return null;

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        aria-label="Install NexBatch as an app"
        style={installButtonStyle(busy)}
      >
        <DownloadIcon />
        <span>Install App</span>
      </button>
      {fallbackOpen ? (
        <InstallInstructionsModal platform={platform} onClose={() => setFallbackOpen(false)} />
      ) : null}
    </>
  );
}

function installButtonStyle(busy: boolean): CSSProperties {
  return {
    position: "fixed",
    /** Stay above the iOS home indicator and any potential bottom navs. */
    bottom: "max(16px, env(safe-area-inset-bottom))",
    right: 16,
    zIndex: 60,
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 14px",
    borderRadius: 999,
    border: "1px solid rgba(34, 211, 238, 0.45)",
    background: "linear-gradient(135deg, rgba(15,23,42,0.92), rgba(8,47,73,0.85))",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    color: "#a5f3fc",
    fontSize: 13,
    fontWeight: 800,
    letterSpacing: "-0.005em",
    cursor: busy ? "wait" : "pointer",
    boxShadow: "0 10px 30px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(34, 211, 238, 0.06) inset",
    opacity: busy ? 0.85 : 1,
    transition: "transform 120ms ease, box-shadow 200ms ease, opacity 200ms ease",
  };
}

function InstallInstructionsModal({
  platform,
  onClose,
}: {
  platform: Platform;
  onClose: () => void;
}) {
  const steps = useMemo(() => instructionsForPlatform(platform), [platform]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="presentation"
      onMouseDown={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        background: "rgba(2, 6, 23, 0.6)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Install NexBatch"
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 420,
          marginBottom: "max(16px, env(safe-area-inset-bottom))",
          background: "linear-gradient(165deg, rgba(15,23,42,0.98), rgba(2,6,23,0.98))",
          border: "1px solid rgba(34, 211, 238, 0.32)",
          borderRadius: 18,
          padding: "18px 18px 16px",
          boxShadow: "0 24px 60px rgba(0, 0, 0, 0.55)",
          color: "#e2e8f0",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: "#f8fafc" }}>{steps.title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close install instructions"
            style={{
              background: "transparent",
              border: "none",
              color: "#94a3b8",
              fontSize: 22,
              lineHeight: 1,
              cursor: "pointer",
              padding: 4,
            }}
          >
            ×
          </button>
        </div>
        <p style={{ margin: "6px 0 12px", fontSize: 13, color: "#94a3b8", lineHeight: 1.5 }}>
          {steps.subtitle}
        </p>
        <ol
          style={{
            margin: 0,
            paddingLeft: 18,
            color: "#cbd5e1",
            fontSize: 14,
            lineHeight: 1.55,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {steps.items.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function instructionsForPlatform(platform: Platform): {
  title: string;
  subtitle: string;
  items: string[];
} {
  if (platform === "ios") {
    return {
      title: "Install on iPhone",
      subtitle: "Safari can pin NexBatch to your Home Screen so it opens like an app.",
      items: ["Tap Share", "Add to Home Screen"],
    };
  }
  if (platform === "android") {
    return {
      title: "Install on Android",
      subtitle: "Chrome can install NexBatch as an app on your device.",
      items: ["Open browser menu", "Install App or Add to Home Screen"],
    };
  }
  return {
    title: "Install on Desktop",
    subtitle: "Chrome and Edge can install NexBatch as a desktop app.",
    items: ["Use the install icon in the address bar"],
  };
}

function DownloadIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3v12" />
      <path d="m6 11 6 6 6-6" />
      <path d="M5 21h14" />
    </svg>
  );
}
