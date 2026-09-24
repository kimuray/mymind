import { nextOnAdvance, STATUS_LABELS, type Status } from '@mymind/domain';

/** 状態を形でも区別する（DESIGN.md 2.2、4.2）。色は data-status と CSS で付ける */
function Glyph({ status }: { status: Status }) {
  switch (status) {
    case 'todo':
      return <circle className="si-ring" cx="10" cy="10" r="7.5" />;
    case 'doing':
      return (
        <>
          <circle className="si-ring" cx="10" cy="10" r="7.5" />
          <path className="si-fill" d="M10 2.5a7.5 7.5 0 0 0 0 15z" />
        </>
      );
    case 'waiting':
      return (
        <>
          <circle className="si-ring" cx="10" cy="10" r="7.5" />
          <path className="si-line" d="M10 5.5V10l3 2" />
        </>
      );
    case 'paused':
      return (
        <>
          <circle className="si-ring" cx="10" cy="10" r="7.5" />
          <path className="si-line" d="M8 6.5v7M12 6.5v7" />
        </>
      );
    case 'done':
      return (
        <>
          <circle className="si-fill" cx="10" cy="10" r="8.5" />
          <path className="si-check" d="M6.2 10.2l2.6 2.6 5-5.4" />
        </>
      );
    case 'cancelled':
      return (
        <>
          <circle className="si-ring" cx="10" cy="10" r="7.5" />
          <path className="si-line" d="M5 15L15 5" />
        </>
      );
  }
}

type StatusIconProps = {
  title: string;
  status: Status;
  onAdvance: () => void;
  disabled?: boolean;
};

/**
 * ステータスアイコン。クリック（と Space / Enter）で次の状態へ進める（DESIGN.md 4.2）。
 * 進められない状態（中止）はボタンを無効にする。
 */
export function StatusIcon({ title, status, onAdvance, disabled = false }: StatusIconProps) {
  const canAdvance = nextOnAdvance(status) !== null;
  const label = `${title}：${STATUS_LABELS[status]}${canAdvance ? '（クリックで次の状態へ）' : ''}`;
  return (
    <button
      type="button"
      className="status-icon"
      data-status={status}
      aria-label={label}
      disabled={disabled || !canAdvance}
      onClick={(e) => {
        e.stopPropagation();
        onAdvance();
      }}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <Glyph status={status} />
      </svg>
    </button>
  );
}
