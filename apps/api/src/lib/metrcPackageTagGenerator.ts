import { listEvaluationCreatedPackageLabels } from "./metrcEvaluationCreatedPackages.js";
import { METRC_EVALUATION_DEFAULT_PACKAGE_LABEL } from "./metrcPackageEvaluationDefaults.js";
import {
  findMetrcPackageByLabel,
  listMetrcPackagesForCompany,
} from "../repositories/metrcPackageRepository.js";
import {
  MetrcAvailablePackageTagsService,
  type MetrcAvailablePackageTagsResponse,
} from "../services/metrcAvailablePackageTagsService.js";

export type MetrcPackageTagSelectionSource = "available_metrc_tags" | "incremented_fallback";

export type SelectedSandboxPackageTag = {
  selectedPackageTag: string;
  tagSelectionSource: MetrcPackageTagSelectionSource;
  availableTagCount: number;
  excludedUsedTags: string[];
  previousPackageLabel?: string | null;
};

/** @deprecated Use SelectedSandboxPackageTag */
export type MetrcPackageTagSource = "incremented_from_latest_package" | "incremented_from_default_seed";

/** @deprecated Use SelectedSandboxPackageTag */
export type GeneratedSandboxPackageTag = {
  generatedPackageTag: string;
  packageTagSource: MetrcPackageTagSource;
  previousPackageLabel: string | null;
};

const MAX_TAG_COLLISION_ATTEMPTS = 500;

export class MetrcPackageTagUnavailableError extends Error {
  readonly licenseNumber: string;
  readonly availableTagCount: number;
  readonly excludedUsedTags: string[];

  constructor(input: {
    licenseNumber: string;
    availableTagCount: number;
    excludedUsedTags: string[];
  }) {
    super(
      `No available package tags found for license ${input.licenseNumber}. Generate or assign package tags in METRC sandbox first.`,
    );
    this.name = "MetrcPackageTagUnavailableError";
    this.licenseNumber = input.licenseNumber;
    this.availableTagCount = input.availableTagCount;
    this.excludedUsedTags = input.excludedUsedTags;
  }
}

/** Increment trailing numeric suffix while preserving zero-padding and prefix. */
export function incrementMetrcTag(label: string): string {
  const trimmed = String(label || "").trim();
  const match = trimmed.match(/^(.+?)(\d+)$/);
  if (!match) {
    return `${trimmed}000000001`;
  }
  const [, prefix, digits] = match;
  const next = (BigInt(digits) + 1n).toString();
  const padded = next.padStart(digits.length, "0");
  return `${prefix}${padded}`;
}

function matchesSandboxLicense(
  rowLicense: string,
  licenseNumber: string | null | undefined,
): boolean {
  const license = String(licenseNumber || "").trim();
  if (!license) return true;
  return rowLicense.trim().toLowerCase() === license.toLowerCase();
}

export function pickLatestSandboxPackageLabel(
  rows: Array<{ packageLabel: string; lastSyncedAt: Date; licenseNumber: string }>,
  licenseNumber?: string | null,
): string | null {
  const filtered = rows.filter(
    (row) =>
      String(row.packageLabel || "").trim().length > 0 &&
      matchesSandboxLicense(row.licenseNumber, licenseNumber),
  );
  if (!filtered.length) return null;

  const sorted = [...filtered].sort((a, b) => {
    const syncDiff = b.lastSyncedAt.getTime() - a.lastSyncedAt.getTime();
    if (syncDiff !== 0) return syncDiff;
    return b.packageLabel.localeCompare(a.packageLabel);
  });
  return sorted[0]?.packageLabel.trim() ?? null;
}

/** GET /tags/v2/package/available — package tags only (METRC inventory). */
export async function getAvailablePackageTags(
  companyId: string,
  licenseNumber: string,
  tagsService: MetrcAvailablePackageTagsService = new MetrcAvailablePackageTagsService(),
): Promise<MetrcAvailablePackageTagsResponse> {
  return tagsService.fetchLabels({
    companyId,
    licenseNumber,
    limit: 500,
  });
}

/** Tags already consumed in NexBatch (synced packages + prior evaluation create-test). */
export async function collectExcludedUsedPackageTags(input: {
  companyId: string;
  licenseNumber?: string | null;
}): Promise<Set<string>> {
  const excluded = new Set<string>();

  const rows = await listMetrcPackagesForCompany(input.companyId);
  for (const row of rows) {
    const label = String(row.packageLabel || "").trim();
    if (!label) continue;
    if (!matchesSandboxLicense(row.licenseNumber, input.licenseNumber)) continue;
    excluded.add(label);
  }

  const evaluationLabels = await listEvaluationCreatedPackageLabels(input.companyId);
  for (const label of evaluationLabels) {
    if (label) excluded.add(label);
  }

  excluded.add(METRC_EVALUATION_DEFAULT_PACKAGE_LABEL);
  return excluded;
}

async function generateIncrementedFallbackTag(input: {
  companyId: string;
  licenseNumber?: string | null;
}): Promise<SelectedSandboxPackageTag> {
  const rows = await listMetrcPackagesForCompany(input.companyId);
  const latestLabel = pickLatestSandboxPackageLabel(rows, input.licenseNumber);
  const previousPackageLabel = latestLabel;
  const seedLabel = latestLabel ?? METRC_EVALUATION_DEFAULT_PACKAGE_LABEL;
  let candidate = incrementMetrcTag(seedLabel);

  for (let attempt = 0; attempt < MAX_TAG_COLLISION_ATTEMPTS; attempt += 1) {
    const existing = await findMetrcPackageByLabel(input.companyId, candidate);
    if (!existing) {
      return {
        selectedPackageTag: candidate,
        tagSelectionSource: "incremented_fallback",
        availableTagCount: 0,
        excludedUsedTags: [],
        previousPackageLabel,
      };
    }
    candidate = incrementMetrcTag(candidate);
  }

  throw new Error(
    `Unable to allocate an unused sandbox package tag after ${MAX_TAG_COLLISION_ATTEMPTS} attempts.`,
  );
}

/**
 * Pick a METRC-available package tag, excluding labels already used in NexBatch.
 * Falls back to incrementing only when the METRC tags endpoint is unavailable (404).
 */
export async function selectSandboxPackageTag(input: {
  companyId: string;
  licenseNumber: string;
  tagsService?: MetrcAvailablePackageTagsService;
}): Promise<SelectedSandboxPackageTag> {
  const licenseNumber = String(input.licenseNumber || "").trim();
  if (!licenseNumber) {
    throw new Error("Facility license number is required to select a package tag.");
  }

  const excluded = await collectExcludedUsedPackageTags({
    companyId: input.companyId,
    licenseNumber,
  });
  const excludedUsedTags = [...excluded].sort();

  const tagsResult = await getAvailablePackageTags(
    input.companyId,
    licenseNumber,
    input.tagsService,
  );

  if (tagsResult.ok === true) {
    const available = tagsResult.labels.filter((label) => {
      const normalized = String(label || "").trim();
      return normalized && !excluded.has(normalized);
    });

    const selected = available[0];
    if (!selected) {
      throw new MetrcPackageTagUnavailableError({
        licenseNumber,
        availableTagCount: tagsResult.labels.length,
        excludedUsedTags,
      });
    }

    return {
      selectedPackageTag: selected,
      tagSelectionSource: "available_metrc_tags",
      availableTagCount: tagsResult.labels.length,
      excludedUsedTags,
    };
  }

  if (tagsResult.status === 404) {
    const fallback = await generateIncrementedFallbackTag({
      companyId: input.companyId,
      licenseNumber,
    });
    return {
      ...fallback,
      excludedUsedTags,
    };
  }

  throw new Error(tagsResult.message || "Failed to fetch available METRC package tags.");
}

/** @deprecated Use selectSandboxPackageTag */
export async function generateNextUnusedSandboxPackageTag(input: {
  companyId: string;
  licenseNumber?: string | null;
}): Promise<GeneratedSandboxPackageTag> {
  const licenseNumber = String(input.licenseNumber || "").trim();
  const selected = await selectSandboxPackageTag({
    companyId: input.companyId,
    licenseNumber,
  });
  return {
    generatedPackageTag: selected.selectedPackageTag,
    packageTagSource:
      selected.tagSelectionSource === "available_metrc_tags"
        ? "incremented_from_latest_package"
        : "incremented_from_default_seed",
    previousPackageLabel: selected.previousPackageLabel ?? null,
  };
}
