export type LeafLinkCompanyConfig = {
  integrationEnabled: boolean;
  companySlug: string;
  companyId: string;
  username: string;
  /** Write-only from UI; never returned by API reads. */
  apiKey?: string;
  baseUrl: string;
};

export const defaultLeafLinkCompanyConfig: LeafLinkCompanyConfig = {
  integrationEnabled: false,
  companySlug: "",
  companyId: "",
  username: "",
  apiKey: "",
  baseUrl: "https://app.leaflink.com/api",
};

export type LeafLinkConfigReadDto = Omit<LeafLinkCompanyConfig, "apiKey"> & {
  hasApiKey: boolean;
};

