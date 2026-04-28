/**
 * Mandala データ更新スクリプト（全上場銘柄対応版）
 *
 * 使い方:
 *   npm run refresh
 *
 * 動作:
 *   1. src/lib/jp-stocks.json から全銘柄ロード
 *   2. Yahoo Finance から並列取得（concurrency 6, sleep 100ms）
 *   3. 失敗銘柄はスキップして続行（429 は exponential backoff で 2回リトライ）
 *   4. 個別マンダラを Upstash に書き込み（mandala:{code}）
 *   5. スリムランキングを 1000 件単位でチャンク保存（ranking:slim:N）
 *
 * 実行環境:
 *   - Mac/macOS launchd（住宅 IP）→ Yahoo に通る
 *   - GitHub Actions runner → Yahoo に通る（IP 共有のため稀に 429）
 *   - Vercel Function → Yahoo に弾かれるので NG（このスクリプトでは使わない）
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

import { yfChart, yfQuoteSummary } from '../src/lib/clients/yahoo';
import { UNIVERSE, toYfTicker } from '../src/lib/universe';
import { buildMandala, type MandalaResult } from '../src/lib/mandala-engine';
import {
  kvSet,
  kvSetMany,
  KV_KEYS,
  isKvEnabled,
  type SlimRankingEntry,
  type SlimRankingMeta,
} from '../src/lib/clients/kv';

// 同時並列数（Yahoo の優しさを乱用しない）
// デフォルトは保守的に2並列。大丈夫そうなら REFRESH_CONCURRENCY=4 などで上げる
const CONCURRENCY = Number(process.env.REFRESH_CONCURRENCY ?? 2);
// 各リクエスト後の sleep（ms）
const SLEEP_MS = Number(process.env.REFRESH_SLEEP_MS ?? 500);
// リトライ最大回数（429 のとき exponential backoff）
const MAX_RETRIES = 3;
// 429 が連続したら長時間休む（ミリ秒）
const RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000; // 5 分
// 連続 429 のしきい値
const RATE_LIMIT_BURST_THRESHOLD = 10;
// 進捗ログを出す間隔（銘柄数）
const LOG_INTERVAL = 100;
// スリムランキング 1チャンクあたりのエントリ数
const RANKING_CHUNK_SIZE = 1000;
// rankingAll（レガシー）に保存する閾値: ユニバースが小さいときだけ
const LEGACY_RANKING_ALL_THRESHOLD = 500;

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

function isRateLimitError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /429|too many requests|rate limit/i.test(msg);
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
// 連続 429 検出用（共有ステート）
let consecutiveRateLimits = 0;
let lastCooldownAt = 0;

async function computeOne(
  stock: { code: string; name: string; sector: string },
): Promise<MandalaResult | null> {
  const ticker = toYfTicker(stock.code);

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const [chart, summary] = await Promise.all([
        yfChart(ticker, '1y'),
        yfQuoteSummary(ticker),
      ]);
      consecutiveRateLimits = 0; // 成功したらリセット
      return buildMandala({ ...stock, chart, summary });
    } catch (e) {
      lastErr = e as Error;
      if (isRateLimitError(e)) {
        consecutiveRateLimits++;
        // 連続429がしきい値超えたら長期クールダウン（並列ワーカ全員が同時に通る）
        if (
          consecutiveRateLimits >= RATE_LIMIT_BURST_THRESHOLD &&
          Date.now() - lastCooldownAt > RATE_LIMIT_COOLDOWN_MS
        ) {
          lastCooldownAt = Date.now();
          console.log(
            `\n[refresh] ⚠ rate-limited ${consecutiveRateLimits}回連続 → ${RATE_LIMIT_COOLDOWN_MS / 1000}秒クールダウン`,
          );
          await sleep(RATE_LIMIT_COOLDOWN_MS);
          consecutiveRateLimits = 0;
        }
        if (attempt < MAX_RETRIES) {
          const wait = 3000 * Math.pow(2, attempt); // 3s, 6s, 12s
          await sleep(wait);
          continue;
        }
      }
      break;
    }
  }
  if (lastErr) {
    const msg = lastErr.message.slice(0, 60);
    if (sampleErrors.length < 3) {
      console.error(`  ✗ ${stock.code} ${stock.name}: ${lastErr.message.slice(0, 200)}`);
      sampleErrors.push(stock.code);
    }
    const key = msg.replace(/[\d.]+/g, 'N');
    failReasons.set(key, (failReasons.get(key) ?? 0) + 1);
  }
  return null;
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
  console.log(`[refresh] universe: ${UNIVERSE.length} stocks`);
  console.log(`[refresh] concurrency: ${CONCURRENCY}, sleep: ${SLEEP_MS}ms`);

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
    if (done - lastLog >= LOG_INTERVAL || done === UNIVERSE.length) {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
      console.log(
        `  [${done}/${UNIVERSE.length}] elapsed ${elapsed}s ok=${succeeded} fail=${done - succeeded}` +
          (r ? ` last=${s.code} score=${r.totalScore.toFixed(0)}` : ` last=${s.code}(fail)`),
      );
      lastLog = done;
    }
    await sleep(SLEEP_MS);
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
