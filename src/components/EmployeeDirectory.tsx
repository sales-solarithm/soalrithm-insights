'use client';

import React, { useState, useMemo, useRef } from 'react';
import {
  Users,
  Plus,
  Search,
  Filter,
  Download,
  Upload,
  FileSpreadsheet,
  Edit,
  Trash2,
  Building2,
  CreditCard,
  Banknote,
  FileText,
  CheckCircle2,
  X,
  AlertCircle,
  Briefcase,
  ShieldCheck,
  UserCheck,
  KeyRound
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { doc, deleteDoc, setDoc } from 'firebase/firestore';
import { db } from '@/src/lib/firebase';
import { COLLECTIONS } from '@/src/config/schema';
import { submitPasswordResetRequest, logAuditEvent } from '@/src/lib/masterHub';
import { formatIndianName, getFirstName, isZeroOrPositive, formatCurrency } from '@/src/lib/projectUtils';
import {
  provisionUserAndEmployee,
  deleteUserAndEmployeeRecord,
  sanitizeFirestorePayload
} from '@/src/lib/userService';

export interface AdminEmployee {
  id: string;
  empId: string;
  employeeId?: string;
  name: string;
  email: string;
  mobile?: string;
  phone?: string;
  department: string;
  designation: string;
  role?: string;
  dateOfJoining?: string;
  doj?: string;
  dateOfBirth?: string;
  dob?: string;
  basic?: number;
  basicPay?: number;
  bankName?: string;
  bank?: string;
  accountNumber?: string;
  accNo?: string;
  ifscCode?: string;
  ifsc?: string;
  pan?: string;
  panCardNumber?: string;
  aadhaarCardNumber?: string;
  houseAddress?: string;
  personalEmailAddress?: string;
  uan?: string;
  pfNo?: string;
  esicNo?: string;
  status?: 'active' | 'inactive' | 'on_leave';
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: any;
}

interface EmployeeDirectoryProps {
  users: any[];
  setUsers: React.Dispatch<React.SetStateAction<any[]>>;
  clients?: any[];
  projects?: any[];
  onNavigateToSalaryStudio?: (employeeId?: string) => void;
}

const DEPARTMENT_PRESETS = [
  'Solar Design & Engineering',
  'Sales & Business Development',
  'Site & Operations',
  'Accounts & Finance',
  'Management & Executive',
  'Human Resources & Admin'
];

function safeIdString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toLocaleString('fullwide', { useGrouping: false, maximumFractionDigits: 0 }) : '';
  }
  return String(value).trim();
}

const BANK_PRESETS = [
  'HDFC Bank',
  'State Bank of India',
  'ICICI Bank',
  'Axis Bank',
  'Bank of Baroda',
  'Kotak Mahindra Bank',
  'Punjab National Bank',
  'IndusInd Bank',
  'Canara Bank',
  'Union Bank of India'
];

export default function EmployeeDirectory({
  users,
  setUsers,
  onNavigateToSalaryStudio
}: EmployeeDirectoryProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<AdminEmployee | null>(null);
  const [deleteConfirmationId, setDeleteConfirmationId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    empId: '',
    name: '',
    email: '',
    mobile: '',
    phone: '',
    department: 'Solar Design & Engineering',
    customDepartment: '',
    designation: '',
    role: 'employee',
    dateOfJoining: '',
    dateOfBirth: '',
    basic: 25000,
    bankName: 'HDFC Bank',
    customBankName: '',
    accountNumber: '',
    ifscCode: '',
    pan: '',
    panCardNumber: '',
    aadhaarCardNumber: '',
    houseAddress: '',
    personalEmailAddress: '',
    uan: '',
    pfNo: '',
    esicNo: '',
    status: 'active'
  });

  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  const handleRequestPasswordReset = async (emp: AdminEmployee) => {
    if (!emp.email) {
      showToast('Cannot request password reset: employee email is missing.', 'error');
      return;
    }
    try {
      showToast(`Submitting password reset approval for ${emp.name}...`, 'info');
      await submitPasswordResetRequest({
        requestedEmail: emp.email,
        email: emp.email,
        employeeId: emp.employeeId || emp.empId,
        name: emp.name,
        requestedBy: 'admin_portal'
      });
      showToast(`Password reset approval requested for ${emp.email}!`, 'success');
    } catch (err: any) {
      console.error('Password reset request error:', err);
      showToast(err.message || 'Failed to submit password reset request', 'error');
    }
  };

  const normalizedEmployees = useMemo<AdminEmployee[]>(() => {
    if (!Array.isArray(users)) return [];
    const seenIds = new Set<string>();

    return users.map((u, index) => {
      const fallbackId = `emp_${index + 1}`;
      let id = u.id || fallbackId;
      if (seenIds.has(id)) {
        id = `${id}-${index}`;
      }
      seenIds.add(id);

      const empId = u.employeeId || u.empId || `SOL-EMP-${String(index + 1).padStart(3, '0')}`;
      const name = formatIndianName(u.fullName || u.name || u.displayName || u.employeeName || 'Unnamed Employee');
      const department = u.department || u.role || 'Solar Design & Engineering';
      const designation = u.designation || u.role || 'Associate';
      const role = u.role || 'employee';
      const rawBasic = u.basic ?? u.basicPay ?? u.baseSalary;
      const basic = isZeroOrPositive(rawBasic) ? Number(rawBasic) : 0;
      const bankName = u.bankName || u.bank || '';
      const accountNumber = safeIdString(u.accountNumber || u.accNo || u.bankAccountNo || '');
      const ifscCode = u.ifscCode || u.ifsc || '';
      const dateOfJoining = u.dateOfJoining || u.doj || u.createdAt || '';
      const dateOfBirth = u.dateOfBirth || u.dob || '';
      const pan = u.panCardNumber || u.pan || '';
      const panCardNumber = pan;
      const aadhaarCardNumber = safeIdString(u.aadhaarCardNumber || '');
      const houseAddress = u.houseAddress || '';
      const personalEmailAddress = u.personalEmailAddress || '';

      return {
        ...u,
        id,
        empId,
        employeeId: empId,
        name,
        email: u.email || '',
        mobile: u.phone || u.mobile || '',
        phone: u.phone || u.mobile || '',
        department,
        designation,
        role,
        basic,
        basicPay: basic,
        bankName,
        accountNumber,
        ifscCode,
        dateOfJoining,
        dateOfBirth,
        pan,
        panCardNumber,
        aadhaarCardNumber,
        houseAddress,
        personalEmailAddress,
        uan: u.uan || '',
        pfNo: u.pfNo || '',
        esicNo: u.esicNo || '',
        status: u.status || (u.active !== false ? 'active' : 'inactive'),
        active: (u.status || (u.active !== false ? 'active' : 'inactive')) === 'active'
      };
    });
  }, [users]);

  const filteredEmployees = useMemo(() => {
    return normalizedEmployees.filter((emp) => {
      if (departmentFilter !== 'all') {
        const empDept = (emp.department || '').toLowerCase();
        if (!empDept.includes(departmentFilter.toLowerCase())) {
          return false;
        }
      }

      if (statusFilter !== 'all') {
        const isActive = emp.status === 'active' || emp.active !== false;
        if (statusFilter === 'active' && !isActive) return false;
        if (statusFilter === 'inactive' && isActive) return false;
      }

      if (searchTerm) {
        const q = searchTerm.toLowerCase().trim();
        const matchesName = emp.name.toLowerCase().includes(q);
        const matchesId = emp.empId.toLowerCase().includes(q);
        const matchesDesignation = emp.designation.toLowerCase().includes(q);
        const matchesDept = emp.department.toLowerCase().includes(q);
        const matchesEmail = emp.email.toLowerCase().includes(q);
        const matchesBank = (emp.bankName || '').toLowerCase().includes(q);
        return matchesName || matchesId || matchesDesignation || matchesDept || matchesEmail || matchesBank;
      }

      return true;
    });
  }, [normalizedEmployees, searchTerm, departmentFilter, statusFilter]);

  const metrics = useMemo(() => {
    const total = normalizedEmployees.length;
    const activeCount = normalizedEmployees.filter(e => e.status === 'active' || e.active !== false).length;
    const totalBasicPayroll = normalizedEmployees.reduce(
      (sum, e) => sum + (isZeroOrPositive(e.basic) ? Number(e.basic) : 0),
      0
    );
    const withBanking = normalizedEmployees.filter(e => e.bankName && e.accountNumber && e.ifscCode).length;
    const depts = new Set(normalizedEmployees.map(e => e.department).filter(Boolean));

    return {
      total,
      activeCount,
      totalBasicPayroll,
      withBanking,
      departmentsCount: depts.size
    };
  }, [normalizedEmployees]);

  const handleOpenAddModal = () => {
    const nextSeq = String(normalizedEmployees.length + 1).padStart(3, '0');
    setEditingEmployee(null);
    setFormData({
      empId: `SOL-EMP-${nextSeq}`,
      name: '',
      email: '',
      mobile: '',
      phone: '',
      department: 'Solar Design & Engineering',
      customDepartment: '',
      designation: '',
      role: 'employee',
      dateOfJoining: new Date().toISOString().split('T')[0],
      dateOfBirth: '',
      basic: 25000,
      bankName: 'HDFC Bank',
      customBankName: '',
      accountNumber: '',
      ifscCode: '',
      pan: '',
      panCardNumber: '',
      aadhaarCardNumber: '',
      houseAddress: '',
      personalEmailAddress: '',
      uan: '',
      pfNo: '',
      esicNo: '',
      status: 'active'
    });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (emp: AdminEmployee) => {
    setEditingEmployee(emp);
    const isDeptPreset = DEPARTMENT_PRESETS.includes(emp.department);
    const isBankPreset = BANK_PRESETS.includes(emp.bankName || '');

    setFormData({
      empId: emp.employeeId || emp.empId || '',
      name: emp.name || '',
      email: emp.email || '',
      mobile: emp.phone || emp.mobile || '',
      phone: emp.phone || emp.mobile || '',
      department: isDeptPreset ? emp.department : 'custom',
      customDepartment: isDeptPreset ? '' : emp.department,
      designation: emp.designation || '',
      role: emp.role || 'employee',
      dateOfJoining: emp.dateOfJoining ? String(emp.dateOfJoining).split('T')[0] : '',
      dateOfBirth: emp.dateOfBirth ? String(emp.dateOfBirth).split('T')[0] : '',
      basic: isZeroOrPositive(emp.basic) ? Number(emp.basic) : 0,
      bankName: isBankPreset ? (emp.bankName || 'HDFC Bank') : 'custom',
      customBankName: isBankPreset ? '' : (emp.bankName || ''),
      accountNumber: safeIdString(emp.accountNumber || emp.accNo || ''),
      ifscCode: emp.ifscCode || emp.ifsc || '',
      pan: emp.panCardNumber || emp.pan || '',
      panCardNumber: emp.panCardNumber || emp.pan || '',
      aadhaarCardNumber: safeIdString(emp.aadhaarCardNumber || ''),
      houseAddress: emp.houseAddress || '',
      personalEmailAddress: emp.personalEmailAddress || '',
      uan: emp.uan || '',
      pfNo: emp.pfNo || '',
      esicNo: emp.esicNo || '',
      status: emp.status || 'active'
    });
    setIsModalOpen(true);
  };

  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      showToast('Employee name is required', 'error');
      return;
    }
    if (!formData.empId.trim()) {
      showToast('Employee ID is required', 'error');
      return;
    }

    setIsSaving(true);

    const finalDepartment = formData.department === 'custom'
      ? (formData.customDepartment.trim() || 'Operations')
      : formData.department;

    const finalBankName = formData.bankName === 'custom'
      ? (formData.customBankName.trim() || 'Bank')
      : formData.bankName;

    try {
      // Provision via canonical Auth UID and sanitized payload (Audit DAT-01 / ING-01)
      const { uid: canonicalUid, empId: canonicalEmpId, payload: savedPayload } = await provisionUserAndEmployee(
        db,
        {
          ...formData,
          department: finalDepartment,
          bankName: finalBankName,
          customDepartment: undefined,
          customBankName: undefined
        },
        {
          existingEmployee: editingEmployee,
          authUid: editingEmployee?.authUid || editingEmployee?.uid
        }
      );

      const recordForState: AdminEmployee = {
        ...savedPayload,
        id: canonicalEmpId,
        uid: canonicalUid,
        authUid: canonicalUid,
        empId: canonicalEmpId,
        employeeId: canonicalEmpId
      } as unknown as AdminEmployee;

      await logAuditEvent({
        action: editingEmployee && editingEmployee.id ? 'EMPLOYEE_UPDATED' : 'EMPLOYEE_CREATED',
        target: savedPayload.email || canonicalEmpId,
        details: { id: canonicalEmpId, uid: canonicalUid, name: savedPayload.name, department: finalDepartment }
      });

      if (editingEmployee && editingEmployee.id) {
        setUsers((prev) =>
          prev.map((u) => (u.id === editingEmployee.id || u.empId === canonicalEmpId ? { ...u, ...recordForState } : u))
        );
        showToast(`Employee "${savedPayload.name}" updated successfully!`, 'success');
      } else {
        setUsers((prev) => [recordForState, ...prev]);
        showToast(`Employee "${savedPayload.name}" created successfully!`, 'success');
      }

      setIsModalOpen(false);
      setEditingEmployee(null);
    } catch (err: any) {
      console.error('Error saving employee:', err);
      showToast(err.message || 'Failed to save employee record', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteEmployee = async (id: string) => {
    try {
      const targetEmp = users.find((u) => u.id === id);
      await deleteUserAndEmployeeRecord(
        db,
        id,
        targetEmp?.authUid || targetEmp?.uid,
        targetEmp?.email
      );

      await logAuditEvent({
        action: 'EMPLOYEE_DELETED',
        target: targetEmp?.email || id,
        details: { id, name: targetEmp?.name }
      });

      setUsers((prev) => prev.filter((u) => u.id !== id));
      showToast('Employee deleted successfully', 'info');
      setDeleteConfirmationId(null);
    } catch (err: any) {
      console.error('Delete error:', err);
      showToast(err.message || 'Failed to delete employee', 'error');
    }
  };

  const handleDownloadTemplate = () => {
    const templateData = [
      {
        'Employee ID': 'SOL-EMP-001',
        'Name': 'Rahul Sharma',
        'Email': 'rahul.sharma@solarithm.com',
        'Designation': 'Senior Solar Design Engineer',
        'Department': 'Solar Design & Engineering',
        'Role': 'engineer',
        'Date of Joining': '2026-01-15',
        'Date of Birth': '1995-06-20',
        'Basic Pay': 45000,
        'Bank Name': 'HDFC Bank',
        'Account Number': '50100456789123',
        'IFSC': 'HDFC0001234',
        'PAN': 'ABCDE1234F',
        'Aadhaar': '123456789012',
        'Personal Email': 'rahul.personal@gmail.com',
        'Address': '123 Sunrise Enclave, Delhi'
      }
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'Employee_Import_Template.xlsx');
    showToast('Template downloaded: Employee_Import_Template.xlsx', 'success');
  };

  const handleExportExcel = () => {
    if (filteredEmployees.length === 0) {
      showToast('No employee records to export', 'info');
      return;
    }

    const exportRows = filteredEmployees.map((e) => ({
      'Employee ID': e.empId,
      'Full Name': e.name,
      'Designation': e.designation,
      'Department': e.department,
      'Date of Joining': e.dateOfJoining || '—',
      'Basic Pay (₹)': isZeroOrPositive(e.basic) ? Number(e.basic) : 0,
      'Bank Name': e.bankName || '—',
      'Account Number': safeIdString(e.accountNumber) || '—',
      'IFSC Code': e.ifscCode || '—',
      'Email': e.email || '—',
      'Status': e.status || 'Active'
    }));

    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Employees Master');
    XLSX.writeFile(wb, `Solarithm_Employees_${new Date().toISOString().split('T')[0]}.xlsx`);
    showToast('Employee directory exported to Excel!', 'success');
  };

  return (
    <div className="w-full space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-2xl flex items-center space-x-3 text-sm font-medium border transition-all ${
            toastMessage.type === 'success'
              ? 'bg-white dark:bg-[#1E1E1E] text-emerald-600 dark:text-emerald-400 border-emerald-500/40'
              : toastMessage.type === 'error'
              ? 'bg-white dark:bg-[#2D1515] text-rose-600 dark:text-rose-400 border-rose-500/40'
              : 'bg-white dark:bg-[#1E1E1E] text-[#D4AF37] border-[#D4AF37]/40'
          }`}
        >
          {toastMessage.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />}
          {toastMessage.type === 'error' && <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />}
          {toastMessage.type === 'info' && <ShieldCheck className="w-5 h-5 text-[#D4AF37] shrink-0" />}
          <span className="text-gray-900 dark:text-white">{toastMessage.text}</span>
          <button onClick={() => setToastMessage(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/30">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white tracking-wide">Employee Administration</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Centralized HR records, administrative details, compensation, and banking configurations.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            id="excel-employee-import-input"
          />

          <button
            onClick={handleDownloadTemplate}
            className="px-3.5 py-2 rounded-lg bg-white dark:bg-[#1E1E1E] hover:bg-gray-100 dark:hover:bg-[#2A2A2A] text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-[#333333] text-xs font-semibold flex items-center space-x-1.5 transition-colors shadow-sm"
          >
            <FileSpreadsheet className="w-4 h-4 text-[#D4AF37]" />
            <span>Download Template</span>
          </button>

          <button
            onClick={handleExportExcel}
            className="px-3.5 py-2 rounded-lg bg-white dark:bg-[#1E1E1E] hover:bg-gray-100 dark:hover:bg-[#2A2A2A] text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-[#333333] text-xs font-semibold flex items-center space-x-1.5 transition-colors shadow-sm"
          >
            <Download className="w-4 h-4 text-emerald-500" />
            <span>Export Excel</span>
          </button>

          <button
            onClick={handleOpenAddModal}
            className="px-4 py-2 rounded-lg bg-[#D4AF37] hover:bg-[#e5be42] text-black text-xs font-bold flex items-center space-x-1.5 transition-all shadow-md shadow-[#D4AF37]/20"
          >
            <Plus className="w-4 h-4" />
            <span>Add Employee</span>
          </button>
        </div>
      </div>

      {/* KPI Stats Overview Cards (UIX-01 Light/Dark contrast compliance) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-xl p-5 shadow-sm transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Total Workforce</span>
            <div className="p-2 rounded-lg bg-gray-100 dark:bg-[#121212] text-[#D4AF37]">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <div className="text-2xl font-bold text-gray-900 dark:text-white font-mono">{metrics.total}</div>
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 flex items-center justify-between border-t border-gray-100 dark:border-[#2A2A2A] pt-2">
              <span>Active Status:</span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">{metrics.activeCount} Active</span>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-xl p-5 shadow-sm transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Monthly Basic Payroll</span>
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Banknote className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 font-mono">
              {formatCurrency(metrics.totalBasicPayroll)}
            </div>
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 flex items-center justify-between border-t border-gray-100 dark:border-[#2A2A2A] pt-2">
              <span>Average Basic:</span>
              <span className="font-mono text-gray-700 dark:text-gray-300">
                {formatCurrency(metrics.total > 0 ? metrics.totalBasicPayroll / metrics.total : 0)}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-xl p-5 shadow-sm transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Banking Setup</span>
            <div className="p-2 rounded-lg bg-gray-100 dark:bg-[#121212] text-[#D4AF37]">
              <CreditCard className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <div className="text-2xl font-bold text-gray-900 dark:text-white font-mono">
              {metrics.withBanking} / {metrics.total}
            </div>
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 flex items-center justify-between border-t border-gray-100 dark:border-[#2A2A2A] pt-2">
              <span>Direct Deposit Ready:</span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                {metrics.total > 0 ? `${Math.round((metrics.withBanking / metrics.total) * 100)}%` : '0%'}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-xl p-5 shadow-sm transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Departments</span>
            <div className="p-2 rounded-lg bg-gray-100 dark:bg-[#121212] text-[#D4AF37]">
              <Building2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <div className="text-2xl font-bold text-gray-900 dark:text-white font-mono">{metrics.departmentsCount}</div>
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 flex items-center justify-between border-t border-gray-100 dark:border-[#2A2A2A] pt-2">
              <span>Operational Units:</span>
              <span className="text-gray-700 dark:text-gray-300">Design, Sales, Ops</span>
            </div>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 shadow-sm transition-colors">
        <div className="flex items-center space-x-3 flex-1 min-w-[260px]">
          <Search className="w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by Employee ID, Name, Designation, Department..."
            className="bg-transparent border-none text-xs text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none w-full"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center space-x-1.5 bg-gray-50 dark:bg-[#121212] border border-gray-300 dark:border-[#333333] rounded-lg px-2.5 py-1.5 text-xs">
            <Filter className="w-3.5 h-3.5 text-[#D4AF37]" />
            <select
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              className="bg-transparent text-gray-800 dark:text-gray-200 focus:outline-none cursor-pointer pr-1 text-xs"
            >
              <option value="all" className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white">All Departments</option>
              {DEPARTMENT_PRESETS.map((dept) => (
                <option key={dept} value={dept} className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white">
                  {dept}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-white dark:bg-[#1E1E1E] rounded-xl shadow-sm p-5 overflow-x-auto whitespace-nowrap border border-gray-200 dark:border-[#333333] transition-colors">
        <table className="w-full text-left text-xs whitespace-nowrap">
          <thead>
            <tr className="text-gray-500 dark:text-gray-400 uppercase text-[11px] border-b border-gray-200 dark:border-[#333333]">
              <th className="pb-3 px-3.5 font-semibold">Employee ID</th>
              <th className="pb-3 px-3.5 font-semibold">Name</th>
              <th className="pb-3 px-3.5 font-semibold">Email</th>
              <th className="pb-3 px-3.5 font-semibold">Designation</th>
              <th className="pb-3 px-3.5 font-semibold">Department</th>
              <th className="pb-3 px-3.5 font-semibold text-right">Basic Pay</th>
              <th className="pb-3 px-3.5 font-semibold">Bank Name</th>
              <th className="pb-3 px-3.5 font-semibold">Account Number</th>
              <th className="pb-3 px-3.5 font-semibold">Status</th>
              <th className="pb-3 px-3.5 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-[#2A2A2A]">
            {filteredEmployees.map((emp, index) => (
              <tr key={emp.id ? `${emp.id}-${index}` : `employee-${index}`} className="hover:bg-gray-50 dark:hover:bg-[#252525] transition-colors">
                <td className="py-3.5 px-3.5 font-mono text-xs font-bold text-[#D4AF37]">
                  {emp.empId}
                </td>
                <td className="py-3.5 px-3.5 font-semibold text-gray-900 dark:text-white">
                  {emp.name}
                </td>
                <td className="py-3.5 px-3.5 text-gray-600 dark:text-gray-300 font-mono">
                  {emp.email || '—'}
                </td>
                <td className="py-3.5 px-3.5 font-medium text-gray-800 dark:text-gray-200">
                  {emp.designation || 'Associate'}
                </td>
                <td className="py-3.5 px-3.5">
                  <span className="inline-block px-2 py-0.5 rounded bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/30 text-[10px] font-semibold">
                    {emp.department || '—'}
                  </span>
                </td>
                <td className="py-3.5 px-3.5 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(isZeroOrPositive(emp.basic) ? Number(emp.basic) : 0)}
                </td>
                <td className="py-3.5 px-3.5 text-gray-700 dark:text-gray-200">
                  {emp.bankName || '—'}
                </td>
                <td className="py-3.5 px-3.5 font-mono text-gray-600 dark:text-gray-300">
                  {safeIdString(emp.accountNumber) || '—'}
                </td>
                <td className="py-3.5 px-3.5">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20">
                    Active
                  </span>
                </td>
                <td className="py-3.5 px-3.5 text-right">
                  <div className="inline-flex items-center space-x-1.5">
                    {onNavigateToSalaryStudio && (
                      <button
                        onClick={() => onNavigateToSalaryStudio(emp.id)}
                        className="px-2 py-1 rounded bg-gray-100 dark:bg-[#2A2A2A] hover:bg-gray-200 dark:hover:bg-[#333333] text-[#D4AF37] text-[11px] font-semibold"
                        title="Generate Salary Slip"
                      >
                        Salary Slip
                      </button>
                    )}
                    <button
                      onClick={() => handleRequestPasswordReset(emp)}
                      className="p-1 rounded bg-gray-100 dark:bg-[#2A2A2A] text-amber-500"
                      title="Reset Password Approval"
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleOpenEditModal(emp)}
                      className="p-1 rounded bg-gray-100 dark:bg-[#2A2A2A] text-[#D4AF37]"
                      title="Edit"
                    >
                      <Edit className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleteConfirmationId(emp.id)}
                      className="p-1 rounded bg-gray-100 dark:bg-[#2A2A2A] text-rose-500"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirmationId && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-gray-900 dark:text-white">Confirm Delete</h3>
            <p className="text-xs text-gray-600 dark:text-gray-300">
              Are you sure you want to delete this employee record?
            </p>
            <div className="flex justify-end space-x-2 pt-2">
              <button
                onClick={() => setDeleteConfirmationId(null)}
                className="px-3.5 py-1.5 rounded-lg text-gray-600 dark:text-gray-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteEmployee(deleteConfirmationId)}
                className="px-3.5 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit/Add Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-gray-200 dark:border-[#333333] pb-3">
              <h3 className="text-base font-bold text-gray-900 dark:text-white">
                {editingEmployee ? `Edit ${editingEmployee.name}` : 'Add Employee'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEmployee} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-gray-700 dark:text-gray-300 font-semibold mb-1">Name *</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-gray-50 dark:bg-[#121212] border border-gray-300 dark:border-[#333333] rounded-lg px-3 py-2 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-gray-700 dark:text-gray-300 font-semibold mb-1">Employee ID *</label>
                  <input
                    type="text"
                    required
                    value={formData.empId}
                    onChange={(e) => setFormData({ ...formData, empId: e.target.value })}
                    className="w-full bg-gray-50 dark:bg-[#121212] border border-gray-300 dark:border-[#333333] rounded-lg px-3 py-2 text-gray-900 dark:text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-gray-700 dark:text-gray-300 font-semibold mb-1">Email</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full bg-gray-50 dark:bg-[#121212] border border-gray-300 dark:border-[#333333] rounded-lg px-3 py-2 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-gray-700 dark:text-gray-300 font-semibold mb-1">Basic Pay (₹)</label>
                  <input
                    type="number"
                    value={formData.basic}
                    onChange={(e) => setFormData({ ...formData, basic: e.target.value === '' ? 0 : (isZeroOrPositive(e.target.value) ? Number(e.target.value) : 0) })}
                    className="w-full bg-gray-50 dark:bg-[#121212] border border-gray-300 dark:border-[#333333] rounded-lg px-3 py-2 text-gray-900 dark:text-white font-mono"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-[#333333]">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#2A2A2A]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2 rounded-lg bg-[#D4AF37] hover:bg-[#e5be42] text-black font-bold shadow-sm"
                >
                  {isSaving ? 'Saving...' : 'Save Employee'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
