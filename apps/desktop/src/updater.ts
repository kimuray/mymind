/**
 * デスクトップアプリの更新の確認と適用（FR-U05、ADR-0017）。
 * 更新元は .app を作った手元のリポジトリ。git fetch で origin/main を取り、.app を作ったコミットより先に進んでいれば知らせる。
 * 適用はそのリポジトリで `pnpm update-app` を動かす（ビルド、.app の入れ替え、再起動まで行う）。
 * コマンドの実行、通知、時刻は差し込む（Electron と子プロセスに依存させず、単体テストで確かめるため）
 */

export type CommandResult = { code: number; stdout: string };

/** リポジトリで git を動かす。args は固定の引数と、検証済みのコミットだけ */
export type RunGit = (args: readonly string[]) => Promise<CommandResult>;

export type CheckResult =
  | { kind: 'up-to-date' }
  | { kind: 'available'; latest: string; commits: number }
  | { kind: 'error'; message: string };

/** origin/main が、.app を作ったコミットより先に進んでいるか */
export async function checkForUpdate(runGit: RunGit, buildCommit: string): Promise<CheckResult> {
  const fetched = await runGit(['fetch', '--quiet', 'origin', 'main']);
  if (fetched.code !== 0) {
    return { kind: 'error', message: '更新元（GitHub）から取得できませんでした' };
  }
  const head = await runGit(['rev-parse', 'origin/main']);
  const latest = head.stdout.trim();
  if (head.code !== 0 || !/^[0-9a-f]{40}$/.test(latest)) {
    return { kind: 'error', message: 'origin/main を読めませんでした' };
  }
  if (latest === buildCommit) return { kind: 'up-to-date' };
  // 件数は git に数えさせる。.app を作ったコミットより先にある main のコミットの数
  const counted = await runGit(['rev-list', '--count', `${buildCommit}..origin/main`]);
  const commits = Number.parseInt(counted.stdout.trim(), 10);
  if (counted.code !== 0 || !Number.isInteger(commits)) {
    return { kind: 'error', message: '.app を作ったコミットがリポジトリに見つかりません' };
  }
  // main より先のブランチから作った .app では、main に新しいコミットがなければ知らせない
  if (commits === 0) return { kind: 'up-to-date' };
  return { kind: 'available', latest, commits };
}

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; latest: string; commits: number }
  | { kind: 'updating' }
  | { kind: 'failed'; message: string };

/** 動かしている `pnpm update-app`。成功すると、終わる前にこのアプリを終了させる */
export type RunningUpdate = { onExit: (listener: (code: number | null) => void) => void };

export type UpdaterDeps = {
  check: () => Promise<CheckResult>;
  startUpdate: () => RunningUpdate;
  notify: (message: { title: string; body: string }) => void;
  onChange: (state: UpdateState) => void;
};

export function createUpdater(deps: UpdaterDeps) {
  let state: UpdateState = { kind: 'idle' };
  // 同じ版を何度も通知しない（定期の確認のたびに出さない）
  let notifiedLatest: string | null = null;
  const setState = (next: UpdateState) => {
    state = next;
    deps.onChange(state);
  };

  /** 確かめた結果を状態に反映し、知らせるべきものを通知する */
  const applyResult = (result: CheckResult, before: UpdateState, manual: boolean) => {
    if (result.kind === 'available') {
      setState(result);
      if (!manual && notifiedLatest === result.latest) return;
      notifiedLatest = result.latest;
      deps.notify({
        title: 'mymind のアップデートがあります',
        body: `${result.commits} 件の変更があります。メニューバーのマメから更新できます`,
      });
      return;
    }
    if (result.kind === 'up-to-date') {
      setState({ kind: 'idle' });
      if (manual) deps.notify({ title: 'mymind は最新です', body: '新しい変更はありません' });
      return;
    }
    // オフラインなどで確かめられないときは、定期の確認では黙って前の状態に戻す（NFR-11）
    setState(before);
    if (manual) deps.notify({ title: 'アップデートを確かめられません', body: result.message });
  };

  return {
    getState: () => state,
    /** manual は、利用者がメニューから確かめたとき。最新のときと失敗したときも知らせる */
    async check({ manual }: { manual: boolean }) {
      if (state.kind === 'checking' || state.kind === 'updating') return;
      const before = state;
      setState({ kind: 'checking' });
      applyResult(await deps.check(), before, manual);
    },
    /** `pnpm update-app` を動かす。終わるとこのアプリは再起動される */
    apply() {
      if (state.kind === 'checking' || state.kind === 'updating') return;
      setState({ kind: 'updating' });
      deps.startUpdate().onExit((code) => {
        // 成功したときは、スクリプトがこのアプリを終了させるので、ここには来ない。
        // 来たら入れ替わっていない（失敗、または /Applications の .app ではない場所で動いている）
        const message =
          code === 0
            ? '.app を入れ替えませんでした。ログを確かめてください'
            : `更新に失敗しました（終了コード ${code ?? '不明'}）。ログを確かめてください`;
        setState({ kind: 'failed', message });
        deps.notify({ title: 'mymind を更新できませんでした', body: message });
      });
    },
  };
}

export type Updater = ReturnType<typeof createUpdater>;
