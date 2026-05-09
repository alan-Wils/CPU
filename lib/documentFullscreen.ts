/**
 * Fullscreen API helpers + session intent so we can try to re-enter fullscreen after
 * in-app navigations (many browsers exit fullscreen on route change even for SPAs).
 */

const WANTS_FULLSCREEN_KEY = "nexbatch-wants-fullscreen-v1";

type DocWithFs = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void>;
};

type ElWithFs = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void>;
  mozRequestFullScreen?: () => Promise<void>;
};

export function isDocumentFullscreen(): boolean {
  if (typeof document === "undefined") return false;
  const d = document as DocWithFs;
  return Boolean(document.fullscreenElement || d.webkitFullscreenElement);
}

export function getWantsFullscreen(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  try {
    return sessionStorage.getItem(WANTS_FULLSCREEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function setWantsFullscreen(wants: boolean): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    if (wants) sessionStorage.setItem(WANTS_FULLSCREEN_KEY, "1");
    else sessionStorage.removeItem(WANTS_FULLSCREEN_KEY);
  } catch {
    /* quota / private mode */
  }
}

export async function requestDocumentFullscreen(): Promise<void> {
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

export async function exitDocumentFullscreen(): Promise<void> {
  const d = document as DocWithFs;
  if (document.fullscreenElement && typeof document.exitFullscreen === "function") {
    await document.exitFullscreen();
    return;
  }
  if (d.webkitFullscreenElement && typeof d.webkitExitFullscreen === "function") {
    await d.webkitExitFullscreen();
  }
}

/** Best-effort re-enter after SPA navigation (may fail without user activation). */
export function tryRequestDocumentFullscreen(): void {
  if (!getWantsFullscreen() || isDocumentFullscreen()) return;
  void requestDocumentFullscreen().catch(() => {});
}
