/**
 * Mandala データ更新スクリプト（J-Quants 版・全上場銘柄対応）
 *
 * 使い方:
 *   npm run refresh
 *
 * 動作:
 *   1. J-Quants /listed/info で全銘柄メタを 1 回だけプリフェッチ → Map<code, JqListedInfo>
 *   2. src/lib/jp-stocks.json から自分側の銘柄ユニバースをロード
 *   3. 各銘柄について並列で
 *      - /equities/bars/daily?from=...&to=... で 1.5 年分の日足を取得
 *      - /fins/statements?code=... で四半期決算履歴を取得
 *   4. quotesToChart / buildMandalaSummary で mandala-engine 入力に変換
 *   5. buildMandala で 81 セルのマンダラを生成
 *   6. Upstash Redis に書き込み（mandala:{code} と ranking:slim:N）
 *
 * 設計判断:
 *   - Yahoo / Stooq は 2026/04 時点で GH Actions / Vercel から完全 IP ブロック中
 *   - J-Quants V2 はクラウド IP 制限なし（公式 API）。x-api-key ヘッダー認証のみ
 *   - 無料プランは 12 週遅れだが、252 営業日の履歴が取れるので
 *     RSI / MACD / SMA / 52 週レンジ等のテクニカル系は機能する
 *   - ファンダは /fins/statements の最新四半期から PER / 利益率 / YoY を合成
 *     PBR / ROE / D/E などは無料で取れないので null（mandala-engine が「未取得」扱いにする）
 *   - 旧 forecast カテゴリ（アナリスト目標）は廃止し、出来高サージ + 高値接近度 + ボラ急騰の
 *     注目度 attention カテゴリに置換した（mandala-engine.ts 側で実装）
 *
 * レート制限:
 *   - J-Quants V2 はおおむね寛容だが、3,589 銘柄 × 2 リクエスト = 7,178 リクエストを
 *     一気に投げると 429 を喰う可能性があるので concurrency=3, sleep=200ms を既定値とする
 *   - 環境変数 REFRESH_CONCURRENCY / REFRESH_SLEEP_MS で調整可能
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

import {
  fetchDailyQuotes,
  fetchAllDailyQuotesInRange,
  fetchStatements,
  fetchAllListedInfo,
  type JqDailyBar,
  type JqListedInfo,
} from '../src/lib/clients/jquants';
import {
  quotesToChart,
  buildMandalaSummary,
} from '../src/lib/adapters/jquants-mandala';
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

// 同時並列数（Free プランはレート制限が厳しいので 1）
const CONCURRENCY = Number(process.env.REFRESH_CONCURRENCY ?? 1);
// 各リクエスト後の sleep（ms）
const SLEEP_MS = Number(process.env.REFRESH_SLEEP_MS ?? 1500);
// J-Quants からの取得タイムアウト
const FETCH_TIMEOUT_MS = Number(process.env.REFRESH_TIMEOUT_MS ?? 20000);
// 進捗ログを出す間隔（銘柄数）
const LOG_INTERVAL = 100;
// スリムランキング 1チャンクあたりのエントリ数
const RANKING_CHUNK_SIZE = 1000;
// rankingAll（レガシー）に保存する閾値: ユニバースが小さいときだけ
const LEGACY_RANKING_ALL_THRESHOLD = 500;
// 日足取得期間（営業日 252 ≒ 1.5 年）
const HISTORY_DAYS = 540; // カレンダー日。土日祝込みでも 252 営業日は確保できる
// Free プラン: 12 週遅延 → to は今日より 84 日以上前を指定する必要あり
// （余裕を見て 90 日前にする）
const FREE_PLAN_DELAY_DAYS = 90;

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
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

/** タイムアウト付き Promise */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch((e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

async function computeOne(
  stock: { code: string; name: string; sector: string },
  fromDate: string,
  toDate: string,
  listedInfoMap: Map<string, JqListedInfo>,
  prefetchedBars?: Map<string, JqDailyBar[]>,
): Promise<MandalaResult | null> {
  try {
    // J-Quants は 4 桁コードでも 5 桁コード（末尾 0 付与）でも受け付けるが、
    // /listed/info は 4 桁で返ってくるケースが多い。揃えるため 4→4 のまま渡す。
    const code = stock.code;

    // 日足: bulk 事前取得済みなら map から取り出し、そうでなければ個別取得
    const quotesPromise: Promise<JqDailyBar[]> = prefetchedBars
      ? Promise.resolve(prefetchedBars.get(code) ?? prefetchedBars.get(code + '0') ?? [])
      : withTimeout(fetchDailyQuotes(code, fromDate, toDate), FETCH_TIMEOUT_MS, `quotes ${code}`);

    // 決算は per-stock のみ
    const [quotes, statements] = await Promise.all([
      quotesPromise,
      withTimeout(fetchStatements(code), FETCH_TIMEOUT_MS, `statements ${code}`).catch(() => []),
    ]);

    if (!quotes || quotes.length < 30) {
      const key = 'insufficient bars (<30)';
      failReasons.set(key, (failReasons.get(key) ?? 0) + 1);
      return null;
    }

    const chart = quotesToChart(code, quotes);
    if (chart.bars.length < 30) {
      const key = 'insufficient bars after filter (<30)';
      failReasons.set(key, (failReasons.get(key) ?? 0) + 1);
      return null;
    }

    const lastClose = chart.bars[chart.bars.length - 1]?.close ?? null;
    const listedInfo = listedInfoMap.get(code) ?? null;
    const summary = buildMandalaSummary({
      code,
      listedInfo,
      statements,
      lastClose,
    });

    // 業種は J-Quants 側を優先、無ければ universe.json 側
    const sector = summary.sector ?? stock.sector;
    const name = listedInfo?.CoName ?? stock.name;

    return buildMandala({
      code,
      name,
      sector,
      chart,
      summary,
    });
  } catch (e) {
    const err = e as Error;
    const msg = err.message.slice(0, 100);
    if (sampleErrors.length < 5) {
      console.error(`  ✗ ${stock.code} ${stock.name}: ${msg}`);
      sampleErrors.push(stock.code);
    }
    // メッセージ中の数値は集計用に伏せる
    const key = msg.replace(/[\d.]+/g, 'N');
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
  console.log(`[refresh] data source: J-Quants V2 (https://api.jquants.com/v2)`);
  console.log(`[refresh] universe: ${UNIVERSE.length} stocks`);
  console.log(`[refresh] concurrency: ${CONCURRENCY}, sleep: ${SLEEP_MS}ms, timeout: ${FETCH_TIMEOUT_MS}ms`);

  if (!process.env.JQUANTS_REFRESH_TOKEN) {
    console.error('[refresh] ERROR: JQUANTS_REFRESH_TOKEN が未設定。GH Secrets を確認してください');
    process.exit(1);
  }
  if (!isKvEnabled()) {
    console.error('[refresh] ERROR: UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN が未設定');
    process.exit(1);
  }
  if (UNIVERSE.length === 0) {
    console.error('[refresh] ERROR: universe が空。`npm run update-universe` を先に実行してください');
    process.exit(1);
  }

  // ---------- /listed/info を 1 回だけプリフェッチ ----------
  console.log('[refresh] prefetching /listed/info ...');
  let listedInfoMap = new Map<string, JqListedInfo>();
  try {
    const all = await fetchAllListedInfo();
    for (const info of all) {
      // J-Quants の Code は 5 桁（末尾 0 付き）で返ってくるケースもあるので両方登録
      const c4 = info.Code.slice(0, 4);
      listedInfoMap.set(info.Code, info);
      listedInfoMap.set(c4, info);
    }
    console.log(`[refresh] listedInfo: ${all.length} records (mapped ${listedInfoMap.size} keys)`);
  } catch (e) {
    console.warn(`[refresh] WARNING: /listed/info プリフェッチ失敗 (${(e as Error).message})。会社名は universe.json 側を使う`);
    listedInfoMap = new Map();
  }

  // TOPIX サイズ区分でユニバースを絞る。
  // J-Quants Free プランのレート制限と GH Actions の実行時間制約上、
  // 全 3,589 銘柄を取得するのは現実的でないため。
  //   topix100 = Core30 + Large70 (~100銘柄)
  //   topix500 = Core30 + Large70 + Mid400 (~500銘柄)
  //   all      = 全銘柄
  const scaleFilter = process.env.SCALE_FILTER ?? 'topix100';
  const TOPIX100_SCALES = new Set(['TOPIX Core30', 'TOPIX Large70']);
  const TOPIX500_SCALES = new Set(['TOPIX Core30', 'TOPIX Large70', 'TOPIX Mid400']);
  let scaleFilteredUniverse = UNIVERSE;
  if (scaleFilter === 'topix100' && listedInfoMap.size > 0) {
    scaleFilteredUniverse = UNIVERSE.filter((s) => {
      const info = listedInfoMap.get(s.code);
      return info?.ScaleCat && TOPIX100_SCALES.has(info.ScaleCat);
    });
    console.log(
      `[refresh] SCALE_FILTER=topix100 → ${scaleFilteredUniverse.length} stocks (Core30+Large70) of ${UNIVERSE.length}`,
    );
  } else if (scaleFilter === 'topix500' && listedInfoMap.size > 0) {
    scaleFilteredUniverse = UNIVERSE.filter((s) => {
      const info = listedInfoMap.get(s.code);
      return info?.ScaleCat && TOPIX500_SCALES.has(info.ScaleCat);
    });
    console.log(
      `[refresh] SCALE_FILTER=topix500 → ${scaleFilteredUniverse.length} stocks (Core30+Large70+Mid400) of ${UNIVERSE.length}`,
    );
  } else {
    console.log(`[refresh] SCALE_FILTER=${scaleFilter} → using full universe (${UNIVERSE.length})`);
  }

  // テスト用: LIMIT=10 で先頭10銘柄だけ処理
  const limit = Number(process.env.LIMIT ?? scaleFilteredUniverse.length);
  const targetUniverse =
    limit < scaleFilteredUniverse.length ? scaleFilteredUniverse.slice(0, limit) : scaleFilteredUniverse;
  if (limit < scaleFilteredUniverse.length) {
    console.log(`[refresh] LIMIT=${limit} → testing with first ${targetUniverse.length} stocks`);
  }

  // 取得期間: Free プランは 12 週遅延が厳格チェックされ、`to` を今日にすると 400 を返す。
  // よって `to = 今日 - 90 日` を上限に固定する（fromもそこから HISTORY_DAYS 遡る）
  const now = new Date();
  const toDateObj = new Date(now.getTime() - FREE_PLAN_DELAY_DAYS * 24 * 60 * 60 * 1000);
  const fromDateObj = new Date(toDateObj.getTime() - HISTORY_DAYS * 24 * 60 * 60 * 1000);
  const fromDate = ymd(fromDateObj);
  const toDate = ymd(toDateObj);
  console.log(`[refresh] history range: ${fromDate} → ${toDate} (~${HISTORY_DAYS} days; to = today - ${FREE_PLAN_DELAY_DAYS}d for free plan delay)`);

  // ---------- 日足を「日付 × 全銘柄」で bulk 事前取得（オプション） ----------
  // BULK_PRICES=true（既定）: /equities/bars/daily?date=... を営業日ごとに 1 回呼び、
  //   全銘柄の bar を Map<code, JqDailyBar[]> に集約する。
  //   リクエスト数: ~営業日数 (~370 日 × 1 = 370 reqs) + 銘柄数（statements 用）
  //   ↔ 旧来は 銘柄数 × 2 = 2N reqs だったので、N=489 なら 978 → ~860 と微減。
  //   ただし日付単位のレスポンスは大きいので、Free プランの req カウンタ的に有利。
  // BULK_PRICES=false: 旧来どおり銘柄ごとに /equities/bars/daily?code=... を呼ぶ。
  const useBulkPrices = (process.env.BULK_PRICES ?? 'true').toLowerCase() !== 'false';
  let prefetchedBars: Map<string, JqDailyBar[]> | undefined;
  if (useBulkPrices) {
    console.log(`[refresh] BULK_PRICES=true → prefetching daily bars by date (${fromDate} → ${toDate})...`);
    const bulkStart = Date.now();
    let lastDayLog = 0;
    prefetchedBars = await fetchAllDailyQuotesInRange(fromDate, toDate, SLEEP_MS, (done, total, lastDate) => {
      if (done - lastDayLog >= 20 || done === total) {
        const elapsed = ((Date.now() - bulkStart) / 1000).toFixed(0);
        console.log(`  [bulk ${done}/${total}] elapsed ${elapsed}s lastDate=${lastDate} codes=${prefetchedBars?.size ?? 0}`);
        lastDayLog = done;
      }
    });
    const bulkElapsed = ((Date.now() - bulkStart) / 1000).toFixed(0);
    console.log(`[refresh] bulk done: ${prefetchedBars.size} codes in ${bulkElapsed}s`);
  } else {
    console.log(`[refresh] BULK_PRICES=false → per-stock fetchDailyQuotes`);
  }

  // ---------- データ取得 ----------
  let done = 0;
  let succeeded = 0;
  let lastLog = 0;
  const results = await poolRun(targetUniverse, CONCURRENCY, async (s) => {
    const r = await computeOne(s, fromDate, toDate, listedInfoMap, prefetchedBars);
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
      source: 'jquants',
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
