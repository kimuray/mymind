import { randomBytes } from 'node:crypto';

// Crockford の Base32（I、L、O、U を除く）
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LENGTH = 10;
const RANDOM_LENGTH = 16;

function encodeTime(ms: number): string {
  let out = '';
  let rest = ms;
  for (let i = 0; i < TIME_LENGTH; i++) {
    out = ALPHABET.charAt(rest % 32) + out;
    rest = Math.floor(rest / 32);
  }
  return out;
}

/** 80 ビットの乱数部分を、Base32 の数字（0〜31）の並びで持つ */
function randomDigits(): number[] {
  return [...randomBytes(RANDOM_LENGTH)].map((b) => b % 32);
}

/** 乱数部分に 1 を足す。桁あふれは同じミリ秒に 32^16 個作った場合だけで、実際には起きない */
function increment(digits: number[]): number[] {
  const next = [...digits];
  for (let i = next.length - 1; i >= 0; i--) {
    const d = next[i] ?? 0;
    if (d < 31) {
      next[i] = d + 1;
      return next;
    }
    next[i] = 0;
  }
  throw new Error('同じミリ秒の中で ULID を作りすぎました');
}

/**
 * 単調増加する ULID を作る関数を返す（coding.md「時刻と ID」）。
 * イベントの順序は ID の順で決めるため、同じミリ秒の中でも作った順に大きくなるようにする。
 * 時計が戻った場合も、直前の値より大きい ID を返す。
 */
export function createUlidGenerator(now: () => number): () => string {
  let lastTime = -1;
  let lastRandom: number[] = [];
  return () => {
    const time = now();
    if (time > lastTime) {
      lastTime = time;
      lastRandom = randomDigits();
    } else {
      lastRandom = increment(lastRandom);
    }
    return encodeTime(lastTime) + lastRandom.map((d) => ALPHABET.charAt(d)).join('');
  };
}
