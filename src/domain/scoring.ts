import type { AxisId, Judgement, Mandala, Score, Stock } from './types';
import { ROOT_AXES } from './seed';

/** 周囲8マスの加重平均 → 中心セル（小計または総合）スコア */
export function computeCenterScore(m: Mandala): Score | undefined {
  const surroundIdx = [0, 1, 2, 3, 5, 6, 7, 8];
  const scored = surroundIdx
    .map((i, k) => ({ score: m.cells[i].score, w: m.weights[k] }))
    .filter(s => typeof s.score === 'number');
  if (scored.length === 0) return undefined;
  const totalW = scored.reduce((a, b) => a + b.w, 0);
  const sum = scored.reduce((a, b) => a + (b.score as number) * b.w, 0);
  return Math.round(sum / totalW);
}

/** 子マンダラ（第2階層）の小計スコアを各軸ごとに集計し、第1階層の対応マスへ反映した Stock を返す */
export function recomputeStock(stock: Stock): Stock {
  const newSubs = { ...stock.subs };
  const newRootCells = [...stock.root.cells] as Mandala['cells'];

  for (let i = 0; i < 9; i++) {
    if (i === 4) continue;
    const axisId = ROOT_AXES[i].id;
    if (axisId === null) continue;
    const sub = newSubs[axisId];
    if (!sub) continue;
    const subScore = computeCenterScore(sub);
    // 子マンダラの中心セルにも反映
    sub.cells[4] = { ...sub.cells[4], score: subScore };
    // 第1階層マスに反映
    newRootCells[i] = { ...newRootCells[i], score: subScore };
  }

  const totalScore = computeCenterScore({ ...stock.root, cells: newRootCells });
  newRootCells[4] = { ...newRootCells[4], score: totalScore };

  return {
    ...stock,
    root: { ...stock.root, cells: newRootCells },
    subs: newSubs,
    updatedAt: new Date().toISOString(),
  };
}

export function judgement(score: Score | undefined, buyTh = 80, holdTh = 60): Judgement | undefined {
  if (typeof score !== 'number') return undefined;
  if (score >= buyTh) return 'buy';
  if (score >= holdTh) return 'hold';
  return 'sell';
}

export function judgementLabel(j: Judgement | undefined): string {
  if (j === 'buy') return '買い';
  if (j === 'hold') return '中立';
  if (j === 'sell') return '見送り';
  return '—';
}

/** スコア → カラー（和モダン×ネオン パレット） */
export function scoreColor(score: Score | undefined): {
  bg: string; ring: string; text: string;
} {
  if (typeof score !== 'number') return { bg: 'bg-ink-800', ring: 'ring-ink-700', text: 'text-slate-400' };
  if (score >= 80) return { bg: 'bg-gradient-to-br from-gold to-gold-dark', ring: 'ring-gold', text: 'text-ink-950' };
  if (score >= 60) return { bg: 'bg-gradient-to-br from-jade to-jade-dark', ring: 'ring-jade', text: 'text-white' };
  if (score >= 40) return { bg: 'bg-gradient-to-br from-slate-600 to-slate-700', ring: 'ring-slate-500', text: 'text-white' };
  return { bg: 'bg-gradient-to-br from-violet-950 to-cinnabar-dark', ring: 'ring-cinnabar', text: 'text-white' };
}

/** 全72マス中、入力済みのスコアの数を返す（コンプリート率表示用） */
export function completionCount(stock: Stock): { filled: number; total: number } {
  let filled = 0;
  let total = 0;
  for (const axis of ROOT_AXES) {
    if (axis.id === null) continue;
    const sub = stock.subs[axis.id];
    if (!sub) continue;
    for (let i = 0; i < 9; i++) {
      if (i === 4) continue;
      total++;
      if (typeof sub.cells[i].score === 'number') filled++;
    }
  }
  return { filled, total };
}
