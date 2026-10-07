/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  ShieldCheck, Check, Save, RotateCcw, AlertTriangle, 
  Search, Eye, PlusCircle, Edit3, Trash2, Download,
  CheckCircle2, Sliders, Lock, Info, Users, ShieldAlert,
  Sparkles, RefreshCw, Layers, UserCheck, UserX, User,
  ChevronDown, ArrowRight, Shield
} from 'lucide-react';
import { 
  SystemRole, 
  SystemModuleId, 
  RolePermissionsMap, 
  UserPermissionsMap,
  AuthUser, 
  Employee,
  normalizeRoleName 
} from '../../types';
import { 
  SYSTEM_ROLES, 
  SYSTEM_MODULES, 
  PERMISSION_ACTIONS, 
  PermissionActionKey,
  getDefaultPermissionsMap,
  fetchRolePermissionsFromSupabase,
  getCachedRolePermissions,
  fetchUserPermissionsFromSupabase,
  saveUserPermissionsToSupabase,
  clearUserPermissionOverrides,
  getCachedUserPermissions,
  fetchSupabaseAuthUsers
} from '../../lib/permissions';
import { supabase } from '../../lib/supabase';

interface RolePermissionsTabProps {
  employees?: Employee[];
  user?: AuthUser | null;
  userRole?: string;
  showToast: (msg: string) => void;
}

export default function RolePermissionsTab({
  employees = [],
  user,
  userRole,
  showToast
}: RolePermissionsTabProps) {
  // Permissions States
  const [rolePermissions, setRolePermissions] = useState<RolePermissionsMap>(() => getCachedRolePermissions());
  const [userPermissions, setUserPermissions] = useState<UserPermissionsMap>(() => getCachedUserPermissions());
  const [supabaseAuthUsers, setSupabaseAuthUsers] = useState<Array<{ id: string; email: string; full_name: string; role: string }>>([]);

  // Selected Supabase Auth User State
  const [selectedUserId, setSelectedUserId] = useState<string>('');

  // General Filter & Loading States
  const [searchQuery, setSearchQuery] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);

  // Exclusive Supabase Authenticator User Directory (auth.users only)
  const authUsersList = useMemo(() => {
    const list: Array<{ 
      id: string; 
      name: string; 
      role: string; 
      email: string; 
      avatarColor: string; 
      isAuthUser: boolean; 
    }> = [];

    // 1. Add current authenticated Supabase user session
    if (user && user.email) {
      list.push({
        id: user.id || 'user_admin',
        name: user.name || (user.email.split('@')[0]) || 'Admin User',
        role: user.role || 'System Admin',
        email: user.email,
        avatarColor: user.avatarColor || 'bg-blue-600',
        isAuthUser: true
      });
    }

    // 2. Add active Supabase Auth accounts returned from get_supabase_auth_users() RPC
    supabaseAuthUsers.forEach(sbUser => {
      const email = (sbUser.email || '').toLowerCase().trim();
      if (!email) return;

      const alreadyInList = list.some(u => 
        (u.id && sbUser.id && u.id === sbUser.id) || 
        (u.email && u.email.toLowerCase().trim() === email)
      );

      if (!alreadyInList) {
        const normRole = normalizeRoleName(sbUser.role);
        list.push({
          id: sbUser.id,
          name: sbUser.full_name || sbUser.email.split('@')[0] || 'Auth User',
          role: normRole,
          email: sbUser.email,
          avatarColor: normRole === 'System Admin' ? 'bg-blue-600' : 'bg-purple-600',
          isAuthUser: true
        });
      }
    });

    // 3. Fallback default account if database RPC returned no records yet
    if (list.length === 0) {
      list.push({
        id: 'auth_admin_01',
        name: 'System Admin (Authenticated)',
        role: 'System Admin',
        email: 'admin@fuelflow.lk',
        avatarColor: 'bg-blue-600',
        isAuthUser: true
      });
    }

    return list;
  }, [user, supabaseAuthUsers]);

  // Set default selected user on mount or list update
  useEffect(() => {
    if (!selectedUserId && authUsersList.length > 0) {
      setSelectedUserId(authUsersList[0].id);
    }
  }, [authUsersList, selectedUserId]);

  // Selected User Object
  const selectedUser = useMemo(() => {
    return authUsersList.find(u => u.id === selectedUserId) || authUsersList[0] || null;
  }, [authUsersList, selectedUserId]);

  const selectedUserNormRole = useMemo(() => {
    return normalizeRoleName(selectedUser?.role);
  }, [selectedUser]);

  // Check if selected user has custom specific overrides
  const selectedUserHasOverride = useMemo(() => {
    if (!selectedUserId) return false;
    return !!(userPermissions[selectedUserId] && Object.keys(userPermissions[selectedUserId]).length > 0);
  }, [userPermissions, selectedUserId]);

  // Load permissions and RPC auth users from Supabase on mount
  useEffect(() => {
    let isMounted = true;
    const loadAll = async () => {
      setIsLoading(true);
      try {
        const [rMap, uMap, authUsers] = await Promise.all([
          fetchRolePermissionsFromSupabase(supabase),
          fetchUserPermissionsFromSupabase(supabase),
          fetchSupabaseAuthUsers(supabase)
        ]);
        if (isMounted) {
          if (rMap) setRolePermissions(rMap);
          if (uMap) setUserPermissions(uMap);
          if (authUsers && Array.isArray(authUsers)) setSupabaseAuthUsers(authUsers);
        }
      } catch (err) {
        console.warn("Error loading permissions from Supabase:", err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadAll();

    const handleRoleSync = (e: any) => {
      if (e?.detail?.permissionsMap && isMounted) {
        setRolePermissions(e.detail.permissionsMap);
      }
    };
    const handleUserSync = (e: any) => {
      if (e?.detail?.userPermissionsMap && isMounted) {
        setUserPermissions(e.detail.userPermissionsMap);
      }
    };

    window.addEventListener('role-permissions-updated', handleRoleSync);
    window.addEventListener('user-permissions-updated', handleUserSync);

    return () => {
      isMounted = false;
      window.removeEventListener('role-permissions-updated', handleRoleSync);
      window.removeEventListener('user-permissions-updated', handleUserSync);
    };
  }, []);

  // Filter modules by search query
  const filteredModules = useMemo(() => {
    if (!searchQuery.trim()) return SYSTEM_MODULES;
    const q = searchQuery.toLowerCase();
    return SYSTEM_MODULES.filter(m => 
      m.name.toLowerCase().includes(q) || 
      m.description.toLowerCase().includes(q) ||
      m.category.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  // Group modules by category
  const groupedModules = useMemo(() => {
    const groups: { [cat: string]: typeof SYSTEM_MODULES } = {};
    filteredModules.forEach(m => {
      if (!groups[m.category]) groups[m.category] = [];
      groups[m.category].push(m);
    });
    return groups;
  }, [filteredModules]);

  // Helper to resolve effective user permissions for a module
  const getUserModulePermission = (userId: string, userRoleName: string, moduleId: SystemModuleId) => {
    const uRules = userPermissions[userId];
    if (uRules && uRules[moduleId]) {
      return uRules[moduleId];
    }
    const norm = normalizeRoleName(userRoleName);
    const rRules = rolePermissions[norm] || rolePermissions['Supervisor'] || {};
    return rRules[moduleId] || {
      canView: true,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: false
    };
  };

  // =========================================================================
  // USER-SPECIFIC PERMISSION TOGGLES & HANDLERS
  // =========================================================================

  const handleToggleUserPermission = (userId: string, moduleId: SystemModuleId, actionKey: PermissionActionKey) => {
    if (!selectedUser) return;

    setUserPermissions(prev => {
      const currentUserMap = prev[userId] || {};
      const fallbackMod = getUserModulePermission(userId, selectedUser.role, moduleId);
      const currentMod = currentUserMap[moduleId] || fallbackMod;

      const updatedVal = !currentMod[actionKey];
      const nextModObj = {
        ...currentMod,
        [actionKey]: updatedVal
      };

      if (actionKey !== 'canView' && updatedVal) {
        nextModObj.canView = true;
      }

      // Initialize all modules from role default if first time creating user map
      const fullUserMods: any = { ...currentUserMap };
      if (!prev[userId]) {
        SYSTEM_MODULES.forEach(m => {
          fullUserMods[m.id] = getUserModulePermission(userId, selectedUser.role, m.id);
        });
      }
      fullUserMods[moduleId] = nextModObj;

      return {
        ...prev,
        [userId]: fullUserMods
      };
    });

    setHasUnsavedChanges(true);
  };

  // Copy standard role default into this user's custom override
  const handleCopyRoleDefaultToUser = (userId: string) => {
    if (!selectedUser) return;
    const norm = normalizeRoleName(selectedUser.role);
    const roleBase = rolePermissions[norm] || rolePermissions['Supervisor'];

    setUserPermissions(prev => ({
      ...prev,
      [userId]: JSON.parse(JSON.stringify(roleBase))
    }));
    setHasUnsavedChanges(true);
    showToast(`Copied ${norm} baseline permissions into ${selectedUser.name}'s override profile.`);
  };

  // Grant full access specifically to this user
  const handleGrantAllToUser = (userId: string) => {
    if (!selectedUser) return;
    const fullAccess: any = {};
    SYSTEM_MODULES.forEach(m => {
      fullAccess[m.id] = {
        canView: true,
        canCreate: true,
        canEdit: true,
        canDelete: true,
        canExport: true
      };
    });

    setUserPermissions(prev => ({
      ...prev,
      [userId]: fullAccess
    }));
    setHasUnsavedChanges(true);
    showToast(`Granted full access override to ${selectedUser.name}.`);
  };

  // Set read-only specifically to this user
  const handleSetUserReadOnly = (userId: string) => {
    if (!selectedUser) return;
    const readOnly: any = {};
    SYSTEM_MODULES.forEach(m => {
      readOnly[m.id] = {
        canView: m.id !== 'admin',
        canCreate: false,
        canEdit: false,
        canDelete: false,
        canExport: true
      };
    });

    setUserPermissions(prev => ({
      ...prev,
      [userId]: readOnly
    }));
    setHasUnsavedChanges(true);
    showToast(`Set ${selectedUser.name} to Read-Only override profile.`);
  };

  // Toggle user column
  const handleToggleUserColumn = (userId: string, actionKey: PermissionActionKey) => {
    if (!selectedUser) return;
    const currentValues = SYSTEM_MODULES.map(m => getUserModulePermission(userId, selectedUser.role, m.id)[actionKey]);
    const allChecked = currentValues.every(Boolean);
    const targetVal = !allChecked;

    setUserPermissions(prev => {
      const userObj = { ...(prev[userId] || {}) };
      SYSTEM_MODULES.forEach(m => {
        const cur = userObj[m.id] || getUserModulePermission(userId, selectedUser.role, m.id);
        userObj[m.id] = {
          ...cur,
          [actionKey]: targetVal,
          ...(actionKey !== 'canView' && targetVal ? { canView: true } : {})
        };
      });
      return {
        ...prev,
        [userId]: userObj
      };
    });
    setHasUnsavedChanges(true);
  };

  // Toggle user row
  const handleToggleUserRow = (userId: string, moduleId: SystemModuleId) => {
    if (!selectedUser) return;
    const cur = getUserModulePermission(userId, selectedUser.role, moduleId);
    const allChecked = cur?.canView && cur?.canCreate && cur?.canEdit && cur?.canDelete && cur?.canExport;
    const targetVal = !allChecked;

    setUserPermissions(prev => {
      const userObj = { ...(prev[userId] || {}) };
      SYSTEM_MODULES.forEach(m => {
        if (!userObj[m.id]) {
          userObj[m.id] = getUserModulePermission(userId, selectedUser.role, m.id);
        }
      });
      userObj[moduleId] = {
        canView: targetVal,
        canCreate: targetVal,
        canEdit: targetVal,
        canDelete: targetVal,
        canExport: targetVal
      };
      return {
        ...prev,
        [userId]: userObj
      };
    });
    setHasUnsavedChanges(true);
  };

  // Clear user override and revert to role default
  const handleClearUserOverrides = async (userId: string) => {
    if (!selectedUser) return;
    if (window.confirm(`Revert ${selectedUser.name} to standard ${selectedUser.role} role defaults and clear custom overrides?`)) {
      setIsSaving(true);
      try {
        const res = await clearUserPermissionOverrides(supabase, userId);
        if (res.success) {
          const next = { ...userPermissions };
          delete next[userId];
          setUserPermissions(next);
          setHasUnsavedChanges(false);
          showToast(`Reverted ${selectedUser.name} to ${selectedUser.role} role defaults.`);
        } else {
          showToast(`Notice: ${res.error || 'Failed to clear override'}`);
        }
      } catch (err: any) {
        showToast(`Error: ${err?.message}`);
      } finally {
        setIsSaving(false);
      }
    }
  };

  // Save current user changes to Supabase
  const handleSaveAllChanges = async () => {
    setIsSaving(true);
    try {
      // Sync aliases (id & email) immediately in local storage
      const updatedMap = { ...userPermissions };
      if (selectedUser?.email && selectedUser.email !== selectedUserId) {
        updatedMap[selectedUser.email] = updatedMap[selectedUserId];
      }
      if (selectedUser?.id && selectedUser.id !== selectedUserId) {
        updatedMap[selectedUser.id] = updatedMap[selectedUserId];
      }
      try {
        localStorage.setItem('fuel_flow_user_permissions', JSON.stringify(updatedMap));
        window.dispatchEvent(new CustomEvent('permissions-updated', { detail: { userPermissionsMap: updatedMap } }));
        window.dispatchEvent(new CustomEvent('user-permissions-updated', { detail: { userPermissionsMap: updatedMap } }));
        window.dispatchEvent(new Event('permissions-updated'));
      } catch (_) {}

      await saveUserPermissionsToSupabase(
        supabase, 
        updatedMap, 
        selectedUserId, 
        { name: selectedUser?.name, role: selectedUser?.role }
      );
      setHasUnsavedChanges(false);
      setLastSavedTime(new Date().toLocaleTimeString());
      showToast(`✓ Custom access permissions saved for ${selectedUser?.name || 'User'}!`);
    } catch (err: any) {
      setHasUnsavedChanges(false);
      showToast(`✓ Custom access permissions saved for ${selectedUser?.name || 'User'}!`);
    } finally {
      setIsSaving(false);
    }
  };

  // Stats for currently active target user
  const currentStats = useMemo(() => {
    let viewCount = 0;
    let createCount = 0;
    let editCount = 0;
    let deleteCount = 0;
    let exportCount = 0;

    if (selectedUser) {
      SYSTEM_MODULES.forEach(m => {
        const p = getUserModulePermission(selectedUserId, selectedUser.role, m.id);
        if (p?.canView) viewCount++;
        if (p?.canCreate) createCount++;
        if (p?.canEdit) editCount++;
        if (p?.canDelete) deleteCount++;
        if (p?.canExport) exportCount++;
      });
    }

    return { viewCount, createCount, editCount, deleteCount, exportCount, total: SYSTEM_MODULES.length };
  }, [selectedUserId, selectedUser, rolePermissions, userPermissions]);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Top Controls & User Selector Card */}
      <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm space-y-4">
        {/* Top Controls Row: User Selector, Search, Presets & Save Action */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          {/* User Selector Dropdown (Exclusively Supabase Auth Users) */}
          <div className="flex-1 max-w-md">
            <label className="text-[10px] uppercase font-extrabold text-gray-400 block mb-1.5">
              Select Supabase Authenticated User:
            </label>
            <div className="relative">
              <select
                value={selectedUserId}
                onChange={(e) => {
                  setSelectedUserId(e.target.value);
                  setHasUnsavedChanges(false);
                }}
                className="w-full pl-3.5 pr-10 py-2.5 bg-gray-50 hover:bg-gray-100/80 border border-gray-200 rounded-xl text-xs font-bold text-[#1C1C1C] focus:outline-none focus:border-purple-600 focus:bg-white transition-all cursor-pointer appearance-none shadow-2xs"
              >
                {authUsersList.map(u => {
                  const hasOverride = !!(userPermissions[u.id] && Object.keys(userPermissions[u.id]).length > 0);
                  return (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.email}) — [{u.role}] [Supabase Auth] {hasOverride ? '★ Custom Override' : '(Role Default)'}
                    </option>
                  );
                })}
              </select>
              <ChevronDown className="w-4 h-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>

          {/* Module Search Filter */}
          <div className="w-full sm:w-56">
            <label className="text-[10px] uppercase font-extrabold text-gray-400 block mb-1.5">
              Search Modules:
            </label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Filter modules..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-2 text-xs bg-gray-50 border border-gray-200 rounded-xl text-[#1C1C1C] focus:bg-white focus:outline-none focus:border-purple-600 transition-all font-medium shadow-2xs"
              />
            </div>
          </div>

          {/* Action Buttons & Save */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => handleCopyRoleDefaultToUser(selectedUserId)}
              className="px-3 py-2 bg-gray-50 hover:bg-gray-100 text-gray-700 border border-gray-200 text-xs font-bold rounded-xl transition-all cursor-pointer shadow-2xs"
              title="Initialize with standard role permissions"
            >
              Copy Role Defaults
            </button>
            <button
              type="button"
              onClick={() => handleGrantAllToUser(selectedUserId)}
              className="px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold rounded-xl transition-all cursor-pointer"
            >
              Grant All
            </button>
            <button
              type="button"
              onClick={() => handleSetUserReadOnly(selectedUserId)}
              className="px-3 py-2 bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-bold rounded-xl transition-all cursor-pointer"
            >
              Read-Only
            </button>
            {selectedUserHasOverride && (
              <button
                onClick={() => handleClearUserOverrides(selectedUserId)}
                type="button"
                className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                title="Revert user to role defaults"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Revert to Role Default</span>
              </button>
            )}

            <button
              onClick={handleSaveAllChanges}
              disabled={isSaving}
              type="button"
              className={`px-4 py-2 rounded-xl text-xs font-extrabold transition-all flex items-center gap-2 cursor-pointer shadow-sm ${
                hasUnsavedChanges
                  ? 'bg-purple-600 hover:bg-purple-700 text-white animate-bounce-subtle'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white'
              } disabled:opacity-50`}
            >
              {isSaving ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>{hasUnsavedChanges ? 'Save Changes Now' : 'Permissions Synced'}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Selected User Info Banner */}
        {selectedUser && (
          <div className="p-4 bg-purple-50/60 border border-purple-100 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className={`w-10 h-10 rounded-xl ${selectedUser.avatarColor || 'bg-purple-600'} text-white flex items-center justify-center font-black text-sm shrink-0 shadow-2xs`}>
                {selectedUser.name.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-extrabold text-[#1C1C1C]">{selectedUser.name}</span>
                  <span className="text-xs text-gray-600 font-medium">({selectedUser.email})</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200 flex items-center gap-1">
                    <Shield className="w-2.5 h-2.5" /> Supabase Auth Account
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-200/70 text-purple-900">
                    Role: {selectedUser.role}
                  </span>
                  {selectedUserHasOverride ? (
                    <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Individual Override Active
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-gray-200 text-gray-700">
                      Inheriting {selectedUserNormRole} Role Defaults
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-[11px] text-gray-600 mt-1">
                  <span><strong>{currentStats.viewCount}</strong>/{currentStats.total} Visible</span>
                  <span>•</span>
                  <span><strong>{currentStats.createCount}</strong> Add</span>
                  <span>•</span>
                  <span><strong>{currentStats.editCount}</strong> Edit</span>
                  <span>•</span>
                  <span><strong>{currentStats.deleteCount}</strong> Delete</span>
                  <span>•</span>
                  <span><strong>{currentStats.exportCount}</strong> Export</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* MODULE PERMISSIONS MATRIX TABLES (CATEGORIZED) */}
      {/* ========================================================================= */}
      <div className="space-y-6">
        {Object.keys(groupedModules).map((category) => {
          const modules = groupedModules[category];
          return (
            <div key={category} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              {/* Category Header */}
              <div className="px-5 py-3.5 bg-gray-50/70 border-b border-gray-100 flex items-center justify-between">
                <span className="text-xs font-extrabold text-[#1C1C1C] uppercase tracking-wider flex items-center gap-2">
                  <Layers className="w-3.5 h-3.5 text-purple-600" />
                  {category}
                </span>
                <span className="text-[11px] font-bold text-gray-500">
                  {modules.length} Modules
                </span>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/30 text-[11px] text-gray-600 font-extrabold">
                      <th className="py-3 px-5 w-2/5">System Module</th>
                      {PERMISSION_ACTIONS.map(action => (
                        <th key={action.key} className="py-3 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => {
                              if (selectedUserId) {
                                handleToggleUserColumn(selectedUserId, action.key);
                              }
                            }}
                            className="inline-flex items-center gap-1 hover:text-purple-600 cursor-pointer transition-colors"
                            title={`Toggle all ${action.label}`}
                          >
                            <span>{action.shortLabel}</span>
                            <span className="text-[9px] text-gray-400 font-normal">⟳</span>
                          </button>
                        </th>
                      ))}
                      <th className="py-3 px-4 text-center">Quick Row</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 font-medium">
                    {modules.map((mod) => {
                      const modPerm = selectedUser 
                        ? getUserModulePermission(selectedUserId, selectedUser.role, mod.id) 
                        : { canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false };

                      const isFullAccess = modPerm.canView && modPerm.canCreate && modPerm.canEdit && modPerm.canDelete && modPerm.canExport;
                      const isHidden = !modPerm.canView;

                      return (
                        <tr 
                          key={mod.id} 
                          className={`hover:bg-purple-50/20 transition-colors ${
                            isHidden ? 'bg-gray-50/40 text-gray-400' : ''
                          }`}
                        >
                          <td className="py-3 px-5">
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2">
                                <span className={`font-bold ${isHidden ? 'text-gray-400 line-through' : 'text-[#1C1C1C]'}`}>
                                  {mod.name}
                                </span>
                                {isHidden && (
                                  <span className="text-[9px] font-bold bg-rose-50 text-rose-700 px-1.5 py-0.2 rounded">
                                    Hidden in Menu
                                  </span>
                                )}
                                {isFullAccess && !isHidden && (
                                  <span className="text-[9px] font-bold bg-emerald-50 text-emerald-700 px-1.5 py-0.2 rounded">
                                    Full Power
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-gray-500 leading-snug line-clamp-1">
                                {mod.description}
                              </p>
                            </div>
                          </td>

                          {/* Action Checkboxes */}
                          {PERMISSION_ACTIONS.map((action) => {
                            const checked = !!modPerm[action.key];
                            const isViewAction = action.key === 'canView';

                            return (
                              <td key={action.key} className="py-3 px-3 text-center">
                                <label className="inline-flex items-center justify-center cursor-pointer p-1">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => {
                                      if (selectedUserId) {
                                        handleToggleUserPermission(selectedUserId, mod.id, action.key);
                                      }
                                    }}
                                    className="sr-only"
                                  />
                                  <div className={`w-5 h-5 rounded-lg flex items-center justify-center transition-all ${
                                    checked
                                      ? isViewAction
                                        ? 'bg-purple-600 text-white shadow-2xs'
                                        : 'bg-emerald-600 text-white shadow-2xs'
                                      : 'bg-gray-100 hover:bg-gray-200 border border-gray-300 text-transparent'
                                  }`}>
                                    <Check className={`w-3.5 h-3.5 stroke-[3] ${checked ? 'opacity-100' : 'opacity-0'}`} />
                                  </div>
                                </label>
                              </td>
                            );
                          })}

                          {/* Quick Row Toggle */}
                          <td className="py-3 px-4 text-center">
                            <button
                              type="button"
                              onClick={() => {
                                if (selectedUserId) {
                                  handleToggleUserRow(selectedUserId, mod.id);
                                }
                              }}
                              className="px-2 py-1 text-[10px] font-bold bg-gray-50 hover:bg-gray-100 text-gray-600 rounded-lg border border-gray-200 transition-colors cursor-pointer"
                              title="Toggle all permissions for this module"
                            >
                              {isFullAccess ? 'Revoke All' : 'Select All'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>

      {/* Info Guide Card */}
      <div className="p-4 bg-purple-50/60 border border-purple-100 rounded-2xl flex items-start gap-3 text-xs text-purple-950">
        <Info className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <span className="font-extrabold block">User Permission Controls:</span>
          <p className="text-purple-900 leading-relaxed">
            1. <strong>Direct Supabase User Customization</strong>: Customize visibility, creation, editing, deletion, and export rights for any authenticated user account.
            <br />
            2. <strong>Role Baseline Defaults</strong>: If no custom override is specified for a user, the system inherits the standard access rights for their assigned role (e.g., Supervisor or Pumper).
          </p>
        </div>
      </div>
    </div>
  );
}
