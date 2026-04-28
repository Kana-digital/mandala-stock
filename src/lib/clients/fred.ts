/**
 * FRED API クライアント (米国マクロ指標)
 * https://fred.stlouisfed.org/docs/api/fred/
 *
 * 環境変数: FRED_API_KEY
 *
 * 使用シリーズ例:
 *  - DGS10  : US 10年金利
 *  - VIXCLS : VIX
 *  - DEXJPUS: USD/JPY
 *  - DCOILWTICO : WTI原油
 *  - SP500  : S&P500 指数
 *  - NASDAQCOM : NASDAQ Composite
 */

const BASE = 'https://api.stlouisfed.org/fred/series/observations';

interface FredObs {
  date: string;
  value: string; // "."  だと欠損
}

export interface FredObservation {
  date: string;
  value: number;
}

export async function fetchFredSeries(seriesId: string, limit = 60): Promise<FredObservation[]> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) throw new Error('FRED_API_KEY is not set');

  const url = `${BASE}?series_id=${encodeURIComponent(seriesId)}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FRED ${seriesId} failed: ${res.status}`);
  const json = (await res.json()) as { observations: FredObs[] };
  return json.observations
    .filter((o) => o.value !== '.')
    .map((o) => ({ date: o.date, value: Number(o.value) }))
    .filter((o) => Number.isFinite(o.value));
}

/** 直近の値と1ヶ月前比較を返す */
export function summarizeSeries(obs: FredObservation[]): { latest: number; latestDate: string; deltaPct: number | null } {
  if (obs.length === 0) return { latest: NaN, latestDate: '', deltaPct: null };
  const [latest, ...rest] = obs;
  const monthAgo = rest.find((_, i) => i >= 20); // 営業日 ~21
  const deltaPct = monthAgo ? ((latest.value - monthAgo.value) / monthAgo.value) * 100 : null;
  return { latest: latest.value, latestDate: latest.date, deltaPct };
}
