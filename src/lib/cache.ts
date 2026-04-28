/**
 * Vercel Edge / Node Functions 共通の簡易キャッシュ。
 * グローバルメモリに TTL 付きで保持する（コールドスタート時はミス）。
 * 本番で持続キャッシュが欲しくなったら Vercel KV に差し替え可能。
 */

type Entry<T> = { value: T; expires: number };

const store: Map<string, Entry<unknown>> = (globalThis as { __ms_cache?: Map<string, Entry<unknown>> }).__ms_cache ?? new Map();
(globalThis as { __ms_cache?: Map<string, Entry<unknown>> }).__ms_cache = store;

export function cacheGet<T>(key: string): T | null {
  const hit = store.get(key) as Entry<T> | undefined;
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    store.delete(key);
    return null;
  }
  return hit.value;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expires: Date.now() + ttlMs });
}

export async function withCache<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const cached = cacheGet<T>(key);
  if (cached !== null) return cached;
  const fresh = await fetcher();
  cacheSet(key, fresh, ttlMs);
  return fresh;
}

/** 共通 JSON レスポンス（CDN 側でも 1 時間キャッシュ可能にする） */
export function jsonResponse<T>(data: T, opts?: { sMaxAge?: number; status?: number }): Response {
  return new Response(JSON.stringify(data), {
    status: opts?.status ?? 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, s-maxage=${opts?.sMaxAge ?? 3600}, stale-while-revalidate=${(opts?.sMaxAge ?? 3600) * 2}`,
    },
  });
}

export function errorResponse(message: string, status = 500): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
