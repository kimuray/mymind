import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readBuildInfo } from './buildInfo';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mymind-build-info-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('FR-U05 .app を作ったときの情報', () => {
  it('コミットとリポジトリの場所を読む', () => {
    const path = join(dir, 'build-info.json');
    const info = { commit: 'a'.repeat(40), repoPath: '/Users/me/mymind' };
    writeFileSync(path, JSON.stringify(info));
    expect(readBuildInfo(path)).toEqual({ kind: 'ok', info });
  });

  it('ファイルがなければ（開発時の起動）、ないことを返す', () => {
    expect(readBuildInfo(join(dir, 'none.json'))).toEqual({ kind: 'missing' });
  });

  it('コミットの形が違えば、正しくないとする（git に渡さない）', () => {
    const path = join(dir, 'build-info.json');
    writeFileSync(path, JSON.stringify({ commit: 'HEAD; rm -rf /', repoPath: '/Users/me/mymind' }));
    expect(readBuildInfo(path).kind).toBe('invalid');
  });

  it('リポジトリの場所が絶対パスでなければ、正しくないとする', () => {
    const path = join(dir, 'build-info.json');
    writeFileSync(path, JSON.stringify({ commit: 'a'.repeat(40), repoPath: 'mymind' }));
    expect(readBuildInfo(path).kind).toBe('invalid');
  });

  it('JSON として読めなければ、正しくないとする', () => {
    const path = join(dir, 'build-info.json');
    writeFileSync(path, '{');
    expect(readBuildInfo(path).kind).toBe('invalid');
  });
});
