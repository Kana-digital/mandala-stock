/**
 * Stooq クライアント (サーバーサイド専用)
 *
 * Stooq は無料の海外データプロバイダで、日本株の OHLCV データを CSV で配信している。
 * Yahoo Finance のような IP ブロックは（少なくとも 2025 年時点では）課されておらず、
 * Vercel / GitHub Actions などのクラウド IP からも普通にアクセスできる。
 *
 * 個別銘柄: https://stooq.com/q/d/l/?s={code}.jp&i=d
 *   - code は 4 桁の証券コード（小文字 .jp 必須）
 *   - i=d は日足
 *   - レスポンスは CSV: `Date,Open,High,Low,Close,Volume\n2024-01-04,...`
 *   - 銘柄が見つからない / 廃止された場合は "No data" のような短い文字列を返す
 *
 * チャート期間は内部でクライアント側スライスする（範囲指定パラメータが不安定なため
 * 全件取得して必要分だけ使う方が安定）。直近 ~250 営業日（1 年強）で十分。
 */

import { setTimeout as delay } from 'node:timers/promises';

export interface StooqBar {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface StooqChart {
  ticker: string; // `${code}.JP`
  code: string;
  bars: StooqBar[];
  /** 直近終値（メタとして便利）*/
  lastClose: number | null;
  /** 直近営業日 */
  lastDate: string | null;
}

const BASE = 'https://stooq.com/q/d/l/';

export class StooqError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'StooqError';
  }
}

/** CSV 1 行をパース */
function parseCsvLine(line: string): StooqBar | null {
  // Stooq CSV: Date,Open,High,Low,Close,Volume
  const cols = line.split(',');
  if (cols.length < 6) return null;
  const [date, open, high, low, close, volume] = cols;
  const o = Number(open);
  const h = Number(high);
  const l = Number(low);
  const c = Number(close);
  const v = Number(volume);
  if (!date || !Number.isFinite(c)) return null;
  return {
    date,
    open: Number.isFinite(o) ? o : c,
    high: Number.isFinite(h) ? h : c,
    low: Number.isFinite(l) ? l : c,
    close: c,
    volume: Number.isFinite(v) ? v : 0,
  };
}

/**
 * 個別銘柄の日足チャートを取得する。
 *
 * - code は 4 桁証券コード（例: '7203'）
 * - 取得できる範囲は Stooq 側のデフォルト（数年〜十数年）。フィルタは呼び出し側で。
 * - 失敗時 (404, "No data", タイムアウト等) は StooqError を投げる
 */
export async function stooqChart(code: string, opts?: { timeoutMs?: number }): Promise<StooqChart> {
  const timeoutMs = opts?.timeoutMs ?? 15000;
  const url = `${BASE}?s=${code}.jp&i=d`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Stooq は素朴な UA でも通るが念のため
        'User-Agent': 'mandala-stock/1.0 (+https://mandala-stock.vercel.app)',
        Accept: 'text/csv,text/plain,*/*',
      },
    });
  } catch (e) {
    clearTimeout(timer);
    if ((e as { name?: string })?.name === 'AbortError') {
      throw new StooqError(`Stooq timeout (${timeoutMs}ms): ${code}`);
    }
    throw new StooqError(`Stooq fetch failed: ${(e as Error).message}`);
  }
  clearTimeout(timer);

  if (!res.ok) {
    throw new StooqError(`Stooq HTTP ${res.status} for ${code}`, res.status);
  }

  const text = await res.text();
  if (!text || text.length < 20) {
    throw new StooqError(`Stooq empty response for ${code}: "${text.slice(0, 60)}"`);
  }

  // "No data" は完全一致で来ることもあれば、CSV 風の HTML が来ることも稀にある。
  // 1 行目に Date が含まれているかで判定。
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) {
    throw new StooqError(`Stooq no data for ${code}: "${lines[0]?.slice(0, 60)}"`);
  }
  const header = lines[0].toLowerCase();
  if (!header.includes('date') || !header.includes('close')) {
    throw new StooqError(`Stooq malformed CSV for ${code}: header="${lines[0].slice(0, 60)}"`);
  }

  const bars: StooqBar[] = [];
  for (let i = 1; i < lines.length; i++) {
    const bar = parseCsvLine(lines[i]);
    if (bar) bars.push(bar);
  }
  if (bars.length === 0) {
    throw new StooqError(`Stooq parsed 0 bars for ${code}`);
  }

  const lastBar = bars[bars.length - 1];
  return {
    ticker: `${code}.JP`,
    code,
    bars,
    lastClose: lastBar.close,
    lastDate: lastBar.date,
  };
}

/**
 * 直近 N 営業日にスライス (N=252 ≒ 1 年)。
 * 余分なヒストリは捨てて、Upstash の容量を節約。
 */
export function sliceRecent(bars: StooqBar[], n = 252): StooqBar[] {
  if (bars.length <= n) return bars;
  return bars.slice(-n);
}

/**
 * 軽いリトライ付き fetch ラッパ。
 * Stooq は普段安定しているが、稀に 5xx / コネリセが起きるので 2 回まで再試行。
 */
export async function stooqChartWithRetry(
  code: string,
  opts?: { retries?: number; timeoutMs?: number; backoffMs?: number },
): Promise<StooqChart> {
  const retries = opts?.retries ?? 2;
  const backoff = opts?.backoffMs ?? 1500;
  let last: Error | null = null;
  for (let i = 0; i <= retries; i++) {
    try {
      return await stooqChart(code, { timeoutMs: opts?.timeoutMs });
    } catch (e) {
      last = e as Error;
      // "No data" 系（4xx）は再試行しても無駄
      if (e instanceof StooqError && e.status && e.status >= 400 && e.status < 500) {
        throw e;
      }
      if (i < retries) await delay(backoff * (i + 1));
    }
  }
  throw last ?? new StooqError(`stooqChartWithRetry exhausted for ${code}`);
}
