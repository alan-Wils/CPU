/** Buyer marketplace seller-logo defaults (BudFox-style wide wordmarks). */
export const DEFAULT_BUYER_CARD_LOGO_MAX_H = 36;
export const DEFAULT_BUYER_CHIP_LOGO_MAX_H = 44;
export const DEFAULT_BUYER_MODAL_LOGO_MAX_H = 40;
/** When using default card sizing, cap width so horizontal wordmarks do not dominate the card. */
export const DEFAULT_BUYER_CARD_LOGO_MAX_W = 200;

/** Persisted in `sales.marketplaceBuyerCardLogoMaxHeightPx`; 0 = use default. */
export function clampMarketplaceBuyerCardLogoMaxHeightPx(n: unknown): number {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return 0;
  return Math.min(120, Math.max(40, Math.round(x)));
}

/** Persisted in `sales.marketplaceBuyerChipLogoMaxHeightPx`; 0 = use default. */
export function clampMarketplaceBuyerChipLogoMaxHeightPx(n: unknown): number {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return 0;
  return Math.min(120, Math.max(36, Math.round(x)));
}

export function resolveBuyerCardLogoMaxHeight(configured: number | null | undefined): number {
  const n = clampMarketplaceBuyerCardLogoMaxHeightPx(configured);
  return n > 0 ? n : DEFAULT_BUYER_CARD_LOGO_MAX_H;
}

export function resolveBuyerChipLogoMaxHeight(configured: number | null | undefined): number {
  const n = clampMarketplaceBuyerChipLogoMaxHeightPx(configured);
  return n > 0 ? n : DEFAULT_BUYER_CHIP_LOGO_MAX_H;
}

/** Detail modal: scales with seller card boost, else legacy 40px. */
export function resolveBuyerModalLogoMaxHeight(cardConfigured: number | null | undefined): number {
  const boosted = clampMarketplaceBuyerCardLogoMaxHeightPx(cardConfigured);
  if (boosted > 0) {
    return Math.min(120, Math.max(40, Math.round(boosted * (DEFAULT_BUYER_MODAL_LOGO_MAX_H / DEFAULT_BUYER_CARD_LOGO_MAX_H))));
  }
  return DEFAULT_BUYER_MODAL_LOGO_MAX_H;
}

export function sellerUsesBuyerCardLogoBoost(configured: number | null | undefined): boolean {
  return clampMarketplaceBuyerCardLogoMaxHeightPx(configured) > 0;
}

export function sellerUsesBuyerChipLogoBoost(configured: number | null | undefined): boolean {
  return clampMarketplaceBuyerChipLogoMaxHeightPx(configured) > 0;
}
