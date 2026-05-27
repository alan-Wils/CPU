export type MetrcSpreadsheetFields = {
  resultCode: number;
  licenseFacility: string;
  idNumber: string;
  lastModifiedDate: string;
  tagNumber: string;
  requestSent: string;
  minifiedJsonForSpreadsheet: string;
};

function minifyJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? "");
  }
}

export function buildMetrcSpreadsheetFields(input: {
  httpStatus: number;
  licenseNumber: string;
  packageId: string | null;
  packageLabel: string;
  requestBody: unknown;
  responsePayload: unknown;
  lastModifiedDate?: string | null;
}): MetrcSpreadsheetFields {
  const requestSent = (() => {
    try {
      return JSON.stringify(input.requestBody, null, 2);
    } catch {
      return String(input.requestBody ?? "");
    }
  })();

  const minifiedJsonForSpreadsheet = minifyJson({
    request: input.requestBody,
    response: input.responsePayload,
  });

  return {
    resultCode: input.httpStatus,
    licenseFacility: input.licenseNumber,
    idNumber: input.packageId ?? "",
    lastModifiedDate:
      input.lastModifiedDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    tagNumber: input.packageLabel,
    requestSent,
    minifiedJsonForSpreadsheet,
  };
}

export function attachSpreadsheetFieldsToResponse<T extends Record<string, unknown>>(
  payload: T,
  spreadsheetFields: MetrcSpreadsheetFields,
): T & { spreadsheetFields: MetrcSpreadsheetFields } {
  return { ...payload, spreadsheetFields };
}
