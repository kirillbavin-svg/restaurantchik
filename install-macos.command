#!/bin/zsh
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_BIN="$(command -v node)"
PLIST="$HOME/Library/LaunchAgents/home.restaurantchik.app.plist"
mkdir -p "$HOME/Library/LaunchAgents"
sed -e "s|__NODE__|$NODE_BIN|g" -e "s|__DIR__|$SCRIPT_DIR|g" "$SCRIPT_DIR/macos/home.restaurantchik.app.plist.template" > "$PLIST"
launchctl bootout "gui/$(id -u)/home.restaurantchik.app" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/home.restaurantchik.app"
IP="$(ipconfig getifaddr en0 2>/dev/null || echo localhost)"
echo ""
echo "Ресторанчик запущен: http://$IP:3030"
echo "Теперь он будет автоматически запускаться вместе с Mac."
read "?Нажмите Enter, чтобы закрыть…"
