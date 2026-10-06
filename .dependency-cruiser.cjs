/** パッケージ間の依存方向を検証する（.claude/rules/architecture.md） */
module.exports = {
  forbidden: [
    {
      name: 'domain-is-pure',
      comment: 'packages/domain は他のパッケージ・Node.js 組み込み・DB/HTTP ライブラリに依存しない',
      severity: 'error',
      from: { path: '^packages/domain/' },
      to: {
        pathNot: '^packages/domain/|node_modules/(zod|ulid)/',
      },
    },
    {
      name: 'domain-no-node-builtins',
      severity: 'error',
      from: { path: '^packages/domain/' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'db-and-agent-depend-only-on-domain',
      severity: 'error',
      from: { path: '^packages/(db|agent)/' },
      to: { path: '^(apps/|packages/(mcp)/)' },
    },
    {
      name: 'mcp-depends-only-on-domain',
      comment: 'packages/mcp は DB を直接読まず、サーバーの API を呼ぶ（ADR-0014、FR-M03）',
      severity: 'error',
      from: { path: '^packages/mcp/' },
      to: { path: '^(apps/|packages/(db|agent)/)' },
    },
    {
      name: 'no-child-process-outside-agent',
      comment:
        'エージェントの起動は packages/agent の AgentRunner を経由する。ビルド用のスクリプト（apps/*/scripts、ルートの scripts と同じ扱い）は対象外',
      severity: 'error',
      from: { pathNot: '^(packages/agent/|apps/[^/]+/scripts/)' },
      to: { path: '^(node:)?child_process$', dependencyTypes: ['core'] },
    },
    {
      name: 'web-does-not-import-server-runtime',
      comment: 'apps/web は apps/server の型だけを共有する（import type のみ許可）',
      severity: 'error',
      from: { path: '^apps/web/' },
      to: { path: '^apps/server/', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'desktop-depends-only-on-server',
      comment:
        'apps/desktop はサーバーを起動するために apps/server だけを読み込み、DB やエージェントを直接使わない（ADR-0015）',
      severity: 'error',
      // テストだけは、メニューのキーが画面のキーと重ならないかを確かめるため、画面のキーマップを読む
      from: { path: '^apps/desktop/', pathNot: '\\.test\\.ts$' },
      to: { path: '^(apps/web/|packages/)' },
    },
    {
      name: 'nothing-imports-desktop',
      comment: 'apps/desktop は最上位。ほかのパッケージから読み込まない（ADR-0015）',
      severity: 'error',
      from: { pathNot: '^apps/desktop/' },
      to: { path: '^apps/desktop/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // ビルドの出力（apps/desktop/out は .app を作ったときの出力）は調べない
    exclude: { path: '(^|/)(dist|coverage)/|^apps/desktop/out/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'types'] },
  },
};
