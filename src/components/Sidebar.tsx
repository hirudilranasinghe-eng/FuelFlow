/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, Clock, Fuel, BarChart3, FileText, Users, 
  ShieldCheck, ChevronLeft, ChevronRight, ChevronDown,
  Droplet, CreditCard, TrendingUp, Droplets, Truck,
  Database, Gauge, Tag, ArrowLeftRight, Flame, Landmark
} from 'lucide-react';

import { AuthUser, resolveUserRole } from '../types';
import FuelLogo from './FuelLogo';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string, subTab?: string) => void;
  activeReportSubTab?: string;
  activeAdminSubTab?: string;
  user?: AuthUser | null;
  onLogout?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export default function Sidebar({ 
  activeTab, 
  setActiveTab, 
  activeReportSubTab,
  activeAdminSubTab,
  user, 
  onLogout,
  isCollapsed: externalIsCollapsed,
  onToggleCollapse
}: SidebarProps) {
  const [internalIsCollapsed, setInternalIsCollapsed] = useState(false);
  const isCollapsed = externalIsCollapsed !== undefined ? externalIsCollapsed : internalIsCollapsed;

  const [isReportsExpanded, setIsReportsExpanded] = useState<boolean>(activeTab === 'reports');
  const [isAdminExpanded, setIsAdminExpanded] = useState<boolean>(activeTab === 'admin');

  useEffect(() => {
    if (activeTab === 'reports') {
      setIsReportsExpanded(true);
    }
    if (activeTab === 'admin') {
      setIsAdminExpanded(true);
    }
  }, [activeTab]);

  const handleToggle = () => {
    if (onToggleCollapse) {
      onToggleCollapse();
    } else {
      setInternalIsCollapsed(!internalIsCollapsed);
    }
  };

  const { role } = resolveUserRole(user?.email, user?.role);
  const isAdmin = role === 'admin';

  const menuItems = [
    { id: 'dashboard', name: 'Dashboard', icon: LayoutDashboard },
    { id: 'shift', name: 'Shift Management', icon: Clock },
    { id: 'deposits', name: 'Deposits', icon: Landmark },
    { id: 'stock', name: 'Fuel Stock', icon: Fuel },
    { id: 'oil-storage', name: 'Oil (Lubricant) Storage', icon: Droplets },
    { id: 'gas-inventory', name: 'LP Gas Inventory', icon: Flame },
    { id: 'purchases', name: 'Purchases', icon: Truck },
    { id: 'manual-dip-record', name: 'Manual Dip Record', icon: Droplet },
    { id: 'reports', name: 'Reports', icon: FileText },
    { id: 'customers', name: 'Customers', icon: Users },
    ...(isAdmin ? [{ id: 'admin', name: 'Admin Control', icon: ShieldCheck }] : []),
  ];

  const reportSubItems = [
    { id: 'daily-sales', name: 'Daily Sales', fullName: 'Daily Sales History', icon: BarChart3 },
    { id: 'shift-meter', name: 'Shift & Meter Audits', fullName: 'Shift & Meter Audits', icon: Clock },
    { id: 'tank-stock', name: 'Tank & Stock Reconcile', fullName: 'Tank & Stock Reconciliation', icon: Droplet },
    { id: 'oil-movement', name: 'Oil Movement', fullName: 'Bulk Oil & Transfer Movements', icon: ArrowLeftRight },
    { id: 'credit-customer', name: 'Credit Statements', fullName: 'Credit & Customer Statements', icon: CreditCard },
    { id: 'financials', name: 'Financials & Profit', fullName: 'Financials & Profitability', icon: TrendingUp },
  ];

  const adminSubItems = [
    { id: 'tanks', name: 'Underground Tanks', fullName: 'Underground Tanks & Fuel Volumes', icon: Database },
    { id: 'mapping', name: 'Dispenser Nozzles & Pumps', fullName: 'Dispenser Nozzles & Pumps Mapping', icon: Gauge },
    { id: 'oils', name: 'Bulk Oil & Lubricants', fullName: 'Bulk Oil & Lubricant Storage', icon: Droplets },
    { id: 'employees', name: 'Staff Directory & Roles', fullName: 'Staff Directory & Access Roles', icon: Users },
    { id: 'price', name: 'Fuel Tariff & Prices', fullName: 'Fuel Tariff & Price Management', icon: Tag },
  ];

  return (
    <div 
      id="sidebar-container" 
      className={`${
        isCollapsed ? 'w-20' : 'w-64'
      } h-screen bg-white border-r border-gray-100 flex flex-col fixed left-0 top-0 z-20 transition-all duration-300 ease-in-out select-none`}
    >
      {/* Brand Logo & Collapse Toggle */}
      <div id="brand-logo" className={`p-4 ${isCollapsed ? 'justify-center flex-col items-center gap-3' : 'justify-between flex-row items-center'} flex w-full border-b border-gray-100/60 transition-all`}>
        <div className="flex items-center justify-center overflow-hidden">
          {isCollapsed ? (
            <FuelLogo variant="mark" size="md" />
          ) : (
            <FuelLogo variant="full" size="md" />
          )}
        </div>

        <button
          onClick={handleToggle}
          className="p-1.5 rounded-xl bg-gray-50 hover:bg-gray-100 border border-gray-200/80 text-gray-500 hover:text-[#1C1C1C] transition-all cursor-pointer shadow-2xs group flex-shrink-0"
          title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
        >
          {isCollapsed ? (
            <ChevronRight className="w-4 h-4 transition-transform group-hover:scale-110" />
          ) : (
            <ChevronLeft className="w-4 h-4 transition-transform group-hover:scale-110" />
          )}
        </button>
      </div>

      {/* Navigation Menu Links */}
      <div id="sidebar-menu" className={`flex-1 px-3 py-3 space-y-1.5 ${isCollapsed ? 'overflow-visible' : 'overflow-y-auto'} no-scrollbar`}>
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          const isReports = item.id === 'reports';

          if (isReports) {
            if (isCollapsed) {
              return (
                <div key={item.id} className="relative group">
                  <button
                    id={`tab-btn-${item.id}`}
                    onClick={() => setActiveTab('reports', activeReportSubTab || 'daily-sales')}
                    className={`w-full flex items-center justify-center px-0 py-3 rounded-2xl text-sm font-medium transition-all duration-200 border border-transparent cursor-pointer ${
                      isActive
                        ? 'bg-gray-100/80 text-[#1C1C1C] font-semibold shadow-2xs'
                        : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
                    }`}
                    title={item.name}
                  >
                    <Icon className={`w-5 h-5 flex-shrink-0 transition-transform duration-200 ${
                      isActive ? 'scale-105 text-[#1C1C1C]' : 'text-gray-500 group-hover:text-gray-800'
                    }`} />
                  </button>

                  {/* Sleek Hover/Flyout Popup Sub-Menu when Collapsed */}
                  <div className="absolute left-full top-0 ml-2.5 w-60 bg-white border border-gray-200/90 rounded-2xl shadow-xl p-2.5 z-50 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-auto before:content-[''] before:absolute before:-left-3 before:top-0 before:w-4 before:h-full">
                    <div className="px-2.5 py-1.5 border-b border-gray-100 mb-1 flex items-center justify-between">
                      <span className="font-extrabold text-xs text-[#1C1C1C] flex items-center gap-2">
                        <FileText className="w-3.5 h-3.5 text-blue-600" />
                        Reports Operations
                      </span>
                      <span className="text-[10px] font-bold bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">6 Modules</span>
                    </div>
                    <div className="space-y-1 mt-1">
                      {reportSubItems.map((sub) => {
                        const SubIcon = sub.icon;
                        const isSubActive = activeTab === 'reports' && (activeReportSubTab === sub.id || (!activeReportSubTab && sub.id === 'daily-sales'));
                        return (
                          <button
                            key={sub.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveTab('reports', sub.id);
                            }}
                            title={sub.fullName || sub.name}
                            className={`w-full flex items-start gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                              isSubActive
                                ? 'bg-[#1C1C1C] text-white font-bold shadow-2xs'
                                : 'text-gray-600 hover:bg-gray-100 hover:text-[#1C1C1C]'
                            }`}
                          >
                            <SubIcon className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${isSubActive ? 'text-white' : 'text-blue-600'}`} />
                            <span className="whitespace-normal text-xs leading-snug text-left">{sub.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div key={item.id} className="space-y-1">
                <button
                  id={`tab-btn-${item.id}`}
                  onClick={() => {
                    if (activeTab !== 'reports') {
                      setActiveTab('reports', activeReportSubTab || 'daily-sales');
                      setIsReportsExpanded(true);
                    } else {
                      setIsReportsExpanded(!isReportsExpanded);
                    }
                  }}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl text-sm font-medium transition-all duration-200 border border-transparent cursor-pointer ${
                    isActive
                      ? 'bg-gray-100/80 text-[#1C1C1C] font-semibold shadow-2xs'
                      : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
                  }`}
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <Icon className={`w-5 h-5 flex-shrink-0 transition-transform duration-200 ${
                      isActive ? 'scale-105 text-[#1C1C1C]' : 'text-gray-500 group-hover:text-gray-800'
                    }`} />
                    <span className="truncate text-xs font-semibold">{item.name}</span>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${
                    isReportsExpanded ? 'rotate-180 text-gray-700' : ''
                  }`} />
                </button>

                {/* Expanded Sub-Menu Links */}
                {isReportsExpanded && (
                  <div className="ml-5 pl-3 border-l-2 border-gray-100 space-y-1 py-1 transition-all duration-200">
                    {reportSubItems.map((sub) => {
                      const SubIcon = sub.icon;
                      const isSubActive = activeTab === 'reports' && (activeReportSubTab === sub.id || (!activeReportSubTab && sub.id === 'daily-sales'));
                      return (
                        <button
                          key={sub.id}
                          id={`sub-tab-btn-${sub.id}`}
                          onClick={() => {
                            setActiveTab('reports', sub.id);
                            setIsReportsExpanded(true);
                          }}
                          title={sub.fullName || sub.name}
                          className={`w-full flex items-start gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                            isSubActive
                              ? 'bg-[#1C1C1C] text-white font-bold shadow-2xs'
                              : 'text-gray-500 hover:bg-gray-100/70 hover:text-gray-900'
                          }`}
                        >
                          <SubIcon className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${isSubActive ? 'text-white' : 'text-gray-400'}`} />
                          <span className="whitespace-normal text-xs leading-snug text-left">{sub.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          if (item.id === 'admin') {
            if (isCollapsed) {
              return (
                <div key={item.id} className="relative group">
                  <button
                    id={`tab-btn-${item.id}`}
                    onClick={() => setActiveTab('admin', activeAdminSubTab || 'tanks')}
                    className={`w-full flex items-center justify-center px-0 py-3 rounded-2xl text-sm font-medium transition-all duration-200 border border-transparent cursor-pointer ${
                      isActive
                        ? 'bg-gray-100/80 text-[#1C1C1C] font-semibold shadow-2xs'
                        : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
                    }`}
                    title={item.name}
                  >
                    <Icon className={`w-5 h-5 flex-shrink-0 transition-transform duration-200 ${
                      isActive ? 'scale-105 text-[#1C1C1C]' : 'text-gray-500 group-hover:text-gray-800'
                    }`} />
                  </button>

                  {/* Sleek Hover/Flyout Popup Sub-Menu when Collapsed */}
                  <div className="absolute left-full top-0 ml-2.5 w-60 bg-white border border-gray-200/90 rounded-2xl shadow-xl p-2.5 z-50 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-auto before:content-[''] before:absolute before:-left-3 before:top-0 before:w-4 before:h-full">
                    <div className="px-2.5 py-1.5 border-b border-gray-100 mb-1 flex items-center justify-between">
                      <span className="font-extrabold text-xs text-[#1C1C1C] flex items-center gap-2">
                        <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                        Admin Controls
                      </span>
                      <span className="text-[10px] font-bold bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">5 Modules</span>
                    </div>
                    <div className="space-y-1 mt-1">
                      {adminSubItems.map((sub) => {
                        const SubIcon = sub.icon;
                        const isSubActive = activeTab === 'admin' && (activeAdminSubTab === sub.id || (!activeAdminSubTab && sub.id === 'tanks'));
                        return (
                          <button
                            key={sub.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveTab('admin', sub.id);
                            }}
                            title={sub.fullName || sub.name}
                            className={`w-full flex items-start gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                              isSubActive
                                ? 'bg-[#1C1C1C] text-white font-bold shadow-2xs'
                                : 'text-gray-600 hover:bg-gray-100 hover:text-[#1C1C1C]'
                            }`}
                          >
                            <SubIcon className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${isSubActive ? 'text-white' : 'text-blue-600'}`} />
                            <span className="whitespace-normal text-xs leading-snug text-left">{sub.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div key={item.id} className="space-y-1">
                <button
                  id={`tab-btn-${item.id}`}
                  onClick={() => {
                    if (activeTab !== 'admin') {
                      setActiveTab('admin', activeAdminSubTab || 'tanks');
                      setIsAdminExpanded(true);
                    } else {
                      setIsAdminExpanded(!isAdminExpanded);
                    }
                  }}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl text-sm font-medium transition-all duration-200 border border-transparent cursor-pointer ${
                    isActive
                      ? 'bg-gray-100/80 text-[#1C1C1C] font-semibold shadow-2xs'
                      : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
                  }`}
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <Icon className={`w-5 h-5 flex-shrink-0 transition-transform duration-200 ${
                      isActive ? 'scale-105 text-[#1C1C1C]' : 'text-gray-500 group-hover:text-gray-800'
                    }`} />
                    <span className="truncate text-xs font-semibold">{item.name}</span>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${
                    isAdminExpanded ? 'rotate-180 text-gray-700' : ''
                  }`} />
                </button>

                {/* Expanded Sub-Menu Links */}
                {isAdminExpanded && (
                  <div className="ml-5 pl-3 border-l-2 border-gray-100 space-y-1 py-1 transition-all duration-200">
                    {adminSubItems.map((sub) => {
                      const SubIcon = sub.icon;
                      const isSubActive = activeTab === 'admin' && (activeAdminSubTab === sub.id || (!activeAdminSubTab && sub.id === 'tanks'));
                      return (
                        <button
                          key={sub.id}
                          id={`admin-sub-tab-btn-${sub.id}`}
                          onClick={() => {
                            setActiveTab('admin', sub.id);
                            setIsAdminExpanded(true);
                          }}
                          title={sub.fullName || sub.name}
                          className={`w-full flex items-start gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                            isSubActive
                              ? 'bg-[#1C1C1C] text-white font-bold shadow-2xs'
                              : 'text-gray-500 hover:bg-gray-100/70 hover:text-gray-900'
                          }`}
                        >
                          <SubIcon className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${isSubActive ? 'text-white' : 'text-gray-400'}`} />
                          <span className="whitespace-normal text-xs leading-snug text-left">{sub.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          return (
            <div key={item.id} className="relative group">
              <button
                id={`tab-btn-${item.id}`}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center ${
                  isCollapsed ? 'justify-center px-0 py-3' : 'justify-start gap-3.5 px-4 py-3'
                } rounded-2xl text-sm font-medium transition-all duration-200 border border-transparent cursor-pointer ${
                  isActive
                    ? 'bg-gray-100/80 text-[#1C1C1C] font-semibold shadow-2xs'
                    : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
                }`}
                title={isCollapsed ? item.name : undefined}
              >
                <Icon className={`w-5 h-5 flex-shrink-0 transition-transform duration-200 ${
                  isActive ? 'scale-105 text-[#1C1C1C]' : 'text-gray-500 group-hover:text-gray-800'
                }`} />
                
                {!isCollapsed && (
                  <span className="truncate text-xs font-semibold">{item.name}</span>
                )}
              </button>

              {/* Hover Tooltip when Collapsed */}
              {isCollapsed && (
                <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-3 py-1.5 bg-[#1C1C1C] text-white text-xs font-bold rounded-xl opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-200 whitespace-nowrap shadow-md z-50">
                  {item.name}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Minimal Footer */}
      <div id="sidebar-footer" className="p-3 border-t border-gray-100/80 text-center">
        {!isCollapsed ? (
          <p className="text-[10px] font-medium text-gray-400">
            FuelFlow ERP v1.0.0
          </p>
        ) : (
          <p className="text-[9px] font-bold text-gray-400">v1.0</p>
        )}
      </div>
    </div>
  );
}

