/**
 * Shape from METRC GET /facilities/v2/ example response (see state API docs).
 * `FacilityType` is capability flags only; readable type is `License.LicenseType`.
 */
export const METRC_FACILITIES_V2_EXAMPLE_ROW = {
  FacilityId: 1,
  Name: "Cultivation LLC",
  DisplayName: "Cultivation on Road St",
  FacilityType: {
    IsMedical: false,
    IsRetail: true,
    CanGrowPlants: true,
    CanPackageWaste: false,
  },
  License: {
    Number: "403-X0001",
    StartDate: "2013-06-28",
    EndDate: "2015-12-28",
    LicenseType: "Medical Cultivation",
  },
} as const;

export const METRC_FACILITIES_V2_PROCESSOR_ROW = {
  Name: "SBX Centralized Processing Hub Location 1",
  FacilityType: {
    IsMedical: false,
    IsRetail: false,
    CanGrowPlants: false,
    CanRecordProcessingJobs: true,
  },
  License: {
    Number: "SF-SBX-CO-1-13402",
    LicenseType: "Processor",
  },
  IsActive: true,
} as const;
