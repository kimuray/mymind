/**
 * 進み具合のバー（DESIGN.md 4.20）。塗りは幅ではなく scaleX で伸び縮みさせ、変化をなめらかにする（2.7：transform だけを動かす）。
 * 読み上げには progressbar の役割と値を渡す
 */
export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const ratio = max <= 0 ? 0 : Math.min(Math.max(value / max, 0), 1);
  return (
    <div
      className="progress-bar"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
    >
      {/* CSP は style 属性を許さないが、React は CSSOM で当てるので使える */}
      <span className="progress-bar-fill" style={{ transform: `scaleX(${ratio})` }} />
    </div>
  );
}
