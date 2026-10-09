/**
 * `pnpm update-app` で、/Applications の mymind.app を入れ替えるかどうかの判断（NFR-25）。
 * 実際の入れ替え（.app の作成、終了、コピー、起動）は scripts/update-app.mjs が行う
 */

/** 入れ替える先の初期値。MYMIND_APP_PATH で変えられる */
export const DEFAULT_APP_PATH = '/Applications/mymind.app';

/** .app のバンドル ID（scripts/packageApp.mjs の appBundleId）。終了させるときに使う */
export const APP_BUNDLE_ID = 'local.mymind.desktop';

export type UpdateAppOptions = {
  /** 入っている .app が今のコミットから作られていても作り直す */
  force: boolean;
  /** デスクトップアプリを入れ替えない（ブラウザ版だけ使う場合） */
  skipApp: boolean;
};

export type ParseArgsResult = { ok: true; value: UpdateAppOptions } | { ok: false; error: string };

export function parseUpdateAppArgs(argv: readonly string[]): ParseArgsResult {
  const options: UpdateAppOptions = { force: false, skipApp: false };
  for (const arg of argv) {
    if (arg === '--force') options.force = true;
    else if (arg === '--no-app') options.skipApp = true;
    else
      return {
        ok: false,
        error: `知らないオプションです: ${arg}（使えるのは --force と --no-app）`,
      };
  }
  return { ok: true, value: options };
}

/**
 * Info.plist の CFBundleVersion（`0.0.0+abc1234`、scripts/packageApp.mjs の buildVersion）から、
 * .app を作ったコミットを取り出す。取り出せないとき（古い .app、git のない環境で作った .app）は null
 */
export function parseBuildCommit(bundleVersion: string): string | null {
  const match = /\+([0-9a-f]{4,40})$/.exec(bundleVersion.trim());
  return match?.[1] ?? null;
}

/**
 * 入れ替える先として受け付けるパスか。MYMIND_APP_PATH は外から変えられるので、
 * 別のアプリを消して写してしまわないよう、絶対パスで、名前が mymind.app のものだけを受け付ける
 */
export function isAcceptableAppPath(path: string): boolean {
  return path.startsWith('/') && !path.split('/').includes('..') && path.endsWith('/mymind.app');
}

/** 入っている .app の Info.plist から読んだもの。読めなかった値は null */
export type InstalledApp = { bundleId: string | null; bundleVersion: string | null };

export type AppUpdatePlan =
  | { action: 'install' }
  | { action: 'skip'; reason: 'not-installed' | 'up-to-date' | 'disabled' }
  /** 入れ替えてはいけない（mymind ではない .app が置かれている） */
  | { action: 'refuse'; reason: string };

export function planAppUpdate(input: {
  options: UpdateAppOptions;
  /** 入っている .app。入っていなければ null */
  installed: InstalledApp | null;
  /** 今のコミット（完全なハッシュ） */
  headCommit: string;
}): AppUpdatePlan {
  if (input.options.skipApp) return { action: 'skip', reason: 'disabled' };
  // 初めて入れるときは、手順（署名していない .app を開く操作）を読んでもらうため、自動では入れない
  if (input.installed === null) return { action: 'skip', reason: 'not-installed' };
  if (input.installed.bundleId !== APP_BUNDLE_ID) {
    return {
      action: 'refuse',
      reason: `バンドル ID が ${APP_BUNDLE_ID} ではありません（${input.installed.bundleId ?? '読めない'}）`,
    };
  }
  if (input.options.force) return { action: 'install' };
  const built = parseBuildCommit(input.installed.bundleVersion ?? '');
  // 短いハッシュの長さは作った時のリポジトリで変わりうるので、前方一致で比べる
  if (built !== null && input.headCommit.startsWith(built)) {
    return { action: 'skip', reason: 'up-to-date' };
  }
  return { action: 'install' };
}

/** pgrep -f に渡す、.app の中から起動したプロセス（Electron とサーバー）に当たる正規表現 */
export function appProcessPattern(appPath: string): string {
  return `${appPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/Contents/`;
}
