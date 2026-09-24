// マメ（DESIGN.md 4.1）。形は docs/design/mockup-source/Mame.dc.html を 48×48 の座標系のまま写したもの。
// 色は Mame.css のクラスで tokens.css の --mame-* を当てる（本番の CSP は style 属性を許さない。ADR-0007）。
import './Mame.css';

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
  return (
    <svg
      className="mame"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      data-mood={mood}
      role="img"
      aria-label={label ?? MOOD_LABELS[mood]}
    >
      <ellipse className="mame-ground" cx="24" cy="44.4" rx="10.5" ry="1.7" opacity="0.08" />
      <path className="mame-stem" d={s.stem} strokeWidth="1.4" strokeLinecap="round" />
      <path
        className="mame-leaf"
        d={s.leaf}
        fillOpacity="0.8"
        strokeWidth="0.9"
        strokeLinejoin="round"
      />
      {s.flower > 0 && (
        <circle className="mame-flower" cx="24" cy="6.2" r={s.flower} strokeWidth="0.9" />
      )}
      <ellipse className="mame-body" cx="24" cy="29.5" rx="15.5" ry="14" fillOpacity="0.86" />
      <ellipse className="mame-under" cx="24" cy="35.5" rx="12.5" ry="7.5" opacity="0.12" />
      <ellipse
        className="mame-rim"
        cx="24"
        cy="29.5"
        rx="15.5"
        ry="14"
        strokeOpacity="0.9"
        strokeWidth="1.1"
      />
      <path
        className="mame-shine"
        d="M12.3 27a12 11 0 0 1 8.6-9.6"
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity="0.9"
      />
      <circle className="mame-spark" cx="31.6" cy="19.6" r="1.2" opacity="0.85" />
      <path
        className="mame-face"
        d={s.eyes}
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        className="mame-face"
        d={s.mouth}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {mood === 'think' && (
        <g className="mame-bubbles">
          <circle cx="38.5" cy="14" r="1.1" opacity="0.45" />
          <circle cx="42" cy="9.5" r="1.6" opacity="0.45" />
        </g>
      )}
    </svg>
  );
}
