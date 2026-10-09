import { describe, expect, it } from 'vitest';
import {
  type CheckResult,
  type CommandResult,
  checkForUpdate,
  createUpdater,
  type RunGit,
  type UpdateState,
} from './updater';

const BUILD = 'a'.repeat(40);
const LATEST = 'b'.repeat(40);

/** git の引数ごとに結果を返す偽物。呼ばれた引数を記録する */
function fakeGit(results: Record<string, CommandResult>) {
  const calls: string[] = [];
  const run: RunGit = async (args) => {
    const key = args.join(' ');
    calls.push(key);
    return results[key] ?? { code: 1, stdout: '' };
  };
  return { run, calls };
}

const ok = (stdout = ''): CommandResult => ({ code: 0, stdout });

describe('FR-U05 更新元との比較', () => {
  it('origin/main が .app を作ったコミットと同じなら、最新とする', async () => {
    const git = fakeGit({
      'fetch --quiet origin main': ok(),
      'rev-parse origin/main': ok(`${BUILD}\n`),
    });
    expect(await checkForUpdate(git.run, BUILD)).toEqual({ kind: 'up-to-date' });
  });

  it('origin/main が先に進んでいれば、変更の件数を git に数えさせて返す', async () => {
    const git = fakeGit({
      'fetch --quiet origin main': ok(),
      'rev-parse origin/main': ok(`${LATEST}\n`),
      [`rev-list --count ${BUILD}..origin/main`]: ok('3\n'),
    });
    expect(await checkForUpdate(git.run, BUILD)).toEqual({
      kind: 'available',
      latest: LATEST,
      commits: 3,
    });
  });

  it('main より先のブランチから作った .app で、main に新しいコミットがなければ最新とする', async () => {
    const git = fakeGit({
      'fetch --quiet origin main': ok(),
      'rev-parse origin/main': ok(LATEST),
      [`rev-list --count ${BUILD}..origin/main`]: ok('0'),
    });
    expect(await checkForUpdate(git.run, BUILD)).toEqual({ kind: 'up-to-date' });
  });

  it('取得できないとき（オフライン）は、失敗を返し、先に進まない', async () => {
    const git = fakeGit({});
    const result = await checkForUpdate(git.run, BUILD);
    expect(result.kind).toBe('error');
    expect(git.calls).toEqual(['fetch --quiet origin main']);
  });

  it('.app を作ったコミットがリポジトリにないときは、失敗を返す', async () => {
    const git = fakeGit({
      'fetch --quiet origin main': ok(),
      'rev-parse origin/main': ok(LATEST),
    });
    expect((await checkForUpdate(git.run, BUILD)).kind).toBe('error');
  });
});

function setup(checkResult: CheckResult) {
  const states: UpdateState[] = [];
  const notices: string[] = [];
  let exit: ((code: number | null) => void) | null = null;
  let started = 0;
  const updater = createUpdater({
    check: async () => checkResult,
    startUpdate: () => {
      started += 1;
      return {
        onExit: (listener) => {
          exit = listener;
        },
      };
    },
    notify: ({ title }) => notices.push(title),
    onChange: (state) => states.push(state),
  });
  return {
    updater,
    states,
    notices,
    started: () => started,
    exit: (code: number | null) => exit?.(code),
  };
}

const available: CheckResult = { kind: 'available', latest: LATEST, commits: 2 };

describe('FR-U05 アップデートの確認', () => {
  it('アップデートがあれば、状態を変えて1回だけ通知する（定期の確認のたびには出さない）', async () => {
    const t = setup(available);
    await t.updater.check({ manual: false });
    await t.updater.check({ manual: false });
    expect(t.updater.getState()).toEqual(available);
    expect(t.notices).toEqual(['mymind のアップデートがあります']);
  });

  it('メニューから確かめたときは、知らせた版でももう一度通知する', async () => {
    const t = setup(available);
    await t.updater.check({ manual: false });
    await t.updater.check({ manual: true });
    expect(t.notices).toHaveLength(2);
  });

  it('最新のときは、定期の確認では通知せず、メニューから確かめたときだけ通知する', async () => {
    const t = setup({ kind: 'up-to-date' });
    await t.updater.check({ manual: false });
    expect(t.notices).toEqual([]);
    await t.updater.check({ manual: true });
    expect(t.notices).toEqual(['mymind は最新です']);
    expect(t.updater.getState()).toEqual({ kind: 'idle' });
  });

  it('確かめられないときは、定期の確認では黙って前の状態に戻す', async () => {
    const t = setup({ kind: 'error', message: 'オフライン' });
    await t.updater.check({ manual: false });
    expect(t.notices).toEqual([]);
    expect(t.states).toEqual([{ kind: 'checking' }, { kind: 'idle' }]);
  });

  it('確かめられないときも、メニューから確かめたときは理由を通知する', async () => {
    const t = setup({ kind: 'error', message: 'オフライン' });
    await t.updater.check({ manual: true });
    expect(t.notices).toEqual(['アップデートを確かめられません']);
  });
});

describe('FR-U05 アップデートの適用', () => {
  it('適用すると更新中にし、更新中にもう一度選んでも二重に動かさない', () => {
    const t = setup(available);
    t.updater.apply();
    t.updater.apply();
    expect(t.started()).toBe(1);
    expect(t.updater.getState()).toEqual({ kind: 'updating' });
  });

  it('更新中は確かめない', async () => {
    const t = setup(available);
    t.updater.apply();
    await t.updater.check({ manual: true });
    expect(t.updater.getState()).toEqual({ kind: 'updating' });
  });

  it('スクリプトが失敗して終わったら、失敗にして通知する', () => {
    const t = setup(available);
    t.updater.apply();
    t.exit(1);
    expect(t.updater.getState()).toMatchObject({ kind: 'failed' });
    expect(t.notices).toEqual(['mymind を更新できませんでした']);
  });

  it('アプリが終了させられないまま成功で終わったら、入れ替わっていないので失敗にする', () => {
    const t = setup(available);
    t.updater.apply();
    t.exit(0);
    expect(t.updater.getState()).toEqual({
      kind: 'failed',
      message: '.app を入れ替えませんでした。ログを確かめてください',
    });
  });
});
