import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { z } from 'zod';

/**
 * .app を作ったときの情報（FR-U05、ADR-0017）。scripts/packageApp.mjs が Resources/app に書き、
 * アプリが更新を確かめるときに読む。開発時の起動（electron .）にはない
 */
export const BUILD_INFO_FILE = 'build-info.json';

export const buildInfoSchema = z.object({
  /** .app を作ったコミット（完全なハッシュ） */
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  /** .app を作ったリポジトリ。更新の確認（git fetch）と適用（pnpm update-app）をここで行う */
  repoPath: z.string().refine(isAbsolute, '絶対パスではありません'),
});

export type BuildInfo = z.infer<typeof buildInfoSchema>;

export type ReadBuildInfoResult =
  | { kind: 'ok'; info: BuildInfo }
  | { kind: 'missing' }
  | { kind: 'invalid'; reason: string };

export function readBuildInfo(path: string): ReadBuildInfoResult {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') return { kind: 'missing' };
    return { kind: 'invalid', reason: e instanceof Error ? e.message : String(e) };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { kind: 'invalid', reason: 'JSON として読めません' };
  }
  const parsed = buildInfoSchema.safeParse(raw);
  if (!parsed.success) return { kind: 'invalid', reason: parsed.error.message };
  return { kind: 'ok', info: parsed.data };
}
