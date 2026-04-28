# 毎朝自動更新セットアップ（全上場銘柄対応）

Claude Code 不要で **毎朝6時に全銘柄ぶんを自動更新** する仕組み。  
GitHub Actions（メイン）と macOS launchd（バックアップ）の二重化。

---

## 構成

```
Mac/GH Actions ──[毎朝]──> Yahoo Finance（住宅IPでBlock回避）
       │
       └──> Upstash Redis ──> Vercel API ──> ブラウザ
```

データ:
- `mandala:{code}`：個別銘柄のフルマンダラ（全銘柄）
- `ranking:slim:0,1,2,3`：チャンク化した全銘柄スリムランキング
- `ranking:slim:meta`：チャンク数・件数

ユニバース:
- `src/lib/jp-stocks.json`：全上場銘柄リスト
- 週1で `npm run update-universe` が JPX 公式から自動取得

---

## STEP 1: ローカル動作確認（Macで実行）

ターミナルで：

```bash
cd ~/Library/CloudStorage/Dropbox/Apps/cowork/4.7/mandala-stock

# 新規依存をインストール
npm install

# JPX から全銘柄リストを取得（src/lib/jp-stocks.json が更新される）
npm run update-universe

# 全銘柄ぶんマンダラを計算して Upstash に保存（30〜60分かかる）
npm run refresh

# 本番再デプロイ（API が新しい全銘柄ランキングを返すように）
vercel --prod
```

`npm run refresh` 中は進捗が `[100/3870] elapsed 90s ok=92 fail=8` のように出ます。  
失敗銘柄（`fail`）は Yahoo に上場廃止情報がない・データ未公開などで、無視して続行します。

完走したら https://mandala-stock.vercel.app/ranking でランキング表示を確認。

---

## STEP 2: 自動更新の選択（A か B か両方）

### A. GitHub Actions（推奨：常時稼働）

**メリット:** Mac 起動・ネット不要。サーバー側で毎朝必ず実行。  
**デメリット:** リポジトリを GitHub に置く必要あり（パブリックなら無料・無制限）。

#### 手順

1. **GitHub リポジトリを作成**（パブリック推奨：実行時間制限なし）

   ```bash
   cd ~/Library/CloudStorage/Dropbox/Apps/cowork/4.7/mandala-stock
   git init
   git add .
   git commit -m "Initial commit: mandala-stock with auto-refresh"
   ```

   GitHub の Web で空リポジトリを作成（例: `mandala-stock`）してから：

   ```bash
   git branch -M main
   git remote add origin git@github.com:YOUR_USERNAME/mandala-stock.git
   git push -u origin main
   ```

2. **GitHub Secrets を追加**

   GitHub の Settings → Secrets and variables → Actions → New repository secret で2つ追加：

   - `UPSTASH_REDIS_REST_URL` = `https://able-snail-108735.upstash.io`
   - `UPSTASH_REDIS_REST_TOKEN` = `gQAAAAAAAai_AAIgcDJjODVmY2UzOTA2ZDQ0ODJmOGFhOTJjOTY4ZjJlOGVhNA`

3. **動作確認**

   GitHub の Actions タブ → "Daily Mandala Refresh" → 右側の "Run workflow" ボタンで手動実行。  
   30〜60分後に成功すれば Vercel のランキングが更新されています。

4. **以降は自動実行**

   - 毎朝 6:00 JST → 全銘柄リフレッシュ（`refresh.yml`）
   - 毎週月曜 5:30 JST → JPX から銘柄リスト更新（`update-universe.yml`、変更があれば自動 commit）

### B. macOS launchd（Mac が常時起動している場合）

**メリット:** GitHub 不要。Mac 上で完結。  
**デメリット:** Mac がスリープ・電源 OFF だと走らない。

#### 手順

```bash
cd ~/Library/CloudStorage/Dropbox/Apps/cowork/4.7/mandala-stock

# launchd ジョブを登録（毎朝 7:00 AM 実行）
bash scripts/setup-launchd.sh

# 動作確認（実行中なら mandala の行が出る）
launchctl list | grep mandala

# 手動でいま走らせる
launchctl start com.mandala-stock.refresh

# ログ確認
tail -f logs/refresh.log

# 削除
bash scripts/setup-launchd.sh remove
```

注: macOS の「省電力」「スリープ」設定によっては実行されません。  
**システム設定 → バッテリー → 「ディスプレイがオフのときコンピュータを自動でスリープ」を OFF**、  
かつ電源接続中だけ動くようにしておくのが無難です。

### C. 両方併用（最強）

GitHub Actions + Mac launchd 両方有効にしておくと、片方が落ちても OK。  
時刻を 1 時間ずらしてあるので（GH 6:00 / launchd 7:00）、二重実行で問題が出るのは Upstash の同時書き込みだけ。同じキーに上書きするだけなので実質無害。

---

## 銘柄数の目安

| ユニバース | 件数 | 1回あたり所要時間 |
|---|---|---|
| 日経225 ベース | 80 | 約 1〜2 分 |
| プライム+スタンダード+グロース | 約 3,800 | 30〜60 分 |

`refresh` 中の Yahoo Finance 429（レート制限）はリトライで救うので、失敗率は通常 1〜5% 程度に収まります。

---

## トラブルシューティング

### 全銘柄失敗する（Yahoo 429）

- GH Actions: 並列度を下げる → `.github/workflows/refresh.yml` の `REFRESH_CONCURRENCY: '5'` を `'3'` などに。
- 一時的な IP ブロックなら数時間〜1日待つと解除される。

### Upstash の容量・コマンド数が足りない

- Free plan: 256MB、10,000 commands/day。3,900 銘柄 × 1 SET ≒ 4,000 commands/day なので余裕あり。
- 心配なら Upstash の Usage ページで実績確認。

### ランキングが出ない（503）

- Vercel のログで `KV not configured` なら、Vercel 環境変数に Upstash の URL/Token が無い。
- `vercel env ls` で確認、無ければ追加。

### universe.json の commit でコケる（GH Actions）

- リポジトリ Settings → Actions → General → Workflow permissions で **"Read and write permissions"** を ON。

---

## ファイル一覧

```
src/lib/jp-stocks.json           ← 全上場銘柄リスト（自動更新）
src/lib/universe.ts              ← jp-stocks.json をロード
src/lib/clients/kv.ts            ← Upstash クライアント（チャンク対応）
src/lib/clients/yahoo.ts         ← Yahoo Finance クライアント
scripts/refresh.ts               ← マンダラ一括計算＆KV書き込み
scripts/update-universe.ts       ← JPX エクセルから銘柄リスト更新
scripts/run-refresh.sh           ← launchd / cron 用ラッパー
scripts/setup-launchd.sh         ← launchd ジョブのインストーラ
.github/workflows/refresh.yml          ← 毎朝の自動 refresh
.github/workflows/update-universe.yml  ← 週次の銘柄リスト更新
```
