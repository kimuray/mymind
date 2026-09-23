import { defineConfig } from 'drizzle-kit';

// generate は DB に接続せずにスキーマから SQL を作るだけなので、ドライバの指定は不要（ADR-0006）
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema.ts',
  out: './migrations',
});
