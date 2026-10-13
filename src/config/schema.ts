export const COLLECTIONS = {
  USERS: 'users',
  EMPLOYEES: 'employees',
  APPROVALS: 'approvals',
  AUDIT_LOGS: 'auditLogs',
  APPS: 'registeredApps',
  APP_REGISTRY: 'registeredApps',
  REGISTERED_APPS: 'registeredApps',
  CLIENTS: 'clients',
  PROJECTS: 'projects',
  SCOPES: 'scopes',
  PRICING_RULES: 'pricingRules',
  PROPOSALS: 'proposals',
  CHANGE_REQUESTS: 'changeRequests',
  PRICING_CATEGORIES: 'pricingCategories',
  INVOICES: 'invoices',
  INCOMES: 'incomes'
} as const;

export const APPROVAL_TYPES = {
  PASSWORD_RESET_REQUEST: 'PASSWORD_RESET_REQUEST',
  PASSWORD_RESET: 'PASSWORD_RESET_REQUEST'
} as const;

export const APPROVAL_STATUS = {
  PENDING: 'pending',
  APPROVED: 'APPROVED',
  REJECTED: 'rejected'
} as const;

export const EMPLOYEE_FIELDS = {
  EMAIL: 'email',
  NAME: 'name',
  PHONE: 'phone',
  DEPARTMENT: 'department',
  DESIGNATION: 'designation',
  ROLE: 'role',
  EMPLOYEE_ID: 'employeeId',
  DATE_OF_JOINING: 'dateOfJoining',
  DATE_OF_BIRTH: 'dateOfBirth',
  BANK_NAME: 'bankName',
  ACCOUNT_NUMBER: 'accountNumber',
  IFSC_CODE: 'ifscCode',
  PAN_CARD_NUMBER: 'panCardNumber',
  AADHAAR_CARD_NUMBER: 'aadhaarCardNumber',
  HOUSE_ADDRESS: 'houseAddress',
  PERSONAL_EMAIL_ADDRESS: 'personalEmailAddress',
  CREATED_AT: 'createdAt',
  UPDATED_AT: 'updatedAt'
} as const;

export const REGISTERED_APP_FIELDS = {
  NAME: 'name',
  URL: 'url',
  DESCRIPTION: 'description',
  ICON: 'icon',
  CATEGORY: 'category',
  ACTIVE: 'active',
  ALLOWED_ROLES: 'allowedRoles',
  CREATED_AT: 'createdAt'
} as const;
export const CLIENT_STATUS = { PENDING: 'pending_approval', APPROVED: 'approved', REJECTED: 'rejected' } as const;
export const PROJECT_STATUS = { NOT_STARTED: 'not_started', IN_PROGRESS: 'in_progress', REQUIRED_DATA_PENDING: 'required_data_pending', IN_REVISION: 'in_revision', IN_VERIFICATION: 'in_verification', DELAYED: 'delayed', COMPLETED: 'completed' } as const;
export const CLIENT_FIELDS = { COMPANY_NAME: 'companyName', CONTACT_PERSON: 'contactPerson', EMAIL: 'email', PHONE: 'phone', CITY: 'city', GSTIN: 'gstin', PRICING_CATEGORY: 'pricingCategory', SALES_PERSON_EMAIL: 'salesPersonEmail', PROPOSAL_NUMBER: 'proposalNumber', STATUS: 'status', CREATED_AT: 'createdAt' } as const;
export const PROJECT_FIELDS = {
  PROJECT_NUMBER: 'projectNumber',
  SR_NUMBER: 'srNumber',
  PROJECT_NAME: 'projectName',
  CLIENT_ID: 'clientId',
  CLIENT_NAME: 'clientName',
  SCOPE_OF_WORK: 'scopeOfWork',
  SUB_SERVICE: 'subService',
  PLANT_CAPACITY: 'plantCapacity',
  CAPACITY_UNIT: 'capacityUnit',
  LOCATION: 'location',
  DESIGNER_EMAIL: 'designerEmail',
  DESIGNER_NAME: 'designerName',
  SALES_PERSON_EMAIL: 'salesPersonEmail',
  SALES_PERSON: 'salesPerson',
  SALES_PERSON_NAME: 'salesPersonName',
  PRICING_CATEGORY: 'pricingCategory',
  STATUS: 'status',
  DATE: 'date',
  PROJECT_DATE: 'projectDate',
  CREATED_AT: 'createdAt',
  UPDATED_AT: 'updatedAt',
  UPGRADE_HISTORY: 'upgradeHistory',
  ASSIGNED_SCOPES: 'assignedScopes',
  MODULES: 'modules',
  PAYMENT_STATUS: 'paymentStatus'
} as const;

export interface CanonicalModulePhase {
  phaseKey: string;
  phaseName: string;
  status: 'not_started' | 'in_progress' | 'in_revision' | 'completed';
  assignedDesignerEmail: string;
  assignedDesignerName?: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface CanonicalProjectDocument {
  id?: string;
  projectNumber: string;
  srNumber: string;
  projectName: string;
  clientId: string;
  clientName: string;
  projectDate: string;
  date: string;
  createdAt: any;
  updatedAt?: any;
  scopeOfWork: string;
  subService?: string;
  plantCapacity: number | null;
  capacityUnit: 'KW' | 'MW';
  location: string;
  assignedScopes?: Record<string, string | undefined>;
  modules?: CanonicalModulePhase[];
  status: 'not_started' | 'in_progress' | 'in_revision' | 'completed';
  designerEmail?: string;
  designerName?: string;
  salesPersonEmail?: string;
  salesPerson?: string;
  salesPersonName?: string;
  pricingCategory?: 'T1' | 'T2' | 'T3' | 'T4';
  rate?: number | null;
  projectValue?: number | null;
  projectCost?: number | null;
  paymentStatus?: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
  upgradeHistory?: ProjectUpgradeRecord[];
}

/**
 * A single recorded modification to an already-created project (a scope or
 * capacity change requested after the project's original entry). This is
 * deliberately separate from the project's own `createdAt`/`date` fields --
 * those are never touched by an upgrade event; `upgradeDate` is the only
 * place "when this change happened" is recorded.
 *
 * `invoicedInPeriod` and `incentivePaidInSlip` start out null and are meant
 * to be filled in later, once billing/payroll logic actually consumes this
 * record -- they exist now so that future logic has an idempotency key to
 * check against (has this specific upgrade's delta already been billed or
 * paid?) rather than needing to infer it from invoice/slip contents.
 */
export interface ProjectUpgradeRecord {
  upgradeId: string;
  upgradeDate: string; // ISO date string -- when the modification occurred
  previousScope: string;
  newScope: string;
  previousCapacity: string | number;
  newCapacity: string | number;
  // Positive = cost increase, negative = cost decrease, 0 = no cost impact.
  costDifferential: number;
  reason?: string;
  // Period key (e.g. "2026-09") or invoice ID once the delta has been
  // billed to the client. Null until that happens.
  invoicedInPeriod?: string | null;
  // Salary slip number once the incentive delta has been paid to the
  // assigned designer(s). Null until that happens.
  incentivePaidInSlip?: string | null;
}

export interface PricingCategoryHistoryPeriod {
  tier: string;
  effectiveFrom: string; // ISO date YYYY-MM-DD or ISO string
  effectiveTo?: string | null; // ISO date YYYY-MM-DD or null for open-ended
}

export interface ClientSubscriptionPlan {
  planId?: string;
  planName?: string;
  scopeCovered: string; // e.g. 'Pre-Design', 'Detailed Engineering'
  totalAllowedProjects: number; // e.g. 10
  upfrontPrice: number; // Retainer invoice amount, e.g. 50000
  durationMonths?: number; // e.g. 3, 6, 12
  startDate: string; // ISO date YYYY-MM-DD
  endDate: string; // ISO date YYYY-MM-DD
  active?: boolean;
}
