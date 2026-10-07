/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { 
  checkUserPermission, 
  getCachedRolePermissions, 
  getCachedUserPermissions,
  fetchRolePermissionsFromSupabase,
  fetchUserPermissionsFromSupabase
} from './permissions';
import { SystemModuleId, RolePermissionsMap, UserPermissionsMap, normalizeRoleName, AuthUser } from '../types';
import { supabase } from './supabase';

/**
 * Centralized admin role authorization check helper.
 * System Admins, Admins, and Managers have administrative authority.
 */
export const isAdmin = (userRole?: string): boolean => {
  if (!userRole) {
    return true;
  }
  const norm = normalizeRoleName(userRole);
  if (norm === 'System Admin' || norm === 'Manager') {
    return true;
  }
  const role = userRole.toLowerCase().trim();
  if (
    role === 'system admin' ||
    role === 'system_admin' ||
    role === 'admin' ||
    role === 'manager' ||
    role === 'owner' ||
    role.includes('admin')
  ) {
    return true;
  }
  return false;
};

/**
 * Check if the user's role or specific user account has permission to perform an action on a module.
 */
export const canPerformAction = (
  userOrRole?: string | AuthUser | null,
  module?: SystemModuleId | string,
  action: 'view' | 'create' | 'edit' | 'delete' | 'export' = 'view',
  permissionsMap?: RolePermissionsMap,
  userPermissionsMap?: UserPermissionsMap
): boolean => {
  return checkUserPermission(permissionsMap, userOrRole, module, action, userPermissionsMap);
};

/**
 * Custom React Hook to get active permissions (Role + User overrides) with live updates
 */
export function useRolePermissions(userOrRole?: string | AuthUser | null) {
  const [permissions, setPermissions] = useState<RolePermissionsMap>(() => getCachedRolePermissions());
  const [userPerms, setUserPerms] = useState<UserPermissionsMap>(() => getCachedUserPermissions());

  useEffect(() => {
    let isMounted = true;
    Promise.all([
      fetchRolePermissionsFromSupabase(supabase),
      fetchUserPermissionsFromSupabase(supabase)
    ]).then(([rMap, uMap]) => {
      if (isMounted) {
        if (rMap) setPermissions(rMap);
        if (uMap) setUserPerms(uMap);
      }
    });

    const handleRoleSync = (e: any) => {
      if (e?.detail?.permissionsMap && isMounted) {
        setPermissions(e.detail.permissionsMap);
      }
    };
    const handleUserSync = (e: any) => {
      if (e?.detail?.userPermissionsMap && isMounted) {
        setUserPerms(e.detail.userPermissionsMap);
      }
    };

    window.addEventListener('role-permissions-updated', handleRoleSync);
    window.addEventListener('user-permissions-updated', handleUserSync);
    window.addEventListener('permissions-updated', handleUserSync);
    window.addEventListener('storage', handleUserSync);
    return () => {
      isMounted = false;
      window.removeEventListener('role-permissions-updated', handleRoleSync);
      window.removeEventListener('user-permissions-updated', handleUserSync);
      window.removeEventListener('permissions-updated', handleUserSync);
      window.removeEventListener('storage', handleUserSync);
    };
  }, []);

  const can = (
    module: SystemModuleId | string,
    action: 'view' | 'create' | 'edit' | 'delete' | 'export' = 'view'
  ): boolean => {
    return checkUserPermission(permissions, userOrRole, module, action, userPerms);
  };

  const userRoleStr = typeof userOrRole === 'object' && userOrRole !== null ? userOrRole.role : (userOrRole as string);

  return {
    permissions,
    userPermissions: userPerms,
    can,
    canView: (mod: SystemModuleId | string) => can(mod, 'view'),
    canCreate: (mod: SystemModuleId | string) => can(mod, 'create'),
    canEdit: (mod: SystemModuleId | string) => can(mod, 'edit'),
    canDelete: (mod: SystemModuleId | string) => can(mod, 'delete'),
    canExport: (mod: SystemModuleId | string) => can(mod, 'export'),
    isAdmin: isAdmin(userRoleStr)
  };
}

export default isAdmin;
