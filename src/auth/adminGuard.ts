import type { FastifyReply, FastifyRequest } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "../server/errors.js";

export interface AdminPrincipal {
  userId: string;
}

interface MembershipCacheEntry {
  isMember: boolean;
  cachedAt: number;
}

const MEMBERSHIP_TTL_MS = 60_000; // AUTH.md §2: revocation effective within 60 s (DB layer is immediate)

/**
 * Admin authentication + authorization for /admin routes.
 * Verification: supabase.auth.getUser() performs trusted issuer/audience/expiry
 * validation server-side (AUTH.md §2 — getUser is used where session freshness
 * matters). Authorization: membership in app_admins, checked per request with a
 * 60 s in-process freshness cache. RLS is a second layer, never the only one.
 */
export function createAdminGuard(supabase: SupabaseClient) {
  const cache = new Map<string, MembershipCacheEntry>();

  return async function adminGuard(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new AppError("UNAUTHORIZED", "Missing bearer token.");
    }
    const token = header.slice("Bearer ".length).trim();

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      throw new AppError("UNAUTHORIZED", "Invalid or expired session.");
    }
    const userId = data.user.id;

    const cached = cache.get(userId);
    const now = Date.now();
    let isMember: boolean;
    if (cached && now - cached.cachedAt < MEMBERSHIP_TTL_MS) {
      isMember = cached.isMember;
    } else {
      const { data: row, error: dbError } = await supabase
        .from("app_admins")
        .select("user_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (dbError) throw new AppError("INTERNAL", "Authorization backend failure.");
      isMember = row !== null;
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
