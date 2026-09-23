#!/usr/bin/env bash
# 編集されたファイルを Biome で整形・lint する。問題があれば exit 2 で Claude に修正を促す。
set -uo pipefail

input="$(cat)"
file="$(printf '%s' "$input" | node -e '
let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
  try { const j = JSON.parse(s); process.stdout.write(j.tool_input?.file_path ?? ""); } catch { }
});')"

case "$file" in
  *.ts|*.tsx|*.js|*.mjs|*.cjs|*.json|*.css) ;;
  *) exit 0 ;;
esac
[ -f "$file" ] || exit 0

cd "$CLAUDE_PROJECT_DIR" || exit 0
if ! out="$(pnpm exec biome check --write "$file" 2>&1)"; then
  {
    echo "Biome が問題を検出しました。.claude/rules/coding.md に沿って修正してください。"
    echo "$out"
  } >&2
  exit 2
fi
exit 0
