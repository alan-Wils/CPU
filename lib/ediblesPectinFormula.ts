/**
 * Re-export Melt-to-Make pectin math for the root Next.js app (edibles kitchen UI).
 * Prefer importing from here so kitchen code stays discoverable.
 */
export {
  additiveMassFractionFromGoals,
  estimatedGummyWeightGramsFromMoldMl,
  planPectinMultiAdditiveBatch,
  planPectinSingleAdditiveBatch,
  type PectinAdditiveLineInput,
  type PectinMultiAdditiveInput,
  type PectinMultiAdditivePlan,
  type PectinSingleAdditiveInput,
  type PectinSingleAdditivePlan,
} from "@cpu/shared";
