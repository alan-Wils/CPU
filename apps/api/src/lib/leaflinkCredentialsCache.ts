import { memoizedRead, invalidateMemoPrefix } from "./requestMemoCache.js";
import type { LeafLinkResolvedCredentials } from "../services/leaflinkService.js";

const TTL_MS = 60_000;

export function leafLinkCredentialsCacheKey(companyId: string): string {
  return `leaflink:creds:${companyId}`;
}

export async function cachedLeafLinkCredentials(
  companyId: string,
  loader: () => Promise<LeafLinkResolvedCredentials>,
): Promise<LeafLinkResolvedCredentials> {
  return memoizedRead(leafLinkCredentialsCacheKey(companyId), TTL_MS, loader);
}

export function invalidateLeafLinkCredentialsCache(companyId: string): void {
  invalidateMemoPrefix(leafLinkCredentialsCacheKey(companyId));
}
