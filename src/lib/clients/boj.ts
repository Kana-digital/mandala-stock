/**
 * 日銀時系列統計データ検索サイト (BOJ Time-Series Data Search) クライアント
 * https://www.stat-search.boj.or.jp/index.html
 *
 * 公式 REST API は限定的なので、CSV ダウンロードエンドポイントを叩く実装にする。
 * 例: 短観・無担保コール翌日物・基準割引率・マネタリーベース など。
 *
 * 環境変数は不要（公開データ）。
 */

interface BojSeriesSpec {
  /** 日銀の DataCode（例: 'IR01' = 短期金利関連） */
  series: string;
  /** 表示用ラベル */
  label: string;
}

export const BOJ_SERIES: Record<string, BojSeriesSpec> = {
  // 例。実際のコードは BOJ の系列指定方法に合わせて利用時に補完すること。
  uncollateralizedOvernight: { series: 'IR01\'MADR1M', label: '無担保コール翌日物' },
  monetaryBase: { series: 'MD02\'MAM1NAM11', label: 'マネタリーベース' },
};

/**
 * 日銀の時系列CSV を取得して [{date, value}] にパースする。
 * NOTE: BOJ 公式のエンドポイント仕様は不安定なため、フェーズ2では
 * 「fetch + 簡易CSVパース」だけ用意し、実呼出しはユーザーが
 *  系列コードを設定した時点でテストする方針。
 */
export async function fetchBojCsv(seriesCode: string): Promise<{ date: string; value: number }[]> {
  // ここはプレースホルダ。実 URL は BOJ のサイトでダウンロードリンクを取得して入れる。
  const url = `https://www.stat-search.boj.or.jp/ssi/cgi-bin/famecgi2?cgi=$nme_a000_en&hdnYyyyMmDd=&rdoSearch=NEW&hdnSeriesCd=${encodeURIComponent(seriesCode)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`BOJ ${seriesCode} failed: ${res.status}`);
  const text = await res.text();
  const lines = text.split(/\r?\n/);
  const out: { date: string; value: number }[] = [];
  for (const line of lines) {
    const m = line.match(/^(\d{4}[\/-]\d{1,2}(?:[\/-]\d{1,2})?)\s*,\s*([-\d.]+)/);
    if (m) {
      const date = m[1].replace(/\//g, '-');
      const value = Number(m[2]);
      if (Number.isFinite(value)) out.push({ date, value });
    }
  }
  return out;
}
