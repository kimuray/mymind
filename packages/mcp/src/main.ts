// mymind の MCP サーバー（FR-M01〜M03、ADR-0014）。stdio で動き、読み取りの道具だけを出す。
// 使い方は packages/mcp/README.md。標準出力は MCP の通信に使うので、ログは標準エラーにだけ出す
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createApiClient, loadConnection } from './client';
import { createTools } from './tools';

const tools = createTools(createApiClient(loadConnection(process.env)));
const server = new McpServer({ name: 'mymind', version: '0.1.0' });

server.registerTool(
  'get_day',
  {
    title: tools.get_day.title,
    description: tools.get_day.description,
    inputSchema: tools.get_day.inputSchema,
    annotations: { readOnlyHint: true },
  },
  (args) => tools.get_day.run(args),
);
server.registerTool(
  'get_backlog',
  {
    title: tools.get_backlog.title,
    description: tools.get_backlog.description,
    annotations: { readOnlyHint: true },
  },
  () => tools.get_backlog.run(),
);
server.registerTool(
  'get_timeline',
  {
    title: tools.get_timeline.title,
    description: tools.get_timeline.description,
    inputSchema: tools.get_timeline.inputSchema,
    annotations: { readOnlyHint: true },
  },
  (args) => tools.get_timeline.run(args),
);
server.registerTool(
  'get_month',
  {
    title: tools.get_month.title,
    description: tools.get_month.description,
    inputSchema: tools.get_month.inputSchema,
    annotations: { readOnlyHint: true },
  },
  (args) => tools.get_month.run(args),
);
server.registerTool(
  'search_tasks',
  {
    title: tools.search_tasks.title,
    description: tools.search_tasks.description,
    inputSchema: tools.search_tasks.inputSchema,
    annotations: { readOnlyHint: true },
  },
  (args) => tools.search_tasks.run(args),
);

await server.connect(new StdioServerTransport());
