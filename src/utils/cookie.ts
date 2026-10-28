import { CookieOptions, Request, Response } from "express";
import { envVars } from "../config/env";


const isProd = envVars.NODE_ENV === "production";

/**
 * BetterAuth prefixes cookie names with `__Secure-` when `useSecureCookies` is true.
 * This helper reads the session token cookie regardless of the prefix.
 */
const SESSION_COOKIE_NAME         = "better-auth.session_token";
const SECURE_SESSION_COOKIE_NAME  = "__Secure-better-auth.session_token";

const getBetterAuthSessionToken = (req: Request): string | undefined => {
    return req.cookies[SESSION_COOKIE_NAME] || req.cookies[SECURE_SESSION_COOKIE_NAME];
};

/**
 * Cookie name to use when *setting* the session token manually
 * (e.g. during email/password login).
 */
const betterAuthSessionCookieName = isProd ? SECURE_SESSION_COOKIE_NAME : SESSION_COOKIE_NAME;

const setCookie=(res:Response,key:string,value:string,options:CookieOptions)=>{

    res.cookie(key,value,options)
}

const getCookie=(req:Request,key:string)=>{
    return req.cookies[key];
}

const clearCookie = (res: Response, key: string, options: CookieOptions) => {
    res.clearCookie(key, options);
}

export const cookieUtils={
    setCookie,
    getCookie,
    clearCookie,
    getBetterAuthSessionToken,
    betterAuthSessionCookieName,
}
