"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Nav from "@/components/Nav";
import PageAccessGate from "@/components/PageAccessGate";
import { apiRequest, getSelectedCompanyId } from "@/lib/api";
import { getAuthUser } from "@/lib/auth";
import { store } from "@/lib/store";
import { extractRewardsFromCompanyConfig, type RewardsSettings } from "@/lib/rewardsConfig";
import { patchLog } from "@/lib/logsApi";
import { canUserApproveTaskChallenges, isTaskChallengePendingReview } from "@/lib/taskChallengePayload";
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
  const [rewardsSettings, setRewardsSettings] = useState<RewardsSettings | null>(null);
  const [pendingChallengeLogs, setPendingChallengeLogs] = useState<LogLike[]>([]);
  const [dataRefreshKey, setDataRefreshKey] = useState(0);
  const [reviewBusyLogId, setReviewBusyLogId] = useState<string | null>(null);

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
        setRewardsSettings(rewards);
        setEnabled(rewards.enabled);
        if (!rewards.enabled) {
          setPendingChallengeLogs([]);
          setReady(true);
          return;
        }

        const logs = ((store as { logs?: unknown }).logs || []) as LogLike[];
        setPendingChallengeLogs(
          logs.filter((l) => isTaskChallengePendingReview(l.data?.taskChallenge)),
        );
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
  }, [dataRefreshKey]);

  const canReviewChallenges = useMemo(() => {
    const me = getAuthUser();
    if (!rewardsSettings || !me) return false;
    return canUserApproveTaskChallenges(me, rewardsSettings);
  }, [rewardsSettings]);

  async function resolveChallengeReview(log: LogLike, decision: "approved" | "denied") {
    const id = String(log.id || "").trim();
    if (!id) return;
    const me = getAuthUser();
    const tc = log.data?.taskChallenge;
    if (!tc || typeof tc !== "object") return;
    const o = tc as Record<string, unknown>;
    const proposed = Number(o.proposedPoints);
    setReviewBusyLogId(id);
    try {
      const nextTc =
        decision === "approved"
          ? {
              ...o,
              reviewStatus: "approved",
              pointsEarned: Number.isFinite(proposed) && proposed > 0 ? proposed : 0,
              reviewedAt: new Date().toISOString(),
              reviewedByUserId: me?.id || "",
            }
          : {
              ...o,
              reviewStatus: "denied",
              pointsEarned: 0,
              reviewedAt: new Date().toISOString(),
              reviewedByUserId: me?.id || "",
            };
      await patchLog(id, { data: { taskChallenge: nextTc } });
      await hydrateTaskLogsFromApi();
      setDataRefreshKey((k) => k + 1);
    } catch (e) {
      console.error(e);
    } finally {
      setReviewBusyLogId(null);
    }
  }

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

      {rewardsSettings?.taskChallenge.requireManagerApproval && canReviewChallenges ? (
        <section
          style={{
            maxWidth: 720,
            margin: "0 auto 28px",
            padding: 18,
            borderRadius: 16,
            border: "1px solid rgba(251, 191, 36, 0.35)",
            background: "rgba(120, 53, 15, 0.12)",
          }}
        >
          <h2 style={{ marginTop: 0, textAlign: "center", fontSize: 18 }}>Challenge approvals</h2>
          <p style={{ textAlign: "center", color: "#94a3b8", marginBottom: 16, fontSize: 14 }}>
            Approve or deny speed-challenge points submitted by staff. Denied entries stay in the log but do not award
            points.
          </p>
          {pendingChallengeLogs.length === 0 ? (
            <p style={{ color: "#94a3b8", textAlign: "center", margin: 0 }}>No pending challenge reviews.</p>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {pendingChallengeLogs.map((log) => {
                const id = String(log.id || "").trim();
                const tc = log.data?.taskChallenge as Record<string, unknown> | undefined;
                const proposed = Number(tc?.proposedPoints);
                const actor =
                  String(log.data?.loggedBy?.username || "").trim() ||
                  String(log.data?.loggedBy?.userId || "").trim() ||
                  "Unknown";
                const busy = reviewBusyLogId === id;
                const when = log.createdAt || log.time || "";
                return (
                  <div
                    key={id || `${log.area}-${log.task}-${when}`}
                    style={{
                      padding: "12px 14px",
                      borderRadius: 10,
                      background: "#0f172a",
                      border: "1px solid #334155",
                    }}
                  >
                    <div style={{ color: "#e2e8f0", fontWeight: 700, marginBottom: 6 }}>
                      {String(log.area || "—")} · {String(log.task || "Task")}
                    </div>
                    <div style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.5 }}>
                      Batch: {String(log.batch || "—")} · {actor}
                      {when ? ` · ${formatRewardEventDate(String(when))}` : ""}
                    </div>
                    <div style={{ color: "#cbd5e1", fontSize: 13, marginTop: 8 }}>
                      Proposed: <strong style={{ color: "#86efac" }}>{Math.round(proposed * 100) / 100} pts</strong>
                      {tc?.tierLabel != null ? ` · Tier: ${String(tc.tierLabel)}` : ""}
                      {tc?.normalizedMinutesPerPerson != null
                        ? ` · ${Number(tc.normalizedMinutesPerPerson).toFixed(1)} min/person`
                        : ""}
                    </div>
                    {!id ? (
                      <p style={{ color: "#f87171", fontSize: 13, marginTop: 10 }}>This log has no server id yet.</p>
                    ) : (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => resolveChallengeReview(log, "approved")}
                          style={{
                            padding: "8px 16px",
                            borderRadius: 8,
                            border: "none",
                            background: busy ? "#334155" : "#16a34a",
                            color: "#fff",
                            fontWeight: 700,
                            cursor: busy ? "default" : "pointer",
                          }}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => resolveChallengeReview(log, "denied")}
                          style={{
                            padding: "8px 16px",
                            borderRadius: 8,
                            border: "1px solid #64748b",
                            background: "#1e293b",
                            color: "#e2e8f0",
                            fontWeight: 700,
                            cursor: busy ? "default" : "pointer",
                          }}
                        >
                          Deny
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
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
