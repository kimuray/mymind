import { describe, expect, it } from 'vitest';
import { detectAgent, type ProbeVersion } from './detect';

// 実物の CLI は呼ばず、--version の結果を差し替えて確かめる
const probeReturning =
  (result: Awaited<ReturnType<ProbeVersion>>): ProbeVersion =>
  async () =>
    result;

describe('NFR-21 エージェントを使えるか', () => {
  it('偽のアダプタはいつでも使える', async () => {
    expect(
      await detectAgent('fake', probeReturning({ ok: false, kind: 'failed', message: '' })),
    ).toEqual({
      name: 'fake',
      usable: true,
      executable: null,
      message: null,
    });
  });

  it('実行ファイルが見つからなければ、使えない理由を返す', async () => {
    const status = await detectAgent(
      'claude',
      probeReturning({ ok: false, kind: 'not_found', message: 'claude が見つかりません' }),
    );
    expect(status).toEqual({
      name: 'claude',
      usable: false,
      executable: { found: false, version: null },
      message: 'claude が見つかりません',
    });
  });

  it('実行ファイルがあればバージョンを返すが、アダプタがまだなければ使えない', async () => {
    const status = await detectAgent(
      'codex',
      probeReturning({ ok: true, stdout: 'codex-cli 1.2.3\n' }),
    );
    expect(status).toEqual({
      name: 'codex',
      usable: false,
      executable: { found: true, version: 'codex-cli 1.2.3' },
      message: 'codex のアダプタはまだ使えません（MYMIND_AGENT=fake で偽のアダプタを使えます）',
    });
  });

  it('--version が失敗したら、実行ファイルはあるが使えないとする', async () => {
    const status = await detectAgent(
      'claude',
      probeReturning({ ok: false, kind: 'failed', message: 'claude --version が失敗しました' }),
    );
    expect(status).toMatchObject({
      usable: false,
      executable: { found: true, version: null },
      message: 'claude --version が失敗しました',
    });
  });

  it('対応していないエージェントは使えない', async () => {
    expect(await detectAgent('other')).toMatchObject({
      usable: false,
      message: 'other には対応していません',
    });
  });
});
