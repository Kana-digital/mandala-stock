/**
 * Upstash Redis クライアント
 *
 * 環境変数 UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN を使用。
 * Vercel KV と互換性あり（同じ Upstash Redis ベース）。
 */

import { Redis } from '@upstash/redis';

let _redis: Redis | null = null;

function getRedis(): Redis {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error(
      'UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN が未設定です（または KV_REST_API_URL / KV_REST_API_TOKEN）',
    );
  }
  _redis = new Redis({ url, token });
  return _redis;
}

/** Upstash が利用可能か（環境変数が揃っているか） */
export function isKvEnabled(): boolean {
  return !!(
    (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ||
    (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
  );
}

/** JSON 値を取得（undefined → null）*/
export async function kvGet<T>(key: string): Promise<T | null> {
  const r = getRedis();
  const v = await r.get<T>(key);
  return (v as T | null) ?? null;
}

/** JSON 値を保存（TTL 秒指定可）*/
export async function kvSet<T>(key: string, value: T, ttlSec?: number): Promise<void> {
  const r = getRedis();
  if (ttlSec && ttlSec > 0) {
    await r.set(key, value as object, { ex: ttlSec });
  } else {
    await r.set(key, value as object);
  }
}

/** パイプライン書き込み（高速） */
export async function kvSetMany(entries: Array<{ key: string; value: unknown; ttlSec?: number }>): Promise<void> {
  const r = getRedis();
  const pipe = r.pipeline();
  for (const e of entries) {
    if (e.ttlSec && e.ttlSec > 0) {
      pipe.set(e.key, e.value as object, { ex: e.ttlSec });
    } else {
      pipe.set(e.key, e.value as object);
    }
  }
  await pipe.exec();
}

// ---------- キー命名規則 ----------
export const KV_KEYS = {
  /** 個別銘柄のフルマンダラ */
  mandala: (code: string) => `mandala:${code}`,
  /** 全銘柄ぶんのマンダラ集計（80銘柄時代のレガシー、≤500銘柄時のみ使用） */
  rankingAll: () => `ranking:all`,
  /** スリム版ランキングのチャンク（全銘柄スケール用、各 1000 件） */
  rankingSlimChunk: (i: number) => `ranking:slim:${i}`,
  /** スリム版ランキングのメタ（チャンク数等） */
  rankingSlimMeta: () => `ranking:slim:meta`,
  /** 最終更新時刻（ISO 文字列） */
  lastRefreshedAt: () => `meta:last-refreshed`,
  /** 直近のリフレッシュメタ情報（成功/失敗銘柄数など） */
  lastRefreshMeta: () => `meta:last-refresh-meta`,
} as const;

/** ランキング用の軽量エントリ（全銘柄でも < 1MB に収まる） */
export interface SlimRankingEntry {
  code: string;
  name: string;
  sector: string;
  price: number | null;
  predictedPrice: number | null;
  predictedUpsidePct: number;
  analystUpsidePct: number | null;
  totalScore: number;
  /** 8 カテゴリのスコアのみ（name は frontend で key からマッピング） */
  categoryScores: Array<{ key: string; name: string; score: number }>;
}

export interface SlimRankingMeta {
  totalCount: number;
  chunkCount: number;
  chunkSize: number;
  generatedAt: string;
}
