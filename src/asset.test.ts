import { describe, it, expect } from 'vitest';
import type { Asset } from '@livefolio/sdk';
import { assetToFredSeriesId } from './asset';

describe('assetToFredSeriesId', () => {
  it('returns asset.id for a macro asset', () => {
    const asset: Asset = { kind: 'macro', id: 'DGS10', symbol: '10Y Treasury' };
    expect(assetToFredSeriesId(asset)).toBe('DGS10');
  });

  it('throws for an equity asset, mentioning kind and id', () => {
    const asset: Asset = { kind: 'equity', id: 'AAPL', symbol: 'AAPL' };
    expect(() => assetToFredSeriesId(asset)).toThrow(/kind="equity"/);
    expect(() => assetToFredSeriesId(asset)).toThrow(/id="AAPL"/);
  });

  it('throws for an unknown kind', () => {
    const asset = { kind: 'crypto', id: 'btc', symbol: 'BTC-USD' } as unknown as Asset;
    expect(() => assetToFredSeriesId(asset)).toThrow(/kind="crypto"/);
  });
});
