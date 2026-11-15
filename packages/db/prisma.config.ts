import 'dotenv/config';
import path from 'node:path';
import { defineConfig, env } from 'prisma/config';
import { config } from 'dotenv';

config({ path: path.resolve(import.meta.dirname, '../../.env'), quiet: true, override: false });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
