/**
 * Catalog module entry point (B4.6).
 *
 * `getCatalogProvider()` picks the implementation from validated server env.
 * `lib/security/env` is server-only and validates at load time, so it is
 * imported lazily inside the factory — importing this module never touches
 * the environment, keeping pure helpers usable from tests and shared code.
 */
import type { CatalogProvider } from "./types";

export type { CatalogProvider, CatalogTrack } from "./types";
export type {
  ImportedTrack,
  ImportResult,
  ImportErrorCode,
} from "./import";
export {
  ImportError,
  MAX_CSV_ROWS,
  MAX_IMPORT_BYTES,
  parseLibraryCsv,
  parseRekordboxXml,
} from "./import";
export { isCamelotCompatible, parseCamelot } from "./camelot";

let cachedProvider: CatalogProvider | null = null;

/** Server-side factory: resolves the configured CatalogProvider (cached). */
export async function getCatalogProvider(): Promise<CatalogProvider> {
  if (cachedProvider) return cachedProvider;

  const { env } = await import("@/lib/security/env");
  switch (env.CATALOG_PROVIDER) {
    case "mock":
    default: {
      const { MockCatalogProvider } = await import("./mock");
      cachedProvider = new MockCatalogProvider();
      break;
    }
  }
  return cachedProvider;
}

/** Test hook: clears the cached provider so env changes take effect. */
export function resetCatalogProviderForTests(): void {
  cachedProvider = null;
}
