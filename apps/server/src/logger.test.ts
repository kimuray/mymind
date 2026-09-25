import { describe, expect, it } from 'vitest';
import { createLogger, REDACTED, redact } from './logger';

const capture = () => {
  const lines: string[] = [];
  const logger = createLogger({
    write: (line) => lines.push(line),
    now: () => new Date('2026-09-25T00:00:00.000Z'),
  });
  return { lines, logger };
};

describe('NFR-16 ログに機微データを出さない', () => {
  it('振り返り・メモ・FB の本文・調子の根拠を伏せ字にする', () => {
    const { lines, logger } = capture();
    logger.error('保存に失敗しました', {
      day: '2026-09-25',
      thoughts_md: '上司との面談がつらかった',
      learningMd: '朝のうちに決めると楽',
      note_md: '個人的なメモ',
      contentJson: '{"good":["..."]}',
      aiReason: '睡眠不足で集中できなかった',
    });
    const [line] = lines;
    expect(line).toBeDefined();
    for (const secret of [
      '上司との面談',
      '朝のうちに決める',
      '個人的なメモ',
      '{"good"',
      '睡眠不足',
    ]) {
      expect(line).not.toContain(secret);
    }
    expect(JSON.parse(line ?? '{}')).toMatchObject({
      level: 'error',
      message: '保存に失敗しました',
      day: '2026-09-25',
      thoughts_md: REDACTED,
      aiReason: REDACTED,
    });
  });

  it('入れ子や配列の中の項目も伏せ字にする', () => {
    expect(
      redact({
        job: { id: 'j1', feedback: { content: { good: ['よかったこと'] } } },
        list: [{ noteMd: 'x' }],
      }),
    ).toEqual({ job: { id: 'j1', feedback: { content: REDACTED } }, list: [{ noteMd: REDACTED }] });
  });

  it('エージェントへの入力と出力もロガーには出さない', () => {
    const { lines, logger } = capture();
    logger.warn('形式が違いました', {
      jobId: 'j1',
      input: '<data>振り返り</data>',
      output: '出力',
    });
    expect(lines[0]).not.toContain('振り返り');
    expect(lines[0]).toContain('"jobId":"j1"');
  });

  it('元の値は変えない', () => {
    const fields = { note_md: 'メモ' };
    redact(fields);
    expect(fields.note_md).toBe('メモ');
  });
});
