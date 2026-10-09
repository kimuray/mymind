import { describe, expect, it } from 'vitest';
import {
  appProcessPattern,
  parseBuildCommit,
  parseUpdateAppArgs,
  planAppUpdate,
} from './appInstall';

const HEAD = 'abc1234def5678abc1234def5678abc1234def56';
const defaults = { force: false, skipApp: false };

describe('NFR-25 pnpm update-app の引数', () => {
  it('何も付けなければ、作り直しを強制せずアプリも入れ替える', () => {
    expect(parseUpdateAppArgs([])).toEqual({ ok: true, value: defaults });
  });

  it('--force と --no-app を読む', () => {
    expect(parseUpdateAppArgs(['--force', '--no-app'])).toEqual({
      ok: true,
      value: { force: true, skipApp: true },
    });
  });

  it('知らないオプションは失敗にする', () => {
    expect(parseUpdateAppArgs(['--forse']).ok).toBe(false);
  });
});

describe('NFR-25 .app を作ったコミットの読み取り', () => {
  it('ビルド番号の + の後ろのコミットを取り出す', () => {
    expect(parseBuildCommit('0.0.0+abc1234')).toBe('abc1234');
  });

  it('git のない環境で作った .app（unknown）は null', () => {
    expect(parseBuildCommit('0.0.0+unknown')).toBeNull();
  });

  it('コミットを含まない版は null', () => {
    expect(parseBuildCommit('1.0.0')).toBeNull();
  });
});

describe('NFR-25 mymind.app を入れ替えるかの判断', () => {
  it('入っている .app が今のコミットから作られていれば、作り直さない', () => {
    expect(
      planAppUpdate({
        options: defaults,
        installedBundleVersion: '0.0.0+abc1234',
        headCommit: HEAD,
      }),
    ).toEqual({ action: 'skip', reason: 'up-to-date' });
  });

  it('入っている .app が古いコミットから作られていれば、入れ替える', () => {
    expect(
      planAppUpdate({
        options: defaults,
        installedBundleVersion: '0.0.0+0000000',
        headCommit: HEAD,
      }),
    ).toEqual({ action: 'install' });
  });

  it('作ったコミットが分からない .app は、入れ替える', () => {
    expect(
      planAppUpdate({
        options: defaults,
        installedBundleVersion: '0.0.0+unknown',
        headCommit: HEAD,
      }),
    ).toEqual({ action: 'install' });
  });

  it('--force なら、今のコミットから作られていても入れ替える', () => {
    expect(
      planAppUpdate({
        options: { ...defaults, force: true },
        installedBundleVersion: '0.0.0+abc1234',
        headCommit: HEAD,
      }),
    ).toEqual({ action: 'install' });
  });

  it('.app が入っていなければ、自動では入れない', () => {
    expect(
      planAppUpdate({
        options: { ...defaults, force: true },
        installedBundleVersion: null,
        headCommit: HEAD,
      }),
    ).toEqual({ action: 'skip', reason: 'not-installed' });
  });

  it('--no-app なら、入れ替えない', () => {
    expect(
      planAppUpdate({
        options: { force: true, skipApp: true },
        installedBundleVersion: '0.0.0+0000000',
        headCommit: HEAD,
      }),
    ).toEqual({ action: 'skip', reason: 'disabled' });
  });
});

describe('NFR-25 動いているアプリのプロセスの探し方', () => {
  it('パスの . を文字どおりに当てる正規表現にする', () => {
    const pattern = new RegExp(appProcessPattern('/Applications/mymind.app'));
    expect(pattern.test('/Applications/mymind.app/Contents/MacOS/mymind')).toBe(true);
    expect(pattern.test('/Applications/mymindXapp/Contents/MacOS/mymind')).toBe(false);
  });
});
