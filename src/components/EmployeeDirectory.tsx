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
  Calendar,
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
  Phone,
  Mail,
  Hash,
  KeyRound
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { collection, doc, addDoc, updateDoc, deleteDoc, setDoc } from 'firebase/firestore';
import { db } from '@/src/lib/firebase';
import { COLLECTIONS, EMPLOYEE_FIELDS, APPROVAL_TYPES } from '@/src/config/schema';
import { submitPasswordResetRequest, logAuditEvent } from '@/src/lib/masterHub';

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
  clients = [],
  projects = [],
  onNavigateToSalaryStudio
}: EmployeeDirectoryProps) {
  // Search and Filter States
  const [searchTerm, setSearchTerm] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Modal States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<AdminEmployee | null>(null);
  const [deleteConfirmationId, setDeleteConfirmationId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  // File input ref for Excel import
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form State
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

  // Handle Dispatching Password Reset Request to Central Hub Approvals
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

  // Normalized list of employees
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

      const empId = u.employeeId || u.empId || `SOL-${(u.name || 'EMP').substring(0, 3).toUpperCase()}-${String(index + 1).padStart(3, '0')}`;
      const name = u.name || u.displayName || u.employeeName || u.email?.split('@')[0] || 'Team Member';
      const department = u.department || u.role || 'Solar Design & Engineering';
      const designation = u.designation || u.role || 'Associate';
      const role = u.role || 'employee';
      const basic = Number(u.basic || u.basicPay || u.baseSalary || 25000);
      const bankName = u.bankName || u.bank || '';
      const accountNumber = u.accountNumber || u.accNo || u.bankAccountNo || '';
      const ifscCode = u.ifscCode || u.ifsc || '';
      const dateOfJoining = u.dateOfJoining || u.doj || u.createdAt || '';
      const dateOfBirth = u.dateOfBirth || u.dob || '';
      const pan = u.panCardNumber || u.pan || '';
      const panCardNumber = pan;
      const aadhaarCardNumber = u.aadhaarCardNumber || '';
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

  // Filtered Employees
  const filteredEmployees = useMemo(() => {
    return normalizedEmployees.filter((emp) => {
      // Department Filter
      if (departmentFilter !== 'all') {
        const empDept = (emp.department || '').toLowerCase();
        if (!empDept.includes(departmentFilter.toLowerCase())) {
          return false;
        }
      }

      // Status Filter
      if (statusFilter !== 'all') {
        const isActive = emp.status === 'active' || emp.active !== false;
        if (statusFilter === 'active' && !isActive) return false;
        if (statusFilter === 'inactive' && isActive) return false;
      }

      // Search Term
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

  // Executive Metrics
  const metrics = useMemo(() => {
    const total = normalizedEmployees.length;
    const activeCount = normalizedEmployees.filter(e => e.status === 'active' || e.active !== false).length;
    const totalBasicPayroll = normalizedEmployees.reduce((sum, e) => sum + (Number(e.basic) || 0), 0);
    const withBanking = normalizedEmployees.filter(e => e.bankName && e.accountNumber && e.ifscCode).length;
    
    // Unique departments
    const depts = new Set(normalizedEmployees.map(e => e.department).filter(Boolean));

    return {
      total,
      activeCount,
      totalBasicPayroll,
      withBanking,
      departmentsCount: depts.size
    };
  }, [normalizedEmployees]);

  // Open modal for Adding
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

  // Open modal for Editing
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
      basic: Number(emp.basic || emp.basicPay || 25000),
      bankName: isBankPreset ? (emp.bankName || 'HDFC Bank') : 'custom',
      customBankName: isBankPreset ? '' : (emp.bankName || ''),
      accountNumber: emp.accountNumber || emp.accNo || '',
      ifscCode: emp.ifscCode || emp.ifsc || '',
      pan: emp.panCardNumber || emp.pan || '',
      panCardNumber: emp.panCardNumber || emp.pan || '',
      aadhaarCardNumber: emp.aadhaarCardNumber || '',
      houseAddress: emp.houseAddress || '',
      personalEmailAddress: emp.personalEmailAddress || '',
      uan: emp.uan || '',
      pfNo: emp.pfNo || '',
      esicNo: emp.esicNo || '',
      status: emp.status || 'active'
    });
    setIsModalOpen(true);
  };

  // Submit Add / Edit Form
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

    const cleanEmail = formData.email.trim().toLowerCase();
    const cleanEmpId = formData.empId.trim().toUpperCase();
    const cleanName = formData.name.trim();
    const cleanPhone = (formData.phone || formData.mobile || '').trim();
    const cleanPan = (formData.panCardNumber || formData.pan || '').trim().toUpperCase();

    // Strict Master Blueprint Schema for employees / users
    const employeePayload = {
      email: cleanEmail,
      name: cleanName,
      phone: cleanPhone,
      department: finalDepartment,
      designation: formData.designation.trim() || 'Associate',
      role: formData.role || 'employee',
      employeeId: cleanEmpId,
      dateOfJoining: formData.dateOfJoining || '',
      dateOfBirth: formData.dateOfBirth || '',
      bankName: finalBankName,
      accountNumber: formData.accountNumber.trim(),
      ifscCode: formData.ifscCode.trim().toUpperCase(),
      panCardNumber: cleanPan,
      aadhaarCardNumber: formData.aadhaarCardNumber.trim(),
      houseAddress: formData.houseAddress.trim(),
      personalEmailAddress: formData.personalEmailAddress.trim().toLowerCase(),
      createdAt: editingEmployee?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      // Backward-compatible aliases for existing satellite apps / views
      empId: cleanEmpId,
      mobile: cleanPhone,
      doj: formData.dateOfJoining || '',
      dob: formData.dateOfBirth || '',
      basic: Number(formData.basic) || 0,
      basicPay: Number(formData.basic) || 0,
      bank: finalBankName,
      accNo: formData.accountNumber.trim(),
      ifsc: formData.ifscCode.trim().toUpperCase(),
      pan: cleanPan,
      uan: formData.uan.trim(),
      pfNo: formData.pfNo.trim(),
      esicNo: formData.esicNo.trim(),
      status: formData.status,
      active: formData.status === 'active'
    };

    try {
      if (editingEmployee && editingEmployee.id) {
        // Update existing employee in Firestore across both employees and users collections
        try {
          await setDoc(doc(db, COLLECTIONS.EMPLOYEES, editingEmployee.id), employeePayload, { merge: true });
        } catch (fbErr) {
          console.warn('Firestore employees update failed:', fbErr);
        }
        try {
          await setDoc(doc(db, COLLECTIONS.USERS, editingEmployee.id), employeePayload, { merge: true });
        } catch (fbErr) {
          console.warn('Firestore users update failed:', fbErr);
        }

        // Telemetry audit log
        await logAuditEvent({
          action: 'EMPLOYEE_UPDATED',
          target: cleanEmail || cleanEmpId,
          details: { id: editingEmployee.id, name: cleanName, department: finalDepartment }
        });

        // Update local state
        setUsers((prev) =>
          prev.map((u) => (u.id === editingEmployee.id ? { ...u, ...employeePayload } : u))
        );
        showToast(`Employee "${cleanName}" updated successfully!`, 'success');
      } else {
        // Create new employee document with unique deterministic or generated ID
        const docId = cleanEmail.replace(/[^a-zA-Z0-9_]/g, '_') || `emp_${Date.now()}`;
        const newRecord = {
          ...employeePayload,
          id: docId,
          createdAt: new Date().toISOString()
        };

        try {
          await setDoc(doc(db, COLLECTIONS.EMPLOYEES, docId), newRecord, { merge: true });
        } catch (fbErr) {
          console.warn('Firestore employees setDoc failed:', fbErr);
        }
        try {
          await setDoc(doc(db, COLLECTIONS.USERS, docId), newRecord, { merge: true });
        } catch (fbErr) {
          console.warn('Firestore users setDoc failed:', fbErr);
        }

        // Telemetry audit log
        await logAuditEvent({
          action: 'EMPLOYEE_CREATED',
          target: cleanEmail || cleanEmpId,
          details: { id: docId, name: cleanName, department: finalDepartment }
        });

        setUsers((prev) => [newRecord, ...prev]);
        showToast(`Employee "${cleanName}" created successfully!`, 'success');
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

  // Delete Employee
  const handleDeleteEmployee = async (id: string) => {
    try {
      const targetEmp = users.find((u) => u.id === id);
      try {
        await deleteDoc(doc(db, COLLECTIONS.EMPLOYEES, id));
      } catch (fbErr) {
        console.warn('Firestore employees delete failed:', fbErr);
      }
      try {
        await deleteDoc(doc(db, COLLECTIONS.USERS, id));
      } catch (fbErr) {
        console.warn('Firestore users delete failed:', fbErr);
      }

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

  // Download Excel Import Template
  const handleDownloadTemplate = () => {
    const templateData = [
      {
        'Employee ID': 'SOL-EMP-001',
        'Name': 'Rahul Sharma',
        'Email': 'rahul.sharma@solarithm.com',
        'Designation': 'Senior Solar Design Engineer',
        'Department': 'Solar Design & Engineering',
        'Role': 'engineer',
        'Date of Joining': '2024-01-15',
        'Date of Birth': '1995-06-20',
        'Basic Pay': 45000,
        'Bank Name': 'HDFC Bank',
        'Account Number': '50100456789123',
        'IFSC': 'HDFC0001234',
        'PAN': 'ABCDE1234F',
        'Aadhaar': '123456789012',
        'Personal Email': 'rahul.personal@gmail.com',
        'Address': '123 Sunrise Enclave, Delhi'
      },
      {
        'Employee ID': 'SOL-EMP-002',
        'Name': 'Priya Patel',
        'Email': 'priya.patel@solarithm.com',
        'Designation': 'Sales Executive',
        'Department': 'Sales & Business Development',
        'Role': 'sales',
        'Date of Joining': '2024-03-01',
        'Date of Birth': '1998-11-12',
        'Basic Pay': 35000,
        'Bank Name': 'State Bank of India',
        'Account Number': '30987654321',
        'IFSC': 'SBIN0004567',
        'PAN': 'XYZPW9876Q',
        'Aadhaar': '987654321098',
        'Personal Email': 'priya.patel.personal@gmail.com',
        'Address': '45 Green Meadows, Ahmedabad'
      }
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);

    // Set custom column widths for readability
    ws['!cols'] = [
      { wch: 15 }, // Employee ID
      { wch: 22 }, // Name
      { wch: 28 }, // Email
      { wch: 28 }, // Designation
      { wch: 28 }, // Department
      { wch: 14 }, // Role
      { wch: 16 }, // Date of Joining
      { wch: 16 }, // Date of Birth
      { wch: 14 }, // Basic Pay
      { wch: 20 }, // Bank Name
      { wch: 20 }, // Account Number
      { wch: 14 }, // IFSC
      { wch: 14 }, // PAN
      { wch: 16 }, // Aadhaar
      { wch: 28 }, // Personal Email
      { wch: 32 }  // Address
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'Employee_Import_Template.xlsx');
    showToast('Template downloaded: Employee_Import_Template.xlsx', 'success');
  };

  // Helper to parse date from Excel cell (handles serial dates or strings)
  const parseExcelDate = (val: any): string => {
    if (!val) return '';
    if (typeof val === 'number') {
      // Excel serial date number
      const date = new Date(Math.round((val - 25569) * 86400 * 1000));
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
    }
    const str = String(val).trim();
    if (!str) return '';
    
    // Check if format is DD/MM/YYYY or DD-MM-YYYY
    const dmyMatch = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (dmyMatch) {
      const day = dmyMatch[1].padStart(2, '0');
      const month = dmyMatch[2].padStart(2, '0');
      const year = dmyMatch[3];
      return `${year}-${month}-${day}`;
    }

    // Try standard date parsing
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }
    return str;
  };

  // Handle Excel File Import
  const handleImportExcel = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        throw new Error('Spreadsheet contains no sheets');
      }

      const worksheet = workbook.Sheets[firstSheetName];
      const rawRows: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

      if (!rawRows || rawRows.length === 0) {
        showToast('Spreadsheet has no data rows to import', 'error');
        setIsImporting(false);
        if (event.target) event.target.value = '';
        return;
      }

      let addedCount = 0;
      let updatedCount = 0;
      const newEmployees: AdminEmployee[] = [];

      for (let i = 0; i < rawRows.length; i++) {
        const row = rawRows[i];

        // Flexible header matching
        const empId = String(
          row['Employee ID'] || row['EmployeeId'] || row['Emp ID'] || row['EmpId'] || row['ID'] || ''
        ).trim().toUpperCase();

        const name = String(
          row['Name'] || row['Full Name'] || row['Employee Name'] || row['EmployeeName'] || ''
        ).trim();

        if (!empId && !name) continue; // Skip blank rows

        const email = String(
          row['Email'] || row['Email ID'] || row['Official Email'] || row['Email Address'] || ''
        ).trim().toLowerCase();

        const designation = String(
          row['Designation'] || row['Role'] || row['Position'] || row['Job Title'] || 'Associate'
        ).trim();

        const department = String(
          row['Department'] || row['Dept'] || row['Team'] || 'Solar Design & Engineering'
        ).trim();

        const role = String(row['Role'] || row['role'] || 'employee').trim();

        const dateOfJoining = parseExcelDate(
          row['Date of Joining'] || row['DOJ'] || row['Joining Date'] || row['Joining'] || ''
        );

        const dateOfBirth = parseExcelDate(
          row['Date of Birth'] || row['DOB'] || row['Birth Date'] || ''
        );

        const basicRaw = row['Basic Pay'] ?? row['Basic'] ?? row['Basic Salary'] ?? row['Base Pay'] ?? row['Basic Pay (₹)'] ?? 25000;
        const basic = typeof basicRaw === 'number' ? basicRaw : parseFloat(String(basicRaw).replace(/[^0-9.]/g, '')) || 25000;

        const bankName = String(
          row['Bank Name'] || row['Bank'] || row['BankName'] || ''
        ).trim();

        const accountNumber = String(
          row['Account Number'] || row['Account No'] || row['Acc No'] || row['AccountNumber'] || row['Bank Account Number'] || ''
        ).trim();

        const ifscCode = String(
          row['IFSC'] || row['IFSC Code'] || row['Ifsc'] || row['IfscCode'] || ''
        ).trim().toUpperCase();

        const mobile = String(
          row['Mobile'] || row['Phone'] || row['Contact Number'] || row['Mobile Number'] || ''
        ).trim();

        const pan = String(row['PAN'] || row['Pan'] || row['PAN Number'] || '').trim().toUpperCase();
        const aadhaarCardNumber = String(row['Aadhaar'] || row['Aadhaar Card'] || row['Aadhaar Number'] || row['aadhaarCardNumber'] || '').trim();
        const houseAddress = String(row['Address'] || row['House Address'] || row['Residential Address'] || row['houseAddress'] || '').trim();
        const personalEmailAddress = String(row['Personal Email'] || row['Personal Email Address'] || row['personalEmailAddress'] || '').trim().toLowerCase();

        const uan = String(row['UAN'] || row['Uan'] || '').trim();
        const pfNo = String(row['PF Number'] || row['PF No'] || row['PF'] || '').trim();
        const esicNo = String(row['ESIC Number'] || row['ESIC No'] || row['ESIC'] || '').trim();
        const statusRaw = String(row['Status'] || 'Active').trim().toLowerCase();
        const status = statusRaw.includes('inactive') || statusRaw.includes('relieved') ? 'inactive' : statusRaw.includes('leave') ? 'on_leave' : 'active';

        // Safe ID generation: guarantee a unique fallback ID if Employee ID or id is missing
        const rowId = row['Employee ID'] || row['id'] || row['EmployeeId'] || row['Emp ID'] || `EMP_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
        const finalEmpId = empId || String(rowId).trim();
        const finalName = name || 'Employee';

        const payload: Partial<AdminEmployee> = {
          id: String(rowId).trim(),
          empId: finalEmpId,
          employeeId: finalEmpId,
          name: finalName,
          email,
          designation,
          department,
          role,
          dateOfJoining,
          doj: dateOfJoining,
          dateOfBirth,
          dob: dateOfBirth,
          basic,
          basicPay: basic,
          bankName,
          bank: bankName,
          accountNumber,
          accNo: accountNumber,
          ifscCode,
          ifsc: ifscCode,
          mobile,
          phone: mobile,
          pan,
          panCardNumber: pan,
          aadhaarCardNumber,
          houseAddress,
          personalEmailAddress,
          uan,
          pfNo,
          esicNo,
          status,
          active: status === 'active',
          updatedAt: new Date().toISOString()
        };

        // Check if employee already exists in newEmployees (within this file) or in existing users state
        const existingInNewIdx = newEmployees.findIndex(
          (u) =>
            (rowId && u.id === String(rowId).trim()) ||
            (finalEmpId && u.empId && u.empId.toUpperCase() === finalEmpId.toUpperCase()) ||
            (email && u.email && u.email.toLowerCase() === email)
        );

        const existingEmp = existingInNewIdx >= 0 ? newEmployees[existingInNewIdx] : users.find(
          (u) =>
            (rowId && u.id === String(rowId).trim()) ||
            (finalEmpId && u.empId && u.empId.toUpperCase() === finalEmpId.toUpperCase()) ||
            (email && u.email && u.email.toLowerCase() === email)
        );

        if (existingEmp) {
          const resolvedId = existingEmp.id || String(rowId).trim();
          const updatedRecord = { ...existingEmp, ...payload, id: resolvedId } as AdminEmployee;

          // Update in Firestore across employees and users collections
          if (resolvedId) {
            try {
              await setDoc(doc(db, COLLECTIONS.EMPLOYEES, resolvedId), payload, { merge: true });
            } catch (fbErr) {
              console.warn('Firestore employees updateDoc failed during Excel import:', fbErr);
            }
            try {
              await setDoc(doc(db, COLLECTIONS.USERS, resolvedId), payload, { merge: true });
            } catch (fbErr) {
              console.warn('Firestore users updateDoc failed during Excel import:', fbErr);
            }
          }

          if (existingInNewIdx >= 0) {
            newEmployees[existingInNewIdx] = updatedRecord;
          } else {
            newEmployees.push(updatedRecord);
            updatedCount++;
          }
        } else {
          // Create in Firestore across employees and users collections
          const newId = String(rowId).trim() || (email ? email.replace(/[^a-zA-Z0-9_]/g, '_') : `emp_${Date.now()}`);
          const recordToSave = {
            ...payload,
            id: newId,
            createdAt: new Date().toISOString()
          };

          try {
            await setDoc(doc(db, COLLECTIONS.EMPLOYEES, newId), recordToSave, { merge: true });
          } catch (fbErr) {
            console.warn('Firestore employees setDoc failed during Excel import:', fbErr);
          }
          try {
            await setDoc(doc(db, COLLECTIONS.USERS, newId), recordToSave, { merge: true });
          } catch (fbErr) {
            console.warn('Firestore users setDoc failed during Excel import:', fbErr);
          }
          addedCount++;
          newEmployees.push(recordToSave as AdminEmployee);
        }
      }

      // Log bulk import to auditLogs
      await logAuditEvent({
        action: 'EMPLOYEES_BULK_IMPORTED',
        target: `Total: ${newEmployees.length}`,
        details: { added: addedCount, updated: updatedCount }
      });

      // Update state and localStorage with strict deduplication
      setUsers((prev) => {
        let updatedList = [...prev];
        newEmployees.forEach((newEmp) => {
          const idx = updatedList.findIndex(
            (u) =>
              (u.id && newEmp.id && u.id === newEmp.id) ||
              (u.empId && newEmp.empId && u.empId.toUpperCase() === newEmp.empId.toUpperCase()) ||
              (newEmp.email && u.email && u.email.toLowerCase() === newEmp.email.toLowerCase())
          );
          if (idx >= 0) {
            updatedList[idx] = { ...updatedList[idx], ...newEmp, id: updatedList[idx].id || newEmp.id };
          } else {
            updatedList.unshift(newEmp);
          }
        });

        // Deduplicate updatedList by unique key to prevent duplicate React keys
        const seenKeys = new Set<string>();
        const deduplicatedList: AdminEmployee[] = [];
        for (const emp of updatedList) {
          const key = (emp.id || emp.empId || emp.email || '').toLowerCase().trim();
          if (key && seenKeys.has(key)) {
            continue;
          }
          if (key) {
            seenKeys.add(key);
          }
          deduplicatedList.push(emp);
        }

        try {
          localStorage.setItem('users', JSON.stringify(deduplicatedList));
          localStorage.setItem('employees', JSON.stringify(deduplicatedList));
          localStorage.setItem('solarithm_users', JSON.stringify(deduplicatedList));
          localStorage.setItem('solarithm_employees', JSON.stringify(deduplicatedList));
        } catch (lsErr) {
          console.warn('Failed to save to localStorage:', lsErr);
        }
        return deduplicatedList;
      });

      showToast(
        `Import Complete: ${addedCount} new employee(s) added, ${updatedCount} updated!`,
        'success'
      );
    } catch (err: any) {
      console.error('Failed to import Excel:', err);
      showToast(err.message || 'Failed to parse Excel file. Please check format.', 'error');
    } finally {
      setIsImporting(false);
      if (event.target) event.target.value = '';
    }
  };

  // Export to Excel
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
      'Date of Birth': e.dateOfBirth || '—',
      'Basic Pay (₹)': e.basic || 0,
      'Bank Name': e.bankName || '—',
      'Account Number': e.accountNumber || '—',
      'IFSC Code': e.ifscCode || '—',
      'Email': e.email || '—',
      'Mobile': e.mobile || '—',
      'PAN': e.pan || '—',
      'UAN': e.uan || '—',
      'PF Number': e.pfNo || '—',
      'Status': e.status || 'Active'
    }));

    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Employees Master');
    XLSX.writeFile(wb, `Solarithm_Employees_Directory_${new Date().toISOString().split('T')[0]}.xlsx`);
    showToast('Employee directory exported to Excel!', 'success');
  };

  // Format currency
  const formatINR = (val: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(val);

  return (
    <div className="w-full space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-2xl flex items-center space-x-3 text-sm font-medium border transition-all animate-bounce ${
            toastMessage.type === 'success'
              ? 'bg-[#1E1E1E] text-emerald-400 border-emerald-500/40'
              : toastMessage.type === 'error'
              ? 'bg-[#2D1515] text-rose-400 border-rose-500/40'
              : 'bg-[#1E1E1E] text-[#D4AF37] border-[#D4AF37]/40'
          }`}
        >
          {toastMessage.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />}
          {toastMessage.type === 'error' && <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />}
          {toastMessage.type === 'info' && <ShieldCheck className="w-5 h-5 text-[#D4AF37] shrink-0" />}
          <span>{toastMessage.text}</span>
          <button onClick={() => setToastMessage(null)} className="text-gray-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header & Quick Action Banner */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/30">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white tracking-wide">Employee Administration</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Centralized HR records, administrative details, compensation, and banking configurations.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Hidden Excel File Input */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImportExcel}
            accept=".xlsx, .xls, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
            className="hidden"
            id="excel-employee-import-input"
          />

          {/* Download Template Button */}
          <button
            onClick={handleDownloadTemplate}
            className="px-3.5 py-2 rounded-lg bg-[#1E1E1E] hover:bg-[#2A2A2A] text-gray-200 hover:text-white border border-[#333333] hover:border-[#D4AF37]/50 text-xs font-semibold flex items-center space-x-1.5 transition-colors shadow-sm"
            title="Download formatted Excel template for bulk employee import"
            id="btn-download-employee-template"
          >
            <FileSpreadsheet className="w-4 h-4 text-[#D4AF37]" />
            <span>Download Template</span>
          </button>

          {/* Import Excel Button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            className="px-3.5 py-2 rounded-lg bg-[#1E1E1E] hover:bg-[#2A2A2A] text-gray-200 hover:text-white border border-[#333333] text-xs font-semibold flex items-center space-x-1.5 transition-colors shadow-sm disabled:opacity-50"
            title="Import employee records from Excel (.xlsx or .xls)"
            id="btn-import-employee-excel"
          >
            <Upload className={`w-4 h-4 text-amber-400 ${isImporting ? 'animate-bounce' : ''}`} />
            <span>{isImporting ? 'Importing...' : 'Import Excel'}</span>
          </button>

          {/* Export Excel Button */}
          <button
            onClick={handleExportExcel}
            className="px-3.5 py-2 rounded-lg bg-[#1E1E1E] hover:bg-[#2A2A2A] text-gray-200 hover:text-white border border-[#333333] text-xs font-semibold flex items-center space-x-1.5 transition-colors shadow-sm"
            title="Download employee directory spreadsheet"
            id="btn-export-employee-excel"
          >
            <Download className="w-4 h-4 text-emerald-400" />
            <span>Export Excel</span>
          </button>

          {/* Add Employee Button */}
          <button
            onClick={handleOpenAddModal}
            className="px-4 py-2 rounded-lg bg-[#D4AF37] hover:bg-[#e5be42] text-black text-xs font-bold flex items-center space-x-1.5 transition-all shadow-md shadow-[#D4AF37]/20"
            id="btn-add-employee-modal"
          >
            <Plus className="w-4 h-4" />
            <span>Add Employee</span>
          </button>
        </div>
      </div>

      {/* KPI Stats Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Employees */}
        <div className="bg-[#1E1E1E] border border-[#333333] hover:border-[#D4AF37]/40 rounded-xl p-5 shadow-sm transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Total Workforce</span>
            <div className="p-2 rounded-lg bg-[#121212] text-[#D4AF37]">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <div className="text-2xl font-bold text-white font-mono">{metrics.total}</div>
            <div className="mt-1 text-xs text-gray-400 flex items-center justify-between border-t border-[#2A2A2A] pt-2">
              <span>Active Status:</span>
              <span className="font-semibold text-emerald-400">{metrics.activeCount} Active</span>
            </div>
          </div>
        </div>

        {/* Card 2: Total Basic Payroll */}
        <div className="bg-[#1E1E1E] border border-[#333333] hover:border-[#D4AF37]/40 rounded-xl p-5 shadow-sm transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Monthly Basic Payroll</span>
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
              <Banknote className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <div className="text-2xl font-bold text-emerald-400 font-mono">
              {formatINR(metrics.totalBasicPayroll)}
            </div>
            <div className="mt-1 text-xs text-gray-400 flex items-center justify-between border-t border-[#2A2A2A] pt-2">
              <span>Average Basic:</span>
              <span className="font-mono text-gray-300">
                {formatINR(metrics.total > 0 ? metrics.totalBasicPayroll / metrics.total : 0)}
              </span>
            </div>
          </div>
        </div>

        {/* Card 3: Banking Configurations */}
        <div className="bg-[#1E1E1E] border border-[#333333] hover:border-[#D4AF37]/40 rounded-xl p-5 shadow-sm transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Banking Setup</span>
            <div className="p-2 rounded-lg bg-[#121212] text-[#D4AF37]">
              <CreditCard className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <div className="text-2xl font-bold text-white font-mono">
              {metrics.withBanking} / {metrics.total}
            </div>
            <div className="mt-1 text-xs text-gray-400 flex items-center justify-between border-t border-[#2A2A2A] pt-2">
              <span>Direct Deposit Ready:</span>
              <span className="font-semibold text-emerald-400">
                {metrics.total > 0 ? `${Math.round((metrics.withBanking / metrics.total) * 100)}%` : '0%'}
              </span>
            </div>
          </div>
        </div>

        {/* Card 4: Departments */}
        <div className="bg-[#1E1E1E] border border-[#333333] hover:border-[#D4AF37]/40 rounded-xl p-5 shadow-sm transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Departments</span>
            <div className="p-2 rounded-lg bg-[#121212] text-[#D4AF37]">
              <Building2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <div className="text-2xl font-bold text-white font-mono">{metrics.departmentsCount}</div>
            <div className="mt-1 text-xs text-gray-400 flex items-center justify-between border-t border-[#2A2A2A] pt-2">
              <span>Operational Units:</span>
              <span className="text-gray-300">Design, Sales, Site, Ops</span>
            </div>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-[#1E1E1E] border border-[#333333] rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 shadow-sm">
        <div className="flex items-center space-x-3 flex-1 min-w-[260px]">
          <Search className="w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by Employee ID, Name, Designation, Department, Email, Bank..."
            className="bg-transparent border-none text-xs text-white placeholder-gray-500 focus:outline-none w-full"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Department Filter */}
          <div className="flex items-center space-x-1.5 bg-[#121212] border border-[#333333] rounded-lg px-2.5 py-1.5 text-xs">
            <Filter className="w-3.5 h-3.5 text-[#D4AF37]" />
            <select
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              className="bg-transparent text-gray-200 focus:outline-none cursor-pointer pr-1 text-xs"
            >
              <option value="all" className="bg-[#1E1E1E] text-white">All Departments</option>
              {DEPARTMENT_PRESETS.map((dept) => (
                <option key={dept} value={dept} className="bg-[#1E1E1E] text-white">
                  {dept}
                </option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="bg-[#121212] border border-[#333333] rounded-lg px-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-[#D4AF37]"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active Staff Only</option>
            <option value="inactive">Inactive / Past</option>
          </select>

          {/* Reset Filters */}
          {(searchTerm || departmentFilter !== 'all' || statusFilter !== 'all') && (
            <button
              onClick={() => {
                setSearchTerm('');
                setDepartmentFilter('all');
                setStatusFilter('all');
              }}
              className="px-2.5 py-1.5 rounded-lg bg-[#2A2A2A] hover:bg-[#333333] text-gray-300 hover:text-white border border-[#444] text-xs font-medium"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Main Employee Directory Table */}
      <div className="bg-[#1E1E1E] rounded-xl shadow-2xl p-6 overflow-x-auto whitespace-nowrap border border-[#333333]">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center space-x-2">
            <Building2 className="w-4 h-4 text-[#D4AF37]" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Employee Records ({filteredEmployees.length})
            </h3>
          </div>
        </div>

        {filteredEmployees.length === 0 ? (
          <div className="text-center py-12 px-4 border border-dashed border-[#333333] rounded-xl bg-[#141414]">
            <Users className="mx-auto h-12 w-12 text-gray-500 mb-3 opacity-60" />
            <h4 className="text-base font-semibold text-gray-300">No employee records found</h4>
            <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
              {searchTerm || departmentFilter !== 'all'
                ? 'Try adjusting your search query or department filters to see matching employees.'
                : 'Get started by clicking "Add Employee" or "Import Excel" to register your team.'}
            </p>
            <div className="mt-4 flex items-center justify-center space-x-3">
              <button
                onClick={handleOpenAddModal}
                className="px-4 py-2 rounded-lg bg-[#D4AF37] hover:bg-[#e5be42] text-black text-xs font-bold inline-flex items-center space-x-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Add Employee</span>
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 rounded-lg bg-[#2A2A2A] hover:bg-[#333333] text-gray-200 hover:text-white border border-[#444] text-xs font-semibold inline-flex items-center space-x-1.5"
              >
                <Upload className="w-4 h-4 text-amber-400" />
                <span>Import Excel</span>
              </button>
            </div>
          </div>
        ) : (
          <table className="w-full text-left text-xs whitespace-nowrap">
            <thead>
              <tr className="text-gray-400 uppercase text-[11px] border-b border-[#333333]">
                <th className="pb-3 px-3.5 font-semibold">Employee ID</th>
                <th className="pb-3 px-3.5 font-semibold">Name</th>
                <th className="pb-3 px-3.5 font-semibold">Email</th>
                <th className="pb-3 px-3.5 font-semibold">Designation</th>
                <th className="pb-3 px-3.5 font-semibold">Department</th>
                <th className="pb-3 px-3.5 font-semibold">DOJ</th>
                <th className="pb-3 px-3.5 font-semibold">DOB</th>
                <th className="pb-3 px-3.5 font-semibold text-right">Basic Pay</th>
                <th className="pb-3 px-3.5 font-semibold">Bank Name</th>
                <th className="pb-3 px-3.5 font-semibold">Account Number</th>
                <th className="pb-3 px-3.5 font-semibold">IFSC</th>
                <th className="pb-3 px-3.5 font-semibold">Status</th>
                <th className="pb-3 px-3.5 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2A2A2A]">
              {filteredEmployees.map((emp, index) => {
                const dojFormatted = emp.dateOfJoining ? String(emp.dateOfJoining).split('T')[0] : '—';
                const dobFormatted = emp.dateOfBirth ? String(emp.dateOfBirth).split('T')[0] : '—';

                return (
                  <tr key={emp.id ? `${emp.id}-${index}` : `employee-${index}`} className="hover:bg-[#252525] transition-colors group">
                    {/* Employee ID */}
                    <td className="py-3.5 px-3.5 font-mono text-xs font-bold text-[#D4AF37]">
                      {emp.empId}
                    </td>

                    {/* Name */}
                    <td className="py-3.5 px-3.5 font-semibold text-white">
                      {emp.name}
                    </td>

                    {/* Email */}
                    <td className="py-3.5 px-3.5 text-gray-300 font-mono">
                      {emp.email || '—'}
                    </td>

                    {/* Designation */}
                    <td className="py-3.5 px-3.5 font-medium text-gray-200">
                      {emp.designation || 'Associate'}
                    </td>

                    {/* Department */}
                    <td className="py-3.5 px-3.5">
                      <span className="inline-block px-2 py-0.5 rounded bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/30 text-[10px] font-semibold">
                        {emp.department || '—'}
                      </span>
                    </td>

                    {/* DOJ */}
                    <td className="py-3.5 px-3.5 text-gray-300 font-mono">
                      {dojFormatted}
                    </td>

                    {/* DOB */}
                    <td className="py-3.5 px-3.5 text-gray-400 font-mono">
                      {dobFormatted}
                    </td>

                    {/* Basic Pay */}
                    <td className="py-3.5 px-3.5 text-right font-mono font-bold text-emerald-400">
                      {formatINR(emp.basic || 0)}
                    </td>

                    {/* Bank Name */}
                    <td className="py-3.5 px-3.5 text-gray-200 font-medium">
                      {emp.bankName || '—'}
                    </td>

                    {/* Account Number */}
                    <td className="py-3.5 px-3.5 font-mono text-gray-300">
                      {emp.accountNumber || '—'}
                    </td>

                    {/* IFSC */}
                    <td className="py-3.5 px-3.5">
                      {emp.ifscCode ? (
                        <span className="inline-block px-1.5 py-0.5 rounded bg-gray-800 text-[#D4AF37] border border-[#444] text-[10px] font-mono">
                          {emp.ifscCode}
                        </span>
                      ) : (
                        <span className="text-gray-500">—</span>
                      )}
                    </td>

                    {/* Status */}
                    <td className="py-3.5 px-3.5">
                      <div className="flex items-center space-x-1.5">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            emp.status === 'active' || emp.active !== false ? 'bg-emerald-400 shadow-sm' : 'bg-rose-400'
                          }`}
                        />
                        <span className="capitalize text-gray-300 text-[11px] font-medium">
                          {emp.status || (emp.active !== false ? 'Active' : 'Inactive')}
                        </span>
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-3.5 text-right">
                      <div className="inline-flex items-center space-x-1.5">
                        {onNavigateToSalaryStudio && (
                          <button
                            onClick={() => onNavigateToSalaryStudio(emp.id)}
                            className="px-2.5 py-1 rounded bg-[#2A2A2A] hover:bg-[#333333] text-[#D4AF37] hover:text-white border border-[#444] text-[11px] font-semibold flex items-center space-x-1 transition-colors"
                            title="Generate Salary Slip for this employee"
                            id={`btn-salary-slip-${emp.id}`}
                          >
                            <FileText className="w-3 h-3" />
                            <span>Salary Slip</span>
                          </button>
                        )}

                        <button
                          onClick={() => handleRequestPasswordReset(emp)}
                          className="p-1.5 rounded bg-[#2A2A2A] hover:bg-amber-950/40 text-amber-400 hover:text-amber-300 border border-[#444] transition-colors"
                          title="Submit password reset approval to central hub"
                          id={`btn-reset-password-${emp.id}`}
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                        </button>

                        <button
                          onClick={() => handleOpenEditModal(emp)}
                          className="p-1.5 rounded bg-[#2A2A2A] hover:bg-[#333333] text-gray-300 hover:text-white border border-[#444] transition-colors"
                          title="Edit employee administrative record"
                          id={`btn-edit-employee-${emp.id}`}
                        >
                          <Edit className="w-3.5 h-3.5 text-[#D4AF37]" />
                        </button>

                        <button
                          onClick={() => setDeleteConfirmationId(emp.id)}
                          className="p-1.5 rounded bg-[#2A2A2A] hover:bg-[#3d1c1c] text-gray-300 hover:text-rose-400 border border-[#444] transition-colors"
                          title="Delete employee"
                          id={`btn-delete-employee-${emp.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirmationId && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#1E1E1E] border border-rose-500/40 rounded-xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center space-x-3 text-rose-400">
              <AlertCircle className="w-6 h-6 shrink-0" />
              <h3 className="text-base font-bold text-white">Confirm Employee Deletion</h3>
            </div>
            <p className="text-xs text-gray-300 leading-relaxed">
              Are you sure you want to delete this employee record? This will remove them from the active directory. Any historical salary slips already generated will remain archived.
            </p>
            <div className="flex justify-end space-x-2 pt-2 border-t border-[#333333]">
              <button
                onClick={() => setDeleteConfirmationId(null)}
                className="px-3.5 py-1.5 rounded-lg bg-[#2A2A2A] hover:bg-[#333333] text-gray-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteEmployee(deleteConfirmationId)}
                className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Employee Comprehensive Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-[#1E1E1E] border border-[#333333] rounded-2xl max-w-3xl w-full shadow-2xl max-h-[90vh] flex flex-col overflow-hidden my-auto animate-in fade-in duration-200">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-[#333333] flex items-center justify-between bg-[#181818]">
              <div className="flex items-center space-x-3">
                <div className="p-2 rounded-lg bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/30">
                  <UserCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">
                    {editingEmployee ? `Edit Employee: ${editingEmployee.name}` : 'Add New Employee'}
                  </h3>
                  <p className="text-xs text-gray-400">
                    Fill in complete administrative details, designation, basic pay, and banking information.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-lg hover:bg-[#2A2A2A] text-gray-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body Form */}
            <form onSubmit={handleSaveEmployee} className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Section 1: Core Identification */}
              <div className="space-y-3">
                <div className="flex items-center space-x-2 text-xs font-bold text-[#D4AF37] uppercase tracking-wider border-b border-[#333333] pb-1.5">
                  <Users className="w-4 h-4" />
                  <span>1. Identity &amp; Contact Details</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                      Employee Name <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Hasti Savani"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full bg-[#121212] border border-[#333333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#D4AF37]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                      Employee ID <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. SOL-HS-0126"
                      value={formData.empId}
                      onChange={(e) => setFormData({ ...formData, empId: e.target.value.toUpperCase() })}
                      className="w-full bg-[#121212] border border-[#333333] rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-[#D4AF37]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-gray-300 mb-1">Official Email</label>
                    <input
                      type="email"
                      placeholder="e.g. hasti@solarithm.com"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full bg-[#121212] border border-[#333333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#D4AF37]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-gray-300 mb-1">Mobile / Phone</label>
                    <input
                      type="tel"
                      placeholder="e.g. +91 98765 43210"
                      value={formData.mobile}
                      onChange={(e) => setFormData({ ...formData, mobile: e.target.value })}
                      className="w-full bg-[#121212] border border-[#333333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#D4AF37]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-gray-300 mb-1">Date of Birth</label>
                    <input
                      type="date"
                      value={formData.dateOfBirth}
                      onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })}
                      className="w-full bg-[#121212] border border-[#333333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#D4AF37]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-gray-300 mb-1">Date of Joining</label>
                    <input
                      type="date"
                      value={formData.dateOfJoining}
                      onChange={(e) => setFormData({ ...formData, dateOfJoining: e.target.value })}
                      className="w-full bg-[#121212] border border-[#333333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#D4AF37]"
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: Role & Compensation */}
              <div className="space-y-3">
                <div className="flex items-center space-x-2 text-xs font-bold text-[#D4AF37] uppercase tracking-wider border-b border-[#333333] pb-1.5">
                  <Briefcase className="w-4 h-4" />
                  <span>2. Department, Role &amp; Basic Pay</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-300 mb-1">Department</label>
                    <select
                      value={formData.department}
                      onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                      className="w-full bg-[#121212] border border-[#333333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#D4AF37]"
                    >
                      {DEPARTMENT_PRESETS.map((dept) => (
                        <option key={dept} value={dept}>
                          {dept}
                        </option>
                      ))}
                      <option value="custom">Other / Custom Department</option>
                    </select>
                    {formData.department === 'custom' && (
                      <input
                        type="text"
                        placeholder="Enter custom department name"
                        value={formData.customDepartment}
                        onChange={(e) => setFormData({ ...formData, customDepartment: e.target.value })}
                        className="mt-1.5 w-full bg-[#121212] border border-[#333333] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#D4AF37]"
                      />
                    )}
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-gray-300 mb-1">Designation</label>
                    <input
                      type="text"
                      placeholder="e.g. Senior Solar Engineer / Sales Executive"
                      value={formData.designation}
                      onChange={(e) => setFormData({ ...formData, designation: e.target.value })}
                      className="w-full bg-[#121212] border border-[#333333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#D4AF37]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                      Basic Pay (₹ / month) <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={100}
                      required
                      placeholder="e.g. 25000"
                      value={formData.basic}
                      onChange={(e) => setFormData({ ...formData, basic: Number(e.target.value) || 0 })}
                      className="w-full bg-[#121212] border border-[#333333] rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-[#D4AF37]"
                    />
                    <span className="text-[10px] text-gray-400 mt-0.5 block">
                      Auto-calculates on generated salary slips
                    </span>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-gray-300 mb-1">System Role</label>
                    <select
                      value={formData.role}
                      onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                      className="w-full bg-[#121212] border border-[#333333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#D4AF37]"
                    >
                      <option value="employee">Employee</option>
                      <option value="engineer">Engineer</option>
                      <option value="sales">Sales</option>
                      <option value="operations">Operations</option>
                      <option value="manager">Manager</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-gray-300 mb-1">Status</label>
                    <select
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                      className="w-full bg-[#121212] border border-[#333333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#D4AF37]"
                    >
                      <option value="active">Active Staff</option>
                      <option value="on_leave">On Extended Leave</option>
                      <option value="inactive">Inactive / Relieved</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Section 3: Banking & Statutory Configurations */}
              <div className="space-y-3">
                <div className="flex items-center space-x-2 text-xs font-bold text-[#D4AF37] uppercase tracking-wider border-b border-[#333333] pb-1.5">
                  <CreditCard className="w-4 h-4" />
                  <span>3. Banking &amp; Statutory Configurations</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-300 mb-1">Bank Name</label>
                    <select
                      value={formData.bankName}
                      onChange={(e) => setFormData({ ...formData, bankName: e.target.value })}
                      className="w-full bg-[#121212] border border-[#333333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#D4AF37]"
                    >
                      {BANK_PRESETS.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                      <option value="custom">Other Bank</option>
                    </select>
                    {formData.bankName === 'custom' && (
                      <input
                        type="text"
                        placeholder="Enter bank name"
                        value={formData.customBankName}
                        onChange={(e) => setFormData({ ...formData, customBankName: e.target.value })}
                        className="mt-1.5 w-full bg-[#121212] border border-[#333333] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#D4AF37]"
                      />
                    )}
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-gray-300 mb-1">Bank Account Number</label>
                    <input
                      type="text"
                      placeholder="e.g. 50100234567890"
                      value={formData.accountNumber}
                      onChange={(e) => setFormData({ ...formData, accountNumber: e.target.value })}
                      className="w-full bg-[#121212] border border-[#333333] rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-[#D4AF37]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-gray-300 mb-1">IFSC Code</label>
                    <input
                      type="text"
                      placeholder="e.g. HDFC0000001"
                      value={formData.ifscCode}
                      onChange={(e) => setFormData({ ...formData, ifscCode: e.target.value.toUpperCase() })}
                      className="w-full bg-[#121212] border border-[#333333] rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-[#D4AF37]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-gray-300 mb-1">PAN Card Number</label>
                    <input
                      type="text"
                      placeholder="e.g. ABCDE1234F"
                      value={formData.panCardNumber || formData.pan}
                      onChange={(e) => setFormData({ ...formData, pan: e.target.value.toUpperCase(), panCardNumber: e.target.value.toUpperCase() })}
                      className="w-full bg-[#121212] border border-[#333333] rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-[#D4AF37]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-gray-300 mb-1">UAN / PF Number</label>
                    <input
                      type="text"
                      placeholder="e.g. 100000000001"
                      value={formData.uan}
                      onChange={(e) => setFormData({ ...formData, uan: e.target.value })}
                      className="w-full bg-[#121212] border border-[#333333] rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-[#D4AF37]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-gray-300 mb-1">ESIC Insurance No.</label>
                    <input
                      type="text"
                      placeholder="Optional"
                      value={formData.esicNo}
                      onChange={(e) => setFormData({ ...formData, esicNo: e.target.value })}
                      className="w-full bg-[#121212] border border-[#333333] rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-[#D4AF37]"
                    />
                  </div>
                </div>
              </div>

              {/* Section 4: Central Ecosystem KYC Verification */}
              <div className="space-y-3">
                <div className="flex items-center space-x-2 text-xs font-bold text-[#D4AF37] uppercase tracking-wider border-b border-[#333333] pb-1.5">
                  <ShieldCheck className="w-4 h-4" />
                  <span>4. Central Hub KYC &amp; Verification</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-300 mb-1">Aadhaar Card Number</label>
                    <input
                      type="text"
                      placeholder="12-digit Aadhaar Number"
                      value={formData.aadhaarCardNumber}
                      onChange={(e) => setFormData({ ...formData, aadhaarCardNumber: e.target.value })}
                      className="w-full bg-[#121212] border border-[#333333] rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-[#D4AF37]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-gray-300 mb-1">Personal Email Address</label>
                    <input
                      type="email"
                      placeholder="e.g. personal@gmail.com"
                      value={formData.personalEmailAddress}
                      onChange={(e) => setFormData({ ...formData, personalEmailAddress: e.target.value })}
                      className="w-full bg-[#121212] border border-[#333333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#D4AF37]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-gray-300 mb-1">Residential House Address</label>
                    <input
                      type="text"
                      placeholder="City, State, Pin Code"
                      value={formData.houseAddress}
                      onChange={(e) => setFormData({ ...formData, houseAddress: e.target.value })}
                      className="w-full bg-[#121212] border border-[#333333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#D4AF37]"
                    />
                  </div>
                </div>
              </div>

              {/* Modal Footer Buttons */}
              <div className="pt-4 border-t border-[#333333] flex items-center justify-between">
                <span className="text-[11px] text-gray-400">
                  Changes synchronize live with the Salary Studio module.
                </span>
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-4 py-2 rounded-lg bg-[#2A2A2A] hover:bg-[#333333] text-gray-300 text-xs font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="px-5 py-2 rounded-lg bg-[#D4AF37] hover:bg-[#e5be42] text-black text-xs font-bold transition-all shadow-md shadow-[#D4AF37]/20 disabled:opacity-50"
                  >
                    {isSaving ? 'Saving Record...' : editingEmployee ? 'Update Employee' : 'Save Employee'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
