/** JWT authentication with LEA role model. */
import bcrypt from "bcryptjs";
import express from "express";
import jwt from "jsonwebtoken";
import { env } from "./env";

export type Role = "INVESTIGATOR" | "SUPERVISOR" | "ADMIN";

export interface LeaUser {
  id: string;
  username: string;
  passwordHash: string;
  name: string;
  role: Role;
  agency: string;
}

const users = new Map<string, LeaUser>();

export function seedUser(u: Omit<LeaUser, "passwordHash"> & { password: string }) {
  users.set(u.username, { ...u, passwordHash: bcrypt.hashSync(u.password, 8) });
}

export function authenticate(username: string, password: string): LeaUser | null {
  const u = users.get(username);
  if (u && bcrypt.compareSync(password, u.passwordHash)) return u;
  return null;
}

export function signToken(u: LeaUser): string {
  return jwt.sign(
    { sub: u.id, username: u.username, name: u.name, role: u.role, agency: u.agency },
    env.jwtSecret,
    { expiresIn: "12h" },
  );
}

export interface AuthedRequest extends express.Request {
  user?: { sub: string; username: string; name: string; role: Role; agency: string };
}

export function requireAuth(req: AuthedRequest, res: express.Response, next: express.NextFunction) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    req.user = jwt.verify(token, env.jwtSecret) as AuthedRequest["user"];
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireRole(...roles: Role[]) {
  return (req: AuthedRequest, res: express.Response, next: express.NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Authentication required" });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Requires role: ${roles.join(" or ")}` });
    }
    next();
  };
}

export function publicUser(u: LeaUser) {
  return { id: u.id, username: u.username, name: u.name, role: u.role, agency: u.agency };
}
