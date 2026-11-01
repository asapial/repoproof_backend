import { toNodeHandler } from "better-auth/node";
import express from "express";
import { createApp } from "./appFactory";
import { envVars } from "./config/env";
import { auth } from "./lib/auth";
import { indexRouter } from ".";
import { prisma } from "./lib/prisma";

// Official Vercel Express entrypoint: exporting the app never binds a port.
export default createApp(toNodeHandler(auth), indexRouter, envVars.FRONTEND_URL, envVars.NODE_ENV === "production", envVars.BETTER_AUTH_URL, { app: express(), checkReadiness: () => prisma.$queryRaw`SELECT 1` });
