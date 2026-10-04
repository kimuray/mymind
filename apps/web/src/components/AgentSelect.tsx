import type { AgentChoice } from '../api/settings';

/** 選べるエージェントと表示名（FR-A07）。開発用の fake は環境変数でだけ選ぶので並べない */
export const AGENT_OPTIONS: { value: AgentChoice; label: string }[] = [
  { value: 'claude', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
];

/** 偽のアダプタで動いているときに、選択の横に添える文 */
export const FAKE_AGENT_NOTE = '開発用の偽のアダプタを使っているため、この選択は使われません';

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
  fakeAgent,
}: {
  id: string;
  label: string;
  value: AgentChoice;
  onChange: (value: AgentChoice) => void;
  disabled?: boolean;
  /** 周りに同じ見出しがあるときは false にし、名前を aria-label だけで付ける */
  showLabel?: boolean;
  /**
   * MYMIND_AGENT=fake で動いているときに、選択が使われないことを添える（FR-A07、issue 144）。
   * full は文で、chip は狭い場所向けに「偽のアダプタ」のチップで出す（文は読み上げとツールチップで伝える）
   */
  fakeAgent?: 'full' | 'chip' | undefined;
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
        {...(fakeAgent === undefined ? {} : { 'aria-describedby': `${id}-fake` })}
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
      {fakeAgent === 'full' && (
        <span id={`${id}-fake`} className="agent-select-note">
          {FAKE_AGENT_NOTE}
        </span>
      )}
      {fakeAgent === 'chip' && (
        <span className="chip" data-status="paused" title={FAKE_AGENT_NOTE}>
          偽のアダプタ
          <span id={`${id}-fake`} className="visually-hidden">
            {FAKE_AGENT_NOTE}
          </span>
        </span>
      )}
    </span>
  );
}
