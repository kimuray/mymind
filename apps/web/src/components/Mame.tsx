// マメ（DESIGN.md 4.1）。形は docs/design/mockup-source/Mame.dc.html を 48×48 の座標系のまま写したもの。
// 色は tokens.css の --mame-* だけを使う（SVG の属性では CSS 変数が効かないブラウザがあるので style で渡す）。

export const MOODS = ['best', 'good', 'normal', 'bad', 'worst', 'sleep', 'think'] as const;
export type Mood = (typeof MOODS)[number];

export const MOOD_LABELS: Readonly<Record<Mood, string>> = {
  best: '絶好調',
  good: '好調',
  normal: '普通',
  bad: '不調',
  worst: '絶不調',
  sleep: 'FBなし',
  think: '生成中',
};

type Shape = {
  stem: string;
  leaf: string;
  flower: number;
  eyes: string;
  mouth: string;
};

const TWO_LEAVES =
  'M24 10.5c1.8-3 5.2-3.4 7-2c-1.8 2.4-4.6 3-7 2zM24 10.5c-1.8-3-5.2-3.4-7-2c1.8 2.4 4.6 3 7 2z';
const ONE_LEAF = 'M24 11.5c1.8-3 5.2-3.4 7-2c-1.8 2.4-4.6 3-7 2z';
const DOT_EYES = 'M20 26v2.2M28 26v2.2';

const SHAPES: Readonly<Record<Mood, Shape>> = {
  best: {
    stem: 'M24 15.5V7.5',
    leaf: TWO_LEAVES,
    flower: 2.8,
    eyes: 'M17.8 27.5q2.2-2.6 4.4 0M25.8 27.5q2.2-2.6 4.4 0',
    mouth: 'M21 31.3q3 3.2 6 0',
  },
  good: {
    stem: 'M24 15.5V8',
    leaf: TWO_LEAVES,
    flower: 0,
    eyes: DOT_EYES,
    mouth: 'M21.2 31.4q2.8 2.4 5.6 0',
  },
  normal: { stem: 'M24 15.5V9', leaf: ONE_LEAF, flower: 0, eyes: DOT_EYES, mouth: 'M22 32h4' },
  bad: {
    stem: 'M24 15.5c0-3 .8-5 2.6-6.2',
    leaf: 'M26.6 9.3c2 .6 3 3 2.2 5.2c-1.8-.8-2.8-2.8-2.2-5.2z',
    flower: 0,
    eyes: 'M18.5 26.4l3 1M29.5 26.4l-3 1',
    mouth: 'M21.2 33q2.8-2 5.6 0',
  },
  worst: {
    stem: 'M24 15.5c0-2.6 1.4-3.8 3.4-3.6',
    leaf: 'M27.4 11.9c1.4 1 1.6 3 .6 4.3c-1.2-.9-1.4-2.7-.6-4.3z',
    flower: 0,
    eyes: 'M18 27h4M26 27h4',
    mouth: 'M20.5 33q1.75-1.5 3.5 0t3.5 0',
  },
  sleep: {
    stem: 'M24 15.5V9',
    leaf: ONE_LEAF,
    flower: 0,
    eyes: 'M18 27q2 1.4 4 0M26 27q2 1.4 4 0',
    mouth: 'M23 32h2',
  },
  think: {
    stem: 'M24 15.5V9',
    leaf: ONE_LEAF,
    flower: 0,
    eyes: 'M21 24.6v2M29 24.6v2',
    mouth: 'M23 32.2a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0 -2.2 0',
  },
};

type MameProps = {
  mood: Mood;
  /** 一辺の大きさ（px）。カレンダーとタイムラインで 28〜44、詳細ペインで 56〜76、空の状態で 96 が目安 */
  size?: number;
  /** 読み上げる名前。省略すると表情の名前（「好調」など）を読み上げる */
  label?: string;
};

/** 調子を表すキャラクター。画面ごとに描き直さず、必ずこのコンポーネントを使う（ui.md） */
export function Mame({ mood, size = 44, label }: MameProps) {
  const s = SHAPES[mood];
  const tint = `var(--mame-${mood})`;
  const ink = `var(--mame-${mood}-ink)`;
  const face = { stroke: 'var(--mame-face)' };
  const white = 'var(--mame-highlight)';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      data-mood={mood}
      role="img"
      aria-label={label ?? MOOD_LABELS[mood]}
    >
      <ellipse
        cx="24"
        cy="44.4"
        rx="10.5"
        ry="1.7"
        style={{ fill: 'var(--ink-1)' }}
        opacity="0.08"
      />
      <path
        d={s.stem}
        fill="none"
        style={{ stroke: 'var(--mame-stem)' }}
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d={s.leaf}
        style={{ fill: 'var(--mame-leaf)', stroke: 'var(--mame-stem)' }}
        fillOpacity="0.8"
        strokeWidth="0.9"
        strokeLinejoin="round"
      />
      {s.flower > 0 && (
        <circle
          cx="24"
          cy="6.2"
          r={s.flower}
          style={{ fill: 'var(--mame-flower)', stroke: white }}
          strokeWidth="0.9"
        />
      )}
      <ellipse cx="24" cy="29.5" rx="15.5" ry="14" style={{ fill: tint }} fillOpacity="0.86" />
      <ellipse cx="24" cy="35.5" rx="12.5" ry="7.5" style={{ fill: ink }} opacity="0.12" />
      <ellipse
        cx="24"
        cy="29.5"
        rx="15.5"
        ry="14"
        fill="none"
        style={{ stroke: white }}
        strokeOpacity="0.9"
        strokeWidth="1.1"
      />
      <path
        d="M12.3 27a12 11 0 0 1 8.6-9.6"
        fill="none"
        style={{ stroke: white }}
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity="0.9"
      />
      <circle cx="31.6" cy="19.6" r="1.2" style={{ fill: white }} opacity="0.85" />
      <path
        d={s.eyes}
        fill="none"
        style={face}
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={s.mouth}
        fill="none"
        style={face}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {mood === 'think' && (
        <g className="mame-bubbles">
          <circle cx="38.5" cy="14" r="1.1" style={{ fill: ink }} opacity="0.45" />
          <circle cx="42" cy="9.5" r="1.6" style={{ fill: ink }} opacity="0.45" />
        </g>
      )}
    </svg>
  );
}
