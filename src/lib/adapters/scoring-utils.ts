/**
 * 数値→0-100 スコアの変換ユーティリティ。
 * しきい値ベースで 0/30/60/80/100 のレンジに丸める。
 */

export interface Bands {
  /** 値が低いほど評価が良い（PER, PBR 等） or 高いほど評価が良い (成長率 等) */
  direction: 'higher_better' | 'lower_better';
  /** [低, 中, 高, 最高] のしきい値 (higher_better なら昇順) */
  bands: [number, number, number, number];
}

export function bandScore(value: number, spec: Bands): number {
  if (!Number.isFinite(value)) return 0;
  const v = spec.direction === 'higher_better' ? value : -value;
  const b = spec.direction === 'higher_better' ? spec.bands : spec.bands.map((x) => -x);
  if (v >= b[3]) return 100;
  if (v >= b[2]) return 80;
  if (v >= b[1]) return 60;
  if (v >= b[0]) return 30;
  return 0;
}

/** 線形補間で 0..100 に正規化 */
export function linearScore(value: number, min: number, max: number, opts?: { invert?: boolean }): number {
  if (!Number.isFinite(value)) return 0;
  const clamped = Math.max(min, Math.min(max, value));
  const ratio = (clamped - min) / (max - min);
  return Math.round((opts?.invert ? 1 - ratio : ratio) * 100);
}

/** 直近値と過去値の比較で「過熱/割安」を判定 */
export function relativeBandScore(latest: number, baseline: number): number {
  if (!Number.isFinite(latest) || !Number.isFinite(baseline) || baseline === 0) return 0;
  const ratio = latest / baseline;
  if (ratio > 1.5) return 90;
  if (ratio > 1.2) return 70;
  if (ratio > 0.8) return 50;
  if (ratio > 0.5) return 30;
  return 10;
}
