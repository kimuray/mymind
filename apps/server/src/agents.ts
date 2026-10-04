import type { AgentRunner } from '@mymind/agent';
import { z } from 'zod';

/** 画面から選べるエージェント（FR-A07）。fake は環境変数でだけ選べる開発用なので含めない */
export const agentChoiceSchema = z.enum(['claude', 'codex']);

export type AgentChoice = z.infer<typeof agentChoiceSchema>;

/**
 * 選べるエージェントごとのアダプタ。MYMIND_AGENT=fake のときは、どちらにも偽のアダプタを入れる
 * （テストと開発で、画面の選択に関係なく実物を呼ばないため）
 */
export type AgentRunners = Record<AgentChoice, AgentRunner>;

/** 起動の設定（MYMIND_AGENT）から、設定が保存されていないときの既定のエージェントを決める */
export const initialAgentChoice = (name: string): AgentChoice => {
  const parsed = agentChoiceSchema.safeParse(name);
  return parsed.success ? parsed.data : 'claude';
};
