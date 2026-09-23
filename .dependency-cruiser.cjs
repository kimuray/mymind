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
      name: 'no-child-process-outside-agent',
      comment: 'エージェントの起動は packages/agent の AgentRunner を経由する',
      severity: 'error',
      from: { pathNot: '^packages/agent/' },
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
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(dist|coverage)/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'types'] },
  },
};
