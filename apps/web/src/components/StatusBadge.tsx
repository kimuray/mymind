import { dayOrdinalSince, STATUS_LABELS, type Status } from '@mymind/domain';
import { AnimatedNumber } from './AnimatedNumber';

/**
 * 状態のバッジ「状態・N日目」（DESIGN.md 4.3、FR-T12）。未着手と完了には付けない。
 * 日数は domain で計算する（AI にも画面にも数えさせない）。
 */
export function StatusBadge({
  status,
  since,
  today,
  animate = false,
}: {
  status: Status;
  since: string;
  today: string;
  /** 状態が変わった直後か。true なら現れるときに動きを付ける */
  animate?: boolean;
}) {
  if (status === 'todo' || status === 'done') return null;
  const text =
    status === 'cancelled'
      ? STATUS_LABELS[status]
      : `${STATUS_LABELS[status]}・${dayOrdinalSince(since, today)}日目`;
  return (
    // 状態ごとに作り直し、変わった直後だけ CSS の動きを再生する
    <span key={status} className="chip" data-status={status} data-animate={animate}>
      {text}
    </span>
  );
}

/** 件数を出すチップ（状態色を薄く重ねる）。件数が変わると数字を入れ替える（DESIGN.md 4.20） */
export function CountChip({
  status,
  label,
  count,
}: {
  status: Status;
  label: string;
  count: number;
}) {
  return (
    <span className="chip" data-status={status}>
      {label} <AnimatedNumber value={count} />
    </span>
  );
}
