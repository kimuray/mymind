import { STATUS_LABELS, type DaySummary as Summary } from '@mymind/domain';

/** 各欄の本文（Figma「PC/振り返り」の記録の面）。区切りは完了・着手が「、」、変化が「／」 */
export function formatSummary(summary: Summary) {
  return {
    completed: summary.completed.map((t) => t.title).join('、'),
    started: summary.started
      .map((t) => `${t.title}（${t.isNew ? '新規' : `${t.dayOrdinal}日目`}）`)
      .join('、'),
    changes: summary.changes
      .map((c) =>
        c.kind === 'changed'
          ? `${c.title}：${STATUS_LABELS[c.from]} → ${STATUS_LABELS[c.to]}`
          : `${c.title}：待ちが継続（${c.dayOrdinal}日目）`,
      )
      .join('／'),
  };
}

const CARDS = [
  { key: 'completed', label: '完了', tone: 'done' },
  { key: 'started', label: '着手', tone: 'doing' },
  { key: 'changes', label: '変化', tone: 'waiting' },
] as const;

/**
 * 振り返りの冒頭の、その日の記録のまとめ（FR-D07、DESIGN.md 4.7）。
 * 件数と日数はサーバー（domain の summarizeDay）が数えた値をそのまま出す
 */
export function DaySummary({ summary }: { summary: Summary }) {
  const text = formatSummary(summary);
  return (
    <section className="day-summary" aria-label="この日の記録">
      {CARDS.map((card) => (
        <div key={card.key} className="day-summary-card neu-raised-1">
          <h2 className={`day-summary-label day-summary-${card.tone}`}>
            {card.label} <span className="day-summary-count">{summary[card.key].length}</span>
          </h2>
          <p className={text[card.key] === '' ? 'day-summary-empty' : undefined}>
            {text[card.key] === '' ? 'なし' : text[card.key]}
          </p>
        </div>
      ))}
    </section>
  );
}
