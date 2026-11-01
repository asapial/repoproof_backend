import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../prisma/generated/prisma/client';
import { attachDatabasePool } from "@vercel/functions/db-connections";
import { Pool } from "pg";
import { envVars } from "../config/env";
import { databasePoolOptions, logDatabaseUnavailable } from "./databasePool";

// One bounded pool per warm module. Never disconnect after each request.
const pool = new Pool(databasePoolOptions(envVars.DATABASE_URL));
pool.on("error", logDatabaseUnavailable);
if (process.env.VERCEL === "1") attachDatabasePool(pool);
const adapter = new PrismaPg(pool, { disposeExternalPool: true, onPoolError: logDatabaseUnavailable, onConnectionError: logDatabaseUnavailable });
const prisma = new PrismaClient({ adapter });

export { prisma };
