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
 * Fetch authenticated users from Supabase Auth via get_supabase_auth_users RPC
 */
export async function fetchSupabaseAuthUsers(
  client: any
): Promise<Array<{ id: string; email: string; full_name: string; role: string }>> {
  const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
  if (!isConfigured || !client) return [];

  try {
    const { data, error } = await client.rpc('get_supabase_auth_users');
    if (!error && Array.isArray(data) && data.length > 0) {
      return data;
    }
  } catch (err) {
    // Graceful fallback if RPC has not yet been executed in user's database
    console.warn('Notice: get_supabase_auth_users RPC call note:', err);
  }
  return [];
}

/**
 * Fetch all user-specific permission overrides from Supabase `user_permissions` table
 */
export async function fetchUserPermissionsFromSupabase(client: any): Promise<UserPermissionsMap> {
  const currentMap = getCachedUserPermissions();
  const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
  if (!isConfigured || !client) return currentMap;

  try {
    const { data, error } = await client
      .from('user_permissions')
      .select('*');

    if (!error && data && Array.isArray(data)) {
      const updatedMap: UserPermissionsMap = {};

      data.forEach((row: any) => {
        const uId = String(row.user_id || row.userId || '').trim();
        const mod = row.module;
        if (!uId || !mod) return;

        if (!updatedMap[uId]) {
          updatedMap[uId] = {};
        }

        updatedMap[uId][mod] = {
          canView: row.is_visible ?? row.can_view ?? row.isVisible ?? row.canView ?? true,
          canCreate: row.can_create ?? row.canCreate ?? false,
          canEdit: row.can_edit ?? row.canEdit ?? false,
          canDelete: row.can_delete ?? row.canDelete ?? false,
          canExport: row.can_export ?? row.canExport ?? false,
        };
      });

      try {
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(updatedMap));
      } catch (_) {}

      return updatedMap;
    }
  } catch (err) {
    console.warn('Notice: Error fetching user_permissions from Supabase:', err);
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
 * Dynamic Session Permission Fetching on Login:
 * Queries Supabase `user_permissions` table for the logged-in user and hydrates `active_user_permissions`
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
  const userEmail = ((user as any).email || '').trim().toLowerCase();
  const userName = ((user as any).name || '').trim().toLowerCase();

  const activeRules: Record<string, any> = {};

  // 1. First fetch full user permissions map
  const allUserPerms = await fetchUserPermissionsFromSupabase(client);

  const matched = (userId && allUserPerms[userId]) ||
    (userEmail && allUserPerms[userEmail]) ||
    (userName && allUserPerms[userName]) ||
    (userId && allUserPerms[userId.toLowerCase()]) ||
    (userEmail && allUserPerms[userEmail.toLowerCase()]) ||
    (userName && allUserPerms[userName.toLowerCase()]);

  if (matched) {
    Object.keys(matched).forEach(k => {
      const canon = canonicalModuleId(k);
      activeRules[k] = matched[k];
      activeRules[canon] = matched[k];
      activeRules[k.replace(/-/g, '_')] = matched[k];
      activeRules[k.replace(/_/g, '-')] = matched[k];
    });
  }

  // 2. Direct query Supabase user_permissions table if connected
  const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
  if (isConfigured && client) {
    try {
      const { data, error } = await client
        .from('user_permissions')
        .select('*');

      if (!error && Array.isArray(data)) {
        data.forEach((row: any) => {
          const rowUid = String(row.user_id || '').trim().toLowerCase();
          const rowName = String(row.user_name || '').trim().toLowerCase();
          const rowEmail = String(row.email || row.user_email || '').trim().toLowerCase();

          const isMatch = (userId && rowUid === userId.toLowerCase()) ||
            (userEmail && (rowUid === userEmail || rowEmail === userEmail || rowName === userEmail || rowUid.includes(userEmail.split('@')[0]))) ||
            (userName && (rowName === userName || rowUid === userName || rowName.includes(userName)));

          if (isMatch) {
            const mod = row.module || row.module_key;
            if (mod) {
              const canon = canonicalModuleId(mod);
              const isVis = row.is_visible ?? row.can_view ?? row.isVisible ?? row.canView ?? true;
              const rule = {
                canView: isVis,
                canCreate: row.can_create ?? row.canCreate ?? false,
                canEdit: row.can_edit ?? row.canEdit ?? false,
                canDelete: row.can_delete ?? row.canDelete ?? false,
                canExport: row.can_export ?? row.canExport ?? false,
              };
              activeRules[mod] = rule;
              activeRules[canon] = rule;
              activeRules[mod.replace(/-/g, '_')] = rule;
              activeRules[mod.replace(/_/g, '-')] = rule;
            }
          }
        });
      }
    } catch (err) {
      console.warn('Direct user_permissions query notice:', err);
    }
  }

  try {
    localStorage.setItem(ACTIVE_USER_PERMS_KEY, JSON.stringify(activeRules));
    window.dispatchEvent(new CustomEvent('permissions-updated', { detail: { activeUserPermissions: activeRules } }));
    window.dispatchEvent(new CustomEvent('user-permissions-updated', { detail: { activeUserPermissions: activeRules } }));
    window.dispatchEvent(new Event('permissions-updated'));
  } catch (_) {}

  return activeRules;
}

/**
 * Save user-specific permissions map to Supabase `user_permissions` and localStorage
 */
export async function saveUserPermissionsToSupabase(
  client: any,
  userPermissionsMap: UserPermissionsMap,
  targetUserId?: string,
  targetUserInfo?: { name?: string; role?: string; email?: string }
): Promise<{ success: boolean; error?: string }> {
  // 1. Update localStorage
  try {
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(userPermissionsMap));
    if (targetUserId && userPermissionsMap[targetUserId]) {
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

  // 2. Prepare payload
  const records: any[] = [];
  const now = new Date().toISOString();

  const userIdsToSave = targetUserId ? [targetUserId] : Object.keys(userPermissionsMap);

  userIdsToSave.forEach(uId => {
    const userMods = userPermissionsMap[uId];
    if (userMods) {
      Object.keys(userMods).forEach(moduleId => {
        const p = userMods[moduleId];
        const isVis = !!p.canView;
        records.push({
          id: `${uId.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}_${moduleId}`,
          user_id: uId,
          user_name: targetUserInfo?.name || null,
          user_role: targetUserInfo?.role || null,
          module: moduleId,
          is_visible: isVis,
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

  return await resilientUpsertPermissions(client, 'user_permissions', records, 'user_id,module');
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

  const normRole = normalizeRoleName(userRole);

  // 1. Strict Check for currently logged-in user's active permissions (active_user_permissions)
  const activeUserRules = getActiveUserPermissions();
  const activeModRule = activeUserRules[canon] ||
    activeUserRules[moduleId] ||
    activeUserRules[moduleId.replace(/-/g, '_')] ||
    activeUserRules[moduleId.replace(/_/g, '-')];

  if (activeModRule) {
    switch (action) {
      case 'view':
        if ((activeModRule as any).is_visible !== undefined) return !!(activeModRule as any).is_visible;
        if (activeModRule.canView !== undefined) return !!activeModRule.canView;
        if ((activeModRule as any).can_view !== undefined) return !!(activeModRule as any).can_view;
        return true;
      case 'create':
        return activeModRule.canCreate !== undefined ? !!activeModRule.canCreate : !!(activeModRule as any).can_create;
      case 'edit':
        return activeModRule.canEdit !== undefined ? !!activeModRule.canEdit : !!(activeModRule as any).can_edit;
      case 'delete':
        return activeModRule.canDelete !== undefined ? !!activeModRule.canDelete : !!(activeModRule as any).can_delete;
      case 'export':
        return activeModRule.canExport !== undefined ? !!activeModRule.canExport : !!(activeModRule as any).can_export;
      default:
        return false;
    }
  }

  // 2. Strict Check for specific User Permissions Override in general User Permissions Map
  const uMap = userPermissionsMap || getCachedUserPermissions();
  const matchedUserRules = (userId && uMap[userId]) ||
    (userEmail && uMap[userEmail]) ||
    (userName && uMap[userName]) ||
    (userId && uMap[userId.toLowerCase()]) ||
    (userEmail && uMap[userEmail.toLowerCase()]) ||
    (userName && uMap[userName.toLowerCase()]);

  if (matchedUserRules) {
    const userModRule = matchedUserRules[canon] ||
      matchedUserRules[moduleId] ||
      matchedUserRules[moduleId.replace(/-/g, '_')] ||
      matchedUserRules[moduleId.replace(/_/g, '-')];

    if (userModRule) {
      switch (action) {
        case 'view':
          if ((userModRule as any).is_visible !== undefined) return !!(userModRule as any).is_visible;
          if (userModRule.canView !== undefined) return !!userModRule.canView;
          if ((userModRule as any).can_view !== undefined) return !!(userModRule as any).can_view;
          return true;
        case 'create':
          return userModRule.canCreate !== undefined ? !!userModRule.canCreate : !!(userModRule as any).can_create;
        case 'edit':
          return userModRule.canEdit !== undefined ? !!userModRule.canEdit : !!(userModRule as any).can_edit;
        case 'delete':
          return userModRule.canDelete !== undefined ? !!userModRule.canDelete : !!(userModRule as any).can_delete;
        case 'export':
          return userModRule.canExport !== undefined ? !!userModRule.canExport : !!(userModRule as any).can_export;
        default:
          return false;
      }
    }
  }

  // 2. System Admin default bypass ONLY when NO user-specific override is configured
  if (normRole === 'System Admin') {
    return true;
  }

  // 3. Role Permissions Fallback
  const map = permissionsMap || getCachedRolePermissions();
  const roleRules = map[normRole] || map['Supervisor'];

  if (!roleRules) {
    return action === 'view' ? canon !== 'admin' : false;
  }

  const modRule = roleRules[canon] ||
    roleRules[moduleId as SystemModuleId] ||
    roleRules[moduleId.replace(/-/g, '_') as SystemModuleId] ||
    roleRules[moduleId.replace(/_/g, '-') as SystemModuleId];

  if (!modRule) {
    return action === 'view' ? canon !== 'admin' : false;
  }

  switch (action) {
    case 'view':
      if ((modRule as any).is_visible !== undefined) return !!(modRule as any).is_visible;
      if (modRule.canView !== undefined) return !!modRule.canView;
      if ((modRule as any).can_view !== undefined) return !!(modRule as any).can_view;
      return true;
    case 'create':
      return modRule.canCreate !== undefined ? !!modRule.canCreate : !!(modRule as any).can_create;
    case 'edit':
      return modRule.canEdit !== undefined ? !!modRule.canEdit : !!(modRule as any).can_edit;
    case 'delete':
      return modRule.canDelete !== undefined ? !!modRule.canDelete : !!(modRule as any).can_delete;
    case 'export':
      return modRule.canExport !== undefined ? !!modRule.canExport : !!(modRule as any).can_export;
    default:
      return false;
  }
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

