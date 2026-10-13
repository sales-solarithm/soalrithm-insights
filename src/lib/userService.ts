import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  query,
  where,
  Firestore
} from 'firebase/firestore';
import { COLLECTIONS } from '@/src/config/schema';
import { formatIndianName, isZeroOrPositive } from '@/src/lib/projectUtils';

/**
 * Universal Recursive Firestore Payload Sanitizer (Audit ING-01 / DAT-01)
 *
 * 1. Recursively removes any key whose value is strictly `undefined`.
 * 2. Strictly preserves numeric `0` (₹0 base pay, fees, commissions).
 * 3. Retains native `Date` objects, Firestore `Timestamp` instances, and arrays intact.
 */
export function sanitizeFirestorePayload<T>(input: T): T {
  if (input === null || input === undefined) {
    return input;
  }

  // Preserve primitive types including numeric 0 and boolean false
  if (typeof input !== 'object') {
    return input;
  }

  // Preserve Date instances
  if (input instanceof Date) {
    return input;
  }

  // Preserve Firestore Timestamp instances or objects with toDate()
  if ('toDate' in (input as any) && typeof (input as any).toDate === 'function') {
    return input;
  }

  // Preserve Arrays
  if (Array.isArray(input)) {
    return input
      .filter((item) => item !== undefined)
      .map((item) => sanitizeFirestorePayload(item)) as unknown as T;
  }

  // Process plain objects
  const sanitizedObj: Record<string, any> = {};
  for (const [key, value] of Object.entries(input as Record<string, any>)) {
    if (value === undefined) {
      continue; // Strip out undefined values that trigger Firestore runtime errors
    }
    sanitizedObj[key] = sanitizeFirestorePayload(value);
  }

  return sanitizedObj as T;
}

/**
 * Safely converts an identifier or ID string (PAN, Aadhaar, Bank Acc, Phone, etc.)
 * without numeric truncation or scientific notation corruption.
 */
export function safeStringIdentifier(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? value.toLocaleString('fullwide', { useGrouping: false, maximumFractionDigits: 0 })
      : '';
  }
  return String(value).trim();
}

/**
 * Normalizes date values, explicitly returning `null` if empty or missing (Audit ING-01)
 */
export function safeDateFallback(value: unknown): string | null {
  if (!value || String(value).trim() === '') return null;
  const str = String(value).trim();
  if (str === '—' || str === '-' || str.toLowerCase() === 'null' || str.toLowerCase() === 'undefined') {
    return null;
  }
  return str;
}

export interface NormalizedEmployeePayload {
  email: string;
  name: string;
  phone: string;
  mobile: string;
  department: string;
  designation: string;
  role: string;
  employeeId: string;
  empId: string;
  dateOfJoining: string | null;
  doj: string | null;
  dateOfBirth: string | null;
  dob: string | null;
  bankName: string;
  bank: string;
  accountNumber: string;
  accNo: string;
  ifscCode: string;
  ifsc: string;
  panCardNumber: string;
  pan: string;
  aadhaarCardNumber: string;
  houseAddress: string;
  personalEmail: string;
  personalEmailAddress: string;
  uan: string;
  pfNo: string;
  esicNo: string;
  basic: number;
  basicPay: number;
  status: 'active' | 'inactive' | 'on_leave';
  active: boolean;
  createdAt: string;
  updatedAt: string;
  authUid?: string;
  uid?: string;
  [key: string]: any;
}

/**
 * Normalizes raw employee form data with safe fallbacks and zero preservation.
 */
export function buildNormalizedEmployeePayload(
  formData: any,
  existingData?: any
): NormalizedEmployeePayload {
  const cleanEmail = (formData.email || existingData?.email || '').trim().toLowerCase();
  const cleanEmpId = safeStringIdentifier(formData.empId || formData.employeeId || existingData?.empId || existingData?.employeeId).toUpperCase();
  const cleanName = formatIndianName(formData.name || existingData?.name || 'Unnamed Employee');
  
  // Safe phone fallback to ""
  const cleanPhone = safeStringIdentifier(
    formData.phone || formData.mobile || formData.phoneNumber || formData.contact ||
    existingData?.phone || existingData?.mobile || existingData?.phoneNumber || ''
  );

  // Safe personal email
  const personalEmail = (
    formData.personalEmail || formData.personalEmailAddress ||
    existingData?.personalEmail || existingData?.personalEmailAddress || ''
  ).trim().toLowerCase();

  // Safe dates falling back to null
  const dateOfJoining = safeDateFallback(
    formData.dateOfJoining || formData.doj || existingData?.dateOfJoining || existingData?.doj
  );
  const dateOfBirth = safeDateFallback(
    formData.dateOfBirth || formData.dob || existingData?.dateOfBirth || existingData?.dob
  );

  // Zero-safe salary calculation
  const rawBasic = formData.basic ?? formData.basicPay ?? existingData?.basic ?? existingData?.basicPay;
  const basicSalary = isZeroOrPositive(rawBasic) ? Number(rawBasic) : 0;

  // Banking & Identifiers
  const bankName = String(formData.bankName || formData.bank || existingData?.bankName || existingData?.bank || '').trim();
  const accountNumber = safeStringIdentifier(formData.accountNumber || formData.accNo || existingData?.accountNumber || existingData?.accNo);
  const ifscCode = safeStringIdentifier(formData.ifscCode || formData.ifsc || existingData?.ifscCode || existingData?.ifsc).toUpperCase();
  const panCardNumber = safeStringIdentifier(formData.panCardNumber || formData.pan || existingData?.panCardNumber || existingData?.pan).toUpperCase();
  const aadhaarCardNumber = safeStringIdentifier(formData.aadhaarCardNumber || existingData?.aadhaarCardNumber);
  const houseAddress = String(formData.houseAddress || existingData?.houseAddress || '').trim();
  const uan = safeStringIdentifier(formData.uan || existingData?.uan);
  const pfNo = safeStringIdentifier(formData.pfNo || existingData?.pfNo);
  const esicNo = safeStringIdentifier(formData.esicNo || existingData?.esicNo);

  const status = formData.status || existingData?.status || 'active';
  const active = status === 'active';

  const now = new Date().toISOString();
  const createdAt = existingData?.createdAt || formData.createdAt || now;

  const payload: NormalizedEmployeePayload = {
    email: cleanEmail,
    name: cleanName,
    phone: cleanPhone,
    mobile: cleanPhone,
    department: formData.department || existingData?.department || 'Solar Design & Engineering',
    designation: formData.designation || existingData?.designation || 'Associate',
    role: formData.role || existingData?.role || 'employee',
    employeeId: cleanEmpId,
    empId: cleanEmpId,
    dateOfJoining,
    doj: dateOfJoining,
    dateOfBirth,
    dob: dateOfBirth,
    bankName,
    bank: bankName,
    accountNumber,
    accNo: accountNumber,
    ifscCode,
    ifsc: ifscCode,
    panCardNumber,
    pan: panCardNumber,
    aadhaarCardNumber,
    houseAddress,
    personalEmail,
    personalEmailAddress: personalEmail,
    uan,
    pfNo,
    esicNo,
    basic: basicSalary,
    basicPay: basicSalary,
    status,
    active,
    createdAt,
    updatedAt: now
  };

  if (formData.authUid || existingData?.authUid || formData.uid || existingData?.uid) {
    const canonicalUid = formData.authUid || existingData?.authUid || formData.uid || existingData?.uid;
    payload.authUid = canonicalUid;
    payload.uid = canonicalUid;
  }

  return payload;
}

/**
 * Resolves or discovers the canonical Auth UID for a given email address.
 * Searches `/users` by email. If none exists, generates a canonical Firestore UID reference.
 */
export async function resolveCanonicalAuthUid(
  dbInstance: Firestore,
  email: string,
  hintUid?: string
): Promise<string> {
  if (hintUid && hintUid.trim()) {
    return hintUid.trim();
  }

  const cleanEmail = email.trim().toLowerCase();
  if (cleanEmail && dbInstance) {
    try {
      const q = query(collection(dbInstance, COLLECTIONS.USERS), where('email', '==', cleanEmail));
      const snap = await getDocs(q);
      for (const docSnap of snap.docs) {
        const data = docSnap.data();
        if (data.uid) return data.uid;
        if (docSnap.id && !docSnap.id.includes('@') && !docSnap.id.includes('_')) {
          return docSnap.id;
        }
      }
    } catch (err) {
      console.warn('[userService] Failed to query existing user by email:', err);
    }
  }

  // Generate canonical document UID directly via Firestore
  return doc(collection(dbInstance, COLLECTIONS.USERS)).id;
}

/**
 * Provisions or synchronizes employee data to both /employees/{empId} and /users/{uid} (Audit DAT-01)
 *
 * Directives:
 * 1. Stops generating /users documents using sanitized email slugs.
 * 2. Writes directly to /users/{uid} using the canonical Auth UID.
 * 3. In /employees, maintains the canonical Employee ID (e.g. SDM-JS-001) as document ID while storing authUid.
 * 4. Merges idempotently with fully sanitized payload.
 */
export async function provisionUserAndEmployee(
  dbInstance: Firestore,
  formData: any,
  options?: {
    existingEmployee?: any;
    authUid?: string;
  }
): Promise<{
  uid: string;
  empId: string;
  payload: NormalizedEmployeePayload;
}> {
  const normalized = buildNormalizedEmployeePayload(formData, options?.existingEmployee);
  
  // Resolve canonical Auth UID
  const canonicalUid = await resolveCanonicalAuthUid(
    dbInstance,
    normalized.email,
    options?.authUid || normalized.authUid || normalized.uid
  );

  normalized.authUid = canonicalUid;
  normalized.uid = canonicalUid;

  const sanitizedPayload = sanitizeFirestorePayload(normalized);

  // 1. Write to /employees/{empId} using the canonical Employee ID as document ID
  const empDocId = normalized.empId || options?.existingEmployee?.id || `emp_${Date.now()}`;
  try {
    await setDoc(
      doc(dbInstance, COLLECTIONS.EMPLOYEES, empDocId),
      {
        ...sanitizedPayload,
        id: empDocId
      },
      { merge: true }
    );
  } catch (empErr) {
    console.warn('[userService] /employees setDoc warning:', empErr);
  }

  // 2. Write to /users/{uid} using the canonical Auth UID (Audit DAT-01)
  try {
    await setDoc(
      doc(dbInstance, COLLECTIONS.USERS, canonicalUid),
      {
        ...sanitizedPayload,
        id: canonicalUid,
        uid: canonicalUid
      },
      { merge: true }
    );
  } catch (userErr) {
    console.warn('[userService] /users setDoc warning:', userErr);
  }

  return {
    uid: canonicalUid,
    empId: empDocId,
    payload: sanitizedPayload
  };
}

/**
 * Safely deletes an employee and their corresponding user record.
 */
export async function deleteUserAndEmployeeRecord(
  dbInstance: Firestore,
  employeeId: string,
  linkedUid?: string,
  email?: string
): Promise<void> {
  if (!dbInstance) return;

  // 1. Delete from /employees
  if (employeeId) {
    try {
      await deleteDoc(doc(dbInstance, COLLECTIONS.EMPLOYEES, employeeId));
    } catch (err) {
      console.warn('[userService] Failed deleting employee doc:', err);
    }
  }

  // 2. Resolve UID and delete from /users
  let targetUid = linkedUid;
  if (!targetUid && email) {
    try {
      const q = query(collection(dbInstance, COLLECTIONS.USERS), where('email', '==', email.trim().toLowerCase()));
      const snap = await getDocs(q);
      if (!snap.empty) {
        targetUid = snap.docs[0].id;
      }
    } catch (err) {
      console.warn('[userService] Failed resolving user by email for deletion:', err);
    }
  }

  if (targetUid) {
    try {
      await deleteDoc(doc(dbInstance, COLLECTIONS.USERS, targetUid));
    } catch (err) {
      console.warn('[userService] Failed deleting user doc:', err);
    }
  }
}
