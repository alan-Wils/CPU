import type { NexbatchRoomOption } from "./metrcNexbatchRooms.js";

export function normalizeRoomNameForMatch(name: string): string {
  return String(name || "")
    .toLowerCase()
    .replace(/\broom\b/g, " ")
    .replace(/\bthe\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokenOverlapScore(a: string, b: string): number {
  const tokensA = new Set(a.split(" ").filter(Boolean));
  const tokensB = new Set(b.split(" ").filter(Boolean));
  if (!tokensA.size || !tokensB.size) return 0;
  let overlap = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) overlap += 1;
  }
  return overlap;
}

export function scoreMetrcLocationRoomMatch(metrcName: string, room: NexbatchRoomOption): number {
  const metrcRaw = metrcName.trim().toLowerCase();
  const roomRaw = room.name.trim().toLowerCase();
  if (!metrcRaw || !roomRaw) return 0;
  if (metrcRaw === roomRaw) return 100;

  const metrcNorm = normalizeRoomNameForMatch(metrcName);
  const roomNorm = normalizeRoomNameForMatch(room.name);
  if (!metrcNorm || !roomNorm) return 0;
  if (metrcNorm === roomNorm) return 95;
  if (metrcNorm.includes(roomNorm) || roomNorm.includes(metrcNorm)) return 85;

  const overlap = tokenOverlapScore(metrcNorm, roomNorm);
  if (overlap >= 2) return 60 + overlap * 8;
  if (overlap === 1 && (metrcNorm.length <= 12 || roomNorm.length <= 12)) return 55;
  return 0;
}

/** Minimum score to auto-apply a mapping during sync (never overwrites manual mappings). */
export const METRC_LOCATION_AUTO_MATCH_MIN_SCORE = 70;

export function suggestNexbatchRoomForMetrcLocation(
  metrcName: string,
  options: NexbatchRoomOption[],
  minScore = METRC_LOCATION_AUTO_MATCH_MIN_SCORE,
): NexbatchRoomOption | null {
  let best: { option: NexbatchRoomOption; score: number } | null = null;
  for (const option of options) {
    const score = scoreMetrcLocationRoomMatch(metrcName, option);
    if (score < minScore) continue;
    if (!best || score > best.score) best = { option, score };
  }
  return best?.option ?? null;
}
