// 人のレビューが必須になる変更の判定（issue 023 の暫定決定）。
// merge-if-allowed.mjs（手元）と pr-policy.mjs（CI）の両方がこの定義を使う。
export const REVIEW_REQUIRED = [
  /^packages\/domain\/src\/(status|rules[^/]*)\.ts$/,
  /^packages\/db\/src\/schema/,
  /^packages\/db\/migrations\//,
  /^prompts\//,
  /^apps\/server\/src\/security\//,
  /^docs\/adr\//,
  /^docs\/requirements\.md$/,
  /^AGENTS\.md$/,
  /^CLAUDE\.md$/,
  /^\.claude\//,
  /^\.github\//,
  /^biome\.json$/,
  /^\.dependency-cruiser\.cjs$/,
  /^scripts\/(merge-if-allowed|review-policy|pr-policy|doctor|github-setup|issues-to-github)\.mjs$/,
  /(^|\/)package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^Dockerfile$/,
  /^compose\.yaml$/,
  /^\.dockerignore$/,
  /^\.devcontainer\//,
];

/** レビュー必須の対象になったファイルの一覧を返す */
export function reviewRequiredFiles(paths) {
  return paths.filter((p) => REVIEW_REQUIRED.some((re) => re.test(p)));
}

/** PR のタイトルが Conventional Commits の形式か */
export const TITLE_PATTERN =
  /^(feat|fix|docs|test|refactor|chore|perf|build|ci)(\([\w-]+\))?!?: .+/;

/** PR の本文が issue を参照しているか（Closes / Fixes / Resolves / Refs） */
export const ISSUE_REF_PATTERN = /\b(closes|fixes|resolves|refs)\s+#\d+/i;
