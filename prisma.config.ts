import { defineConfig } from 'prisma/config';

// Prisma 7 keeps connection URLs here, not in schema.prisma.
//
// `datasource.url` is the DIRECT connection (port 5432). It is what migrations
// and introspection use, and it is deliberately NOT the pooled URL --
// migrations cannot run through Supabase's pooler.
//
// The pooled URL (DATABASE_URL, port 6543) never appears in this file. It is
// handed to the PrismaPg driver adapter wherever a PrismaClient is built.
//
// Values come from .env.local, loaded by scripts/with-env.mjs before the
// Prisma CLI starts. Prisma does not read .env.local itself.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node prisma/seed.mjs',
  },
  datasource: {
    url: process.env.DIRECT_URL,
  },
});
