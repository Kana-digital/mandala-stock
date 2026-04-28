#!/bin/bash
# Mac で毎朝 7:00 に refresh を自動実行するための launchd 設定
#
# 使い方:
#   bash scripts/setup-launchd.sh         # インストール
#   bash scripts/setup-launchd.sh remove  # 削除

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.mandala-stock.refresh"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"

if [ "${1:-install}" = "remove" ]; then
  if [ -f "$PLIST_PATH" ]; then
    launchctl unload "$PLIST_PATH" 2>/dev/null || true
    rm "$PLIST_PATH"
    echo "✓ Removed: $PLIST_PATH"
  else
    echo "Not installed: $PLIST_PATH"
  fi
  exit 0
fi

# 既存があれば一旦 unload
if [ -f "$PLIST_PATH" ]; then
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
fi

mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$PROJECT_DIR/logs"

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${PROJECT_DIR}/scripts/run-refresh.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>7</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${PROJECT_DIR}/logs/refresh.log</string>
  <key>StandardErrorPath</key>
  <string>${PROJECT_DIR}/logs/refresh.err.log</string>
  <key>RunAtLoad</key>
  <false/>
  <key>WorkingDirectory</key>
  <string>${PROJECT_DIR}</string>
</dict>
</plist>
EOF

chmod +x "$PROJECT_DIR/scripts/run-refresh.sh"
launchctl load "$PLIST_PATH"

echo "✓ Installed: ${LABEL}"
echo "✓ Schedule:  毎日 7:00 AM"
echo "✓ Logs:      ${PROJECT_DIR}/logs/refresh.log"
echo ""
echo "確認:        launchctl list | grep mandala"
echo "今すぐ実行:   launchctl start ${LABEL}"
echo "停止:        bash $0 remove"
