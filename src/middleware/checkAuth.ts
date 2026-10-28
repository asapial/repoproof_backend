/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextFunction, Request, Response } from "express";
import status from "http-status";

import { envVars } from "../config/env";
import AppError from "../errorHelpers/AppError";
import { prisma } from "../lib/prisma";
import { jwtUtils } from "../utils/jwt";
import { cookieUtils } from "../utils/cookie";
import { Role } from "../../prisma/generated/prisma/enums";

declare global {
    namespace Express {
        interface Request {
            user: {
                userId: string;
                role: Role;
                email: string;
            }
        }
    }
}

/**
 * Authentication middleware.
 *
 * PRIMARY AUTH  → JWT access token (cookie: "accessToken")
 *   • Always required.
 *   • Set on the FRONTEND domain for ALL login methods (email/password AND
 *     Google OAuth), so it is always forwarded when Next.js proxies requests.
 *
 * OPTIONAL AUTH → BetterAuth session cookie
 *   • Only validated if the cookie is present (e.g. email/password login on
 *     localhost where both servers share the `localhost` domain).
 *   • In production, Google OAuth sets the BetterAuth session cookie on the
 *     BACKEND domain (nexora-backend-rust.vercel.app). That cookie is never
 *     forwarded by the frontend (nexorafrontend-one.vercel.app) because
 *     browsers enforce domain isolation. Requiring it breaks Google OAuth in
 *     production — this is the root cause of the cookie disappearing issue.
 */
export const checkAuth = (...authRoles: Role[]) => async (req: Request, res: Response, next: NextFunction) => {
    try {
        // ── 1. Verify the JWT access token (required) ─────────────────────────
        const accessToken = cookieUtils.getCookie(req, "accessToken");

        if (!accessToken) {
            throw new AppError(status.UNAUTHORIZED, "Unauthorized access! Please log in to continue.");
        }

        const verifiedToken = jwtUtils.vefifyToken(accessToken, envVars.ACCESS_TOKEN_SECRET);

        if (!verifiedToken.success || !verifiedToken.data) {
            throw new AppError(status.UNAUTHORIZED, "Unauthorized access! Access token is invalid or expired.");
        }

        const { userId } = verifiedToken.data as { userId: string; role: Role; email: string };

        // ── 2. DB user check — ensure account still exists and is active ──────
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, role: true, email: true, isDeleted: true, isActive: true },
        });

        if (!user) {
            throw new AppError(status.UNAUTHORIZED, "Unauthorized access! User account not found.");
        }

        if (user.isDeleted) {
            throw new AppError(status.UNAUTHORIZED, "Unauthorized access! User account has been deleted.");
        }

        if (user.isActive === false) {
            throw new AppError(status.FORBIDDEN, "Your account has been deactivated. Please contact support.");
        }

        // ── 3. Role-based access guard ────────────────────────────────────────
        if (authRoles.length > 0 && !authRoles.includes(user.role)) {
            throw new AppError(
                status.FORBIDDEN,
                `Forbidden! This resource requires one of: [${authRoles.join(", ")}].`
            );
        }

        // ── 4. Populate req.user ──────────────────────────────────────────────
        req.user = {
            userId: user.id,
            role:   user.role,
            email:  user.email,
        };

        // ── 5. Optional: BetterAuth session expiry warning ────────────────────
        // If the BetterAuth session cookie is present, emit refresh-hint headers.
        // We do NOT reject the request if the session is absent or invalid — the
        // JWT above is the authoritative proof of identity.
        const sessionToken = cookieUtils.getBetterAuthSessionToken(req);

        if (sessionToken) {
            const rawSessionToken = sessionToken.includes(".")
                ? sessionToken.split(".")[0]
                : sessionToken;

            const sessionExists = await prisma.session.findFirst({
                where: { token: rawSessionToken },
                select: { id: true, expiresAt: true, createdAt: true },
            });

            if (sessionExists) {
                const now = new Date();
                const expiresAt = new Date(sessionExists.expiresAt);
                const createdAt = new Date(sessionExists.createdAt);
                const sessionLifeTime = expiresAt.getTime() - createdAt.getTime();
                const timeRemaining = expiresAt.getTime() - now.getTime();
                const percentRemaining = sessionLifeTime > 0 ? (timeRemaining / sessionLifeTime) * 100 : 100;

                if (percentRemaining < 20) {
                    res.setHeader("X-Session-Refresh", "true");
                    res.setHeader("X-Session-Expires-At", expiresAt.toISOString());
                    res.setHeader("X-Time-Remaining", timeRemaining.toString());
                }
            }
        }

        next();
    } catch (error: any) {
        next(error);
    }
};