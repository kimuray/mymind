import { describe, expect, it } from 'vitest';
import { buildAgentPath, parseMarkedPath, readLoginShellPath } from './agentPath';

describe('NFR-01 デスクトップアプリからエージェントを起動するときの PATH', () => {
  it('今の PATH、ログインシェルの PATH、よく使われる場所の順に、重複を除いてつなぐ', () => {
    expect(
      buildAgentPath({
        current: '/usr/bin:/bin',
        loginShell: '/opt/homebrew/bin:/usr/bin:/Users/me/.asdf/shims',
        home: '/Users/me',
      }).split(':'),
    ).toEqual([
      '/usr/bin',
      '/bin',
      '/opt/homebrew/bin',
      '/Users/me/.asdf/shims',
      '/Users/me/.local/bin',
      '/Users/me/.volta/bin',
      '/Users/me/.npm-global/bin',
      '/usr/local/bin',
    ]);
  });

  it('ログインシェルの PATH を読めなくても、よく使われる場所（claude の ~/.local/bin を含む）を足す', () => {
    const path = buildAgentPath({ current: undefined, loginShell: null, home: '/Users/me' });
    expect(path.split(':')).toContain('/Users/me/.local/bin');
    expect(path.split(':')).not.toContain('');
  });

  it('シェルの設定が何かを表示しても、印で挟んだ PATH だけを取り出す', () => {
    expect(parseMarkedPath('Welcome!\n__MYMIND_PATH__/a:/b__MYMIND_PATH__\n')).toBe('/a:/b');
    expect(parseMarkedPath('印がない')).toBeNull();
    expect(parseMarkedPath('__MYMIND_PATH____MYMIND_PATH__')).toBeNull();
  });

  it('シェルが指定されていない、または起動できなければ null', async () => {
    expect(await readLoginShellPath(undefined)).toBeNull();
    expect(await readLoginShellPath('/nonexistent/shell')).toBeNull();
  });

  it('sh をログインシェルとして読むと、その PATH を返す', async () => {
    const path = await readLoginShellPath('/bin/sh');
    expect(path).toMatch(/^\//);
  });
});
