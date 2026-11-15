import path from 'node:path';
import { defineConfig } from 'prisma/config';
import { config } from 'dotenv';

config({ path: path.resolve(import.meta.dirname, '../../.env'), quiet: true, override: false });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // `prisma generate` n'a pas besoin de base (ex. build Vercel de l'interface) : URL factice
  // si absente. Migrations et seed échouent alors explicitement à la connexion.
  datasource: { url: process.env.DATABASE_URL ?? 'postgresql://unset@localhost:5432/unset' },
});
