/**
 * テクニカル軸の adapter
 *  /api/quote の daily 配列から
 *  パターン検出を実行し SUB_CELLS.technical の各セルにスコアを割り当てる。
 */
import type { CellPatch } from './earnings';
import { detectMaTrend, detectStage, detectCupWithHandle, detectBreakout, detect52wPosition } from '@/lib/patterns';
import type { OHLC } from '@/lib/patterns';

function patternToScore(detected: boolean, confidence: number, baseHit = 80, baseMiss = 30): number {
  return detected ? Math.round(baseHit + (100 - baseHit) * confidence) : Math.round(baseMiss * (1 - confidence));
}

export function buildTechnicalPatches(daily: OHLC[]): CellPatch[] {
  const patches: CellPatch[] = [];

  const trend = detectMaTrend(daily);
  patches.push({
    label: '移動平均(25/75/200)',
    value: trend.detail ?? '',
    score: trend.detail?.includes('上昇') ? 90 : trend.detail?.includes('下降') ? 20 : 50,
  });
  patches.push({
    label: 'トレンド判定',
    value: trend.detail ?? '',
    score: trend.detail?.includes('上昇') ? 85 : trend.detail?.includes('下降') ? 25 : 50,
  });

  const stage = detectStage(daily);
  patches.push({
    label: 'ステージ分析(1-4)',
    value: stage.detail ?? '',
    score: stage.detail?.includes('2') ? 90 : stage.detail?.includes('1') ? 60 : stage.detail?.includes('3') ? 40 : 15,
  });

  const cup = detectCupWithHandle(daily);
  patches.push({
    label: 'カップウィズハンドル',
    value: cup.detected ? '検出' : '未検出',
    score: patternToScore(cup.detected, cup.confidence),
    memo: cup.detail,
  });

  const breakout = detectBreakout(daily);
  patches.push({
    label: 'ブレイクアウト判定',
    value: breakout.detected ? '検出' : '通常',
    score: patternToScore(breakout.detected, breakout.confidence),
    memo: breakout.detail,
  });

  const wk = detect52wPosition(daily);
  patches.push({
    label: '52週高安位置',
    value: `${wk.position.toFixed(0)}%`,
    score: Math.min(100, Math.round(wk.position)),
  });

  return patches;
}
