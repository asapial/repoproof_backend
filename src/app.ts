import { toNodeHandler } from "better-auth/node";
import { createApp } from "./appFactory";
import { envVars } from "./config/env";
import { auth } from "./lib/auth";
import { indexRouter } from ".";

export default createApp(toNodeHandler(auth), indexRouter, envVars.FRONTEND_URL, envVars.NODE_ENV === "production", envVars.BETTER_AUTH_URL);
