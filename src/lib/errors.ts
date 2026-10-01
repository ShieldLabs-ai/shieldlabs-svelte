import { ShieldLabsError, type ShieldLabsErrorCode } from '@shieldlabs-ai/js';

/**
 * Returns `reason` when it already is a `ShieldLabsError` (the only error type `@shieldlabs-ai/js`
 * rejects with) and wraps anything else, so the error stores always hold a `ShieldLabsError`.
 */
export function toShieldLabsError(reason: unknown, code: ShieldLabsErrorCode): ShieldLabsError {
  if (reason instanceof ShieldLabsError) return reason;
  const message = reason instanceof Error ? reason.message : String(reason);
  return new ShieldLabsError(code, message, reason);
}
