import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AnimatedNumber, numberChange } from './AnimatedNumber';
import { ProgressBar } from './ProgressBar';

describe('FR-R06 / NFR-29 件数と進み具合の変化（DESIGN.md 4.20）', () => {
  it('増えたら下から、減ったら上から入れる', () => {
    expect(numberChange(2, 3)).toBe('up');
    expect(numberChange(3, 2)).toBe('down');
  });

  it('変わらなければ動かさない', () => {
    expect(numberChange(3, 3)).toBeNull();
  });

  it('最初に出す数字には、動きを付けない', () => {
    const html = renderToStaticMarkup(<AnimatedNumber value={5} />);
    expect(html).toContain('data-change="none"');
    expect(html).toContain('>5<');
  });

  it('進み具合のバーは、割合を scaleX で示し、読み上げに値を渡す', () => {
    const html = renderToStaticMarkup(<ProgressBar value={1} max={4} label="棚卸しの進み具合" />);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="1"');
    expect(html).toContain('aria-valuemax="4"');
    expect(html).toContain('transform:scaleX(0.25)');
  });

  it('対象がないときは、バーを空にする', () => {
    const html = renderToStaticMarkup(<ProgressBar value={0} max={0} label="棚卸しの進み具合" />);
    expect(html).toContain('transform:scaleX(0)');
  });
});
