import { SignJWT, jwtVerify } from "jose";
import { config } from "../config.js";

const secret = new TextEncoder().encode(config.TOKEN_SECRET);

export interface TokenPayload {
  sub: string;
  username: string;
  sid: string;
}

export async function signToken(payload: TokenPayload): Promise<string> {
  return new SignJWT({ username: payload.username, sid: payload.sid })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${config.TOKEN_TTL_DAYS}d`)
    .sign(secret);
}

export async function verifyToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    if (
      typeof payload.sub !== "string" ||
      typeof payload.username !== "string" ||
      typeof payload.sid !== "string"
    ) {
      return null;
    }
    return { sub: payload.sub, username: payload.username, sid: payload.sid };
  } catch {
    return null;
  }
}
