/**
 * J-Quants API クライアント (V2)
 * https://jpx-jquants.com/ja/spec
 *
 * 2025/12/22 以降の登録ユーザーは V2 のみ利用可能。
 * V2 はダッシュボードで発行する API Key を `x-api-key` ヘッダーで送るシンプル認証。
 *
 * 環境変数:
 *   JQUANTS_REFRESH_TOKEN ... 互換のため変数名は据え置き。実体は V2 API Key。
 *                              （UI 表記との整合のため、既存名を再利用）
 */

const BASE = 'https://api.jquants.com/v2';

function getApiKey(): string {
  const key = process.env.JQUANTS_REFRESH_TOKEN;
  if (!key) throw new Error('JQUANTS_REFRESH_TOKEN is not set');
  return key;
}

async function jqGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'x-api-key': getApiKey() },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`J-Quants ${path} failed: ${res.status}${body ? ` ${body.slice(0, 160)}` : ''}`);
  }
  return (await res.json()) as T;
}

export interface JqDailyQuote {
  Date: string;
  Code: string;
  Open: number | null;
  High: number | null;
  Low: number | null;
  Close: number | null;
  Volume: number | null;
  TurnoverValue: number | null;
}

/** YYYY-MM-DD → YYYYMMDD */
function yyyymmdd(dateStr: string): string {
  return dateStr.replace(/-/g, '').slice(0, 8);
}

/**
 * 株価日足を取得。
 * V2 では /equities/bars/daily?code=X&date=YYYYMMDD（単日）
 * 範囲取得は from / to を渡して試行 → 失敗時は to 当日（直近営業日）のみ取得。
 */
export async function fetchDailyQuotes(code: string, from?: string, to?: string): Promise<JqDailyQuote[]> {
  const tryRange = async (): Promise<JqDailyQuote[] | null> => {
    if (!from || !to) return null;
    try {
      const params = new URLSearchParams({ code, from: yyyymmdd(from), to: yyyymmdd(to) });
      const json = await jqGet<{ daily_quotes?: JqDailyQuote[]; bars?: JqDailyQuote[] }>(
        `/equities/bars/daily?${params}`,
      );
      const arr = json.daily_quotes ?? json.bars ?? [];
      return arr;
    } catch {
      return null;
    }
  };

  const rangeRes = await tryRange();
  if (rangeRes && rangeRes.length > 0) return rangeRes;

  // フォールバック: 直近 5 営業日分を順次取得（最低限の last close を確保）
  const days: JqDailyQuote[] = [];
  const now = to ? new Date(to) : new Date();
  for (let i = 0; i < 7 && days.length < 5; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue; // 土日スキップ
    const dateStr = d.toISOString().slice(0, 10).replace(/-/g, '');
    try {
      const json = await jqGet<{ daily_quotes?: JqDailyQuote[]; bars?: JqDailyQuote[] }>(
        `/equities/bars/daily?code=${code}&date=${dateStr}`,
      );
      const arr = json.daily_quotes ?? json.bars ?? [];
      days.push(...arr);
    } catch {
      // 1 日分の失敗は無視
    }
  }
  return days.sort((a, b) => (a.Date < b.Date ? -1 : 1));
}

export interface JqStatement {
  DisclosedDate: string;
  LocalCode: string;
  NetSales?: string;
  OperatingProfit?: string;
  OrdinaryProfit?: string;
  Profit?: string;
  EarningsPerShare?: string;
  ChangesInOperatingProfit?: string;
  ForecastNetSales?: string;
  ForecastOperatingProfit?: string;
  ForecastEarningsPerShare?: string;
}

export async function fetchStatements(code: string): Promise<JqStatement[]> {
  const json = await jqGet<{ statements: JqStatement[] }>(`/fins/statements?code=${code}`);
  return json.statements ?? [];
}

export interface JqListedInfo {
  Code: string;
  CompanyName: string;
  Sector17CodeName?: string;
  Sector33CodeName?: string;
  MarketCodeName?: string;
}

export async function fetchListedInfo(code: string): Promise<JqListedInfo | null> {
  const json = await jqGet<{ info: JqListedInfo[] }>(`/listed/info?code=${code}`);
  return json.info?.[0] ?? null;
}

/** 全銘柄リスト（重いので 1 日キャッシュ前提で利用） */
export async function fetchAllListedInfo(): Promise<JqListedInfo[]> {
  const json = await jqGet<{ info: JqListedInfo[] }>(`/listed/info`);
  return json.info ?? [];
}

/** 同一 33 業種の銘柄を抽出（自分は除外、5件まで） */
export function pickSameSector(all: JqListedInfo[], target: JqListedInfo, n = 5): JqListedInfo[] {
  return all
    .filter((s) => s.Sector33CodeName === target.Sector33CodeName && s.Code !== target.Code)
    .slice(0, n);
}
