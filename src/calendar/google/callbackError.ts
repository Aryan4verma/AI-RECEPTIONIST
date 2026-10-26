import { AppError, type ErrorCode } from "../../server/errors.js";

export const CALLBACK_MESSAGES = {
  configuration: "Google OAuth is not configured. Check the four server settings and restart the backend.",
  state: "This connection attempt is invalid or expired. Return to the admin console and click Connect Google account again; do not refresh this callback.",
  consent: "Google consent was not granted. Start again from the admin console and approve access with the intended account.",
  token_exchange: "Google token exchange failed. Check the OAuth client and exact redirect URI, then start a fresh connection from the admin console.",
  refresh_token: "Google did not return offline access. Start a fresh connection and approve consent again.",
  calendar_access: "The dedicated calendar could not be verified. Check its ID, Google Calendar API access, and that the selected account has owner or writer access.",
  vault_storage: "Secure Vault credential storage failed. Check the backend Vault adapter and permissions, then start a fresh connection.",
  integration_persistence: "Saving the integration failed. Check backend access to the existing google_integration table, then start a fresh connection.",
  audit: "Recording the connection audit failed. Check backend audit permissions and availability, then start a fresh connection.",
} as const;
export type CallbackStage = keyof typeof CALLBACK_MESSAGES;

/** Contains only backend-owned categories and copy; never wraps raw provider/SQL errors. */
export class OAuthCallbackError extends AppError {
  constructor(readonly stage: CallbackStage, code: ErrorCode = "CALENDAR_UNAVAILABLE", readonly cleanupIncomplete = false) {
    super(code, CALLBACK_MESSAGES[stage] + (cleanupIncomplete ? " Credential cleanup is incomplete; ask the administrator to review it before retrying." : ""));
  }
}
