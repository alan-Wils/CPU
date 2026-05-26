import { prisma } from "../config/prisma.js";

export type MetrcLocationUpsertRow = {
  metrcLocationId: string;
  licenseNumber: string;
  name: string;
  locationTypeId: number | null;
  locationTypeName: string;
  forPlants: boolean;
  forHarvests: boolean;
  forPackages: boolean;
  rawPayloadJson: string;
  lastSyncedAt: Date;
};

export type MetrcLocationAutoMappingRow = {
  metrcLocationId: string;
  nexbatchRoomSuite: string;
  nexbatchRoomId: string;
};

export async function upsertMetrcLocationsForCompany(
  companyId: string,
  rows: MetrcLocationUpsertRow[],
): Promise<number> {
  if (!rows.length) return 0;
  await prisma.$transaction(
    rows.map((row) =>
      prisma.metrcLocation.upsert({
        where: {
          companyId_metrcLocationId: {
            companyId,
            metrcLocationId: row.metrcLocationId,
          },
        },
        create: {
          companyId,
          metrcLocationId: row.metrcLocationId,
          licenseNumber: row.licenseNumber,
          name: row.name,
          locationTypeId: row.locationTypeId,
          locationTypeName: row.locationTypeName,
          forPlants: row.forPlants,
          forHarvests: row.forHarvests,
          forPackages: row.forPackages,
          rawPayloadJson: row.rawPayloadJson,
          lastSyncedAt: row.lastSyncedAt,
        },
        update: {
          licenseNumber: row.licenseNumber,
          name: row.name,
          locationTypeId: row.locationTypeId,
          locationTypeName: row.locationTypeName,
          forPlants: row.forPlants,
          forHarvests: row.forHarvests,
          forPackages: row.forPackages,
          rawPayloadJson: row.rawPayloadJson,
          lastSyncedAt: row.lastSyncedAt,
        },
      }),
    ),
  );
  return rows.length;
}

export async function listMetrcLocationsForCompany(companyId: string) {
  return prisma.metrcLocation.findMany({
    where: { companyId },
    orderBy: [{ name: "asc" }, { metrcLocationId: "asc" }],
  });
}

export async function listMetrcPlantCapableLocations(companyId: string) {
  return prisma.metrcLocation.findMany({
    where: { companyId, forPlants: true },
    orderBy: [{ name: "asc" }, { metrcLocationId: "asc" }],
  });
}

export async function listMetrcHarvestCapableLocations(companyId: string) {
  return prisma.metrcLocation.findMany({
    where: { companyId, forHarvests: true },
    orderBy: [{ name: "asc" }, { metrcLocationId: "asc" }],
  });
}

export async function findMetrcLocationById(companyId: string, metrcLocationId: string) {
  const id = String(metrcLocationId || "").trim();
  if (!id) return null;
  return prisma.metrcLocation.findUnique({
    where: {
      companyId_metrcLocationId: { companyId, metrcLocationId: id },
    },
  });
}

export async function findMetrcLocationByName(companyId: string, name: string) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return null;
  const rows = await prisma.metrcLocation.findMany({ where: { companyId } });
  const lower = trimmed.toLowerCase();
  return rows.find((r) => r.name.trim().toLowerCase() === lower) ?? null;
}

export async function applyAutoMetrcLocationMappings(
  companyId: string,
  rows: MetrcLocationAutoMappingRow[],
): Promise<number> {
  if (!rows.length) return 0;
  await prisma.$transaction(
    rows.map((row) =>
      prisma.metrcLocation.updateMany({
        where: {
          companyId,
          metrcLocationId: row.metrcLocationId,
          nexbatchMappingManual: false,
          nexbatchRoomId: null,
        },
        data: {
          nexbatchRoomSuite: row.nexbatchRoomSuite,
          nexbatchRoomId: row.nexbatchRoomId,
          nexbatchMappingManual: false,
        },
      }),
    ),
  );
  return rows.length;
}

export async function updateMetrcLocationMapping(input: {
  companyId: string;
  metrcLocationId: string;
  nexbatchRoomSuite: string | null;
  nexbatchRoomId: string | null;
  nexbatchMappingManual: boolean;
}) {
  return prisma.metrcLocation.update({
    where: {
      companyId_metrcLocationId: {
        companyId: input.companyId,
        metrcLocationId: input.metrcLocationId,
      },
    },
    data: {
      nexbatchRoomSuite: input.nexbatchRoomSuite,
      nexbatchRoomId: input.nexbatchRoomId,
      nexbatchMappingManual: input.nexbatchMappingManual,
    },
  });
}
