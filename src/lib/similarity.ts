/**
 * 銘柄間の類似度（コサイン類似度）
 *  ベクトル: 8軸の中心スコア [earnings, finance, valuation, technical, industry, macro, attention, shikiho]
 *  欠損は 0 とみなす（中性扱い）
 */

import type { AxisId, Stock } from '@/domain/types';

const AXIS_ORDER: AxisId[] = [
  'earnings', 'finance', 'valuation', 'technical',
  'industry', 'macro', 'attention', 'shikiho',
];

export function stockVector(stock: Stock): number[] {
  return AXIS_ORDER.map((axis) => {
    const m = stock.subs[axis];
    const c = m?.cells[4]?.score;
    return typeof c === 'number' ? c : 0;
  });
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface SimilarStock {
  ticker: string;
  name: string;
  similarity: number;
  totalScore: number | null;
}

export function findSimilarStocks(target: Stock, all: Stock[], topN = 3): SimilarStock[] {
  const targetVec = stockVector(target);
  const scored = all
    .filter((s) => s.ticker !== target.ticker)
    .map((s) => ({
      ticker: s.ticker,
      name: s.name,
      similarity: cosineSimilarity(targetVec, stockVector(s)),
      totalScore: typeof s.root.cells[4].score === 'number' ? s.root.cells[4].score : null,
    }))
    .sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, topN);
}
