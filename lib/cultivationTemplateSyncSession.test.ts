import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCultivationTemplateFingerprint,
  markCultivationTemplateSyncDone,
  shouldSkipCultivationTemplateSync,
  clearCultivationTemplateSyncSession,
} from "./cultivationTemplateSyncSession";

function mockBrowserStorage() {
  const session = new Map<string, string>();
  const local = new Map<string, string>();
  const sessionStorage = {
    getItem: (k: string) => session.get(k) ?? null,
    setItem: (k: string, v: string) => {
      session.set(k, v);
    },
    removeItem: (k: string) => {
      session.delete(k);
    },
    clear: () => session.clear(),
    key: () => null,
    length: 0,
  };
  const localStorage = {
    getItem: (k: string) => local.get(k) ?? null,
    setItem: (k: string, v: string) => {
      local.set(k, v);
    },
    removeItem: (k: string) => {
      local.delete(k);
    },
    clear: () => local.clear(),
    key: () => null,
    length: 0,
  };
  vi.stubGlobal("sessionStorage", sessionStorage);
  vi.stubGlobal("localStorage", localStorage);
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    sessionStorage,
    localStorage,
  });
  return { session, local };
}

describe("cultivationTemplateSyncSession", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    mockBrowserStorage();
    localStorage.setItem("cpu_selected_company_id", "co-test-1");
    clearCultivationTemplateSyncSession();
  });

  it("skips sync when fingerprint already synced this session", () => {
    const fp = buildCultivationTemplateFingerprint([
      { id: "t1", stage: "clone", daysFromStageStart: 0, title: "Task" },
    ]);
    expect(shouldSkipCultivationTemplateSync(fp)).toBe(false);
    markCultivationTemplateSyncDone(fp);
    expect(shouldSkipCultivationTemplateSync(fp)).toBe(true);
  });
});
