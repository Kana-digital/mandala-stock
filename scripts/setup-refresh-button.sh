#!/usr/bin/env bash
# scripts/setup-refresh-button.sh
#
# 「データ再生成ボタン」を有効にするためのワンショットセットアップ。
#   1. gh / vercel CLI の存在チェック
#   2. gh の workflow スコープを確保（必要なら追加ログイン）
#   3. ADMIN_PASSWORD を自動生成（既存があれば再利用するか聞く）
#   4. Vercel に GITHUB_TOKEN / ADMIN_PASSWORD を Production / Preview / Development の全環境へ追加
#   5. 表示された ADMIN_PASSWORD を 1Password などに保管するよう促して終了
#
# 使い方:
#   cd ~/Documents/Claude/Projects/4.7/mandala-stock
#   bash scripts/setup-refresh-button.sh
#
set -euo pipefail

bold()  { printf "\033[1m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
red()   { printf "\033[31m%s\033[0m\n" "$*" 1>&2; }
yellow(){ printf "\033[33m%s\033[0m\n" "$*"; }

bold "==> 1. CLI チェック"

if ! command -v gh >/dev/null 2>&1; then
  red "gh CLI が見つかりません。'brew install gh' でインストールしてから再実行してください。"
  exit 1
fi
green "  ✓ gh: $(gh --version | head -1)"

if ! command -v vercel >/dev/null 2>&1; then
  red "vercel CLI が見つかりません。'npm i -g vercel' でインストールしてから再実行してください。"
  exit 1
fi
green "  ✓ vercel: $(vercel --version 2>&1 | tail -1)"

bold "==> 2. GitHub 認証 + workflow スコープを確認"

if ! gh auth status >/dev/null 2>&1; then
  yellow "  gh にログインしていません。これからブラウザでログインします。"
  gh auth login -h github.com -p https -w -s "workflow,repo"
fi

# workflow スコープが付いているか確認
if ! gh auth status 2>&1 | grep -q "workflow"; then
  yellow "  既存トークンに workflow スコープがありません。スコープを追加します。"
  gh auth refresh -h github.com -s workflow
fi
green "  ✓ gh トークンに workflow スコープあり"

GITHUB_TOKEN_VALUE="$(gh auth token)"
if [[ -z "${GITHUB_TOKEN_VALUE}" ]]; then
  red "gh auth token が空でした。手動で 'gh auth login' を実行してください。"
  exit 1
fi
green "  ✓ GitHub トークン取得 (長さ=${#GITHUB_TOKEN_VALUE})"

bold "==> 3. ADMIN_PASSWORD を生成"

# 32 文字の URL-safe ランダム
ADMIN_PASSWORD_VALUE="$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)"
green "  ✓ 生成しました（最後にもう一度表示します）"

bold "==> 4. Vercel プロジェクトをリンク"

# プロジェクト直下で実行されている前提
if [[ ! -d ".vercel" ]]; then
  yellow "  .vercel がないので 'vercel link' を実行します。"
  vercel link
else
  green "  ✓ 既に link 済み"
fi

bold "==> 5. Vercel env を投入"

upsert_env() {
  local key="$1"
  local value="$2"
  for env in production preview development; do
    # 既存があれば一旦削除（vercel env add は重複時にプロンプトを出してしまうため）
    if vercel env ls "${env}" 2>/dev/null | awk '{print $1}' | grep -qx "${key}"; then
      yellow "    - ${env}: ${key} を上書きするので削除"
      printf "y\n" | vercel env rm "${key}" "${env}" >/dev/null 2>&1 || true
    fi
    printf "%s" "${value}" | vercel env add "${key}" "${env}" >/dev/null
    green "    ✓ ${env}: ${key} 追加完了"
  done
}

upsert_env GITHUB_TOKEN  "${GITHUB_TOKEN_VALUE}"
upsert_env ADMIN_PASSWORD "${ADMIN_PASSWORD_VALUE}"

bold "==> 6. Production 再デプロイ"

read -rp "今すぐ Production にデプロイしますか？ [y/N] " ans
ans_lower="$(printf '%s' "${ans:-}" | tr '[:upper:]' '[:lower:]')"
if [[ "${ans_lower}" =~ ^y(es)?$ ]]; then
  vercel deploy --prod
else
  yellow "  スキップ。次回 git push 時に env が反映されます。"
fi

bold "==> 完了 🎉"
echo
green "ADMIN_PASSWORD（このパスワードでデータ再生成ボタンが起動します）:"
echo
printf "    \033[1;36m%s\033[0m\n" "${ADMIN_PASSWORD_VALUE}"
echo
yellow "↑ このパスワードは二度と表示されません。1Password / メモアプリ等に保存してください。"
