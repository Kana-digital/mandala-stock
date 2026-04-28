#!/bin/bash
# launchd / cron から呼ばれる refresh ラッパー
# .env.local 読み込みと PATH 設定を行い npm run refresh を実行

set -e

# プロジェクトルートに移動
cd "$(dirname "${BASH_SOURCE[0]}")/.."

mkdir -p logs

# Homebrew Node を確実に PATH に通す（Apple Silicon / Intel 両対応）
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

# .env.local をロード（launchd は環境変数を継承しない）
if [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

# タイムスタンプ付きで実行
echo ""
echo "===== refresh start: $(date) ====="
npm run refresh
echo "===== refresh end:   $(date) ====="
