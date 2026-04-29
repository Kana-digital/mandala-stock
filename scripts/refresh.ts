/**
 * Mandala データ更新スクリプト（Stooq 版・全上場銘柄対応）
 *
 * 使い方:
 *   npm run refresh
 *
 * 動作:
 *   1. src/lib/jp-stocks.json から全銘柄ロード
 *   2. Stooq から並列で日足 CSV を取得（concurrency 8 デフォルト）
 *   3. 失敗銘柄はスキップして続行（ネットワーク系は exponential backoff で 2 回リトライ）
 *   4. 個別マンダラを Upstash に書き込み（mandala:{code}）
 *   5. スリムランキングを 1000 件単位でチャンク保存（ranking:slim:N）
 *
 * 設計判断:
 *   - Yahoo Finance はクラウド IP（GH Actions / Vercel / 一部 ISP）から完全 IP ブロック中。
 *     2026/04 時点で Mac/macOS launchd / GH runners 双方ともに 429 を返すため使えない。
 *   - 代替として Stooq の無料 CSV API を使う。Stooq は商用クラウド IP も普通に通る。
 *   - ファンダメンタル（PER, ROE 等）は Stooq には無いため、当バージョンは「チャートのみ」運用。
 *     成長性 / 収益性 / 割安度 / 財務健全性 の 4 カテゴリは「データ未取得」として 0 点表示。
 *     必要なら J-Quants /fins/statements を別ジョブで週次同期して合成 summary を構築する。
 *   - 旧 forecast カテゴリ（アナリスト目標）は廃止し、出来高サージ + 高値接近度 + ボラ急騰の
 *     注目度 attention カテゴリに置換した（mandala-engine.ts 側で実装）。
 *
 * 実行環境:
 *   - GitHub Actions runner → Stooq に通る ✓
 *   - ローカル (Mac) → Stooq に通る ✓
 *   - Vercel Cron Function → 5分制限を超えるので NG（このスクリプトでは使わない）
 */

// dotenv はローカル実行時のみ。GH Actions では env から直接来るので失敗を許容。
async function loadDotenv() {
  try {
    const dotenv = await import('dotenv');
    dotenv.config({ path: '.env.local' });
    dotenv.config();
  } catch {
    /* dotenv 未インストールでも GH Actions では動く */
  }
}

import { stooqChartWithRetry, sliceRecent, StooqError } from '../src/lib/clients/stooq';
import { UNIVERSE } from '../src/lib/universe';
import { buildMandala, type MandalaResult } from '../src/lib/mandala-engine';
import {
  kvSet,
  kvSetMany,
  KV_KEYS,
  isKvEnabled,
  type SlimRankingEntry,
  type SlimRankingMeta,
} from '../src/lib/clients/kv';

// 同時並列数（Stooq は Yahoo より寛容。8 並列でも安定するはず）
const CONCURRENCY = Number(process.env.REFRESH_CONCURRENCY ?? 8);
// 各リクエスト後の sleep（ms）
const SLEEP_MS = Number(process.env.REFRESH_SLEEP_MS ?? 60);
// Stooq からの取得タイムアウト
const FETCH_TIMEOUT_MS = Number(process.env.REFRESH_TIMEOUT_MS ?? 15000);
// 進捗ログを出す間隔（銘柄数）
const LOG_INTERVAL = 100;
// スリムランキング 1チャンクあたりのエントリ数
const RANKING_CHUNK_SIZE = 1000;
// rankingAll（レガシー）に保存する閾値: ユニバースが小さいときだけ
const LEGACY_RANKING_ALL_THRESHOLD = 500;

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

async function poolRun<T, R>(
  items: T[],
  n: number,
  worker: (t: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  const runners = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

// 失敗内訳を集計（後でサマリー）
const failReasons: Map<string, number> = new Map();
const sampleErrors: string[] = [];

async function computeOne(
  stock: { code: string; name: string; sector: string },
): Promise<MandalaResult | null> {
  try {
    const raw = await stooqChartWithRetry(stock.code, {
      retries: 2,
      timeoutMs: FETCH_TIMEOUT_MS,
      backoffMs: 2000,
    });
    const bars = sliceRecent(raw.bars, 252);
    if (bars.length < 30) {
      // データ不足（最低 30 営業日は欲しい — RSI, SMA25 が計算できない）
      const key = 'insufficient bars (<30)';
      failReasons.set(key, (failReasons.get(key) ?? 0) + 1);
      return null;
    }
    return buildMandala({
      code: stock.code,
      name: stock.name,
      sector: stock.sector,
      chart: { ticker: raw.ticker, bars },
      summary: null,
    });
  } catch (e) {
    const err = e as Error;
    const msg = err.message.slice(0, 80);
    if (sampleErrors.length < 3) {
      console.error(`  ✗ ${stock.code} ${stock.name}: ${msg}`);
      sampleErrors.push(stock.code);
    }
    // メッセージ中の数値は集計用に伏せる
    const key = (e instanceof StooqError ? '[Stooq] ' : '') + msg.replace(/[\d.]+/g, 'N');
    failReasons.set(key, (failReasons.get(key) ?? 0) + 1);
    return null;
  }
}

function toSlim(r: MandalaResult): SlimRankingEntry {
  return {
    code: r.code,
    name: r.name,
    sector: r.sector ?? 'その他',
    price: r.price ?? null,
    predictedPrice: r.predictedPrice ?? null,
    predictedUpsidePct: r.predictedUpsidePct,
    analystUpsidePct: r.analystUpsidePct ?? null,
    totalScore: r.totalScore,
    categoryScores: r.categories.map((c) => ({ key: c.key, name: c.name, score: c.score })),
  };
}

async function writeChunkedRanking(slim: SlimRankingEntry[]): Promise<number> {
  const chunkCount = Math.ceil(slim.length / RANKING_CHUNK_SIZE);
  const ttl = 30 * 60 * 60; // 30h（毎日更新前提でも余裕あり）

  const entries: Array<{ key: string; value: unknown; ttlSec?: number }> = [];
  for (let i = 0; i < chunkCount; i++) {
    const start = i * RANKING_CHUNK_SIZE;
    const chunk = slim.slice(start, start + RANKING_CHUNK_SIZE);
    entries.push({
      key: KV_KEYS.rankingSlimChunk(i),
      value: chunk,
      ttlSec: ttl,
    });
  }
  const meta: SlimRankingMeta = {
    totalCount: slim.length,
    chunkCount,
    chunkSize: RANKING_CHUNK_SIZE,
    generatedAt: new Date().toISOString(),
  };
  entries.push({
    key: KV_KEYS.rankingSlimMeta(),
    value: meta,
    ttlSec: 7 * 24 * 60 * 60,
  });

  await kvSetMany(entries);
  return chunkCount;
}

async function main() {
  await loadDotenv();
  const startedAt = Date.now();
  console.log(`[refresh] starting @ ${new Date().toISOString()}`);
  console.log(`[refresh] data source: Stooq (https://stooq.com)`);
  console.log(`[refresh] universe: ${UNIVERSE.length} stocks`);
  console.log(`[refresh] concurrency: ${CONCURRENCY}, sleep: ${SLEEP_MS}ms, timeout: ${FETCH_TIMEOUT_MS}ms`);

  if (!isKvEnabled()) {
    console.error('[refresh] ERROR: UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN が未設定');
    process.exit(1);
  }
  if (UNIVERSE.length === 0) {
    console.error('[refresh] ERROR: universe が空。`npm run update-universe` を先に実行してください');
    process.exit(1);
  }

  // テスト用: LIMIT=10 で先頭10銘柄だけ処理
  const limit = Number(process.env.LIMIT ?? UNIVERSE.length);
  const targetUniverse = limit < UNIVERSE.length ? UNIVERSE.slice(0, limit) : UNIVERSE;
  if (limit < UNIVERSE.length) {
    console.log(`[refresh] LIMIT=${limit} → testing with first ${targetUniverse.length} stocks`);
  }

  // ---------- データ取得 ----------
  let done = 0;
  let succeeded = 0;
  let lastLog = 0;
  const results = await poolRun(targetUniverse, CONCURRENCY, async (s) => {
    const r = await computeOne(s);
    done++;
    if (r) succeeded++;
    if (done - lastLog >= LOG_INTERVAL || done === targetUniverse.length) {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
      console.log(
        `  [${done}/${targetUniverse.length}] elapsed ${elapsed}s ok=${succeeded} fail=${done - succeeded}` +
          (r ? ` last=${s.code} score=${r.totalScore.toFixed(0)}` : ` last=${s.code}(fail)`),
      );
      lastLog = done;
    }
    if (SLEEP_MS > 0) await sleep(SLEEP_MS);
    return r;
  });

  const successes = results.filter((r): r is MandalaResult => r !== null);
  const failedCount = targetUniverse.length - successes.length;
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(`\n[refresh] fetched ${successes.length}/${targetUniverse.length} (failed ${failedCount}, ${elapsed}s)`);

  // 失敗内訳サマリー
  if (failReasons.size > 0) {
    console.log('[refresh] failure reasons (top 5):');
    const sorted = [...failReasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    for (const [reason, count] of sorted) {
      console.log(`  ${count}x  ${reason}`);
    }
  }

  if (successes.length === 0) {
    console.error('[refresh] ERROR: 全銘柄取得失敗。原因 ↑ を確認してください');
    process.exit(1);
  }
  if (failedCount > targetUniverse.length * 0.5) {
    console.warn(`[refresh] WARNING: 失敗率 ${((failedCount / targetUniverse.length) * 100).toFixed(0)}% は高めです`);
  }

  // ---------- Upstash 書き込み ----------
  console.log(`[refresh] writing to Upstash...`);

  // 1) 個別マンダラを 100 件ずつバッチ書き込み
  const ttlMandala = 36 * 60 * 60; // 36h
  const BATCH = 100;
  for (let i = 0; i < successes.length; i += BATCH) {
    const batch = successes.slice(i, i + BATCH).map((r) => ({
      key: KV_KEYS.mandala(r.code),
      value: r,
      ttlSec: ttlMandala,
    }));
    await kvSetMany(batch);
    if ((i + BATCH) % 500 === 0 || i + BATCH >= successes.length) {
      console.log(`  mandala batches: ${Math.min(i + BATCH, successes.length)}/${successes.length}`);
    }
  }

  // 2) スリムランキング（全件、totalScore で降順）をチャンクで保存
  const slim = successes.map(toSlim).sort((a, b) => b.totalScore - a.totalScore);
  const chunks = await writeChunkedRanking(slim);
  console.log(`  ranking: ${slim.length} entries in ${chunks} chunks`);

  // 3) レガシー rankingAll（小ユニバース時のみ）
  if (targetUniverse.length <= LEGACY_RANKING_ALL_THRESHOLD) {
    await kvSet(KV_KEYS.rankingAll(), successes, ttlMandala);
    console.log(`  legacy ranking:all written (${successes.length} full entries)`);
  }

  // 4) メタ
  await kvSet(KV_KEYS.lastRefreshedAt(), new Date().toISOString(), 7 * 24 * 60 * 60);
  await kvSet(
    KV_KEYS.lastRefreshMeta(),
    {
      success: successes.length,
      failed: failedCount,
      universeSize: targetUniverse.length,
      durationMs: Date.now() - startedAt,
      finishedAt: new Date().toISOString(),
      source: 'stooq',
    },
    7 * 24 * 60 * 60,
  );

  const totalMs = Date.now() - startedAt;
  console.log(`\n[refresh] ✓ done in ${(totalMs / 1000 / 60).toFixed(1)} min`);
  console.log(`[refresh] success ${successes.length}, failed ${failedCount}`);
}

main().catch((e) => {
  console.error('[refresh] fatal error:', e);
  process.exit(1);
});
