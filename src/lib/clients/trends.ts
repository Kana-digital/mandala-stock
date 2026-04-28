/**
 * Google Trends クライアント (Phase 3 本実装)
 *
 * 公式 API は無いので Trends Explore の非公式エンドポイントを叩く。
 *  1. POST https://trends.google.com/trends/api/explore に keyword を送信して widget の token を得る
 *  2. その token を multiline エンドポイントに渡して時系列を取得
 *
 * レスポンスは ")]}',\n" プレフィックスが付いた JSON なので削ぎ落としてからパース。
 *
 * 注意:
 *  - レート制限が厳しい（同IPから連続だと 429）→ サーバ側で 6h キャッシュ済み
 *  - keyword はそのまま投げる（株名・テーマ名など）
 *  - 失敗時は { points: [], mock: false, error: '...' } を返す
 */

const EXPLORE = 'https://trends.google.com/trends/api/explore';
const MULTILINE = 'https://trends.google.com/trends/api/widgetdata/multiline';

interface ExploreWidget {
  id: string;
  token: string;
  request: unknown;
}

interface ExploreResponse {
  widgets: ExploreWidget[];
}

interface MultilinePoint {
  time: string;
  formattedAxisTime: string;
  value: number[];
  hasData: boolean[];
  formattedValue: string[];
}

interface MultilineResponse {
  default: { timelineData: MultilinePoint[] };
}

/** ")]}'," を取り除いて JSON.parse */
function stripAndParse<T>(text: string): T {
  const cleaned = text.replace(/^[\s\S]*?\n/, '');
  return JSON.parse(cleaned) as T;
}

export interface InterestPoint {
  date: string;   // ISO date (yyyy-mm-dd)
  value: number;  // 0-100
}

export interface InterestResult {
  points: InterestPoint[];
  mock: boolean;
  error?: string;
}

export async function interestOverTime(keyword: string, geo = 'JP'): Promise<InterestResult> {
  try {
    const today = new Date();
    const startStr = new Date(today.getTime() - 90 * 86400000).toISOString().slice(0, 10);
    const endStr = today.toISOString().slice(0, 10);

    const exploreReq = {
      comparisonItem: [{ keyword, geo, time: `${startStr} ${endStr}` }],
      category: 0,
      property: '',
    };
    const params = new URLSearchParams({
      hl: 'ja',
      tz: '-540',
      req: JSON.stringify(exploreReq),
    });

    const r1 = await fetch(`${EXPLORE}?${params}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (mandala-stock)' },
    });
    if (!r1.ok) return { points: [], mock: false, error: `explore HTTP ${r1.status}` };
    const exploreText = await r1.text();
    const explore = stripAndParse<ExploreResponse>(exploreText);
    const widget = explore.widgets.find((w) => w.id === 'TIMESERIES');
    if (!widget) return { points: [], mock: false, error: 'TIMESERIES widget not found' };

    const ml = new URLSearchParams({
      hl: 'ja',
      tz: '-540',
      req: JSON.stringify(widget.request),
      token: widget.token,
    });
    const r2 = await fetch(`${MULTILINE}?${ml}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (mandala-stock)' },
    });
    if (!r2.ok) return { points: [], mock: false, error: `multiline HTTP ${r2.status}` };
    const data = stripAndParse<MultilineResponse>(await r2.text());

    const points: InterestPoint[] = (data.default.timelineData ?? []).map((p) => ({
      date: new Date(Number(p.time) * 1000).toISOString().slice(0, 10),
      value: p.value?.[0] ?? 0,
    }));
    return { points, mock: false };
  } catch (e) {
    return { points: [], mock: false, error: (e as Error).message };
  }
}
