"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Nav from "@/components/Nav";
import PageAccessGate from "@/components/PageAccessGate";
import { apiRequest, getSelectedCompanyId } from "@/lib/api";
import { getAuthUser } from "@/lib/auth";
import { store } from "@/lib/store";
import { extractRewardsFromCompanyConfig } from "@/lib/rewardsConfig";
import { extractCustomTasksRewardDefsFromCompanyConfig } from "@/lib/customTasksConfig";
import {
  buildRewardsSnapshot,
  keysForCurrentUser,
  listRewardEventsForUser,
  type LogLike,
  type RewardPointEvent,
} from "@/lib/buildRewardsSnapshot";
import { getNextRewardProgress } from "@/lib/rewardTierProgress";
import { hydrateTaskLogsFromApi, loadBackendStore } from "@/lib/backendStore";
import { hasAppPermission, isElevatedManagerRole } from "@cpu/shared";

export default function RewardsPage() {
  return (
    <PageAccessGate permission="page.rewards" allowEnrolledRewardsBypass>
      <RewardsBody />
    </PageAccessGate>
  );
}

function RewardsBody() {
  const user = getAuthUser();
  const canSee =
    Boolean(user?.rewardsEnrolled) || isElevatedManagerRole(String(user?.role || ""));
  const perms = user?.permissions ?? [];
  const hasRewardsPerm = hasAppPermission(perms, "page.rewards");

  const [ready, setReady] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [rows, setRows] = useState<{ displayName: string; totalPoints: number }[]>([]);
  const [selfBreakdown, setSelfBreakdown] = useState<{
    fastTask: number;
    potency: number;
    yieldPts: number;
    taskChallenge: number;
  } | null>(null);
  const [pointEvents, setPointEvents] = useState<RewardPointEvent[]>([]);
  const [facility, setFacility] = useState(0);
  const [windowDays, setWindowDays] = useState(30);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadBackendStore({ omitCultivation: true });
        await hydrateTaskLogsFromApi();
        const cfg = await apiRequest<unknown>("/api/config", {
          companyId: getSelectedCompanyId().trim() || undefined,
        });
        const rewards = extractRewardsFromCompanyConfig(cfg);
        const customTaskDefs = extractCustomTasksRewardDefsFromCompanyConfig(cfg);
        if (cancelled) return;
        setEnabled(rewards.enabled);
        if (!rewards.enabled) {
          setReady(true);
          return;
        }

        const logs = ((store as { logs?: unknown }).logs || []) as LogLike[];
        const dryFlowerBatches = (store as { dryFlowerBatches?: unknown[] }).dryFlowerBatches || [];
        const snap = buildRewardsSnapshot({
          rewards,
          logs,
          dryFlowerBatches,
          customTasksRewardDefs: customTaskDefs,
        });
        setRows(
          snap.individuals.map((i) => ({
            displayName: i.displayName,
            totalPoints: i.totalPoints,
          })),
        );
        setFacility(snap.facilityTotalPoints);
        setWindowDays(snap.windowDays);

        const me = getAuthUser();
        const keys = keysForCurrentUser({
          id: me?.id,
          username: me?.username,
          email: me?.email ?? null,
        });
        setPointEvents(
          listRewardEventsForUser({
            rewards,
            logs,
            userKeys: keys,
            windowDays: snap.windowDays,
            customTasksRewardDefs: customTaskDefs,
          }),
        );
        const self = snap.individuals.find((i) => keys.some((k) => i.key === k));
        setSelfBreakdown(self ? { ...self.breakdown } : null);
        const pts = self?.totalPoints ?? 0;
        const prog = getNextRewardProgress(pts, rewards.rewardItems);
        if (prog.allComplete) {
          setBanner("You have reached all configured reward levels.");
        } else if (prog.nextItem && prog.pointsAway != null) {
          setBanner(
            `You are ${prog.pointsAway} points away from earning ${prog.nextItem.label}.`,
          );
        } else {
          setBanner(null);
        }
        setReady(true);
      } catch (e) {
        console.error(e);
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const gated = useMemo(() => {
    if (!enabled) return false;
    if (!canSee) return false;
    if (!hasRewardsPerm && !user?.rewardsEnrolled) return false;
    return true;
  }, [hasRewardsPerm, enabled, canSee, user?.rewardsEnrolled]);

  if (!ready) {
    return (
      <div style={shell}>
        <Nav />
        <p style={{ color: "#94a3b8", textAlign: "center" }}>Loading…</p>
      </div>
    );
  }

  if (!gated) {
    return (
      <div style={shell}>
        <Nav />
        <p style={{ color: "#94a3b8", textAlign: "center", marginTop: 40 }}>
          Rewards are not available for your account or are disabled in Company Config.
        </p>
      </div>
    );
  }

  return (
    <div style={shell}>
      <Nav />
      <h1 style={{ textAlign: "center", marginBottom: 8 }}>Rewards</h1>
      <p style={{ textAlign: "center", color: "#94a3b8", marginBottom: 24 }}>
        Rolling window: last {windowDays} days. Points are indicative (from logs and batch data).
      </p>
      {banner ? (
        <div
          style={{
            maxWidth: 640,
            margin: "0 auto 24px",
            padding: 16,
            borderRadius: 14,
            border: "1px solid rgba(34, 197, 94, 0.45)",
            background: "rgba(6, 78, 59, 0.35)",
            color: "#e2e8f0",
            textAlign: "center",
            fontWeight: 700,
          }}
        >
          {banner}
        </div>
      ) : null}

      <section
        style={{
          maxWidth: 720,
          margin: "0 auto 28px",
          padding: 18,
          borderRadius: 16,
          border: "1px solid rgba(34, 197, 94, 0.35)",
          background: "rgba(6, 78, 59, 0.12)",
        }}
      >
        <h2 style={{ marginTop: 0, textAlign: "center", fontSize: 18 }}>Your points</h2>
        {selfBreakdown ? (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                gap: 10,
                marginBottom: 16,
              }}
            >
              <BreakdownChip
                label="Fast task bonus"
                value={selfBreakdown.fastTask}
              />
              <BreakdownChip
                label="Task challenge"
                value={selfBreakdown.taskChallenge}
              />
              <BreakdownChip label="Potency (individual)" value={selfBreakdown.potency} />
              <BreakdownChip label="Yield (individual)" value={selfBreakdown.yieldPts} />
            </div>
            <h3
              style={{
                fontSize: 15,
                color: "#94a3b8",
                fontWeight: 700,
                marginBottom: 10,
                textAlign: "center",
              }}
            >
              Where your points came from
            </h3>
            {pointEvents.length === 0 ? (
              <p style={{ color: "#94a3b8", textAlign: "center", margin: 0, fontSize: 14 }}>
                No itemized log entries in this window yet (facility potency bonuses may still apply at the snapshot
                level).
              </p>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {pointEvents.map((ev) => (
                  <div
                    key={ev.id}
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      justifyContent: "space-between",
                      gap: 8,
                      padding: "10px 12px",
                      borderRadius: 10,
                      background: "#0f172a",
                      border: "1px solid #334155",
                      alignItems: "center",
                    }}
                  >
                    <div style={{ flex: "1 1 200px" }}>
                      <div style={{ color: "#e2e8f0", fontWeight: 700 }}>{ev.label}</div>
                      <div style={{ color: "#94a3b8", fontSize: 13 }}>
                        {ev.detail}
                        {ev.at ? ` · ${formatRewardEventDate(ev.at)}` : ""}
                      </div>
                    </div>
                    <strong style={{ color: "#86efac" }}>+{Math.round(ev.points * 100) / 100} pts</strong>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <p style={{ color: "#94a3b8", textAlign: "center", margin: 0 }}>
            No task points matched to your profile in this window yet. Use the same account when logging tasks so points
            attribute correctly.
          </p>
        )}
      </section>

      <section
        style={{
          maxWidth: 720,
          margin: "0 auto 28px",
          padding: 18,
          borderRadius: 16,
          border: "1px solid #334155",
          background: "rgba(15, 23, 42, 0.85)",
        }}
      >
        <h2 style={{ marginTop: 0, textAlign: "center", fontSize: 18 }}>Facility snapshot</h2>
        <p style={{ textAlign: "center", color: "#cbd5e1", marginBottom: 0 }}>
          Total points (including facility potency bonuses):{" "}
          <strong style={{ color: "#86efac" }}>{Math.round(facility * 100) / 100}</strong>
        </p>
      </section>

      <section
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: 18,
          borderRadius: 16,
          border: "1px solid #334155",
          background: "rgba(15, 23, 42, 0.85)",
        }}
      >
        <h2 style={{ marginTop: 0, textAlign: "center", fontSize: 18 }}>Individual totals</h2>
        {rows.length === 0 ? (
          <p style={{ color: "#94a3b8", textAlign: "center" }}>No attributed task points in this window yet.</p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {rows.map((r, i) => (
              <div
                key={`${r.displayName}-${i}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "10px 12px",
                  borderRadius: 10,
                  background: "#0f172a",
                  border: "1px solid #334155",
                }}
              >
                <span>{r.displayName}</span>
                <strong style={{ color: "#93c5fd" }}>{Math.round(r.totalPoints * 100) / 100} pts</strong>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function BreakdownChip(props: { label: string; value: number }) {
  const v = Math.round(props.value * 100) / 100;
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 10,
        background: "#0f172a",
        border: "1px solid #334155",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>{props.label}</div>
      <div style={{ fontWeight: 800, color: "#93c5fd" }}>{v} pts</div>
    </div>
  );
}

function formatRewardEventDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  try {
    return new Date(t).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

const shell: CSSProperties = {
  minHeight: "100vh",
  background: "radial-gradient(circle at top, #1e293b 0, #020617 45%, #020617 100%)",
  color: "white",
  padding: 20,
};
