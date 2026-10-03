/**
 * エージェントの失敗の種類（FR-A08、#23）。画面には種類ごとに、何が起きたかと、どうすればよいかを出す。
 * 未ログインと利用上限の実際の出力は spike（#10）で確かめられていないので、言葉で見分ける推定。
 * 見分けられないものは unknown にして、CLI が出した理由をそのまま添える
 */
export type AgentFailureKind =
  | 'not_found'
  | 'auth'
  | 'rate_limit'
  | 'model'
  | 'timeout'
  | 'invalid_output'
  | 'unknown';

/** 種類ごとの、利用者に見せる文の先頭と対処 */
export const FAILURE_GUIDES: Readonly<Record<AgentFailureKind, string>> = {
  not_found:
    'エージェントのコマンドが見つかりません。インストールされているか、PATH を確かめてください',
  auth: 'エージェントにログインしていないようです。ターミナルでログインしてから、もう一度依頼してください',
  rate_limit:
    'エージェントの利用上限に達したようです。しばらく待ってから、もう一度依頼してください',
  model:
    '指定したモデルが使えないようです。MYMIND_AGENT_MODEL か、エージェントの設定ファイルのモデルを確かめてください',
  timeout:
    '時間内に応答がありませんでした。もう一度依頼するか、MYMIND_AGENT_TIMEOUT_SEC を長くしてください',
  invalid_output: 'エージェントの返答が FB の形になっていませんでした。もう一度依頼してください',
  unknown: 'エージェントが FB を返しませんでした',
};

const PATTERNS: readonly [AgentFailureKind, RegExp][] = [
  // 利用上限は、ログインの失敗より先に見る（上限の文に「ログイン」が含まれることがあるため）
  ['rate_limit', /rate.?limit|usage limit|too many requests|\b429\b|上限/i],
  ['model', /model .*(not supported|not found|does not exist)|unsupported model/i],
  ['auth', /not logged in|log ?in|\/login|unauthori[sz]ed|\b401\b|invalid api key|authenticat/i],
];

/** CLI が出した理由の文から、失敗の種類を推定する */
export function classifyFailure(reason: string): AgentFailureKind {
  return PATTERNS.find(([, re]) => re.test(reason))?.[0] ?? 'unknown';
}

/** 画面に出す失敗の文。対処のあとに、CLI が出した理由を添える（調べるときの手がかり） */
export function describeFailure(kind: AgentFailureKind, reason = ''): string {
  const detail = reason.trim();
  return detail === '' ? FAILURE_GUIDES[kind] : `${FAILURE_GUIDES[kind]}（${detail}）`;
}
