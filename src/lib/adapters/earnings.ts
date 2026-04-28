/**
 * 業績軸の adapter
 *  - /api/fundamental の statements を読み、SUB_CELLS.earnings の各項目に
 *    score / value を割り当てる。
 */

import { bandScore } from './scoring-utils';

interface RawStatement {
  DisclosedDate: string;
  NetSales?: string;
  OperatingProfit?: string;
  Profit?: string;
  EarningsPerShare?: string;
  ForecastNetSales?: string;
  ForecastOperatingProfit?: string;
  ForecastEarningsPerShare?: string;
}

export interface CellPatch {
  /** SUB_CELLS.earnings 内のラベル */
  label: string;
  score?: number;
  value?: string | number;
  memo?: string;
  /** パッチ単位でソースを上書きしたい場合（混在ソース軸用） */
  source?: 'manual' | 'jquants' | 'edinet' | 'fred' | 'estat' | 'news' | 'trends' | 'boj';
}

const num = (s?: string): number => (s == null || s === '' ? NaN : Number(s));

/** 直近4期から成長率（YoY）を計算 */
function growthRate(history: RawStatement[], pick: (s: RawStatement) => number): number {
  if (history.length < 5) return NaN;
  const latest = pick(history[0]);
  const yearAgo = pick(history[4]); // 4 quarters ago
  if (!Number.isFinite(latest) || !Number.isFinite(yearAgo) || yearAgo === 0) return NaN;
  return ((latest - yearAgo) / Math.abs(yearAgo)) * 100;
}

export function buildEarningsPatches(latest: RawStatement | null, history: RawStatement[]): CellPatch[] {
  if (!latest) return [];
  const patches: CellPatch[] = [];

  // 売上高成長率
  const salesGrowth = growthRate(history, (s) => num(s.NetSales));
  patches.push({
    label: '売上高成長率',
    value: Number.isFinite(salesGrowth) ? `${salesGrowth.toFixed(1)}%` : '—',
    score: bandScore(salesGrowth, { direction: 'higher_better', bands: [0, 5, 15, 30] }),
    memo: `直近 vs 4期前`,
  });

  // 営業利益成長率
  const opGrowth = growthRate(history, (s) => num(s.OperatingProfit));
  patches.push({
    label: '営業利益成長率',
    value: Number.isFinite(opGrowth) ? `${opGrowth.toFixed(1)}%` : '—',
    score: bandScore(opGrowth, { direction: 'higher_better', bands: [0, 10, 25, 50] }),
  });

  // EPS 成長率
  const epsGrowth = growthRate(history, (s) => num(s.EarningsPerShare));
  patches.push({
    label: 'EPS成長率',
    value: Number.isFinite(epsGrowth) ? `${epsGrowth.toFixed(1)}%` : '—',
    score: bandScore(epsGrowth, { direction: 'higher_better', bands: [0, 10, 25, 50] }),
  });

  // 営業利益率
  const sales = num(latest.NetSales);
  const op = num(latest.OperatingProfit);
  const opMargin = sales > 0 ? (op / sales) * 100 : NaN;
  patches.push({
    label: '営業利益率',
    value: Number.isFinite(opMargin) ? `${opMargin.toFixed(1)}%` : '—',
    score: bandScore(opMargin, { direction: 'higher_better', bands: [0, 5, 10, 20] }),
  });

  // 通期予想進捗率（簡易版: ForecastOperatingProfit がある場合のみ）
  const forecast = num(latest.ForecastOperatingProfit);
  const progress = forecast > 0 ? (op / forecast) * 100 : NaN;
  patches.push({
    label: '通期予想進捗率',
    value: Number.isFinite(progress) ? `${progress.toFixed(1)}%` : '—',
    score: bandScore(progress, { direction: 'higher_better', bands: [25, 50, 75, 90] }),
    memo: '営業利益ベース',
  });

  return patches;
}
