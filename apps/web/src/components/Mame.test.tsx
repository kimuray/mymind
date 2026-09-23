import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Mame, MOOD_LABELS, MOODS } from './Mame';

const render = (mood: (typeof MOODS)[number], label?: string) =>
  renderToStaticMarkup(<Mame mood={mood} size={48} {...(label === undefined ? {} : { label })} />);

describe('DESIGN.md 4.1 マメの表情', () => {
  it('7つの表情がある', () => {
    expect(MOODS).toEqual(['best', 'good', 'normal', 'bad', 'worst', 'sleep', 'think']);
  });

  it.each(MOODS)('%s は、その表情の体の色と影の色をトークンで塗る', (mood) => {
    const svg = render(mood);
    expect(svg).toContain(`fill:var(--mame-${mood})`);
    expect(svg).toContain(`fill:var(--mame-${mood}-ink)`);
  });

  it.each(MOODS)('%s は、色を直書きしない', (mood) => {
    expect(render(mood)).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });

  it('絶好調だけ芽に花が咲く', () => {
    for (const mood of MOODS) {
      expect(render(mood).includes('var(--mame-flower)')).toBe(mood === 'best');
    }
  });

  it('生成中だけ考え中の泡がある', () => {
    for (const mood of MOODS) {
      expect(render(mood).includes('mame-bubbles')).toBe(mood === 'think');
    }
  });

  it('大きさを指定できる', () => {
    expect(renderToStaticMarkup(<Mame mood="good" size={96} />)).toContain('width="96"');
  });
});

describe('ui.md マメの読み上げ', () => {
  it('名前を指定しなければ、表情の名前を読み上げる', () => {
    expect(render('think')).toContain(`aria-label="${MOOD_LABELS.think}"`);
  });

  it('名前を指定すれば、その名前を読み上げる', () => {
    expect(render('good', '今日の調子：好調')).toContain('aria-label="今日の調子：好調"');
  });
});
