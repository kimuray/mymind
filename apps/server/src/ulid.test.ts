import { describe, expect, it } from 'vitest';
import { createUlidGenerator } from './ulid';

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

describe('ADR-0004 イベントの ID（ULID）', () => {
  it('26文字の Crockford Base32 で、先頭10文字が時刻を表す', () => {
    const id = createUlidGenerator(() => 1_790_000_000_000)();
    expect(id).toMatch(ULID);
    expect(id.slice(0, 10)).toBe(createUlidGenerator(() => 1_790_000_000_000)().slice(0, 10));
  });

  it('同じミリ秒の中でも、作った順に大きくなる', () => {
    const next = createUlidGenerator(() => 1_790_000_000_000);
    const ids = Array.from({ length: 100 }, next);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(100);
  });

  it('時刻が進めば、後の ID が大きくなる', () => {
    let t = 1_790_000_000_000;
    const next = createUlidGenerator(() => t);
    const first = next();
    t += 1;
    expect(next() > first).toBe(true);
  });

  it('時計が戻っても、直前より大きい ID を返す', () => {
    let t = 1_790_000_000_000;
    const next = createUlidGenerator(() => t);
    const first = next();
    t -= 5_000;
    expect(next() > first).toBe(true);
  });
});
