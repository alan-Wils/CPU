export function buildMetrcPackageChangeItemBody(input: {
  packageLabel: string;
  itemName: string;
}): unknown[] {
  return [
    {
      Label: input.packageLabel,
      Item: input.itemName,
    },
  ];
}

export function buildMetrcPackageAdjustBody(input: {
  packageLabel: string;
  quantity: number;
  unitOfMeasure: string;
  adjustmentReason: string;
  adjustmentDate: string;
  reasonNote?: string | null;
}): unknown[] {
  return [
    {
      Label: input.packageLabel,
      Quantity: input.quantity,
      UnitOfMeasure: input.unitOfMeasure,
      AdjustmentReason: input.adjustmentReason,
      AdjustmentDate: input.adjustmentDate,
      ReasonNote: input.reasonNote ?? null,
    },
  ];
}

export function buildMetrcPackageFinishBody(input: {
  packageLabel: string;
  actualDate: string;
}): unknown[] {
  return [
    {
      Label: input.packageLabel,
      ActualDate: input.actualDate,
    },
  ];
}

export function buildMetrcPackageUnfinishBody(input: { packageLabel: string }): unknown[] {
  return [{ Label: input.packageLabel }];
}
