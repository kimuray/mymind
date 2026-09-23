#!/usr/bin/env bash
# 作業終了前に、型・依存方向・デザイントークン・変更に関係するテストを確認する。
# 失敗したら exit 2 で終了を止め、Claude に修正を促す。
set -uo pipefail

input="$(cat)"
active="$(printf '%s' "$input" | node -e '
let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
  try { process.stdout.write(String(JSON.parse(s).stop_hook_active ?? false)); } catch { process.stdout.write("false"); }
});')"
# フックによる再実行中なら、無限ループを避けるために確認しない
[ "$active" = "true" ] && exit 0

cd "$CLAUDE_PROJECT_DIR" || exit 0

# 変更がなければ何もしない
if git diff --quiet HEAD -- 2>/dev/null && [ -z "$(git ls-files --others --exclude-standard)" ]; then
  exit 0
fi

failed=""
run() {
  local label="$1"; shift
  if ! out="$("$@" 2>&1)"; then
    failed="${failed}\n### ${label}\n${out}\n"
  fi
}

run "型チェック" pnpm typecheck
run "依存方向" pnpm deps:check
run "デザイントークン" pnpm design:check
run "設計文書（リンクと参照）" pnpm docs:check
run "変更に関係するテスト" pnpm exec vitest run --changed

if [ -n "$failed" ]; then
  printf '完了の前に次の問題を修正してください（AGENTS.md「完了の定義」）:\n%b' "$failed" >&2
  exit 2
fi
exit 0
