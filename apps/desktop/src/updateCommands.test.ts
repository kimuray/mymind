import { describe, expect, it } from 'vitest';
import {
  buildUpdateEnv,
  buildUpdatePath,
  expiredUpdateLogs,
  updateLogName,
} from './updateCommands';

describe('FR-U05 更新のコマンドの PATH と環境変数', () => {
  it('今の PATH を先に置き、よく使われる場所を重複を除いて足す', () => {
    const path = buildUpdatePath('/usr/bin:/opt/homebrew/bin', '/Users/me').split(':');
    expect(path.slice(0, 2)).toEqual(['/usr/bin', '/opt/homebrew/bin']);
    expect(path).toContain('/Users/me/Library/pnpm');
    expect(path.filter((d) => d === '/opt/homebrew/bin')).toHaveLength(1);
  });

  it('PATH がなくても、よく使われる場所だけで作る', () => {
    expect(buildUpdatePath(undefined, '/Users/me').split(':')[0]).toBe('/opt/homebrew/bin');
  });

  it('git にパスワードやパスフレーズを尋ねさせない', () => {
    const env = buildUpdateEnv({ PATH: '/usr/bin' }, '/Users/me');
    expect(env['GIT_TERMINAL_PROMPT']).toBe('0');
    expect(env['GIT_SSH_COMMAND']).toBe('ssh -o BatchMode=yes');
  });

  it('利用者が決めた GIT_SSH_COMMAND は変えない', () => {
    const env = buildUpdateEnv({ GIT_SSH_COMMAND: 'ssh -i key' }, '/Users/me');
    expect(env['GIT_SSH_COMMAND']).toBe('ssh -i key');
  });
});

describe('FR-U05 NFR-24 更新のログの保持', () => {
  const now = new Date('2026-10-23T00:00:00.000Z');

  it('ファイル名に UTC の時刻を入れる', () => {
    expect(updateLogName(new Date('2026-10-09T06:45:00.123Z'))).toBe(
      'update-20261009T064500123Z.log',
    );
  });

  it('14日を過ぎたログだけを消す対象にする（ちょうど14日前は残す）', () => {
    expect(
      expiredUpdateLogs(
        [
          updateLogName(new Date('2026-10-08T23:59:59.999Z')),
          updateLogName(new Date('2026-10-09T00:00:00.000Z')),
          updateLogName(new Date('2026-10-22T00:00:00.000Z')),
        ],
        now,
      ),
    ).toEqual(['update-20261008T235959999Z.log']);
  });

  it('名前の形が違うファイルには触れない', () => {
    expect(expiredUpdateLogs(['main.log', 'update-old.log'], now)).toEqual([]);
  });
});
