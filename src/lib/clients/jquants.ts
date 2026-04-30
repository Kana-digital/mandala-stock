/**
 * J-Quants API クライアント (V2)
 *
 * 仕様: https://jpx-jquants.com/ja/spec
 *
 * 2025/12/22 以降の登録ユーザーは V2 のみ利用可能。
 * V2 はダッシュボードで発行する API Key を `x-api-key` ヘッダーで送るシンプル認証。
 *
 * 主要エンドポイント:
 *   - /v2/equities/master       上場銘柄一覧 (data 配列, code/date 任意)
 *   - /v2/equities/bars/daily   株価四本値 (data 配列, code 必須 / date or from+to)
 *   - /v2/fins/summary          財務情報 (data 配列, code 必須 / date 任意)
 *
 * 全エンドポイントに pagination_key が付くことがあるので、自動で全件回収する。
 *
 * 環境変数:
 *   JQUANTS_REFRESH_TOKEN ... 互換のため変数名は据え置き。実体は V2 API Key。
 */

const BASE = 'https://api.jquants.com/v2';

function getApiKey(): string {
  const key = process.env.JQUANTS_REFRESH_TOKEN;
  if (!key) throw new Error('JQUANTS_REFRESH_TOKEN is not set');
  return key;
}

interface Paginated<T> {
  data?: T[];
  pagination_key?: string;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 1 ページ取得（pagination_key を含めて呼ぶこともある）
 *
 * 429 が返ってきた場合は Retry-After ヘッダ（または指数バックオフ）に従って自動リトライ。
 * Free プランでは 1 req / N 秒の厳しいレート制限があるので必須。
 */
async function jqGetRaw<T>(
  path: string,
  query: Record<string, string | undefined>,
  attempt = 0,
): Promise<Paginated<T>> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') params.set(k, v);
  }
  const qs = params.toString();
  const url = qs ? `${BASE}${path}?${qs}` : `${BASE}${path}`;
  const res = await fetch(url, {
    headers: { 'x-api-key': getApiKey() },
  });

  // 429 をリトライ。最大 5 回、最大累積待機 ~5 分。
  if (res.status === 429 && attempt < 5) {
    const retryAfter = Number(res.headers.get('retry-after'));
    // Retry-After ヘッダがあれば尊重、無ければ指数バックオフ（10s, 20s, 40s, 80s, 160s）
    const waitSec = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter, 180)
      : Math.min(10 * Math.pow(2, attempt), 180);
    await sleep(waitSec * 1000);
    return jqGetRaw<T>(path, query, attempt + 1);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`J-Quants ${path} failed: ${res.status}${body ? ` ${body.slice(0, 200)}` : ''}`);
  }
  return (await res.json()) as Paginated<T>;
}

/**
 * pagination_key を辿って全件取得。最大ページ数で安全弁。
 */
async function jqGetAll<T>(
  path: string,
  query: Record<string, string | undefined>,
  maxPages = 20,
): Promise<T[]> {
  const all: T[] = [];
  let key: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const q = key ? { ...query, pagination_key: key } : query;
    const json = await jqGetRaw<T>(path, q);
    if (json.data && json.data.length > 0) all.push(...json.data);
    if (!json.pagination_key) return all;
    key = json.pagination_key;
  }
  // maxPages 到達 — 部分結果でも返す（呼び出し側で件数を見る）
  return all;
}

// ─────────────────────────────────────────────────────────────
// 株価四本値
// ─────────────────────────────────────────────────────────────

/**
 * /v2/equities/bars/daily の生レスポンス 1 行
 * （フィールドはすべて短縮形。Premium 限定の前場/後場フィールドは含めない）
 */
export interface JqDailyBar {
  Date: string;        // YYYY-MM-DD
  Code: string;        // 5桁
  O: number | null;    // 始値（調整前）
  H: number | null;    // 高値（調整前）
  L: number | null;    // 安値（調整前）
  C: number | null;    // 終値（調整前）
  Vo: number | null;   // 取引高（調整前）
  Va: number | null;   // 取引代金
  AdjFactor: number | null;
  AdjO: number | null; // 調整済み始値
  AdjH: number | null;
  AdjL: number | null;
  AdjC: number | null; // 調整済み終値（チャート計算はこれを使う）
  AdjVo: number | null;
  UL?: string;
  LL?: string;
}

/** YYYY-MM-DD → YYYYMMDD */
function yyyymmdd(dateStr: string): string {
  return dateStr.replace(/-/g, '').slice(0, 8);
}

/**
 * 株価日足を期間取得。
 * V2: /v2/equities/bars/daily?code=X&from=YYYYMMDD&to=YYYYMMDD
 * pagination_key で複数ページにまたがることがあるので全件回収。
 */
export async function fetchDailyQuotes(
  code: string,
  from?: string,
  to?: string,
): Promise<JqDailyBar[]> {
  const query: Record<string, string | undefined> = { code };
  if (from && to) {
    query.from = yyyymmdd(from);
    query.to = yyyymmdd(to);
  }
  // 1.5 年分だと最大 ~370 営業日。pagination_key が出ても 5 ページ以内に収まるはず
  const bars = await jqGetAll<JqDailyBar>('/equities/bars/daily', query, 10);
  // 念のため日付昇順に揃える
  return bars.sort((a, b) => (a.Date < b.Date ? -1 : 1));
}

/**
 * 指定日の全銘柄の株価を取得。
 * V2: /v2/equities/bars/daily?date=YYYYMMDD
 * code を省略すると、その日の全上場銘柄のデータが返る（pagination_key で複数ページ）。
 *
 * 銘柄ごとに呼ぶより遥かに少ないリクエスト数で済むので、
 * 期間取得を「銘柄 × 期間」ではなく「日 × 全銘柄」のループで実装するのに使う。
 */
export async function fetchDailyQuotesByDate(date: string): Promise<JqDailyBar[]> {
  const query: Record<string, string | undefined> = { date: yyyymmdd(date) };
  // 全上場銘柄 ~3,600 件 × 1 日。1 ページに収まるかは API 次第なので余裕を持たせる
  return jqGetAll<JqDailyBar>('/equities/bars/daily', query, 30);
}

/**
 * 指定期間（営業日のみ）について全銘柄の日足を取得し、
 * 銘柄コードごとにグルーピングした Map<code, JqDailyBar[]> を返す。
 *
 * 各日付ループの間に sleepMs だけ待ち、レート制限を踏まないようにする。
 * onProgress(doneDays, totalDays) で進捗を通知できる。
 *
 * @param fromDate YYYY-MM-DD（含む）
 * @param toDate   YYYY-MM-DD（含む）
 * @param sleepMs  各日付リクエスト間の待機ms（デフォルト 1500）
 * @param onProgress 進捗コールバック
 */
export async function fetchAllDailyQuotesInRange(
  fromDate: string,
  toDate: string,
  sleepMs = 1500,
  onProgress?: (doneDays: number, totalDays: number, lastDate: string) => void,
): Promise<Map<string, JqDailyBar[]>> {
  // fromDate → toDate を日次でループ。土日と祝日は API が空 data を返すだけなのでスキップ判定不要。
  // ただし土日は明らかに無駄なのでスキップ。
  const start = new Date(fromDate + 'T00:00:00Z').getTime();
  const end = new Date(toDate + 'T00:00:00Z').getTime();
  const dates: string[] = [];
  for (let t = start; t <= end; t += 24 * 60 * 60 * 1000) {
    const d = new Date(t);
    const dow = d.getUTCDay(); // 0=Sun, 6=Sat
    if (dow === 0 || dow === 6) continue;
    dates.push(d.toISOString().slice(0, 10));
  }

  const byCode = new Map<string, JqDailyBar[]>();
  for (let i = 0; i < dates.length; i++) {
    const d = dates[i];
    try {
      const bars = await fetchDailyQuotesByDate(d);
      for (const bar of bars) {
        const code4 = (bar.Code || '').slice(0, 4);
        const arr = byCode.get(code4) ?? [];
        arr.push(bar);
        byCode.set(code4, arr);
      }
    } catch (e) {
      // 1 日失敗しても続行（祝日や非営業日と同様の扱い）
      const msg = (e as Error).message.slice(0, 100);
      // eslint-disable-next-line no-console
      console.warn(`[jquants] fetchByDate ${d} failed: ${msg}`);
    }
    if (onProgress) onProgress(i + 1, dates.length, d);
    if (sleepMs > 0 && i < dates.length - 1) await sleep(sleepMs);
  }

  // code ごとに日付昇順
  for (const arr of byCode.values()) {
    arr.sort((a, b) => (a.Date < b.Date ? -1 : 1));
  }
  return byCode;
}

// ─────────────────────────────────────────────────────────────
// 財務情報サマリー
// ─────────────────────────────────────────────────────────────

/**
 * /v2/fins/summary の生レスポンス 1 行
 *
 * - 数値フィールドは API ドキュメント上は `number` だがレスポンスサンプルでは
 *   ほとんど string で返ってくる（"100529000000" など）。空欄は ""。
 *   呼び出し側で num() を通す前提で string | number | null として扱う。
 */
export interface JqFinSummary {
  DiscDate: string;       // 開示日 YYYY-MM-DD
  DiscTime: string;       // 開示時刻 HH:MM:SS
  Code: string;           // 銘柄コード（5桁）
  DiscNo: string;
  DocType: string;        // 開示書類種別（"FYFinancialStatements_Consolidated_JP" など）
  CurPerType: string;     // 当会計期間の種類 1Q/2Q/3Q/4Q/5Q/FY
  CurPerSt: string;
  CurPerEn: string;
  CurFYSt: string;
  CurFYEn: string;
  NxtFYSt?: string;
  NxtFYEn?: string;

  // 実績
  Sales?: string | number | null;     // 売上高
  OP?: string | number | null;        // 営業利益
  OdP?: string | number | null;       // 経常利益
  NP?: string | number | null;        // 当期純利益
  EPS?: string | number | null;       // 1株当たり当期純利益
  DEPS?: string | number | null;
  TA?: string | number | null;        // 総資産
  Eq?: string | number | null;        // 純資産
  EqAR?: string | number | null;      // 自己資本比率
  BPS?: string | number | null;       // 1株当たり純資産

  // 通期予想
  FSales?: string | number | null;
  FOP?: string | number | null;
  FOdP?: string | number | null;
  FNP?: string | number | null;
  FEPS?: string | number | null;

  // 配当
  DivAnn?: string | number | null;
  FDivAnn?: string | number | null;

  // 株式数
  ShOutFY?: string | number | null;   // 期末発行済株式数
}

/**
 * 指定銘柄の全期間の財務サマリーを取得（DiscNo 昇順で返る）
 */
export async function fetchStatements(code: string): Promise<JqFinSummary[]> {
  return jqGetAll<JqFinSummary>('/fins/summary', { code }, 10);
}

// ─────────────────────────────────────────────────────────────
// 上場銘柄一覧
// ─────────────────────────────────────────────────────────────

/**
 * /v2/equities/master の生レスポンス 1 行
 */
export interface JqEqMaster {
  Date: string;
  Code: string;       // 5桁
  CoName: string;
  CoNameEn: string;
  S17?: string;
  S17Nm?: string;     // 17 業種コード名
  S33?: string;
  S33Nm?: string;     // 33 業種コード名
  ScaleCat?: string;
  Mkt?: string;
  MktNm?: string;     // 市場区分名（プライム / スタンダード / グロース など）
  Mrgn?: string;
  MrgnNm?: string;
}

/** 単一銘柄の master 情報（無ければ null） */
export async function fetchListedInfo(code: string): Promise<JqEqMaster | null> {
  const arr = await jqGetAll<JqEqMaster>('/equities/master', { code }, 3);
  return arr[0] ?? null;
}

/** 全銘柄の master 情報（pagination_key で全ページ回収） */
export async function fetchAllListedInfo(): Promise<JqEqMaster[]> {
  // 全銘柄取得は重い。Free プランでも 4000 件程度なので 20 ページ上限で十分
  return jqGetAll<JqEqMaster>('/equities/master', {}, 30);
}

// ─────────────────────────────────────────────────────────────
// 互換 alias（既存呼び出し側との互換）
// ─────────────────────────────────────────────────────────────

/** 旧名互換: 既存コードで JqDailyQuote を import している箇所のため alias */
export type JqDailyQuote = JqDailyBar;
/** 旧名互換 */
export type JqStatement = JqFinSummary;
/** 旧名互換 */
export type JqListedInfo = JqEqMaster;

/** 同一 33 業種の銘柄を抽出（自分は除外、5件まで） */
export function pickSameSector(all: JqEqMaster[], target: JqEqMaster, n = 5): JqEqMaster[] {
  return all
    .filter((s) => s.S33Nm && s.S33Nm === target.S33Nm && s.Code !== target.Code)
    .slice(0, n);
}
