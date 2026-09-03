import { PrismaClient } from '@prisma/client';

/**
 * One Prisma client for the whole server process.
 *
 * Next reloads modules in development, so without the global a new client -- and
 * a new connection pool -- is created on every edit. On a pooler with a small
 * connection budget that exhausts the slots and every query fails as P1001.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
