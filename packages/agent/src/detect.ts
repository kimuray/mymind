import { execFile } from 'node:child_process';

/** エージェントの実行ファイルに --version を尋ねた結果 */
export type VersionProbe =
  | { ok: true; stdout: string }
  | { ok: false; kind: 'not_found' | 'failed'; message: string };

export type ProbeVersion = (command: string, timeoutMs: number) => Promise<VersionProbe>;

/** `<command> --version` を実行する。ツールの使用も入力もないので、LLM は呼ばない */
export const probeVersion: ProbeVersion = (command, timeoutMs) =>
  new Promise((resolve) => {
    execFile(command, ['--version'], { timeout: timeoutMs }, (error, stdout) => {
      if (error === null) {
        resolve({ ok: true, stdout: String(stdout) });
        return;
      }
      const code = (error as NodeJS.ErrnoException).code;
      resolve(
        code === 'ENOENT'
          ? {
              ok: false,
              kind: 'not_found',
              message: `${command} が見つかりません（PATH を確認してください）`,
            }
          : {
              ok: false,
              kind: 'failed',
              message: `${command} --version が失敗しました（${error.message}）`,
            },
      );
    });
  });

export type AgentStatus = {
  name: string;
  /** FB を依頼すれば生成できる見込みがあるか */
  usable: boolean;
  /** 実行ファイル（偽のアダプタでは null） */
  executable: { found: boolean; version: string | null } | null;
  /** 使えない理由（使えるなら null） */
  message: string | null;
};

const EXECUTABLES: Record<string, string> = { claude: 'claude', codex: 'codex' };

/** 実物のアダプタを作ったエージェント。起動方法のスパイク（#10、ADR-0005）の後で足す */
const ADAPTERS: ReadonlySet<string> = new Set();

/**
 * エージェントを使えるかを確かめる（NFR-21、architecture.md 12.8）。
 * 実行ファイルの有無とバージョンを見る。アダプタがまだないエージェントは、実行ファイルがあっても使えない
 */
export async function detectAgent(
  name: string,
  probe: ProbeVersion = probeVersion,
  timeoutMs = 5_000,
): Promise<AgentStatus> {
  if (name === 'fake') return { name, usable: true, executable: null, message: null };
  const command = EXECUTABLES[name];
  if (command === undefined) {
    return { name, usable: false, executable: null, message: `${name} には対応していません` };
  }
  const result = await probe(command, timeoutMs);
  const executable = result.ok
    ? { found: true, version: result.stdout.trim().split('\n')[0] ?? null }
    : { found: result.kind !== 'not_found', version: null };
  if (!result.ok) return { name, usable: false, executable, message: result.message };
  if (!ADAPTERS.has(name)) {
    return {
      name,
      usable: false,
      executable,
      message: `${name} のアダプタはまだ使えません（MYMIND_AGENT=fake で偽のアダプタを使えます）`,
    };
  }
  return { name, usable: true, executable, message: null };
}
