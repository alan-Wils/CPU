import {
    hasAppPermission,
    isElevatedManagerRole,
    isOwnerOrAdminRole,
    type AppPagePermissionId,
} from "../../lib/appPermissions.js";

export const SECTION_CALENDAR_SECTIONS = ["cultivation", "extraction", "packaging", "edibles"] as const;
export type SectionCalendarSection = (typeof SECTION_CALENDAR_SECTIONS)[number];

const ROLE_LEVELS: Record<string, number> = {
    VIEW_ONLY: 1,
    CULTIVATION: 2,
    CULTIVATION_SPECIALIST: 2,
    EXTRACTION: 2,
    EXTRACTION_SPECIALIST: 2,
    PACKAGING: 2,
    PACKAGING_SPECIALIST: 2,
    EDIBLES: 2,
    EDIBLES_MANAGER: 3,
    OPERATIONS_MANAGER: 3,
    MANAGER: 3,
    ADMIN: 4,
    OWNER: 5,
};

function normalizeRole(role: string): string {
    return String(role || "")
        .trim()
        .replace(/\s+/g, " ")
        .toUpperCase();
}

function sectionPagePermission(section: SectionCalendarSection): AppPagePermissionId {
    if (section === "cultivation")
        return "page.cultivation";
    if (section === "extraction")
        return "page.extraction";
    if (section === "edibles")
        return "page.edibles";
    return "page.packaging";
}

/** Floor roles that match extraction/packaging page gate (includes VIEW_ONLY read). */
function roleMatchesExtractionOrPackagingFloor(role: string, section: SectionCalendarSection): boolean {
    const r = normalizeRole(role);
    if (section === "extraction")
        return r === "EXTRACTION" || r === "EXTRACTION_SPECIALIST" || r === "VIEW_ONLY";
    if (section === "packaging")
        return r === "PACKAGING" || r === "PACKAGING_SPECIALIST" || r === "VIEW_ONLY";
    if (section === "edibles")
        return r === "EDIBLES" || r === "EDIBLES_MANAGER" || r === "VIEW_ONLY";
    return false;
}

function roleMatchesCultivationFloor(role: string): boolean {
    const r = normalizeRole(role);
    return r === "CULTIVATION" || r === "CULTIVATION_SPECIALIST";
}

function legacyManagerUp(role: string): boolean {
    const tier = ROLE_LEVELS[normalizeRole(role)];
    return typeof tier === "number" && tier >= ROLE_LEVELS.MANAGER;
}

export function parseSectionCalendarSection(raw: string): SectionCalendarSection | null {
    const s = String(raw || "").trim().toLowerCase();
    if (s === "cultivation" || s === "extraction" || s === "packaging" || s === "edibles")
        return s;
    return null;
}

export function monthYmdBounds(monthYyyyMm: string): { fromYmd: string; toYmd: string } {
    const m = String(monthYyyyMm || "").trim();
    const match = /^(\d{4})-(\d{2})$/.exec(m);
    if (!match)
        throw new Error("Invalid month");
    const y = Number(match[1]);
    const mo = Number(match[2]);
    if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12)
        throw new Error("Invalid month");
    const fromYmd = `${match[1]}-${match[2]}-01`;
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const toYmd = `${match[1]}-${match[2]}-${String(last).padStart(2, "0")}`;
    return { fromYmd, toYmd };
}

export function canReadSectionCalendar(params: {
    role: string;
    permissions: string[] | undefined;
    section: SectionCalendarSection;
}): boolean {
    const { role: rawRole, permissions, section } = params;
    const role = normalizeRole(rawRole);
    if (isOwnerOrAdminRole(role) || isElevatedManagerRole(role))
        return true;
    if (legacyManagerUp(role))
        return true;
    const perm = sectionPagePermission(section);
    if (hasAppPermission(permissions, perm))
        return true;
    if (section === "cultivation" && roleMatchesCultivationFloor(role))
        return true;
    if ((section === "extraction" || section === "packaging" || section === "edibles") &&
        roleMatchesExtractionOrPackagingFloor(role, section))
        return true;
    return false;
}

export function canWriteSectionCalendar(params: {
    role: string;
    permissions: string[] | undefined;
    section: SectionCalendarSection;
}): boolean {
    const role = normalizeRole(params.role);
    if (role === "VIEW_ONLY")
        return false;
    if (isOwnerOrAdminRole(role) || isElevatedManagerRole(role))
        return true;
    if (legacyManagerUp(role))
        return true;
    const perm = sectionPagePermission(params.section);
    if (hasAppPermission(params.permissions, perm))
        return true;
    if (params.section === "cultivation" && roleMatchesCultivationFloor(role))
        return true;
    if (params.section === "extraction") {
        return role === "EXTRACTION" || role === "EXTRACTION_SPECIALIST";
    }
    if (params.section === "packaging") {
        return role === "PACKAGING" || role === "PACKAGING_SPECIALIST";
    }
    if (params.section === "edibles") {
        return role === "EDIBLES" || role === "EDIBLES_MANAGER";
    }
    return false;
}
