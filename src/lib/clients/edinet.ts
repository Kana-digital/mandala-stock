/**
 * EDINET API v2 クライアント
 * https://disclosure2.edinet-fsa.go.jp/weee0010.aspx
 *
 * 環境変数: EDINET_SUBSCRIPTION_KEY
 *
 * 主に以下を取得:
 *  - 大量保有報告書 (Doc Type 010..)
 *  - 有価証券報告書 / 四半期報告書 (Doc Type 120, 140)
 */

const BASE = 'https://disclosure.edinet-fsa.go.jp/api/v2';

interface DocListItem {
  docID: string;
  edinetCode: string;
  filerName: string;
  fundCode?: string;
  ordinanceCode?: string;
  formCode?: string;
  docTypeCode?: string;
  periodStart?: string;
  periodEnd?: string;
  submitDateTime: string;
  docDescription?: string;
  secCode?: string; // 証券コード（4桁+0）
}

interface DocListResponse {
  metadata: { resultset: { count: number }; status: string; processDateTime: string };
  results: DocListItem[];
}

function key(): string {
  const k = process.env.EDINET_SUBSCRIPTION_KEY;
  if (!k) throw new Error('EDINET_SUBSCRIPTION_KEY is not set');
  return k;
}

/** 指定日に提出された全書類のリスト */
export async function listDocsByDate(date: string): Promise<DocListItem[]> {
  const url = `${BASE}/documents.json?date=${date}&type=2&Subscription-Key=${encodeURIComponent(key())}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`EDINET listDocs failed: ${res.status}`);
  const json = (await res.json()) as DocListResponse;
  return json.results ?? [];
}

/**
 * 指定銘柄の最近 N 日分の大量保有報告書を取得（簡易版・日付ループ）。
 * 重い処理なので Vercel API Route 側で結果をキャッシュすること。
 */
export async function recentLargeShareholderReports(secCode: string, daysBack = 30): Promise<DocListItem[]> {
  const target = secCode.padEnd(5, '0'); // EDINET の secCode は 4桁+0
  const out: DocListItem[] = [];
  const today = new Date();
  for (let i = 0; i < daysBack; i++) {
    const d = new Date(today.getTime() - i * 86400000);
    const dateStr = d.toISOString().slice(0, 10);
    try {
      const list = await listDocsByDate(dateStr);
      for (const doc of list) {
        if (doc.secCode === target && doc.docTypeCode?.startsWith('010')) {
          out.push(doc);
        }
      }
    } catch {
      // 個別日の失敗は握りつぶして次へ
    }
  }
  return out;
}
