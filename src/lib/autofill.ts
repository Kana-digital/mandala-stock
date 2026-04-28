/**
 * 軸ごとに API → adapter を走らせて、サブマンダラの cells に
 * patch を適用するクライアント側ヘルパ。
 *
 * 使い方:
 *   import { autofillAxis } from '@/lib/autofill';
 *   const updatedSub = await autofillAxis(stock, 'earnings');
 *   ... save ...
 */

import type { AxisId, Mandala, Stock } from '@/domain/types';
import type { CellPatch } from './adapters/earnings';
import { buildEarningsPatches } from './adapters/earnings';
import { buildMacroPatches, type MacroResponse } from './adapters/macro';
import { buildAttentionPatches } from './adapters/attention';
import { buildTechnicalPatches } from './adapters/technical';

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return (await res.json()) as T;
}

export async function fetchPatchesForAxis(stock: Stock, axis: AxisId): Promise<CellPatch[]> {
  switch (axis) {
    case 'earnings': {
      const json = await getJSON<{ latest: Parameters<typeof buildEarningsPatches>[0]; history: Parameters<typeof buildEarningsPatches>[1] }>(
        `/api/fundamental?ticker=${stock.ticker}`
      );
      return buildEarningsPatches(json.latest, json.history);
    }
    case 'macro': {
      const json = await getJSON<MacroResponse>('/api/macro');
      return buildMacroPatches(json);
    }
    case 'attention': {
      // EDINET / News / Trends を並列取得 (失敗しても他は活かす)
      const q = encodeURIComponent(stock.name);
      const [edinetRes, newsRes, trendsRes] = await Promise.allSettled([
        getJSON<Parameters<typeof buildAttentionPatches>[0]>(
          `/api/attention?ticker=${stock.ticker}&days=30`
        ),
        getJSON<Parameters<typeof buildAttentionPatches>[1]>(
          `/api/news?q=${q}&days=7`
        ),
        getJSON<Parameters<typeof buildAttentionPatches>[2]>(
          `/api/trends?keyword=${q}`
        ),
      ]);
      const edinet = edinetRes.status === 'fulfilled' ? edinetRes.value : { largeShareholderReports: [], reportCount: 0 };
      const news = newsRes.status === 'fulfilled' ? newsRes.value : undefined;
      const trends = trendsRes.status === 'fulfilled' ? trendsRes.value : undefined;
      return buildAttentionPatches(edinet, news, trends);
    }
    case 'technical': {
      const json = await getJSON<{ daily: Parameters<typeof buildTechnicalPatches>[0] }>(
        `/api/quote?ticker=${stock.ticker}&days=400`
      );
      return buildTechnicalPatches(json.daily);
    }
    case 'finance':
    case 'valuation':
    case 'industry':
    case 'shikiho':
      // Phase 2 では未対応（設計上、フェーズ3で順次追加）
      return [];
  }
}

/** Mandala の cells に patches を適用して新しい Mandala を返す */
export function applyPatches(mandala: Mandala, patches: CellPatch[], source: 'jquants' | 'edinet' | 'fred' | 'estat' | 'news' | 'trends' | 'manual' | 'boj'): Mandala {
  const now = new Date().toISOString();
  const cells = mandala.cells.map((cell) => {
    const patch = patches.find((p) => p.label === cell.label);
    if (!patch) return cell;
    return {
      ...cell,
      score: patch.score ?? cell.score,
      value: patch.value ?? cell.value,
      memo: patch.memo ?? cell.memo,
      // パッチに source 指定があればそれを優先（混在ソース軸で正確に出典を残す）
      source: patch.source ?? source,
      updatedAt: now,
    };
  }) as Mandala['cells'];
  return { ...mandala, cells };
}

/** 軸 → どのソースで埋めたかを表すラベル */
export const AXIS_SOURCE: Record<AxisId, 'jquants' | 'edinet' | 'fred' | 'estat' | 'news' | 'trends' | 'manual'> = {
  earnings: 'jquants',
  finance: 'jquants',
  valuation: 'jquants',
  technical: 'jquants',
  industry: 'manual',
  macro: 'fred',
  attention: 'edinet',
  shikiho: 'manual',
};
