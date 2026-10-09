import { describe, expect, it } from 'vitest';
import { buildUpdateEnv, buildUpdatePath } from './updateCommands';

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
