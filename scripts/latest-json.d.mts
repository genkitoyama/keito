/** The types of latest-json.mjs, for the tests. */
export interface Latest {
  version: string;
  pub_date: string;
  platforms: Record<string, { url: string; signature: string }>;
}
export function withPlatform(latest: Latest | null, version: string, platform: string, url: string, signature: string, now?: Date): Latest;
