/**
 * src/lib/mutationGuard.ts
 * In-memory circuit breaker and rate-limiter for Firestore document mutations.
 */

const mutationTimestamps = new Map<string, number>();

/**
 * Checks if a document mutation is allowed based on a cooldown window.
 * @param docPath Unique document identifier (e.g., 'projects/PROJ_123' or 'invoices/INV_456')
 * @param cooldownMs Cooldown threshold in milliseconds (default: 15,000 ms)
 * @returns boolean True if mutation is permitted, False if throttled
 */
export function canMutateDocument(docPath: string, cooldownMs: number = 15000): boolean {
  const now = Date.now();
  const lastMutation = mutationTimestamps.get(docPath);

  if (lastMutation && now - lastMutation < cooldownMs) {
    console.warn(`[MutationGuard] Suppressed rapid duplicate write to "${docPath}" (${now - lastMutation}ms < ${cooldownMs}ms cooldown).`);
    return false;
  }

  mutationTimestamps.set(docPath, now);
  return true;
}

/**
 * Manually resets the mutation cooldown for a specific document or all documents.
 */
export function resetMutationGuard(docPath?: string): void {
  if (docPath) {
    mutationTimestamps.delete(docPath);
  } else {
    mutationTimestamps.clear();
  }
}
