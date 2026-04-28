/**
 * バックテスト
 *  入力: 銘柄の Snapshot 列 + 過去株価 (J-Quants /api/quote)
 *  処理: 各 Snapshot 日からの N 日先リターンを計算
 *        スコア × 後リターンの相関係数を算出
 *  出力: 「総合スコアが N 以上だった時の勝率と平均リターン」
 */

import type { Snapshot } from '@/domain/types';

export interface BacktestPoint {
  date: string;
  totalScore: number;
  closeAtDate: number;
  closeAtFuture: number;
  returnPct: number;
}

export interface BacktestResult {
  windowDays: number;
  points: BacktestPoint[];
  winRate: number;       // 上昇した割合 (0-1)
  avgReturn: number;     // 平均リターン (%)
  /** 総合スコアと将来リターンのピアソン相関係数 */
  correlation: number;
  /** スコア >= 80 の時の勝率と平均リターン */
  highScore: { count: number; winRate: number; avgReturn: number };
}

interface DailyClose {
  date: string;
  c: number | null;
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n === 0) return 0;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  if (dx === 0 || dy === 0) return 0;
  return num / Math.sqrt(dx * dy);
}

/** 同じ日付の終値を引く（無ければ近い未来日を使う） */
function closeOnOrAfter(daily: DailyClose[], date: string): { date: string; c: number } | null {
  for (const d of daily) {
    if (d.date >= date && d.c != null) return { date: d.date, c: d.c };
  }
  return null;
}

export function runBacktest(snapshots: Snapshot[], daily: DailyClose[], windowDays = 20): BacktestResult {
  const points: BacktestPoint[] = [];
  for (const sn of snapshots) {
    const at = closeOnOrAfter(daily, sn.date);
    if (!at) continue;
    const futureDate = new Date(at.date);
    futureDate.setDate(futureDate.getDate() + windowDays);
    const futureStr = futureDate.toISOString().slice(0, 10);
    const future = closeOnOrAfter(daily, futureStr);
    if (!future) continue;
    const ret = ((future.c - at.c) / at.c) * 100;
    points.push({
      date: sn.date,
      totalScore: sn.totalScore,
      closeAtDate: at.c,
      closeAtFuture: future.c,
      returnPct: ret,
    });
  }
  const wins = points.filter((p) => p.returnPct > 0).length;
  const avg = points.length > 0 ? points.reduce((s, p) => s + p.returnPct, 0) / points.length : 0;
  const correlation = pearson(points.map((p) => p.totalScore), points.map((p) => p.returnPct));

  const high = points.filter((p) => p.totalScore >= 80);
  const highWins = high.filter((p) => p.returnPct > 0).length;
  const highAvg = high.length > 0 ? high.reduce((s, p) => s + p.returnPct, 0) / high.length : 0;

  return {
    windowDays,
    points,
    winRate: points.length > 0 ? wins / points.length : 0,
    avgReturn: avg,
    correlation,
    highScore: {
      count: high.length,
      winRate: high.length > 0 ? highWins / high.length : 0,
      avgReturn: highAvg,
    },
  };
}
