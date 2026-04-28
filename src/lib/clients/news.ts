/**
 * NewsAPI クライアント
 * https://newsapi.org/docs
 *
 * 環境変数: NEWSAPI_KEY
 *
 * Developer プランは商用不可・100req/日。個人利用なら十分。
 */

const BASE = 'https://newsapi.org/v2';

export interface NewsArticle {
  source: { id: string | null; name: string };
  author: string | null;
  title: string;
  description: string | null;
  url: string;
  urlToImage: string | null;
  publishedAt: string;
  content: string | null;
}

interface NewsResponse {
  status: string;
  totalResults: number;
  articles: NewsArticle[];
}

export async function fetchNews(query: string, opts?: { from?: string; pageSize?: number; language?: string }): Promise<{ totalResults: number; articles: NewsArticle[] }> {
  const apiKey = process.env.NEWSAPI_KEY;
  if (!apiKey) throw new Error('NEWSAPI_KEY is not set');

  const params = new URLSearchParams({
    q: query,
    language: opts?.language ?? 'jp',
    sortBy: 'publishedAt',
    pageSize: String(opts?.pageSize ?? 20),
  });
  if (opts?.from) params.set('from', opts.from);

  const res = await fetch(`${BASE}/everything?${params}`, {
    headers: { 'X-Api-Key': apiKey },
  });
  if (!res.ok) throw new Error(`NewsAPI failed: ${res.status}`);
  const json = (await res.json()) as NewsResponse;
  return { totalResults: json.totalResults, articles: json.articles };
}
