import { collection, addDoc } from 'firebase/firestore';
import { db } from './firebase';
import { COLLECTIONS, APPROVAL_TYPES, APPROVAL_STATUS } from '@/src/config/schema';

export interface PasswordResetRequestInput {
  requestedEmail?: string;
  email?: string;
  appName?: string;
  appId?: string;
  employeeName?: string;
  name?: string;
  employeeId?: string;
  reason?: string;
  requestedBy?: string;
}

/**
 * Dispatches a password reset request to the central `approvals` collection
 * strictly following the Solarithm Master Blueprint.
 */
export async function submitPasswordResetRequest(data: PasswordResetRequestInput) {
  const cleanEmail = (data.requestedEmail || data.email || '').trim().toLowerCase();
  const empName = (data.employeeName || data.name || '').trim();
  const empId = (data.employeeId || '').trim();

  const docData = {
    type: APPROVAL_TYPES.PASSWORD_RESET_REQUEST,
    requestedEmail: cleanEmail,
    email: cleanEmail,
    appName: data.appName || 'Solarithm Executive Dashboard',
    appId: data.appId || 'executive-dashboard',
    employeeName: empName,
    name: empName,
    employeeId: empId,
    reason: data.reason || 'Password reset requested via Executive Dashboard',
    status: APPROVAL_STATUS.PENDING,
    timestamp: new Date().toISOString()
  };

  const docRef = await addDoc(collection(db, COLLECTIONS.APPROVALS), docData);

  // Telemetry audit log
  await logAuditEvent({
    action: 'PASSWORD_RESET_REQUESTED',
    actor: 'system@solarithm.com',
    target: cleanEmail,
    details: {
      approvalId: docRef.id,
      appName: docData.appName,
      reason: docData.reason
    }
  });

  return docRef;
}

export interface AuditLogInput {
  action: string;
  actor?: string;
  target?: string;
  details?: any;
  timestamp?: string;
}

/**
 * Records an administrative or operational event in the centralized `auditLogs` collection.
 */
export async function logAuditEvent(input: AuditLogInput) {
  try {
    await addDoc(collection(db, COLLECTIONS.AUDIT_LOGS), {
      action: input.action,
      actor: input.actor || 'admin@solarithm.com',
      target: input.target || '',
      details: input.details ? (typeof input.details === 'object' ? JSON.stringify(input.details) : String(input.details)) : '',
      timestamp: input.timestamp || new Date().toISOString()
    });
  } catch (err) {
    // Non-blocking telemetry
    console.warn('Audit log write error:', err);
  }
}
