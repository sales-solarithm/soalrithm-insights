import { collection, addDoc } from 'firebase/firestore';
import { db } from '@/src/lib/firebase';
import { COLLECTIONS, APPROVAL_TYPES } from '@/src/config/schema';

export interface AuditEventPayload {
  action: string;
  target?: string;
  details?: Record<string, any>;
  actor?: string;
  timestamp?: string;
}

export interface PasswordResetRequestPayload {
  requestedEmail: string;
  email?: string;
  employeeId?: string;
  name?: string;
  requestedBy?: string;
}

export async function logAuditEvent(event: AuditEventPayload): Promise<void> {
  try {
    if (!db) return;
    await addDoc(collection(db, COLLECTIONS.AUDIT_LOGS), {
      ...event,
      timestamp: event.timestamp || new Date().toISOString(),
    });
  } catch (err) {
    console.warn('[masterHub] logAuditEvent warning:', err);
  }
}

export async function submitPasswordResetRequest(payload: PasswordResetRequestPayload): Promise<void> {
  try {
    if (!db) return;
    await addDoc(collection(db, COLLECTIONS.APPROVALS), {
      type: APPROVAL_TYPES.PASSWORD_RESET_REQUEST,
      ...payload,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    await logAuditEvent({
      action: 'PASSWORD_RESET_REQUESTED',
      target: payload.requestedEmail,
      details: payload,
    });
  } catch (err) {
    console.warn('[masterHub] submitPasswordResetRequest warning:', err);
    throw err;
  }
}
