import { describe, expect, it } from 'vitest';
import {
  buildAgentPath,
  isAllowedShell,
  parseMarkedPath,
  parseShells,
  readLoginShellPath,
} from './agentPath';

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

  it('シェルが指定されていない、または一覧にあっても起動できなければ null', async () => {
    expect(await readLoginShellPath(undefined, { systemShells: ['/bin/sh'] })).toBeNull();
    expect(
      await readLoginShellPath('/nonexistent/shell', { systemShells: ['/nonexistent/shell'] }),
    ).toBeNull();
  });

  it('sh をログインシェルとして読むと、その PATH を返す', async () => {
    const path = await readLoginShellPath('/bin/sh', { systemShells: ['/bin/sh'] });
    expect(path).toMatch(/^\//);
  });

  it('OS のシェルの一覧にない SHELL は起動しない（環境変数は外から変えられるため）', async () => {
    expect(await readLoginShellPath('/tmp/evil', { systemShells: ['/bin/zsh'] })).toBeNull();
  });

  it.each([
    ['/bin/zsh', true],
    ['zsh', false],
    ['/tmp/evil', false],
    ['', false],
    [undefined, false],
  ])('%s を起動してよいか：%s', (shell, expected) => {
    expect(isAllowedShell(shell, ['/bin/zsh', '/bin/bash'])).toBe(expected);
  });

  it('/etc/shells の中身から、コメントと空行を除いてシェルの一覧を取り出す', () => {
    expect(
      parseShells('# List of shells\n/bin/bash\n\n/bin/zsh\n  /opt/homebrew/bin/fish  \n'),
    ).toEqual(['/bin/bash', '/bin/zsh', '/opt/homebrew/bin/fish']);
  });
});
