export type LeafLinkCompanyConfig = {
  integrationEnabled: boolean;
  companySlug: string;
  companyId: string;
  username: string;
  /** Write-only from UI; never returned by API reads. */
  apiKey?: string;
  baseUrl: string;
  /** LeafLink company-staff row id for payment `recorded_by`; null = auto from API list when possible. */
  recordedByStaffId: number | null;
};

export const defaultLeafLinkCompanyConfig: LeafLinkCompanyConfig = {
  integrationEnabled: false,
  companySlug: "",
  companyId: "",
  username: "",
  apiKey: "",
  baseUrl: "https://app.leaflink.com/api",
  recordedByStaffId: null,
};

export type LeafLinkConfigReadDto = Omit<LeafLinkCompanyConfig, "apiKey"> & {
  hasApiKey: boolean;
};

