/**
 * テクニカル指標計算（純粋関数、依存なし）
 * 入力は終値の昇順配列。
 */

export interface OHLC {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** 単純移動平均 */
export function sma(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/** 指数平滑移動平均（EMA） */
export function ema(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let e = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) e = closes[i] * k + e * (1 - k);
  return e;
}

/** RSI(14) — 0-100 */
export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  let avgG = gain / period, avgL = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
    avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgL === 0) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

/** MACD (12,26,9) — { macd, signal, histogram } */
export function macd(closes: number[]): { macd: number; signal: number; histogram: number } | null {
  if (closes.length < 26 + 9) return null;
  // 各日の MACD 線を計算
  const macdLine: number[] = [];
  const k12 = 2 / 13, k26 = 2 / 27;
  let e12 = closes.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
  let e26 = closes.slice(0, 26).reduce((a, b) => a + b, 0) / 26;
  // 25 日目までは MACD 線が確定しないので空
  for (let i = 12; i < 26; i++) e12 = closes[i] * k12 + e12 * (1 - k12);
  macdLine.push(e12 - e26);
  for (let i = 26; i < closes.length; i++) {
    e12 = closes[i] * k12 + e12 * (1 - k12);
    e26 = closes[i] * k26 + e26 * (1 - k26);
    macdLine.push(e12 - e26);
  }
  // signal = MACD の 9 日 EMA
  const k9 = 2 / 10;
  let sig = macdLine.slice(0, 9).reduce((a, b) => a + b, 0) / 9;
  for (let i = 9; i < macdLine.length; i++) sig = macdLine[i] * k9 + sig * (1 - k9);
  const last = macdLine[macdLine.length - 1];
  return { macd: last, signal: sig, histogram: last - sig };
}

/** ボラティリティ（日次リターンの標準偏差）— 年率換算 */
export function volatility(closes: number[], period = 30): number | null {
  if (closes.length < period + 1) return null;
  const slice = closes.slice(-(period + 1));
  const rets: number[] = [];
  for (let i = 1; i < slice.length; i++) rets.push(Math.log(slice[i] / slice[i - 1]));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
  return Math.sqrt(v) * Math.sqrt(252);
}

/** 期間リターン（％） — n 日前から現在 */
export function periodReturn(closes: number[], days: number): number | null {
  if (closes.length < days + 1) return null;
  const prev = closes[closes.length - 1 - days];
  const cur = closes[closes.length - 1];
  return ((cur - prev) / prev) * 100;
}

/** 出来高比率 — 直近の出来高 / N 日平均出来高 */
export function volumeRatio(volumes: number[], period = 20): number | null {
  if (volumes.length < period + 1) return null;
  const recent = volumes[volumes.length - 1];
  const avg = volumes.slice(-(period + 1), -1).reduce((a, b) => a + b, 0) / period;
  if (avg === 0) return null;
  return recent / avg;
}

/** 52週レンジ内位置 (0=安値, 1=高値) */
export function range52w(closes: number[]): number | null {
  if (closes.length < 50) return null;
  const slice = closes.slice(-252);
  const lo = Math.min(...slice);
  const hi = Math.max(...slice);
  if (hi === lo) return 0.5;
  return (closes[closes.length - 1] - lo) / (hi - lo);
}
