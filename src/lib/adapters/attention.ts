/**
 * 投資家注目度軸の adapter
 * /api/attention のレスポンス（EDINET 大量保有報告書数）に加え、
 * /api/news（メディア露出数）/ /api/trends（Google Trends）から
 * SUB_CELLS.attention のセルに値を割り当てる。
 */
import type { CellPatch } from './earnings';
import type { InterestResult } from '@/lib/clients/trends';

interface AttentionResponse {
  largeShareholderReports: { docDescription?: string; submitDateTime: string; filerName: string }[];
  reportCount: number;
}

interface NewsResponse {
  totalResults: number;
  articles: { title: string; publishedAt: string; source: { name: string } }[];
}

function reportScore(count: number): number {
  if (count >= 10) return 95;
  if (count >= 5) return 80;
  if (count >= 3) return 65;
  if (count >= 1) return 45;
  return 20;
}

function newsScore(count: number): number {
  if (count >= 30) return 95;
  if (count >= 15) return 80;
  if (count >= 5) return 65;
  if (count >= 1) return 45;
  return 20;
}

/**
 * Google Trends は 0-100 の関心度。
 * 直近の平均値 + 直近の上昇トレンド分を加味して 0-100 のスコアに圧縮する。
 */
function trendsScore(result: InterestResult): { score: number; latest: number; delta: number } {
  if (result.points.length === 0) return { score: 20, latest: 0, delta: 0 };
  const tail = result.points.slice(-7);
  const head = result.points.slice(-30, -7);
  const tailAvg = tail.reduce((a, p) => a + p.value, 0) / tail.length;
  const headAvg = head.length ? head.reduce((a, p) => a + p.value, 0) / head.length : tailAvg;
  const delta = tailAvg - headAvg;
  // ベース：直近平均 (0-100)
  // ボーナス：上昇分 (-20〜+20 を ±10 で加算)
  const base = Math.max(0, Math.min(100, tailAvg));
  const bonus = Math.max(-10, Math.min(10, delta * 0.5));
  return {
    score: Math.round(Math.max(0, Math.min(100, base + bonus))),
    latest: Math.round(tailAvg),
    delta: Math.round(delta),
  };
}

export function buildAttentionPatches(data: AttentionResponse, news?: NewsResponse, trends?: InterestResult): CellPatch[] {
  const patches: CellPatch[] = [];

  // 大量保有報告(EDINET)
  patches.push({
    label: '大量保有報告(EDINET)',
    value: `${data.reportCount}件`,
    score: reportScore(data.reportCount),
    memo: data.largeShareholderReports
      .slice(0, 3)
      .map((r) => `${r.submitDateTime.slice(0, 10)} ${r.filerName}`)
      .join('\n'),
    source: 'edinet',
  });

  // メディア露出数 (NewsAPI)
  if (news) {
    patches.push({
      label: 'メディア露出数',
      value: `${news.totalResults}件 / 7日`,
      score: newsScore(news.totalResults),
      memo: news.articles
        .slice(0, 3)
        .map((a) => `${a.publishedAt.slice(0, 10)} ${a.source.name}\n${a.title}`)
        .join('\n---\n'),
      source: 'news',
    });
  }

  // Google Trends
  if (trends) {
    const t = trendsScore(trends);
    patches.push({
      label: 'Google Trends',
      value: `関心度 ${t.latest} (前30日比 ${t.delta >= 0 ? '+' : ''}${t.delta})`,
      score: t.score,
      memo: trends.error
        ? `取得失敗: ${trends.error}`
        : `直近7日平均=${t.latest}, 前30日比=${t.delta >= 0 ? '+' : ''}${t.delta}`,
      source: 'trends',
    });
  }

  return patches;
}
