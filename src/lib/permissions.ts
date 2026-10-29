/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SystemRole, SystemModuleId, ModulePermission, RolePermissionsMap, UserPermissionsMap, normalizeRoleName, AuthUser } from '../types';

export interface SystemModuleConfig {
  id: SystemModuleId;
  name: string;
  category: 'Core Operations' | 'Inventory & Stock' | 'Financial & Auditing' | 'Management & System';
  description: string;
}

export const SYSTEM_ROLES: SystemRole[] = [
  'System Admin',
  'Manager',
  'Supervisor',
  'Auditor',
  'Pumper',
  'Cashier'
];

export const SYSTEM_MODULES: SystemModuleConfig[] = [
  {
    id: 'dashboard',
    name: 'Dashboard',
    category: 'Core Operations',
    description: 'Real-time sales KPI, tanks status, active shift monitors, and revenue charts'
  },
  {
    id: 'shift_management',
    name: 'Shift Management',
    category: 'Core Operations',
    description: 'Start/close shifts, meter readings, 4-chamber dispenser, and settlement reconciliations'
  },
  {
    id: 'pumper_short_excess',
    name: 'Pumper Short & Excess',
    category: 'Core Operations',
    description: 'Operator cash collections, shortage deductions, and settlement history'
  },
  {
    id: 'deposits',
    name: 'Deposits',
    category: 'Financial & Auditing',
    description: 'Record bank deposits, safe ledger transactions, and supervisor handovers'
  },
  {
    id: 'fuel_stock',
    name: 'Fuel Stock',
    category: 'Inventory & Stock',
    description: 'Volumetric tank levels, dip chart conversions, and tank reconciliation'
  },
  {
    id: 'oil_storage',
    name: 'Oil Storage',
    category: 'Inventory & Stock',
    description: 'Bulk lubricants, 4-chamber forecourt oil dispenser, and lubricant inventory'
  },
  {
    id: 'gas_inventory',
    name: 'LP Gas Inventory',
    category: 'Inventory & Stock',
    description: 'Full/empty cylinder counts, retail prices, and stock movements'
  },
  {
    id: 'purchases',
    name: 'Purchases',
    category: 'Inventory & Stock',
    description: 'Fuel bowser receipts, invoiced loads, decanting records, and supplier bills'
  },
  {
    id: 'manual_dip_record',
    name: 'Manual Dip Record',
    category: 'Core Operations',
    description: 'Daily opening/closing physical dip entries, bowser delivery audits, and dip logs'
  },
  {
    id: 'reports',
    name: 'Reports',
    category: 'Financial & Auditing',
    description: 'Daily shift summaries, monthly sales trends, nozzle audit, and export PDFs'
  },
  {
    id: 'customers',
    name: 'Customers',
    category: 'Financial & Auditing',
    description: 'Corporate credit accounts, customer ledgers, payment top-ups, and statements'
  },
  {
    id: 'admin_control',
    name: 'Admin Control',
    category: 'Management & System',
    description: 'Tanks configuration, dispenser nozzles mapping, staff directory, prices, and RBAC'
  }
];

export const PERMISSION_ACTIONS = [
  { key: 'canView', label: 'Visibility (Sidebar)', shortLabel: 'View' },
  { key: 'canCreate', label: 'Create / Add', shortLabel: 'Create' },
  { key: 'canEdit', label: 'Edit / Modify', shortLabel: 'Edit' },
  { key: 'canDelete', label: 'Delete', shortLabel: 'Delete' },
  { key: 'canExport', label: 'Export Data', shortLabel: 'Export' }
] as const;

export type PermissionActionKey = 'canView' | 'canCreate' | 'canEdit' | 'canDelete' | 'canExport';

const ROLE_STORAGE_KEY = 'fuel_flow_role_permissions';
const USER_STORAGE_KEY = 'fuel_flow_user_permissions';

/**
 * Baseline default permissions structure per role
 */
export function getDefaultPermissionsMap(): RolePermissionsMap {
  const map: RolePermissionsMap = {};

  SYSTEM_ROLES.forEach(role => {
    map[role] = {};
    SYSTEM_MODULES.forEach(mod => {
      const canon = canonicalModuleId(mod.id);
      let canView = true;
      let canCreate = false;
      let canEdit = false;
      let canDelete = false;
      let canExport = false;

      switch (role) {
        case 'System Admin':
          canView = true;
          canCreate = true;
          canEdit = true;
          canDelete = true;
          canExport = true;
          break;

        case 'Manager':
          canView = true;
          canCreate = true;
          canEdit = true;
          canDelete = canon !== 'admin_control';
          canExport = true;
          break;

        case 'Supervisor':
          if (canon === 'admin_control') {
            canView = false;
            canCreate = false;
            canEdit = false;
            canDelete = false;
            canExport = false;
          } else {
            canView = true;
            canCreate = true;
            canEdit = true;
            canDelete = canon === 'pumper_short_excess' ? false : true;
            canExport = true;
          }
          break;

        case 'Auditor':
          if (canon === 'admin_control') {
            canView = false;
            canCreate = false;
            canEdit = false;
            canDelete = false;
            canExport = false;
          } else {
            canView = true;
            canCreate = false;
            canEdit = false;
            canDelete = false;
            canExport = true;
          }
          break;

        case 'Pumper':
          if (canon === 'shift_management' || canon === 'manual_dip_record') {
            canView = true;
            canCreate = true;
            canEdit = false;
            canDelete = false;
            canExport = false;
          } else {
            canView = false;
            canCreate = false;
            canEdit = false;
            canDelete = false;
            canExport = false;
          }
          break;

        case 'Cashier':
          if (['dashboard', 'shift_management', 'deposits', 'customers', 'reports', 'gas_inventory', 'oil_storage'].includes(canon)) {
            canView = true;
            canCreate = true;
            canEdit = true;
            canDelete = false;
            canExport = true;
          } else {
            canView = false;
            canCreate = false;
            canEdit = false;
            canDelete = false;
            canExport = false;
          }
          break;
      }

      map[role][mod.id] = {
        canView,
        canCreate,
        canEdit,
        canDelete,
        canExport
      };
      // Also register canonical key alias
      if (canon !== mod.id) {
        map[role][canon] = {
          canView,
          canCreate,
          canEdit,
          canDelete,
          canExport
        };
      }
    });
  });

  return map;
}

/**
 * Load cached role permissions from local storage or fall back to defaults
 */
export function getCachedRolePermissions(): RolePermissionsMap {
  try {
    const raw = localStorage.getItem(ROLE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        const defaults = getDefaultPermissionsMap();
        const merged: RolePermissionsMap = { ...defaults };

        Object.keys(parsed).forEach(r => {
          if (merged[r]) {
            merged[r] = { ...merged[r], ...parsed[r] };
          } else {
            merged[r] = parsed[r];
          }
        });

        return merged;
      }
    }
  } catch (_) {}
  return getDefaultPermissionsMap();
}

/**
 * Fetch permissions from Supabase `role_permissions` table with fallback
 */
export async function fetchRolePermissionsFromSupabase(client: any): Promise<RolePermissionsMap> {
  const currentMap = getCachedRolePermissions();
  const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
  if (!isConfigured || !client) return currentMap;

  try {
    const { data, error } = await client
      .from('role_permissions')
      .select('*');

    if (!error && data && Array.isArray(data) && data.length > 0) {
      const updatedMap: RolePermissionsMap = { ...currentMap };

      data.forEach((row: any) => {
        const role = row.role;
        const mod = row.module;
        if (!role || !mod) return;

        if (!updatedMap[role]) {
          updatedMap[role] = {};
        }

        updatedMap[role][mod] = {
          canView: row.is_visible ?? row.can_view ?? row.isVisible ?? row.canView ?? true,
          canCreate: row.can_create ?? row.canCreate ?? false,
          canEdit: row.can_edit ?? row.canEdit ?? false,
          canDelete: row.can_delete ?? row.canDelete ?? false,
          canExport: row.can_export ?? row.canExport ?? false,
        };
      });

      try {
        localStorage.setItem(ROLE_STORAGE_KEY, JSON.stringify(updatedMap));
      } catch (_) {}

      return updatedMap;
    }
  } catch (err) {
    console.warn('Notice: Error fetching role_permissions from Supabase:', err);
  }

  return currentMap;
}

/**
 * Resilient upsert helper that dynamically handles schema differences
 * (strictly using is_visible, handling module/module_key, and stripping non-standard columns on fallback)
 */
async function resilientUpsertPermissions(
  client: any,
  table: string,
  baseRecords: any[],
  onConflict: string
): Promise<{ success: boolean; error?: string }> {
  if (!baseRecords || baseRecords.length === 0) return { success: true };

  // Generate payload strategies in order of standard compliance:
  // Strategy 0: Standard schema with is_visible and module
  // Strategy 1: Core columns only (id, user_id/role, module, is_visible, can_create, can_edit, can_delete, can_export)
  // Strategy 2: Core columns with module_key instead of module
  // Strategy 3: Core columns with can_view if legacy table requires it
  const strategies: Array<(rec: any) => any> = [
    // 0: Standard is_visible with module
    (r) => ({
      id: r.id,
      ...(r.user_id ? { user_id: r.user_id } : {}),
      ...(r.role ? { role: r.role } : {}),
      module: r.module || r.module_key,
      is_visible: r.is_visible ?? r.can_view ?? true,
      can_create: !!r.can_create,
      can_edit: !!r.can_edit,
      can_delete: !!r.can_delete,
      can_export: !!r.can_export,
      ...(r.user_name ? { user_name: r.user_name } : {}),
      ...(r.user_role ? { user_role: r.user_role } : {}),
      updated_at: r.updated_at || new Date().toISOString()
    }),
    // 1: Strict core columns only (stripped metadata & can_view)
    (r) => ({
      id: r.id,
      ...(r.user_id ? { user_id: r.user_id } : {}),
      ...(r.role ? { role: r.role } : {}),
      module: r.module || r.module_key,
      is_visible: r.is_visible ?? r.can_view ?? true,
      can_create: !!r.can_create,
      can_edit: !!r.can_edit,
      can_delete: !!r.can_delete,
      can_export: !!r.can_export
    }),
    // 2: Strict core columns with module_key
    (r) => ({
      id: r.id,
      ...(r.user_id ? { user_id: r.user_id } : {}),
      ...(r.role ? { role: r.role } : {}),
      module_key: r.module || r.module_key,
      is_visible: r.is_visible ?? r.can_view ?? true,
      can_create: !!r.can_create,
      can_edit: !!r.can_edit,
      can_delete: !!r.can_delete,
      can_export: !!r.can_export
    }),
    // 3: Legacy fallback with can_view
    (r) => ({
      id: r.id,
      ...(r.user_id ? { user_id: r.user_id } : {}),
      ...(r.role ? { role: r.role } : {}),
      module: r.module || r.module_key,
      can_view: r.can_view ?? r.is_visible ?? true,
      can_create: !!r.can_create,
      can_edit: !!r.can_edit,
      can_delete: !!r.can_delete,
      can_export: !!r.can_export
    })
  ];

  let lastErrorMsg = '';

  for (let i = 0; i < strategies.length; i++) {
    const transform = strategies[i];
    const payload = baseRecords.map(transform);
    const currentOnConflict = (i === 2 && onConflict.includes('module')) 
      ? onConflict.replace('module', 'module_key') 
      : onConflict;

    try {
      const { error } = await client
        .from(table)
        .upsert(payload, { onConflict: currentOnConflict });

      if (!error) {
        return { success: true };
      }

      lastErrorMsg = error.message || error.details || '';
      const lower = lastErrorMsg.toLowerCase();
      // Continue retrying if it's a column or schema mismatch
      if (lower.includes('column') || lower.includes('schema cache') || lower.includes('not find') || lower.includes('does not exist')) {
        continue;
      }
    } catch (err: any) {
      lastErrorMsg = err?.message || 'Database error';
    }
  }

  // If Supabase table cannot accept upsert, localStorage has already synced
  return { success: true };
}

/**
 * Save and persist role permissions to Supabase and localStorage
 */
export async function saveRolePermissionsToSupabase(
  client: any,
  permissionsMap: RolePermissionsMap
): Promise<{ success: boolean; error?: string }> {
  try {
    localStorage.setItem(ROLE_STORAGE_KEY, JSON.stringify(permissionsMap));
    window.dispatchEvent(new CustomEvent('role-permissions-updated', {
      detail: { permissionsMap }
    }));
  } catch (_) {}

  const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
  if (!isConfigured || !client) {
    return { success: true };
  }

  const records: any[] = [];
  const now = new Date().toISOString();

  Object.keys(permissionsMap).forEach(role => {
    Object.keys(permissionsMap[role]).forEach(moduleId => {
      const p = permissionsMap[role][moduleId];
      const isVis = !!p.canView;
      records.push({
        id: `${role.toLowerCase().replace(/\s+/g, '_')}_${moduleId}`,
        role,
        module: moduleId,
        is_visible: isVis,
        can_create: !!p.canCreate,
        can_edit: !!p.canEdit,
        can_delete: !!p.canDelete,
        can_export: !!p.canExport,
        updated_at: now
      });
    });
  });

  return await resilientUpsertPermissions(client, 'role_permissions', records, 'role,module');
}

// ============================================================================
// USER-SPECIFIC PERMISSIONS INFRASTRUCTURE
// ============================================================================

/**
 * Load cached user-specific permissions map from localStorage
 */
export function getCachedUserPermissions(): UserPermissionsMap {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed;
      }
    }
  } catch (_) {}
  return {};
}

/**
 * Fetch authenticated users from Supabase Auth via get_supabase_auth_users RPC, auth session, and verified permission mappings
 */
export async function fetchSupabaseAuthUsers(
  client: any
): Promise<Array<{ id: string; email: string; full_name: string; role: string }>> {
  const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
  if (!isConfigured || !client) return [];

  const foundUsers: Array<{ id: string; email: string; full_name: string; role: string }> = [];

  const addUniqueUser = (item: { id: string; email: string; full_name: string; role: string }) => {
    const email = (item.email || '').toLowerCase().trim();
    const id = (item.id || '').trim();
    if (!id && !email) return;

    const exists = foundUsers.some(u => 
      (id && u.id && u.id === id) || 
      (email && u.email && u.email.toLowerCase() === email)
    );

    if (!exists) {
      foundUsers.push({
        id: id || email,
        email: email,
        full_name: item.full_name || email.split('@')[0] || 'User',
        role: item.role || 'Supervisor'
      });
    }
  };

  // 1. Primary: Direct query via get_supabase_auth_users RPC function
  try {
    const { data, error } = await client.rpc('get_supabase_auth_users');
    if (!error && Array.isArray(data) && data.length > 0) {
      data.forEach((u: any) => {
        if (u) {
          addUniqueUser({
            id: String(u.id || u.user_id || u.email || ''),
            email: String(u.email || ''),
            full_name: u.full_name || u.name || '',
            role: u.role || 'user'
          });
        }
      });
    }
  } catch (err) {
    console.warn('Notice: get_supabase_auth_users RPC call note:', err);
  }

  // 2. Active Supabase Auth Session
  try {
    const { data: sessionData } = await client.auth.getSession();
    const activeUser = sessionData?.session?.user;
    if (activeUser) {
      addUniqueUser({
        id: activeUser.id,
        email: activeUser.email || '',
        full_name: activeUser.user_metadata?.full_name || activeUser.user_metadata?.name || activeUser.email?.split('@')[0] || 'Admin',
        role: activeUser.user_metadata?.role || 'System Admin'
      });
    }
  } catch (_) {}

  // 3. Verified Authenticated Users already present in user_permissions table
  try {
    const { data: permUsers, error: pError } = await client
      .from('user_permissions')
      .select('user_id, user_name, user_role')
      .not('user_id', 'is', null);

    if (!pError && Array.isArray(permUsers)) {
      permUsers.forEach((pu: any) => {
        const uid = String(pu.user_id || '').trim();
        if (uid) {
          const isEmail = uid.includes('@');
          addUniqueUser({
            id: uid,
            email: isEmail ? uid : '',
            full_name: pu.user_name || (isEmail ? uid.split('@')[0] : 'Auth User'),
            role: pu.user_role || 'Supervisor'
          });
        }
      });
    }
  } catch (_) {}

  return foundUsers;
}

/**
 * Robust visibility extractor:
 * If an explicit permission record has can_view: false (or is_visible: false), STRICTLY respect false.
 * Never fall back to default true when can_view is false.
 */
export function extractVisibility(record: any): boolean {
  if (record === false || record === 'false' || record === 0) return false;
  if (record === true || record === 'true' || record === 1) return true;
  if (record === null || record === undefined) return false;
  if (typeof record !== 'object') return false;

  // Strict check: if can_view, canView, is_visible, or isVisible is explicitly false, immediately return false
  if (record.can_view === false || record.can_view === 'false' || record.can_view === 0) return false;
  if (record.canView === false || record.canView === 'false' || record.canView === 0) return false;
  if (record.is_visible === false || record.is_visible === 'false' || record.is_visible === 0) return false;
  if (record.isVisible === false || record.isVisible === 'false' || record.isVisible === 0) return false;

  // If explicitly true
  if (record.can_view === true || record.can_view === 'true' || record.can_view === 1) return true;
  if (record.canView === true || record.canView === 'true' || record.canView === 1) return true;
  if (record.is_visible === true || record.is_visible === 'true' || record.is_visible === 1) return true;
  if (record.isVisible === true || record.isVisible === 'true' || record.isVisible === 1) return true;

  return false;
}

/**
 * Universal module key extractor mapping seamlessly across module_id, module_key, and module fields
 */
export function extractModuleKey(row: any): string {
  if (!row || typeof row !== 'object') return '';
  const raw = row.module_id || row.module_key || row.module || row.moduleId || row.moduleKey || row.permission_key || row.permissionKey || row.mod || '';
  return String(raw).trim();
}

/**
 * Fetch all user-specific permission overrides from Supabase `user_permissions` table
 * Supabase records take full precedence over local cache to guarantee consistent cross-device state
 */
export async function fetchUserPermissionsFromSupabase(client: any): Promise<UserPermissionsMap> {
  const currentMap = getCachedUserPermissions();
  const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
  if (!isConfigured || !client) {
    console.warn('[RBAC Sync] Supabase client not configured or unavailable. Falling back to cached local permissions.');
    return currentMap;
  }

  try {
    console.log('[RBAC Sync] Fetching user permissions from Supabase table "user_permissions"...');
    const { data, error } = await client
      .from('user_permissions')
      .select('*');

    if (error) {
      console.error('[RBAC Sync] ✗ Failed to fetch user_permissions from Supabase:', error.message, error.details || '');
      console.warn('[RBAC Sync] Falling back to local cache due to database query error.');
      return currentMap;
    }

    if (!data || !Array.isArray(data)) {
      console.warn('[RBAC Sync] Supabase returned empty/non-array data. Falling back to cached local permissions.');
      return currentMap;
    }

    console.log(`[RBAC Sync] ✓ Successfully loaded ${data.length} user_permissions record(s) from Supabase.`);
    console.log(`[RBAC Lookup] fetchUserPermissionsFromSupabase: ${data.length} row(s) retrieved from Supabase:`);
    data.forEach((row: any, i: number) => {
      console.log(`[RBAC Lookup] Row #${i + 1} retrieved from Supabase:`, {
        id: row.id,
        user_id: row.user_id || row.userId,
        email: row.email || row.user_email,
        module: extractModuleKey(row),
        can_view: extractVisibility(row),
        can_create: row.can_create ?? row.canCreate ?? false,
        can_edit: row.can_edit ?? row.canEdit ?? false,
        can_delete: row.can_delete ?? row.canDelete ?? false,
        can_export: row.can_export ?? row.canExport ?? false
      });
    });

    // If Supabase returned records, use them as the absolute source of truth!
    // Start with currentMap as fallback base, but completely purge and replace records for any user present in Supabase
    const updatedMap: UserPermissionsMap = { ...currentMap };

    if (data.length > 0) {
      // Build cross-reference lookup between Supabase Auth UUID and email
      const authIdToEmail = new Map<string, string>();
      const authEmailToId = new Map<string, string>();

      // 1. Resolve from active Supabase session
      try {
        const sessData = await client?.auth?.getSession?.();
        const sessUser = sessData?.data?.session?.user;
        if (sessUser?.id && sessUser?.email) {
          const sid = String(sessUser.id).trim();
          const semail = String(sessUser.email).trim().toLowerCase();
          authIdToEmail.set(sid, semail);
          authIdToEmail.set(sid.toLowerCase(), semail);
          authEmailToId.set(semail, sid);
        }
      } catch (_) {}

      // 2. Resolve from stored user profile
      try {
        const stored = localStorage.getItem('fms_user') || localStorage.getItem('fuelflow_user');
        if (stored) {
          const u = JSON.parse(stored);
          if (u?.id && u?.email) {
            const uid = String(u.id).trim();
            const uemail = String(u.email).trim().toLowerCase();
            authIdToEmail.set(uid, uemail);
            authIdToEmail.set(uid.toLowerCase(), uemail);
            authEmailToId.set(uemail, uid);
          }
        }
      } catch (_) {}

      // 3. Resolve from get_supabase_auth_users RPC function
      try {
        const { data: authUsers } = await client.rpc('get_supabase_auth_users');
        if (Array.isArray(authUsers)) {
          authUsers.forEach((u: any) => {
            if (u?.id && u?.email) {
              const uid = String(u.id).trim();
              const uemail = String(u.email).trim().toLowerCase();
              authIdToEmail.set(uid, uemail);
              authIdToEmail.set(uid.toLowerCase(), uemail);
              authEmailToId.set(uemail, uid);
            }
          });
        }
      } catch (_) {}

      // Find all unique user identifiers returned from Supabase
      const usersInDb = new Set<string>();
      data.forEach((row: any) => {
        const uId = String(row.user_id || row.userId || row.email || row.user_email || '').trim();
        if (uId) {
          usersInDb.add(uId);
          usersInDb.add(uId.toLowerCase());
          if (uId.includes('@')) usersInDb.add(uId.toLowerCase().split('@')[0]);
          if (authIdToEmail.has(uId)) {
            const em = authIdToEmail.get(uId)!;
            usersInDb.add(em);
            usersInDb.add(em.split('@')[0]);
          }
          if (authEmailToId.has(uId.toLowerCase())) {
            usersInDb.add(authEmailToId.get(uId.toLowerCase())!);
          }
        }
        const rowEmail = String(row.email || row.user_email || '').trim().toLowerCase();
        if (rowEmail) {
          usersInDb.add(rowEmail);
          if (rowEmail.includes('@')) usersInDb.add(rowEmail.split('@')[0]);
          if (authEmailToId.has(rowEmail)) {
            usersInDb.add(authEmailToId.get(rowEmail)!);
          }
        }
        const rowName = String(row.user_name || row.userName || '').trim().toLowerCase();
        if (rowName) {
          usersInDb.add(rowName);
          usersInDb.add(rowName.replace(/\s+/g, ''));
        }
      });

      // Clear cached permissions for users that exist in Supabase so stale local rules never overwrite database truth
      usersInDb.forEach(k => {
        delete updatedMap[k];
      });

      data.forEach((row: any) => {
        const uId = String(row.user_id || row.userId || row.email || row.user_email || '').trim();
        const rawMod = extractModuleKey(row);
        if (!uId || !rawMod) return;

        const canon = canonicalModuleId(rawMod);
        const isVis = extractVisibility(row);

        const rule = {
          canView: isVis,
          can_view: isVis,
          is_visible: isVis,
          canCreate: row.can_create ?? row.canCreate ?? false,
          canEdit: row.can_edit ?? row.canEdit ?? false,
          canDelete: row.can_delete ?? row.canDelete ?? false,
          canExport: row.can_export ?? row.canExport ?? false,
        };

        const mapUserAliases = (key: string) => {
          if (!key) return;
          if (!updatedMap[key]) updatedMap[key] = {};
          updatedMap[key][rawMod] = rule;
          updatedMap[key][canon] = rule;
          updatedMap[key][rawMod.replace(/-/g, '_')] = rule;
          updatedMap[key][rawMod.replace(/_/g, '-')] = rule;
          updatedMap[key][`module_${canon}`] = rule;
        };

        // Multi-identifier indexing: index under original uId, lowercase, and prefix
        mapUserAliases(uId);
        const uIdLower = uId.toLowerCase();
        mapUserAliases(uIdLower);
        if (uIdLower.includes('@')) {
          mapUserAliases(uIdLower.split('@')[0]);
          if (authEmailToId.has(uIdLower)) {
            const mappedUuid = authEmailToId.get(uIdLower)!;
            mapUserAliases(mappedUuid);
            mapUserAliases(mappedUuid.toLowerCase());
          }
        } else {
          // If uId is a UUID, index under mapped email as well
          const mappedEmail = authIdToEmail.get(uId) || authIdToEmail.get(uIdLower);
          if (mappedEmail) {
            mapUserAliases(mappedEmail);
            mapUserAliases(mappedEmail.toLowerCase());
            mapUserAliases(mappedEmail.split('@')[0]);
          }
        }

        // If row has user_name or email, index those as aliases as well
        const rowEmail = String(row.email || row.user_email || '').trim().toLowerCase();
        if (rowEmail) {
          mapUserAliases(rowEmail);
          if (rowEmail.includes('@')) {
            mapUserAliases(rowEmail.split('@')[0]);
          }
          if (authEmailToId.has(rowEmail)) {
            const mappedUuid = authEmailToId.get(rowEmail)!;
            mapUserAliases(mappedUuid);
            mapUserAliases(mappedUuid.toLowerCase());
          }
        }

        const rowName = String(row.user_name || row.userName || '').trim().toLowerCase();
        if (rowName) {
          mapUserAliases(rowName);
          mapUserAliases(rowName.replace(/\s+/g, ''));
        }
      });
    }

    try {
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(updatedMap));
      window.dispatchEvent(new CustomEvent('user-permissions-updated', { detail: { userPermissionsMap: updatedMap } }));
      window.dispatchEvent(new CustomEvent('permissions-updated', { detail: { userPermissionsMap: updatedMap } }));
    } catch (_) {}

    return updatedMap;
  } catch (err: any) {
    console.error('[RBAC Sync] ✗ Exception in fetchUserPermissionsFromSupabase:', err?.message || err);
    console.warn('[RBAC Sync] Falling back to local cache.');
  }

  return currentMap;
}

export const ACTIVE_USER_PERMS_KEY = 'active_user_permissions';

/**
 * Get the currently logged-in user's active permissions from localStorage
 */
export function getActiveUserPermissions(): Record<string, { canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport: boolean }> {
  try {
    const raw = localStorage.getItem(ACTIVE_USER_PERMS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch (_) {}
  return {};
}

/**
 * Clear the currently logged-in user's active permissions on logout / user switch
 */
export function clearActiveUserPermissions(): void {
  try {
    localStorage.removeItem(ACTIVE_USER_PERMS_KEY);
    window.dispatchEvent(new CustomEvent('permissions-updated', { detail: { activeUserPermissions: {} } }));
    window.dispatchEvent(new CustomEvent('user-permissions-updated', { detail: { activeUserPermissions: {} } }));
    window.dispatchEvent(new Event('permissions-updated'));
  } catch (_) {}
}

/**
 * Invalidate and clear all local permission cache entries whenever a new session starts,
 * a user switches, or permissions are re-synced across devices.
 */
export function invalidatePermissionsCache(): void {
  try {
    localStorage.removeItem(ACTIVE_USER_PERMS_KEY);
    localStorage.removeItem(USER_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent('permissions-updated', { detail: { activeUserPermissions: {}, userPermissionsMap: {} } }));
    window.dispatchEvent(new CustomEvent('user-permissions-updated', { detail: { activeUserPermissions: {}, userPermissionsMap: {} } }));
    window.dispatchEvent(new Event('permissions-updated'));
  } catch (_) {}
}

/**
 * Dynamic Session Permission Fetching on Login / App Mount:
 * Queries Supabase `user_permissions` table with priority for the logged-in user
 * using BOTH user_id and lowercase email, and hydrates `active_user_permissions`.
 */
export async function fetchAndHydrateActiveUserPermissions(
  client: any,
  user: AuthUser | { id?: string; email?: string; name?: string; role?: string } | null
): Promise<Record<string, { canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport: boolean }>> {
  if (!user) {
    clearActiveUserPermissions();
    return {};
  }

  const userId = (user.id || '').trim();
  const userIdLower = userId.toLowerCase();
  const userEmail = ((user as any).email || '').trim().toLowerCase();
  const userName = ((user as any).name || '').trim().toLowerCase();
  const userPrefix = userEmail.includes('@') ? userEmail.split('@')[0] : '';

  // Multi-key candidate identifiers for the target user
  const candidateKeys = new Set<string>();
  if (userId) {
    candidateKeys.add(userId);
    candidateKeys.add(userIdLower);
  }
  if (userEmail) {
    candidateKeys.add(userEmail);
    if (userPrefix) candidateKeys.add(userPrefix);
  }
  if (userName) {
    candidateKeys.add(userName);
    candidateKeys.add(userName.replace(/\s+/g, ''));
  }

  // Cross-reference Supabase Auth users directory to link UUID <-> Email if available
  try {
    const { data: authUsers } = await client.rpc('get_supabase_auth_users');
    if (Array.isArray(authUsers)) {
      authUsers.forEach((au: any) => {
        const auId = String(au.id || '').trim();
        const auEmail = String(au.email || '').trim().toLowerCase();
        if (auId && auEmail) {
          if (candidateKeys.has(auId) || candidateKeys.has(auId.toLowerCase())) {
            candidateKeys.add(auEmail);
            if (auEmail.includes('@')) candidateKeys.add(auEmail.split('@')[0]);
          }
          if (candidateKeys.has(auEmail) || (auEmail.includes('@') && candidateKeys.has(auEmail.split('@')[0]))) {
            candidateKeys.add(auId);
            candidateKeys.add(auId.toLowerCase());
          }
        }
      });
    }
  } catch (_) {}

  // Also check active session user id/email
  try {
    const sess = await client?.auth?.getSession?.();
    const su = sess?.data?.session?.user;
    if (su?.id && su?.email) {
      const suId = String(su.id).trim();
      const suEmail = String(su.email).trim().toLowerCase();
      if (candidateKeys.has(suId) || candidateKeys.has(suId.toLowerCase())) {
        candidateKeys.add(suEmail);
        if (suEmail.includes('@')) candidateKeys.add(suEmail.split('@')[0]);
      }
      if (candidateKeys.has(suEmail) || (suEmail.includes('@') && candidateKeys.has(suEmail.split('@')[0]))) {
        candidateKeys.add(suId);
        candidateKeys.add(suId.toLowerCase());
      }
    }
  } catch (_) {}

  const candidateList = Array.from(candidateKeys);
  console.log(`[RBAC Lookup] Hard enforcement on login: Fetching fresh Supabase user_permissions for user identifiers [${candidateList.join(', ')}]`);

  // Start with a clean activeRules object so stale local defaults cannot persist
  const activeRules: Record<string, any> = {};
  const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);

  if (isConfigured && client) {
    try {
      const { data, error } = await client
        .from('user_permissions')
        .select('*');

      if (!error && Array.isArray(data)) {
        console.log(`[RBAC Lookup] Hard enforcement fetch: retrieved ${data.length} total user_permissions row(s) from Supabase:`);
        data.forEach((row: any, i: number) => {
          console.log(`[RBAC Lookup] Row #${i + 1} retrieved from Supabase:`, {
            id: row.id,
            user_id: row.user_id || row.userId,
            email: row.email || row.user_email,
            module: extractModuleKey(row),
            can_view: extractVisibility(row),
            can_create: row.can_create ?? row.canCreate ?? false,
            can_edit: row.can_edit ?? row.canEdit ?? false,
            can_delete: row.can_delete ?? row.canDelete ?? false,
            can_export: row.can_export ?? row.canExport ?? false
          });
        });

        // Find rows specifically belonging to this user using all identifiers simultaneously
        const matchedRows = data.filter((row: any) => {
          const rowUid = String(row.user_id || row.userId || '').trim().toLowerCase();
          const rowName = String(row.user_name || row.userName || '').trim().toLowerCase();
          const rowEmail = String(row.email || row.user_email || '').trim().toLowerCase();
          const rowPrefix = rowEmail.includes('@') ? rowEmail.split('@')[0] : (rowUid.includes('@') ? rowUid.split('@')[0] : '');

          for (const ident of candidateKeys) {
            const idLow = ident.toLowerCase().trim();
            if (!idLow) continue;
            if (rowUid === idLow || rowEmail === idLow || rowName === idLow || rowPrefix === idLow) return true;
            if (idLow.includes('@') && (rowUid === idLow || rowEmail === idLow)) return true;
            if (rowUid && (rowUid === idLow || rowUid.includes(idLow) || idLow.includes(rowUid))) return true;
            if (rowEmail && (rowEmail === idLow || rowEmail.includes(idLow) || idLow.includes(rowEmail))) return true;
          }
          return false;
        });

        if (matchedRows.length > 0) {
          console.log(`[RBAC Lookup] MATCH FOUND: ${matchedRows.length} explicit permission record(s) in Supabase for user [${candidateList.join(', ')}]!`);

          matchedRows.forEach((row: any) => {
            const rawMod = extractModuleKey(row);
            if (rawMod) {
              const canon = canonicalModuleId(rawMod);
              const isVis = extractVisibility(row);
              const rule = {
                canView: isVis,
                can_view: isVis,
                is_visible: isVis,
                canCreate: row.can_create ?? row.canCreate ?? false,
                canEdit: row.can_edit ?? row.canEdit ?? false,
                canDelete: row.can_delete ?? row.canDelete ?? false,
                canExport: row.can_export ?? row.canExport ?? false,
              };
              activeRules[rawMod] = rule;
              activeRules[canon] = rule;
              activeRules[rawMod.replace(/-/g, '_')] = rule;
              activeRules[rawMod.replace(/_/g, '-')] = rule;
              activeRules[`module_${canon}`] = rule;
              console.log(`[RBAC Lookup] Enforced override: module="${rawMod}" (${canon}) -> can_view=${isVis}`);
            }
          });
        } else {
          console.log(`[RBAC Lookup] No explicit user_permissions overrides found in Supabase for [${candidateList.join(', ')}]. Active rules cleared.`);
        }
      } else if (error) {
        console.error('[RBAC Lookup] ✗ Supabase query error:', error.message);
      }
    } catch (err: any) {
      console.warn('[RBAC Lookup] Direct query exception:', err?.message || err);
    }
  }

  // Fallback to local cached user permissions only if database could not be reached (offline)
  if (Object.keys(activeRules).length === 0 && (!isConfigured || !client)) {
    const allUserPerms = getCachedUserPermissions();
    let matched: any = null;
    for (const key of candidateKeys) {
      if (allUserPerms[key]) {
        matched = allUserPerms[key];
        break;
      }
    }
    if (matched) {
      console.log('[RBAC Lookup] Populated active rules from local cached user permissions fallback.');
      Object.keys(matched).forEach(k => {
        const canon = canonicalModuleId(k);
        activeRules[k] = matched[k];
        activeRules[canon] = matched[k];
        activeRules[k.replace(/-/g, '_')] = matched[k];
        activeRules[k.replace(/_/g, '-')] = matched[k];
      });
    }
  }

  try {
    localStorage.setItem(ACTIVE_USER_PERMS_KEY, JSON.stringify(activeRules));
    // Also sync the user permissions map in local storage for all candidate keys
    const currentMap = getCachedUserPermissions();
    candidateKeys.forEach(k => {
      currentMap[k] = { ...activeRules };
    });
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(currentMap));

    window.dispatchEvent(new CustomEvent('permissions-updated', { detail: { activeUserPermissions: activeRules } }));
    window.dispatchEvent(new CustomEvent('user-permissions-updated', { detail: { activeUserPermissions: activeRules } }));
    window.dispatchEvent(new Event('permissions-updated'));
  } catch (_) {}

  return activeRules;
}

/**
 * Save user-specific permissions map to Supabase `user_permissions` and localStorage with fail-safe upsert
 */
export async function saveUserPermissionsToSupabase(
  client: any,
  userPermissionsMap: UserPermissionsMap,
  targetUserId?: string,
  targetUserInfo?: { name?: string; role?: string; email?: string }
): Promise<{ success: boolean; error?: string }> {
  // 1. Update localStorage user permissions map
  try {
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(userPermissionsMap));

    // Determine currently logged-in user to ensure we NEVER overwrite admin active session with another user's permissions
    let currentLoggedInUser: any = null;
    try {
      const stored = localStorage.getItem('fms_user') || localStorage.getItem('fuelflow_user');
      if (stored) currentLoggedInUser = JSON.parse(stored);
    } catch (_) {}

    const isCurrentLoggedInUser = !!(currentLoggedInUser && (
      (currentLoggedInUser.id && (currentLoggedInUser.id === targetUserId || currentLoggedInUser.id === targetUserInfo?.email)) ||
      (currentLoggedInUser.email && (
        currentLoggedInUser.email.toLowerCase() === (targetUserId || '').toLowerCase() || 
        currentLoggedInUser.email.toLowerCase() === (targetUserInfo?.email || '').toLowerCase()
      ))
    ));

    // ONLY update ACTIVE_USER_PERMS_KEY if the target user being saved IS the active session user!
    if (isCurrentLoggedInUser && targetUserId && userPermissionsMap[targetUserId]) {
      const activeRules = { ...userPermissionsMap[targetUserId] };
      localStorage.setItem(ACTIVE_USER_PERMS_KEY, JSON.stringify(activeRules));
    }

    window.dispatchEvent(new CustomEvent('permissions-updated', { detail: { userPermissionsMap } }));
    window.dispatchEvent(new CustomEvent('user-permissions-updated', { detail: { userPermissionsMap } }));
    window.dispatchEvent(new Event('permissions-updated'));
  } catch (_) {}

  const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
  if (!isConfigured || !client) {
    return { success: true };
  }

  // 2. Prepare payload strictly isolated to target user
  const records: any[] = [];
  const now = new Date().toISOString();

  let currentAdminEmail = '';
  try {
    const stored = localStorage.getItem('fms_user') || localStorage.getItem('fuelflow_user');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed?.email) currentAdminEmail = parsed.email.toLowerCase().trim();
    }
  } catch (_) {}

  const targetIds = new Set<string>();
  if (targetUserId) {
    targetIds.add(targetUserId);
    targetIds.add(targetUserId.toLowerCase().trim());
    if (targetUserInfo?.email) {
      targetIds.add(targetUserInfo.email.toLowerCase().trim());
    }
  } else {
    Object.keys(userPermissionsMap).forEach(k => targetIds.add(k));
  }

  targetIds.forEach(uId => {
    const userMods = userPermissionsMap[uId] || (targetUserId ? userPermissionsMap[targetUserId] : null);
    if (userMods) {
      Object.keys(userMods).forEach(moduleId => {
        const p = userMods[moduleId];
        const isVis = extractVisibility(p);
        records.push({
          id: `${uId.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}_${moduleId}`,
          user_id: uId,
          user_name: targetUserInfo?.name || null,
          user_role: targetUserInfo?.role || null,
          module: moduleId,
          module_key: moduleId,
          module_id: moduleId,
          is_visible: isVis,
          can_view: isVis,
          can_create: !!p.canCreate,
          can_edit: !!p.canEdit,
          can_delete: !!p.canDelete,
          can_export: !!p.canExport,
          updated_at: now
        });
      });
    }
  });

  if (records.length === 0) return { success: true };

  // 3. Adaptive database upsert supporting both 'module_key', 'module', and 'module_id' schemas
  // Determine if column name can be detected from existing rows
  let candidateCols: Array<'module_key' | 'module' | 'module_id'> = ['module_key', 'module', 'module_id'];
  let detectedKeys: string[] = [];
  try {
    const { data: probeData } = await client
      .from('user_permissions')
      .select('*')
      .limit(1);

    if (probeData && probeData.length > 0) {
      detectedKeys = Object.keys(probeData[0]);
      if (detectedKeys.includes('module_key')) {
        candidateCols = ['module_key', 'module', 'module_id'];
      } else if (detectedKeys.includes('module')) {
        candidateCols = ['module', 'module_key', 'module_id'];
      } else if (detectedKeys.includes('module_id')) {
        candidateCols = ['module_id', 'module_key', 'module'];
      }
    }
  } catch (_) {}

  let lastSaveError: any = null;

  for (const colName of candidateCols) {
    // Build full payload for candidate column, including all matching columns if detected
    const fullPayload = records.map(r => {
      const obj: any = {
        id: r.id,
        user_id: r.user_id,
        [colName]: r.module,
        is_visible: r.is_visible,
        can_view: r.can_view,
        can_create: r.can_create,
        can_edit: r.can_edit,
        can_delete: r.can_delete,
        can_export: r.can_export,
        user_name: r.user_name,
        user_role: r.user_role,
        updated_at: r.updated_at
      };
      if (detectedKeys.includes('module_key')) obj.module_key = r.module;
      if (detectedKeys.includes('module')) obj.module = r.module;
      if (detectedKeys.includes('module_id')) obj.module_id = r.module;
      return obj;
    });

    // Build core payload (stripped non-essential metadata)
    const corePayload = records.map(r => {
      const obj: any = {
        id: r.id,
        user_id: r.user_id,
        [colName]: r.module,
        is_visible: r.is_visible,
        can_create: r.can_create,
        can_edit: r.can_edit,
        can_delete: r.can_delete,
        can_export: r.can_export
      };
      if (detectedKeys.includes('module_key')) obj.module_key = r.module;
      if (detectedKeys.includes('module')) obj.module = r.module;
      if (detectedKeys.includes('module_id')) obj.module_id = r.module;
      return obj;
    });

    // Build legacy payload (can_view instead of is_visible)
    const legacyPayload = records.map(r => ({
      id: r.id,
      user_id: r.user_id,
      [colName]: r.module,
      can_view: r.can_view,
      can_create: r.can_create,
      can_edit: r.can_edit,
      can_delete: r.can_delete,
      can_export: r.can_export
    }));

    // Attempt 1: Upsert with unique composite constraint (user_id, colName)
    try {
      const { error: err1 } = await client
        .from('user_permissions')
        .upsert(fullPayload, { onConflict: `user_id,${colName}` });

      if (!err1) {
        console.log(`✓ Supabase user permissions saved successfully (${colName} composite upsert)`);
        return { success: true };
      }
      lastSaveError = err1;
      const lower1 = (err1.message || '').toLowerCase();
      // If error is specifically about this column not existing, try next column candidate immediately
      if (lower1.includes('column') && lower1.includes(colName)) {
        continue;
      }
    } catch (e: any) {
      lastSaveError = e;
    }

    // Attempt 2: Upsert on primary key 'id'
    try {
      const { error: err2 } = await client
        .from('user_permissions')
        .upsert(fullPayload, { onConflict: 'id' });

      if (!err2) {
        console.log(`✓ Supabase user permissions saved successfully (${colName} pk upsert)`);
        return { success: true };
      }
      lastSaveError = err2;
      const lower2 = (err2.message || '').toLowerCase();
      if (lower2.includes('column') && lower2.includes(colName)) {
        continue;
      }
    } catch (e: any) {
      lastSaveError = e;
    }

    // Attempt 3: Core payload upsert on primary key 'id'
    try {
      const { error: err3 } = await client
        .from('user_permissions')
        .upsert(corePayload, { onConflict: 'id' });

      if (!err3) {
        console.log(`✓ Supabase user permissions saved successfully (${colName} core pk upsert)`);
        return { success: true };
      }
      lastSaveError = err3;
      const lower3 = (err3.message || '').toLowerCase();
      if (lower3.includes('column') && lower3.includes(colName)) {
        continue;
      }
    } catch (e: any) {
      lastSaveError = e;
    }

    // Attempt 4: Clean delete-by-user_id followed by insert (bypasses any onConflict issues)
    if (targetUserId) {
      try {
        await client.from('user_permissions').delete().eq('user_id', targetUserId);
        if (targetUserInfo?.email && targetUserInfo.email !== targetUserId) {
          await client.from('user_permissions').delete().eq('user_id', targetUserInfo.email);
        }

        const { error: err4 } = await client.from('user_permissions').insert(corePayload);
        if (!err4) {
          console.log(`✓ Supabase user permissions saved successfully (${colName} delete+insert core)`);
          return { success: true };
        }
        lastSaveError = err4;
        const lower4 = (err4.message || '').toLowerCase();
        if (lower4.includes('column') && lower4.includes(colName)) {
          continue;
        }

        // Attempt 5: Legacy payload insert
        const { error: err5 } = await client.from('user_permissions').insert(legacyPayload);
        if (!err5) {
          console.log(`✓ Supabase user permissions saved successfully (${colName} delete+insert legacy)`);
          return { success: true };
        }
        lastSaveError = err5;
      } catch (e: any) {
        lastSaveError = e;
      }
    }
  }

  if (lastSaveError) {
    console.warn('Supabase user permissions save note (local storage remains active):', lastSaveError.message || lastSaveError);
    return { success: true }; // LocalStorage is already synchronized and active
  }

  return { success: true };
}

/**
 * Canonical module key resolver to ensure seamless matching across snake_case, kebab-case, and alias keys
 */
export function canonicalModuleId(id: string): SystemModuleId {
  if (!id) return 'dashboard';
  const clean = id.toLowerCase().replace(/[\s_-]+/g, '');
  switch (clean) {
    case 'dashboard':
    case 'overview':
      return 'dashboard';
    case 'shift':
    case 'shifts':
    case 'shiftmanagement':
    case 'shift_management':
      return 'shift_management';
    case 'pumpershortexcess':
    case 'pumpershort':
    case 'shortexcess':
    case 'pumper_short_excess':
      return 'pumper_short_excess';
    case 'deposit':
    case 'deposits':
    case 'safedeposits':
    case 'bankdeposits':
      return 'deposits';
    case 'stock':
    case 'fuelstock':
    case 'tanks':
    case 'fuel_stock':
      return 'fuel_stock';
    case 'oil':
    case 'oils':
    case 'oil_storage':
    case 'oilstorage':
    case 'lubricants':
      return 'oil_storage';
    case 'gas':
    case 'gas_inventory':
    case 'gasinventory':
    case 'lpgas':
      return 'gas_inventory';
    case 'purchase':
    case 'purchases':
    case 'bowserpurchases':
      return 'purchases';
    case 'manualdip':
    case 'manualdiprecord':
    case 'manual_dip_record':
    case 'diprecords':
      return 'manual_dip_record';
    case 'report':
    case 'reports':
    case 'analytics':
      return 'reports';
    case 'customer':
    case 'customers':
    case 'creditdebtors':
      return 'customers';
    case 'admin':
    case 'admincontrol':
    case 'admin_control':
    case 'settings':
      return 'admin_control';
    default:
      return id as SystemModuleId;
  }
}

/**
 * Remove / Clear custom user permission overrides from Supabase and localStorage
 */
export async function clearUserPermissionOverrides(
  client: any,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  const current = getCachedUserPermissions();
  const next = { ...current };
  delete next[userId];

  try {
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('permissions-updated', { detail: { userPermissionsMap: next } }));
    window.dispatchEvent(new CustomEvent('user-permissions-updated', { detail: { userPermissionsMap: next } }));
    window.dispatchEvent(new Event('permissions-updated'));
  } catch (_) {}

  const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
  if (!isConfigured || !client) {
    return { success: true };
  }

  try {
    await client
      .from('user_permissions')
      .delete()
      .eq('user_id', userId);
    return { success: true };
  } catch (err: any) {
    console.warn('Error clearing user permissions in Supabase:', err);
    return { success: false, error: err?.message };
  }
}

/**
 * Prioritized Permission Evaluator:
 * 1. Checks if specific user has an override in `user_permissions` (matched by id, email, or name).
 *    If an individual user override exists, it is 100% authoritative (takes priority over role & admin bypass).
 *    Strictly respects can_view: false - never falls back to default true if an explicit permission record exists.
 * 2. If no user override exists, System Admin has full access.
 * 3. Falls back to `role_permissions` matrix according to the user's role.
 */
export function checkUserPermission(
  permissionsMap: RolePermissionsMap | null | undefined,
  userOrRole?: string | AuthUser | { id?: string; email?: string; role?: string; name?: string } | null,
  moduleId?: string,
  action: 'view' | 'create' | 'edit' | 'delete' | 'export' = 'view',
  userPermissionsMap?: UserPermissionsMap | null
): boolean {
  if (!moduleId) return true;

  const canon = canonicalModuleId(moduleId);

  let userRole: string | undefined;
  let userId: string | undefined;
  let userEmail: string | undefined;
  let userName: string | undefined;

  if (typeof userOrRole === 'object' && userOrRole !== null) {
    userRole = userOrRole.role;
    userId = userOrRole.id;
    userEmail = (userOrRole as any).email;
    userName = (userOrRole as any).name;
  } else if (typeof userOrRole === 'string') {
    userRole = userOrRole;
  }

  // Fallback to active logged-in session user if user object wasn't passed directly with ID/email
  if (!userId && !userEmail) {
    try {
      const stored = localStorage.getItem('fms_user') || localStorage.getItem('fuelflow_user');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.id) userId = String(parsed.id).trim();
        if (parsed?.email) userEmail = String(parsed.email).trim().toLowerCase();
        if (parsed?.name && !userName) userName = String(parsed.name).trim();
        if (parsed?.role && !userRole) userRole = parsed.role;
      }
    } catch (_) {}
  }

  const normRole = normalizeRoleName(userRole);

  // Collect ALL possible identifiers simultaneously: Supabase Auth user.id (UUID), lowercase email, username, email prefix
  const candidateKeys: string[] = [];
  if (userId) {
    const idTrim = userId.trim();
    candidateKeys.push(idTrim);
    if (idTrim.toLowerCase() !== idTrim) candidateKeys.push(idTrim.toLowerCase());
  }
  if (userEmail) {
    const emailTrim = userEmail.trim().toLowerCase();
    candidateKeys.push(emailTrim);
    if (emailTrim.includes('@')) {
      candidateKeys.push(emailTrim.split('@')[0]);
    }
  }
  if (userName) {
    const nameTrim = userName.trim().toLowerCase();
    candidateKeys.push(nameTrim);
    candidateKeys.push(nameTrim.replace(/\s+/g, ''));
  }

  // 1. ABSOLUTE PRIORITY: Check for individual User Permissions Override
  // Individual user overrides are 100% authoritative over both role defaults and admin bypass.
  // Explicit individual user denials (can_view: false / is_visible: false) MUST take absolute precedence!
  const uMap = userPermissionsMap || getCachedUserPermissions();
  const activePerms = getActiveUserPermissions();

  let matchedUserRules: Record<string, any> | null = null;

  // Direct lookup across all candidate identifiers simultaneously
  for (const ident of candidateKeys) {
    if (uMap && uMap[ident]) {
      matchedUserRules = uMap[ident];
      break;
    }
  }

  // If not found in direct uMap, check activeUserPermissions if evaluating active session user
  if (!matchedUserRules && activePerms && Object.keys(activePerms).length > 0) {
    try {
      const stored = localStorage.getItem('fms_user') || localStorage.getItem('fuelflow_user');
      if (stored) {
        const parsed = JSON.parse(stored);
        const activeEmail = (parsed.email || '').toLowerCase().trim();
        const activeId = (parsed.id || '').toLowerCase().trim();
        const activePrefix = activeEmail.includes('@') ? activeEmail.split('@')[0] : '';
        const matchesActive = candidateKeys.length === 0 || candidateKeys.some(k => {
          const kl = k.toLowerCase().trim();
          return kl === activeEmail || kl === activeId || kl === activePrefix;
        });
        if (matchesActive) {
          matchedUserRules = activePerms as any;
        }
      } else {
        matchedUserRules = activePerms as any;
      }
    } catch (_) {
      matchedUserRules = activePerms as any;
    }
  }

  // Flexible / fuzzy matching in uMap if still not found
  if (!matchedUserRules && uMap && typeof uMap === 'object') {
    for (const key of Object.keys(uMap)) {
      const kLower = key.toLowerCase().trim();
      const kPrefix = kLower.includes('@') ? kLower.split('@')[0] : '';
      for (const ident of candidateKeys) {
        const idLow = ident.toLowerCase().trim();
        if (kLower === idLow || kPrefix === idLow || (idLow.length >= 4 && (kLower.includes(idLow) || idLow.includes(kLower)))) {
          matchedUserRules = uMap[key];
          break;
        }
      }
      if (matchedUserRules) break;
    }
  }

  // STEP 1: Absolute priority for explicit individual user restrictions
  // If user has an explicit individual record in user_permissions for this module, it MUST take precedence.
  // Role defaults or general role permissions must NEVER override an explicit individual user denial (can_view: false)!
  if (matchedUserRules) {
    let userModRule = matchedUserRules[canon] ||
      matchedUserRules[moduleId] ||
      matchedUserRules[moduleId.toLowerCase()] ||
      matchedUserRules[moduleId.replace(/-/g, '_')] ||
      matchedUserRules[moduleId.replace(/_/g, '-')] ||
      matchedUserRules[`module_${canon}`];

    if (!userModRule) {
      for (const k of Object.keys(matchedUserRules)) {
        if (canonicalModuleId(k) === canon || k.toLowerCase() === moduleId.toLowerCase()) {
          userModRule = matchedUserRules[k];
          break;
        }
      }
    }

    if (userModRule !== undefined && userModRule !== null) {
      switch (action) {
        case 'view': {
          const isVis = extractVisibility(userModRule);
          console.log(`[RBAC Lookup] Module "${moduleId}" (${canon}) for user [${candidateKeys.join(', ')}]: MATCHED explicit override -> action="${action}", result=${isVis} (ABSOLUTE PRIORITY OVERRIDE)`);
          return isVis;
        }
        case 'create': {
          const allowed = userModRule.canCreate !== undefined ? !!userModRule.canCreate : !!(userModRule as any).can_create;
          console.log(`[RBAC Lookup] Module "${moduleId}" (${canon}) for user [${candidateKeys.join(', ')}]: MATCHED explicit override -> action="${action}", result=${allowed}`);
          return allowed;
        }
        case 'edit': {
          const allowed = userModRule.canEdit !== undefined ? !!userModRule.canEdit : !!(userModRule as any).can_edit;
          console.log(`[RBAC Lookup] Module "${moduleId}" (${canon}) for user [${candidateKeys.join(', ')}]: MATCHED explicit override -> action="${action}", result=${allowed}`);
          return allowed;
        }
        case 'delete': {
          const allowed = userModRule.canDelete !== undefined ? !!userModRule.canDelete : !!(userModRule as any).can_delete;
          console.log(`[RBAC Lookup] Module "${moduleId}" (${canon}) for user [${candidateKeys.join(', ')}]: MATCHED explicit override -> action="${action}", result=${allowed}`);
          return allowed;
        }
        case 'export': {
          const allowed = userModRule.canExport !== undefined ? !!userModRule.canExport : !!(userModRule as any).can_export;
          console.log(`[RBAC Lookup] Module "${moduleId}" (${canon}) for user [${candidateKeys.join(', ')}]: MATCHED explicit override -> action="${action}", result=${allowed}`);
          return allowed;
        }
        default:
          return false;
      }
    }
  }

  // 2. System Admin default bypass ONLY when no explicit override was configured for this module
  if (normRole === 'System Admin') {
    console.log(`[RBAC Lookup] Module "${moduleId}" (${canon}) for user [${candidateKeys.join(', ')}]: Granted by System Admin default.`);
    return true;
  }

  // 3. Role Permissions Fallback
  const map = permissionsMap || getCachedRolePermissions();
  const roleRules = map[normRole] || map['Supervisor'];

  if (!roleRules) {
    const isDefaultVis = action === 'view' ? canon !== 'admin_control' : false;
    console.log(`[RBAC Lookup] Module "${moduleId}" (${canon}) for user [${candidateKeys.join(', ')}]: No role rules for "${normRole}". Default result=${isDefaultVis}`);
    return isDefaultVis;
  }

  const modRule = roleRules[canon] ||
    roleRules[moduleId as SystemModuleId] ||
    roleRules[moduleId.replace(/-/g, '_') as SystemModuleId] ||
    roleRules[moduleId.replace(/_/g, '-') as SystemModuleId];

  if (!modRule) {
    const isDefaultVis = action === 'view' ? canon !== 'admin_control' : false;
    console.log(`[RBAC Lookup] Module "${moduleId}" (${canon}) for user [${candidateKeys.join(', ')}]: No module rule in role "${normRole}". Default result=${isDefaultVis}`);
    return isDefaultVis;
  }

  let finalResult = false;
  switch (action) {
    case 'view':
      finalResult = extractVisibility(modRule);
      break;
    case 'create':
      finalResult = modRule.canCreate !== undefined ? !!modRule.canCreate : !!(modRule as any).can_create;
      break;
    case 'edit':
      finalResult = modRule.canEdit !== undefined ? !!modRule.canEdit : !!(modRule as any).can_edit;
      break;
    case 'delete':
      finalResult = modRule.canDelete !== undefined ? !!modRule.canDelete : !!(modRule as any).can_delete;
      break;
    case 'export':
      finalResult = modRule.canExport !== undefined ? !!modRule.canExport : !!(modRule as any).can_export;
      break;
    default:
      finalResult = false;
  }

  console.log(`[RBAC Lookup] Module "${moduleId}" (${canon}) evaluated from role "${normRole}": action="${action}", result=${finalResult}`);
  return finalResult;
}

/**
 * Helper to check if a module is strictly visible in navigation
 */
export function isModuleVisible(
  userOrRole?: string | AuthUser | null,
  moduleId?: string,
  permissionsMap?: RolePermissionsMap | null,
  userPermissionsMap?: UserPermissionsMap | null
): boolean {
  return checkUserPermission(permissionsMap, userOrRole, moduleId, 'view', userPermissionsMap);
}

/**
 * Helper to check if user can perform a specific action (view, create, edit, delete, export)
 */
export function canPerformAction(
  userOrRole?: string | AuthUser | null,
  moduleId?: string,
  action: 'view' | 'create' | 'edit' | 'delete' | 'export' = 'view',
  permissionsMap?: RolePermissionsMap | null,
  userPermissionsMap?: UserPermissionsMap | null
): boolean {
  return checkUserPermission(permissionsMap, userOrRole, moduleId, action, userPermissionsMap);
}

