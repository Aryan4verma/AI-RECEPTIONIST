import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../server/errors.js";

export interface AdminPrincipal {
  userId: string;
}

export type AdminVerifier = (token: string) => Promise<{ userId: string } | null>;

interface MembershipCacheEntry {
  isMember: boolean;
  cachedAt: number;
}

const MEMBERSHIP_TTL_MS = 60_000; // AUTH.md §2: revocation effective ≤ 60 s (DB layer immediate)

/**
 * Admin authentication + authorization for /admin routes (AUTH.md §2/§4).
 * Identity verification is injected (production: Supabase Auth getUser;
 * tests: a stub) so the guard is contract-testable without live credentials.
 * Authorization is the app_admins membership check with a 60 s freshness
 * cache — independent of RLS, which remains a second layer.
 */
export function createAdminGuard(deps: {
  verify: AdminVerifier;
  isMember: (userId: string) => Promise<boolean>;
}) {
  const cache = new Map<string, MembershipCacheEntry>();

  return async function adminGuard(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new AppError("UNAUTHORIZED", "Missing bearer token.");
    }
    const token = header.slice("Bearer ".length).trim();

    const verified = await deps.verify(token);
    if (!verified) {
      throw new AppError("UNAUTHORIZED", "Invalid or expired session.");
    }
    const userId = verified.userId;

    const cached = cache.get(userId);
    const now = Date.now();
    let isMember: boolean;
    if (cached && now - cached.cachedAt < MEMBERSHIP_TTL_MS) {
      isMember = cached.isMember;
    } else {
      isMember = await deps.isMember(userId);
      cache.set(userId, { isMember, cachedAt: now });
    }
    if (!isMember) {
      throw new AppError("FORBIDDEN", "Administrator membership required.");
    }

    (request as FastifyRequest & { admin?: AdminPrincipal }).admin = { userId };
  };
}

export function requireAdmin(request: FastifyRequest): AdminPrincipal {
  const admin = (request as FastifyRequest & { admin?: AdminPrincipal }).admin;
  if (!admin) throw new AppError("UNAUTHORIZED", "Administrator identity missing.");
  return admin;
}
