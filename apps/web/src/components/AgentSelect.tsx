import type { AgentChoice } from '../api/settings';

/** 選べるエージェントと表示名（FR-A07）。開発用の fake は環境変数でだけ選ぶので並べない */
export const AGENT_OPTIONS: { value: AgentChoice; label: string }[] = [
  { value: 'claude', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
];

const isAgentChoice = (value: string): value is AgentChoice =>
  AGENT_OPTIONS.some((o) => o.value === value);

/** 使うエージェントの選択（振り返りの依頼と、設定の既定のエージェントで使う） */
export function AgentSelect({
  id,
  label,
  value,
  onChange,
  disabled = false,
  showLabel = true,
}: {
  id: string;
  label: string;
  value: AgentChoice;
  onChange: (value: AgentChoice) => void;
  disabled?: boolean;
  /** 周りに同じ見出しがあるときは false にし、名前を aria-label だけで付ける */
  showLabel?: boolean;
}) {
  return (
    <span className="agent-select">
      {showLabel && (
        <label htmlFor={id} className="text-small">
          {label}
        </label>
      )}
      <select
        id={id}
        {...(showLabel ? {} : { 'aria-label': label })}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          if (isAgentChoice(e.target.value)) onChange(e.target.value);
        }}
      >
        {AGENT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}
