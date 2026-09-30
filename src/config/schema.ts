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
  PASSWORD_RESET_REQUEST: 'PASSWORD_RESET_REQUEST'
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
export const PROJECT_FIELDS = { PROJECT_NUMBER: 'projectNumber', PROJECT_NAME: 'projectName', CLIENT_ID: 'clientId', CLIENT_NAME: 'clientName', SCOPE_OF_WORK: 'scopeOfWork', SUB_SERVICE: 'subService', PLANT_CAPACITY: 'plantCapacity', CAPACITY_UNIT: 'capacityUnit', LOCATION: 'location', DESIGNER_EMAIL: 'designerEmail', PRICING_CATEGORY: 'pricingCategory', STATUS: 'status', CREATED_AT: 'createdAt', UPDATED_AT: 'updatedAt', UPGRADE_HISTORY: 'upgradeHistory' } as const;

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
