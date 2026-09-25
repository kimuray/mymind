import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';

const LOOPBACK = '127.0.0.1';
const ALL_INTERFACES = '0.0.0.0';
const DEFAULT_PORT = 4820;

const envSchema = z.object({
  MYMIND_DATA_DIR: z.string().min(1).optional(),
  MYMIND_HOST: z.enum([LOOPBACK, ALL_INTERFACES]).default(LOOPBACK),
  MYMIND_PORT: z.coerce.number().int().min(1).max(65535).default(DEFAULT_PORT),
  MYMIND_IN_CONTAINER: z.enum(['0', '1']).default('0'),
  /** 開発時の Vite のポート。指定したときだけ、Host・Origin の許可リストに加える（ADR-0007） */
  MYMIND_VITE_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  /** FB を作るエージェント（FR-A07）。fake はテストと開発用の偽のアダプタ */
  MYMIND_AGENT: z.enum(['claude', 'codex', 'fake']).default('claude'),
  /** 偽のアダプタの振る舞いと、答えるまでの時間（生成中の表示やキャンセルを確かめるため） */
  MYMIND_FAKE_AGENT_MODE: z.enum(['success', 'invalid', 'invalid-once', 'hang']).default('success'),
  MYMIND_FAKE_AGENT_DELAY_MS: z.coerce.number().int().min(0).max(60_000).default(800),
});

export type ServerConfig = {
  dataDir: string;
  host: typeof LOOPBACK | typeof ALL_INTERFACES;
  port: number;
  /** 開発時に Vite 経由で開く場合のポート。本番（Hono が画面も配信する）では空 */
  devPorts: number[];
  agent: {
    name: 'claude' | 'codex' | 'fake';
    fakeMode: 'success' | 'invalid' | 'invalid-once' | 'hang';
    fakeDelayMs: number;
  };
};

export type ConfigError =
  | { kind: 'invalid_env'; issues: string[] }
  | { kind: 'all_interfaces_outside_container' };

/**
 * 環境変数から起動の設定を作る（NFR-02、ADR-0010）。
 * 待ち受けは 127.0.0.1 が原則で、0.0.0.0 はコンテナの中（ポートをホストの 127.0.0.1 にだけ公開する）でだけ許す。
 */
export function loadConfig(
  env: Record<string, string | undefined>,
): { ok: true; value: ServerConfig } | { ok: false; error: ConfigError } {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        kind: 'invalid_env',
        issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      },
    };
  }
  const e = parsed.data;
  if (e.MYMIND_HOST === ALL_INTERFACES && e.MYMIND_IN_CONTAINER !== '1') {
    return { ok: false, error: { kind: 'all_interfaces_outside_container' } };
  }
  return {
    ok: true,
    value: {
      dataDir: resolve(e.MYMIND_DATA_DIR ?? join(homedir(), '.mymind')),
      host: e.MYMIND_HOST,
      port: e.MYMIND_PORT,
      devPorts: e.MYMIND_VITE_PORT === undefined ? [] : [e.MYMIND_VITE_PORT],
      agent: {
        name: e.MYMIND_AGENT,
        fakeMode: e.MYMIND_FAKE_AGENT_MODE,
        fakeDelayMs: e.MYMIND_FAKE_AGENT_DELAY_MS,
      },
    },
  };
}
