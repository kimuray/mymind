import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './fixtures/migration-check/schema.ts',
  out: './fixtures/migration-check/migrations',
});
