import { createApp } from './app';
import { type ConfigError, loadConfig } from './config';
import { acquireLock, ensureDataDir, issueSessionToken } from './dataDir';
import { listen } from './listen';

// サーバーのロガーを用意するまでは、起動時の失敗を console.error で表示する

function describeConfigError(error: ConfigError): string {
  switch (error.kind) {
    case 'invalid_env':
      return `環境変数が正しくありません：\n  ${error.issues.join('\n  ')}`;
    case 'all_interfaces_outside_container':
      return 'MYMIND_HOST=0.0.0.0 はコンテナの中（MYMIND_IN_CONTAINER=1）でだけ使えます';
  }
}

async function main(): Promise<number> {
  const config = loadConfig(process.env);
  if (!config.ok) {
    console.error(describeConfigError(config.error));
    return 1;
  }
  const { dataDir, host, port } = config.value;

  ensureDataDir(dataDir);
  const lock = acquireLock(dataDir, process.pid);
  if (!lock.ok) {
    console.error(
      `同じデータディレクトリ（${dataDir}）を使うサーバーが既に動いています（PID ${lock.error.pid}）`,
    );
    return 1;
  }

  const sessionToken = issueSessionToken(dataDir);
  const app = createApp({ ports: [port], sessionToken });
  const server = await listen(app, host, port);
  if (!server.ok) {
    lock.release();
    console.error(
      `ポート ${port} は使用中です。使っているプロセスを止めるか、MYMIND_PORT で別のポートを指定してください`,
    );
    return 1;
  }

  const shutdown = async () => {
    await server.value.close();
    lock.release();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  // 標準出力は起動の確認に使う（console.log はロガーに置き換えるまで使わない）
  process.stdout.write(`mymind を http://127.0.0.1:${port} で起動しました\n`);
  return 0;
}

const code = await main();
if (code !== 0) process.exit(code);
