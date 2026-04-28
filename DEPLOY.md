# マンダラ株分析 — デプロイ手順 (Vercel + GitHub)

> Vercel Hobby（無料）で iPhone から PWA として使えるようにする手順です。
> Apple Developer 登録は **不要** です。

---

## 0. 前提

- GitHub アカウント
- Vercel アカウント（GitHub でログイン可）
- 任意：J-Quants / EDINET / FRED / NewsAPI / e-Stat の各 API キー
  （未設定でもアプリは動きます。該当軸はモックまたはエラー表示になります）

---

## 1. ローカル動作確認

```bash
cd mandala-stock
npm install
npm run dev
# → http://localhost:3000 を開く
```

Basic 認証が掛かっている場合は、以下を `.env.local` に書きます：

```
BASIC_AUTH_USER=kana
BASIC_AUTH_PASS=your-passphrase
```

> `middleware.ts` が `BASIC_AUTH_USER` と `BASIC_AUTH_PASS` を要求します。
> 設定しない場合は **誰でもアクセス可能** になりますのでご注意。

---

## 2. GitHub に push

```bash
cd mandala-stock          # まだの場合
git init
git add .
git commit -m "Initial commit: マンダラ株分析 PWA"

# GitHub の Web UI で空のリポジトリを作成（例: kana/mandala-stock）
git branch -M main
git remote add origin https://github.com/<your-user>/mandala-stock.git
git push -u origin main
```

> プライベートリポジトリで OK。公開する場合は API キーを `.env.local` に置き、
> リポジトリには絶対コミットしないこと（`.gitignore` で除外済み）。

---

## 3. Vercel に import

1. <https://vercel.com/new> を開く
2. 「Import Git Repository」で先ほどのリポジトリを選択
3. **Framework Preset = Next.js** が自動で選ばれていることを確認
4. **Environment Variables** に以下を追加（任意）：

   | Key | 用途 | 例 |
   |-----|------|-----|
   | `BASIC_AUTH_USER` | Basic 認証ユーザー名 | `kana` |
   | `BASIC_AUTH_PASS` | Basic 認証パスワード | `your-passphrase` |
   | `JQUANTS_REFRESH_TOKEN` | J-Quants の refresh token | - |
   | `EDINET_API_KEY` | EDINET v2 の API キー | - |
   | `FRED_API_KEY` | FRED の API キー | - |
   | `NEWSAPI_KEY` | NewsAPI のキー | - |
   | `ESTAT_APP_ID` | e-Stat のアプリ ID | - |
   | `CRON_SECRET` | Vercel Cron 認証用ランダム文字列 | `openssl rand -hex 32` の出力 |

5. 「Deploy」を押す
6. 数分後に `https://mandala-stock-xxxx.vercel.app` のような URL が払い出される

---

## 4. Vercel Cron の確認

`vercel.json` に以下が設定済みです：

```json
{
  "crons": [
    { "path": "/api/cron/warm-macro", "schedule": "0 22 * * *" }
  ]
}
```

これによりマクロ系 API のキャッシュを毎日 UTC 22:00（日本時間 翌 7:00）に
ウォームアップします。Vercel Dashboard → Project → Settings → Crons で
「Last run」を見れば動作確認できます。

> Cron は `Authorization: Bearer ${CRON_SECRET}` を投げてくるため、
> `CRON_SECRET` を設定してください（未設定だと 401 になります）。

---

## 5. iPhone に PWA としてインストール

1. Safari（必ず Safari）で本番 URL を開く
2. 共有メニュー → **「ホーム画面に追加」** をタップ
3. 名前を確認して「追加」
4. ホーム画面のアイコンから起動するとアドレスバーが消え、ネイティブアプリ風に動作

> 初回起動時に Service Worker が登録され、2 回目以降はオフラインでも
> 過去入力データ（IndexedDB）が表示されます。

---

## 6. 既知の制約と対処

| 症状 | 原因 | 対処 |
|------|------|------|
| Basic 認証ダイアログが出ない | `middleware.ts` の matcher から外れている | matcher 確認 |
| `/api/cron/...` が 401 | `CRON_SECRET` 未設定 | Vercel に環境変数追加 |
| トレンドが取れない (`429`) | Google Trends のレート制限 | `withCache` で 6h キャッシュ済み。時間を置く |
| 業績軸が空 | `JQUANTS_REFRESH_TOKEN` 未設定 | キーを取得して環境変数に追加 |
| 端末を変えるとデータ消失 | IndexedDB はブラウザ単位 | 設定 → 「JSONエクスポート」で月1バックアップ |

---

## 7. 機種変・ブラウザ移行

1. 旧端末で 設定 → **「JSONエクスポート」** → ファイル共有で新端末に転送
2. 新端末でアプリを開き、設定 → **「JSONインポート」** で復元

---

## 8. 更新（再デプロイ）

```bash
# 修正してから
git add .
git commit -m "Update: ..."
git push
```

`main` への push が Vercel に検知され、自動でビルド & デプロイされます。
プレビューが欲しい場合は別ブランチで PR を作ると、PR ごとに preview URL が払い出されます。

---

## 付録：ローカルだけで使う場合

PWA インストールはローカルでも可能ですが、`http://` だと一部機能が制限されます。
`npm run build && npm start` で本番ビルドを動かし、
LAN 内 IP（`http://192.168.x.x:3000`）に Safari からアクセスすれば iPhone でも試せます。
ただし「ホーム画面に追加」したアイコンから起動するなら HTTPS が必要なので、
正式運用は Vercel 経由がおすすめです。
