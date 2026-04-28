/**
 * JPX 公式エクセルから全上場銘柄リストを取得して
 * src/lib/jp-stocks.json を更新する。
 *
 * 使い方:
 *   npm run update-universe
 *
 * 動作:
 *   1. JPX 公式 (https://www.jpx.co.jp/.../data_j.xls) をダウンロード
 *   2. シートをパース
 *   3. 内国株式（普通株）のみ抽出（ETF/REIT/外国株は除外）
 *   4. 4桁数字コードのみ
 *   5. src/lib/jp-stocks.json を上書き
 *
 * 実行頻度: 週1（GH Actions）
 */

import * as XLSX from 'xlsx';
import * as fs from 'node:fs';
import * as path from 'node:path';

const JPX_URL = 'https://www.jpx.co.jp/markets/statistics-equities/misc/tvdivq0000001vg2-att/data_j.xls';

type Stock = { code: string; name: string; sector: string; market: string };

function pick(row: Record<string, unknown>, candidates: string[]): string {
  for (const c of candidates) {
    const v = row[c];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

async function main() {
  console.log(`[update-universe] downloading JPX list from ${JPX_URL}`);
  const res = await fetch(JPX_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; mandala-stock-bot/1.0)',
      Accept: 'application/vnd.ms-excel,*/*',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`[update-universe] downloaded ${buf.byteLength.toLocaleString()} bytes`);

  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  console.log(`[update-universe] parsed ${rows.length} rows from sheet "${sheetName}"`);

  if (rows.length > 0) {
    console.log('[update-universe] columns:', Object.keys(rows[0]).join(', '));
  }

  const stocks: Stock[] = [];
  let skippedNonDomestic = 0;
  let skippedNonNumeric = 0;
  let skippedNoName = 0;

  for (const row of rows) {
    const code = pick(row, ['コード', 'Code', 'code']);
    const name = pick(row, ['銘柄名', '銘柄', 'Name', 'name']);
    const sector = pick(row, ['33業種区分', '17業種区分', '業種', 'Sector']);
    const market = pick(row, ['市場・商品区分', '市場区分', 'Market', 'market']);

    if (!code || !/^\d{4}$/.test(code)) {
      skippedNonNumeric++;
      continue;
    }
    if (!name) {
      skippedNoName++;
      continue;
    }
    // 内国株式（普通株）のみ。ETF/REIT/外国株/PRO Marketは除外
    if (!market.includes('内国株式')) {
      skippedNonDomestic++;
      continue;
    }

    stocks.push({
      code,
      name,
      sector: sector || 'その他',
      market: market.replace(/（内国株式）/g, '').trim(),
    });
  }

  console.log(`[update-universe] kept: ${stocks.length}`);
  console.log(`[update-universe] skipped non-domestic: ${skippedNonDomestic}`);
  console.log(`[update-universe] skipped non-numeric code: ${skippedNonNumeric}`);
  console.log(`[update-universe] skipped no-name: ${skippedNoName}`);

  if (stocks.length < 1000) {
    console.error(`[update-universe] WARNING: 銘柄数 ${stocks.length} は想定より少ない（通常 3,500-4,000）`);
  }

  // 市場別の内訳
  const byMarket = stocks.reduce<Record<string, number>>((acc, s) => {
    acc[s.market] = (acc[s.market] ?? 0) + 1;
    return acc;
  }, {});
  console.log('[update-universe] by market:', byMarket);

  // ソート（コード順）
  stocks.sort((a, b) => a.code.localeCompare(b.code));

  const out = {
    updatedAt: new Date().toISOString().slice(0, 10),
    source: 'JPX data_j.xls',
    count: stocks.length,
    stocks,
  };

  const outPath = path.resolve(__dirname, '..', 'src', 'lib', 'jp-stocks.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf-8');
  console.log(`[update-universe] ✓ wrote ${outPath} (${stocks.length} stocks)`);
}

main().catch((e) => {
  console.error('[update-universe] error:', e);
  process.exit(1);
});
