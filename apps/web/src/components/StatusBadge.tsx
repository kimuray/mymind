import { dayOrdinalSince, STATUS_LABELS, type Status } from '@mymind/domain';

/**
 * 状態のバッジ「状態・N日目」（DESIGN.md 4.3、FR-T12）。未着手と完了には付けない。
 * 日数は domain で計算する（AI にも画面にも数えさせない）。
 */
export function StatusBadge({
  status,
  since,
  today,
}: {
  status: Status;
  since: string;
  today: string;
}) {
  if (status === 'todo' || status === 'done') return null;
  const text =
    status === 'cancelled'
      ? STATUS_LABELS[status]
      : `${STATUS_LABELS[status]}・${dayOrdinalSince(since, today)}日目`;
  return (
    <span className="chip" data-status={status}>
      {text}
    </span>
  );
}

/** 件数などを出すチップ（状態色を薄く重ねる） */
export function CountChip({ status, children }: { status: Status; children: string }) {
  return (
    <span className="chip" data-status={status}>
      {children}
    </span>
  );
}
