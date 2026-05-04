import type { Asset } from '@livefolio/sdk';

/**
 * Resolves a v0.4 `Asset` to the FRED series ID for the `series/observations`
 * endpoint. Currently only `MacroAsset` is supported — the FRED API has no
 * concept of equities, options, futures, etc.
 *
 * Pure. No I/O.
 */
export function assetToFredSeriesId(asset: Asset): string {
  switch (asset.kind) {
    case 'macro':
      return asset.id;
    default: {
      const kind = (asset as { kind: string }).kind;
      const id = (asset as { id: string }).id;
      throw new Error(`assetToFredSeriesId: unsupported asset kind="${kind}" id="${id}"`);
    }
  }
}
