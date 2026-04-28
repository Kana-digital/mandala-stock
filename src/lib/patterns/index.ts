/**
 * チャートパターン検出ライブラリ
 * 入力: 日足 OHLCV の時系列（古い→新しい）
 * 出力: パターン検出結果と確信度（0-1）
 *
 * 実装パターン:
 *  - 移動平均線 (SMA 25/75/200) と トレンド判定
 *  - ステージ分析 (Stan Weinstein の 1〜4)
 *  - カップウィズハンドル (Cup-with-Handle)
 *  - ダブルボトム (W-bottom)
 *  - ブレイクアウト判定（直近 N 日高値抜け + 出来高増）
 *  - 52週高安からの位置
 */

export interface OHLC {
  date: string;
  o: number | null;
  h: number | null;
  l: number | null;
  c: number | null;
  v: number | null;
}

export interface PatternResult {
  name: string;
  detected: boolean;
  confidence: number; // 0-1
  detail?: string;
}

// ---- 共通ユーティリティ ----

function closes(data: OHLC[]): number[] {
  return data.map((d) => d.c).filter((x): x is number => typeof x === 'number');
}

function sma(values: number[], period: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { out.push(NaN); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    out.push(sum / period);
  }
  return out;
}

function maxIn(values: number[], from: number, to: number): { idx: number; value: number } {
  let idx = from, max = values[from];
  for (let i = from + 1; i <= to && i < values.length; i++) {
    if (values[i] > max) { max = values[i]; idx = i; }
  }
  return { idx, value: max };
}

function minIn(values: number[], from: number, to: number): { idx: number; value: number } {
  let idx = from, min = values[from];
  for (let i = from + 1; i <= to && i < values.length; i++) {
    if (values[i] < min) { min = values[i]; idx = i; }
  }
  return { idx, value: min };
}

// ---- 個別パターン検出 ----

/**
 * 移動平均トレンド判定
 *  - 25 > 75 > 200 → 上昇トレンド
 *  - 25 < 75 < 200 → 下降トレンド
 *  - その他 → レンジ
 */
export function detectMaTrend(data: OHLC[]): PatternResult {
  const c = closes(data);
  if (c.length < 200) return { name: '移動平均トレンド', detected: false, confidence: 0, detail: 'データ不足' };
  const sma25 = sma(c, 25), sma75 = sma(c, 75), sma200 = sma(c, 200);
  const i = c.length - 1;
  const a = sma25[i], b = sma75[i], d = sma200[i];
  if (a > b && b > d) return { name: '移動平均トレンド', detected: true, confidence: 0.9, detail: '上昇 (25>75>200)' };
  if (a < b && b < d) return { name: '移動平均トレンド', detected: true, confidence: 0.9, detail: '下降 (25<75<200)' };
  return { name: '移動平均トレンド', detected: true, confidence: 0.5, detail: 'レンジ / もみ合い' };
}

/**
 * ステージ分析 (Stan Weinstein)
 *  ステージ1: 底固め（200MAフラット、価格が200MA近辺）
 *  ステージ2: 上昇（200MA上向き、価格 > 200MA）
 *  ステージ3: 天井圏（200MAフラット、価格 ~ 200MA）
 *  ステージ4: 下降（200MA下向き、価格 < 200MA）
 */
export function detectStage(data: OHLC[]): PatternResult {
  const c = closes(data);
  if (c.length < 220) return { name: 'ステージ分析', detected: false, confidence: 0, detail: 'データ不足' };
  const sma200 = sma(c, 200);
  const i = c.length - 1;
  const price = c[i];
  const ma = sma200[i];
  const maPrev = sma200[i - 20];
  const slope = (ma - maPrev) / maPrev; // 1ヶ月の傾き
  const above = price > ma;
  let stage = 0;
  if (slope > 0.01 && above) stage = 2;
  else if (slope < -0.01 && !above) stage = 4;
  else if (Math.abs(slope) <= 0.01 && above) stage = 3;
  else stage = 1;
  return {
    name: 'ステージ分析',
    detected: true,
    confidence: 0.7,
    detail: `ステージ ${stage}`,
  };
}

/**
 * カップウィズハンドル (簡易版)
 *  - 直近 ~6ヶ月で底をつけ U字回復
 *  - その後 ~5%以内の浅い押し目（ハンドル）
 *  - カップ高値 > ハンドル高値 ≒ 直近価格
 */
export function detectCupWithHandle(data: OHLC[]): PatternResult {
  const c = closes(data);
  if (c.length < 130) return { name: 'カップウィズハンドル', detected: false, confidence: 0, detail: 'データ不足' };

  const N = c.length;
  const cupStart = Math.max(0, N - 130);     // ~6.5 ヶ月
  const handleStart = Math.max(0, N - 25);   // ~5 週

  const leftRim = maxIn(c, cupStart, cupStart + 20);
  const cupBottom = minIn(c, cupStart + 20, handleStart - 5);
  const rightRim = maxIn(c, handleStart - 15, handleStart);
  const handleLow = minIn(c, handleStart, N - 1);
  const latest = c[N - 1];

  const rimDiff = Math.abs(rightRim.value - leftRim.value) / leftRim.value;
  const cupDepth = (rightRim.value - cupBottom.value) / rightRim.value;
  const handleDepth = (rightRim.value - handleLow.value) / rightRim.value;

  const ok =
    rimDiff < 0.05 &&            // 左右リムが ±5%以内
    cupDepth > 0.12 && cupDepth < 0.50 && // カップ深さ 12〜50%
    handleDepth > 0 && handleDepth < 0.12 && // ハンドル浅め
    latest >= rightRim.value * 0.97; // 直近がリム近辺

  return {
    name: 'カップウィズハンドル',
    detected: ok,
    confidence: ok ? 0.7 : 0.2,
    detail: `cup ${(cupDepth*100).toFixed(1)}% / handle ${(handleDepth*100).toFixed(1)}%`,
  };
}

/**
 * ダブルボトム
 *  - 直近 ~3ヶ月で2つの安値が ±3%以内
 *  - 中間に山（高値）があり、現在は山の高値を抜けつつある
 */
export function detectDoubleBottom(data: OHLC[]): PatternResult {
  const c = closes(data);
  if (c.length < 70) return { name: 'ダブルボトム', detected: false, confidence: 0, detail: 'データ不足' };
  const N = c.length;
  const start = N - 65;
  const half = start + 30;
  const left = minIn(c, start, half);
  const right = minIn(c, half, N - 1);
  const peak = maxIn(c, left.idx, right.idx);
  const bottomDiff = Math.abs(left.value - right.value) / left.value;
  const breakingNeck = c[N - 1] >= peak.value * 0.98;
  const ok = bottomDiff < 0.03 && breakingNeck;
  return {
    name: 'ダブルボトム',
    detected: ok,
    confidence: ok ? 0.65 : 0.2,
    detail: `底値乖離 ${(bottomDiff*100).toFixed(1)}%`,
  };
}

/**
 * ブレイクアウト判定
 *  - 直近 N 日 (=20) 高値を更新
 *  - 出来高 > 20日平均出来高 × 1.5
 */
export function detectBreakout(data: OHLC[]): PatternResult {
  if (data.length < 25) return { name: 'ブレイクアウト', detected: false, confidence: 0, detail: 'データ不足' };
  const N = data.length;
  const window = data.slice(N - 21, N - 1);
  const recent = data[N - 1];
  if (recent.c == null || recent.v == null) return { name: 'ブレイクアウト', detected: false, confidence: 0 };
  const highMax = Math.max(...window.map((d) => d.h ?? -Infinity));
  const avgVol = window.reduce((s, d) => s + (d.v ?? 0), 0) / window.length;
  const ok = recent.c > highMax && recent.v > avgVol * 1.5;
  return {
    name: 'ブレイクアウト',
    detected: ok,
    confidence: ok ? 0.8 : 0.2,
    detail: ok ? '20日高値+出来高1.5倍' : '通常',
  };
}

/**
 * 52週高安位置 (0=安値, 100=高値)
 */
export function detect52wPosition(data: OHLC[]): { position: number; result: PatternResult } {
  const N = data.length;
  if (N < 240) return { position: 0, result: { name: '52週高安位置', detected: false, confidence: 0 } };
  const window = data.slice(N - 252);
  const highs = window.map((d) => d.h ?? -Infinity);
  const lows = window.map((d) => d.l ?? Infinity);
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const latest = data[N - 1].c ?? 0;
  const position = ((latest - min) / (max - min)) * 100;
  return {
    position,
    result: {
      name: '52週高安位置',
      detected: true,
      confidence: 1,
      detail: `${position.toFixed(0)}% 位置`,
    },
  };
}

/** すべて走らせて結果を集約 */
export function detectAllPatterns(data: OHLC[]): PatternResult[] {
  return [
    detectMaTrend(data),
    detectStage(data),
    detectCupWithHandle(data),
    detectDoubleBottom(data),
    detectBreakout(data),
    detect52wPosition(data).result,
  ];
}
