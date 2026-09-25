import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAgentLog } from './agentLog';

let root: string;
let dir: string;
const mode = (path: string) => statSync(path).mode & 0o777;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mymind-agentlog-'));
  dir = join(root, 'logs/agent');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const record = {
  jobId: 'j1',
  kind: 'daily_feedback',
  period: '2026-09-25',
  agent: 'fake',
  promptVersion: '0.1.0',
  input: '<data>振り返り</data>',
  attempts: [{ output: '{}' }],
  status: 'succeeded',
  finishedAt: '2026-09-25T12:00:00.000Z',
};

describe('NFR-16 エージェントの入出力のログ', () => {
  it('業務日ごとのディレクトリに、本人だけが読めるファイルとして全文を残す', () => {
    const path = createAgentLog(dir).write('2026-09-25', record);
    expect(path).toBe(join(dir, '2026-09-25', 'j1.json'));
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(record);
    expect(mode(path)).toBe(0o600);
    expect(mode(join(dir, '2026-09-25'))).toBe(0o700);
    expect(mode(dir)).toBe(0o700);
  });
});

describe('NFR-24 30日を過ぎたログの削除', () => {
  it('30日を過ぎた日付のディレクトリだけを消す', () => {
    const log = createAgentLog(dir);
    for (const day of ['2026-08-25', '2026-08-26', '2026-09-24']) log.write(day, record);
    mkdirSync(join(dir, 'notes'), { recursive: true });
    expect(log.prune('2026-09-25')).toEqual(['2026-08-25']);
    expect(existsSync(join(dir, '2026-08-25'))).toBe(false);
    expect(existsSync(join(dir, '2026-08-26'))).toBe(true);
    // 日付でない名前は消さない
    expect(existsSync(join(dir, 'notes'))).toBe(true);
  });

  it('ログがまだなければ何もしない', () => {
    expect(createAgentLog(dir).prune('2026-09-25')).toEqual([]);
  });
});
