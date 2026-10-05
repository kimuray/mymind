import { useRef } from 'react';

/** 数字が増えたか減ったか（DESIGN.md 4.20）。前と同じ、または初めて出すときは null */
export function numberChange(previous: number, next: number): 'up' | 'down' | null {
  if (previous === next) return null;
  return next > previous ? 'up' : 'down';
}

/**
 * 件数などの数字（DESIGN.md 4.20、NFR-29）。値が変わったときだけ、新しい数字を増えたら下から・減ったら上から入れる。
 * 最初に出すときは動かさない。文字はそのまま数字なので、読み上げは変わらない
 */
export function AnimatedNumber({ value }: { value: number }) {
  const shown = useRef(value);
  const change = useRef<'up' | 'down' | null>(null);
  const next = numberChange(shown.current, value);
  if (next !== null) {
    shown.current = value;
    change.current = next;
  }
  return (
    <span className="animated-number">
      {/* 値ごとに作り直し、変わった直後だけ CSS の動きを再生する */}
      <span key={value} className="animated-number-value" data-change={change.current ?? 'none'}>
        {value}
      </span>
    </span>
  );
}
