import React, { useState, useEffect } from 'react';
import { Flame, AlertTriangle, Info, Edit3, Plus, Minus, Check, X, Layers, Tag } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { LPGasItem } from '../types';

interface LPGasInventoryTabProps {
  gasStock?: LPGasItem[];
  onUpdateGasStock?: (items: LPGasItem[]) => void;
}

const getStoredGasPrice = (size: string, defaultPrice: number): number => {
  try {
    const stored = localStorage.getItem('fuel_flow_gas_prices');
    if (stored) {
      const prices = JSON.parse(stored);
      if (size.includes('12.5') && prices['12.5kg']) return prices['12.5kg'];
      if (size.includes('5.0') && prices['5kg']) return prices['5kg'];
      if (size.includes('2.3') && prices['2.3kg']) return prices['2.3kg'];
    }
  } catch (_) {}
  return defaultPrice;
};

const DEFAULT_GAS_ITEMS: LPGasItem[] = [
  { id: 'gas-12.5kg', size: '12.5 kg', full_count: 0, empty_count: 0, selling_price: 3690, last_updated: new Date().toISOString() },
  { id: 'gas-37.5kg', size: '37.5 kg', full_count: 0, empty_count: 0, selling_price: 11200, last_updated: new Date().toISOString() },
  { id: 'gas-5.0kg', size: '5.0 kg', full_count: 0, empty_count: 0, selling_price: 1482, last_updated: new Date().toISOString() },
  { id: 'gas-2.3kg', size: '2.3 kg', full_count: 0, empty_count: 0, selling_price: 694, last_updated: new Date().toISOString() }
];

export default function LPGasInventoryTab({ gasStock, onUpdateGasStock }: LPGasInventoryTabProps) {
  const [gasItems, setGasItems] = useState<LPGasItem[]>(() => {
    if (gasStock && Array.isArray(gasStock) && gasStock.length > 0) {
      return gasStock;
    }
    try {
      const stored = localStorage.getItem('fuel_flow_gas_stock') || localStorage.getItem('fuel_flow_gas_inventory');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (_) {}
    return DEFAULT_GAS_ITEMS;
  });

  const [loading, setLoading] = useState(false);
  const [editingItem, setEditingItem] = useState<LPGasItem | null>(null);
  const [editEmptyValue, setEditEmptyValue] = useState<string>('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Sync when prop changes
  useEffect(() => {
    if (gasStock && Array.isArray(gasStock) && gasStock.length > 0) {
      setGasItems(gasStock);
    }
  }, [gasStock]);

  useEffect(() => {
    fetchGasItems();

    const handleUpdate = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail && Array.isArray(customEvent.detail.updatedInventory)) {
        setGasItems(customEvent.detail.updatedInventory);
        if (onUpdateGasStock) {
          onUpdateGasStock(customEvent.detail.updatedInventory);
        }
      } else {
        fetchGasItems();
      }
    };

    window.addEventListener('gas-inventory-updated', handleUpdate);
    window.addEventListener('storage', handleUpdate);
    window.addEventListener('focus', fetchGasItems);
    
    return () => {
      window.removeEventListener('gas-inventory-updated', handleUpdate);
      window.removeEventListener('storage', handleUpdate);
      window.removeEventListener('focus', fetchGasItems);
    };
  }, [onUpdateGasStock]);

  const fetchGasItems = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.from('gas_inventory').select('*');
      if (error && error.code !== 'PGRST205') {
        console.warn('Supabase gas_inventory fetch notice:', error.message || error);
      }
      
      if (data && data.length > 0) {
        const merged = DEFAULT_GAS_ITEMS.map(def => {
          const found = data.find((d: any) => d.id === def.id || d.size === def.size);
          const price = found?.selling_price || found?.unit_price || getStoredGasPrice(def.size, def.selling_price || 0);
          return found ? {
            ...def,
            ...found,
            full_count: Number(found.full_count) || 0,
            empty_count: Number(found.empty_count) || 0,
            selling_price: price,
            unit_price: price
          } : {
            ...def,
            selling_price: getStoredGasPrice(def.size, def.selling_price || 0),
            unit_price: getStoredGasPrice(def.size, def.selling_price || 0)
          };
        });

        setGasItems(merged);
        localStorage.setItem('fuel_flow_gas_stock', JSON.stringify(merged));
        localStorage.setItem('fuel_flow_gas_inventory', JSON.stringify(merged));
        if (onUpdateGasStock) {
          onUpdateGasStock(merged);
        }
      } else {
        let localItems: LPGasItem[] = [];
        try {
          const stored = localStorage.getItem('fuel_flow_gas_stock') || localStorage.getItem('fuel_flow_gas_inventory');
          if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed) && parsed.length > 0) localItems = parsed;
          }
        } catch (_) {}

        const itemsToUse = (localItems.length > 0 ? localItems : DEFAULT_GAS_ITEMS).map(item => ({
          ...item,
          selling_price: item.selling_price || getStoredGasPrice(item.size, 0)
        }));
        setGasItems(itemsToUse);
        localStorage.setItem('fuel_flow_gas_stock', JSON.stringify(itemsToUse));
        localStorage.setItem('fuel_flow_gas_inventory', JSON.stringify(itemsToUse));

        await supabase.from('gas_inventory').upsert(itemsToUse);
      }
    } catch (err: any) {
      if (err?.code !== 'PGRST205') {
        console.warn('Error fetching gas items:', err);
      }
      
      try {
        const localData = localStorage.getItem('fuel_flow_gas_stock') || localStorage.getItem('fuel_flow_gas_inventory');
        if (localData) {
          const parsed = JSON.parse(localData);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setGasItems(parsed);
          }
        }
      } catch (_) {}
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateEmptyCount = async (itemId: string, newCount: number) => {
    const safeCount = Math.max(0, Math.floor(newCount));
    const updated = gasItems.map(item => {
      if (item.id === itemId) {
        return {
          ...item,
          empty_count: safeCount,
          last_updated: new Date().toISOString()
        };
      }
      return item;
    });

    setGasItems(updated);
    try {
      localStorage.setItem('fuel_flow_gas_stock', JSON.stringify(updated));
      localStorage.setItem('fuel_flow_gas_inventory', JSON.stringify(updated));
    } catch (_) {}

    if (onUpdateGasStock) {
      onUpdateGasStock(updated);
    }

    window.dispatchEvent(new CustomEvent('gas-inventory-updated', {
      detail: { updatedInventory: updated }
    }));

    showToast('Empty cylinder stock updated successfully');

    // Supabase background sync
    try {
      const targetItem = updated.find(i => i.id === itemId);
      if (targetItem) {
        await supabase
          .from('gas_inventory')
          .upsert({
            id: targetItem.id,
            size: targetItem.size,
            full_count: targetItem.full_count,
            empty_count: targetItem.empty_count,
            last_updated: new Date().toISOString()
          });
      }
    } catch (err) {
      console.warn('Supabase gas_inventory sync notice:', err);
    }
  };

  const openEditModal = (item: LPGasItem) => {
    setEditingItem(item);
    setEditEmptyValue(String(item.empty_count || 0));
  };

  const handleSaveModalEdit = () => {
    if (!editingItem) return;
    const parsed = parseInt(editEmptyValue, 10);
    handleUpdateEmptyCount(editingItem.id, isNaN(parsed) ? 0 : parsed);
    setEditingItem(null);
  };

  const getStatusColor = (count: number) => {
    if (count <= 5) return 'text-red-600 bg-red-50 border-red-200';
    if (count <= 15) return 'text-amber-600 bg-amber-50 border-amber-200';
    return 'text-emerald-600 bg-emerald-50 border-emerald-200';
  };

  return (
    <div className="p-6 max-w-7xl mx-auto h-[calc(100vh-64px)] overflow-y-auto">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white text-xs font-bold px-4 py-3 rounded-xl shadow-xl flex items-center gap-2 border border-slate-700 animate-fade-in">
          <Check className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <div className="p-1.5 bg-orange-100 rounded-lg">
              <Flame className="w-5 h-5 text-orange-600" />
            </div>
            LP Gas Inventory
          </h1>
          <p className="text-xs text-slate-500 mt-1">Manage Litro Gas cylinder stock and returns</p>
        </div>
        <div className="flex items-center gap-2 bg-orange-50 border border-orange-100 text-orange-800 px-3 py-2 rounded-lg text-xs">
          <Info className="w-4 h-4 text-orange-600 shrink-0" />
          <span>Full Cylinders update from Purchases. Empty stock can be adjusted directly below.</span>
        </div>
      </div>

      {/* Inventory Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {gasItems.map(item => (
          <div key={item.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col hover:border-orange-200 transition-all">
            <div className="p-5 border-b border-gray-100 bg-gradient-to-r from-orange-50/50 to-white">
              <div className="flex justify-between items-start mb-1">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">{item.size}</h3>
                  <p className="text-xs text-gray-500">
                    {item.size === '12.5 kg' ? 'Standard Household' : 
                     item.size === '37.5 kg' ? 'Commercial Industrial' :
                     item.size === '5.0 kg' ? 'Buddy' : 'Portable'}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {(item.selling_price || getStoredGasPrice(item.size, 0)) > 0 && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-extrabold text-orange-950 bg-orange-100/80 px-2 py-0.5 rounded-md border border-orange-200">
                      <Tag className="w-2.5 h-2.5 text-orange-600" />
                      Rs. {(item.selling_price || getStoredGasPrice(item.size, 0)).toLocaleString()}
                    </span>
                  )}
                  {item.full_count < 15 && (
                    <div className="flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                      <AlertTriangle className="w-2.5 h-2.5" />
                      Low Full Stock
                    </div>
                  )}
                </div>
              </div>
            </div>
            
            <div className="p-5 flex-1 flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                {/* Full Cylinders (Auto from Purchases) */}
                <div className="flex flex-col">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Full Cylinders</span>
                  </div>
                  <div className={`text-2xl font-black p-3 rounded-lg border ${getStatusColor(item.full_count)} text-center flex items-center justify-center min-h-[56px]`}>
                    {item.full_count}
                  </div>
                  <span className="text-[10px] text-gray-400 mt-1 text-center font-medium">Auto-synced</span>
                </div>

                {/* Empty Cylinders (Manually Adjustable) */}
                <div className="flex flex-col">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Empty Cylinders</span>
                  </div>
                  <div className="relative group">
                    <div className="text-2xl font-black p-3 rounded-lg border border-slate-200 bg-slate-50 text-slate-800 text-center flex items-center justify-center min-h-[56px]">
                      {item.empty_count}
                    </div>
                  </div>
                  
                  {/* Quick Inline Steppers & Adjust Button */}
                  <div className="flex items-center justify-between gap-1 mt-1.5">
                    <button
                      type="button"
                      onClick={() => handleUpdateEmptyCount(item.id, Math.max(0, item.empty_count - 1))}
                      disabled={item.empty_count <= 0}
                      className="flex-1 py-1 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 disabled:hover:bg-gray-100 text-gray-700 font-bold text-xs rounded flex items-center justify-center transition-colors cursor-pointer"
                      title="Decrease by 1"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditModal(item)}
                      className="px-2 py-1 bg-orange-100 hover:bg-orange-200 text-orange-800 font-semibold text-[11px] rounded flex items-center justify-center gap-1 transition-colors cursor-pointer"
                      title="Direct Edit Empty Count"
                    >
                      <Edit3 className="w-2.5 h-2.5" />
                      <span>Edit</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleUpdateEmptyCount(item.id, item.empty_count + 1)}
                      className="flex-1 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs rounded flex items-center justify-center transition-colors cursor-pointer"
                      title="Increase by 1"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
              
              <div className="mt-auto pt-4 border-t border-gray-100 flex justify-between items-center text-xs text-gray-500">
                <span className="font-medium">Total Cylinders on Site</span>
                <span className="font-black text-slate-800 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200">
                  {item.full_count + item.empty_count} units
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Edit Empty Cylinders Modal */}
      {editingItem && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center bg-orange-50/50">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-orange-100 text-orange-700 rounded-lg">
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 text-sm">Adjust Empty Stock</h3>
                  <p className="text-xs text-gray-500 font-medium">{editingItem.size} Cylinders</p>
                </div>
              </div>
              <button 
                onClick={() => setEditingItem(null)}
                className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wide">
                  Current Empty Cylinders Count
                </label>
                <input 
                  type="number"
                  min="0"
                  value={editEmptyValue}
                  onChange={e => setEditEmptyValue(e.target.value)}
                  className="w-full px-3 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-base font-bold text-slate-800 focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 outline-none transition-all"
                  autoFocus
                />
              </div>

              {/* Quick Offset Presets */}
              <div>
                <span className="text-[11px] font-semibold text-gray-500 block mb-1.5">Quick Adjust</span>
                <div className="grid grid-cols-4 gap-1.5">
                  {[
                    { label: '-10', val: -10 },
                    { label: '-5', val: -5 },
                    { label: '+5', val: 5 },
                    { label: '+10', val: 10 }
                  ].map(preset => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        const cur = parseInt(editEmptyValue, 10) || 0;
                        setEditEmptyValue(String(Math.max(0, cur + preset.val)));
                      }}
                      className="py-1.5 text-xs font-bold bg-gray-100 hover:bg-orange-100 hover:text-orange-800 text-gray-700 rounded-lg transition-colors cursor-pointer"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-5 py-3.5 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="px-3.5 py-2 border border-gray-200 text-gray-600 hover:bg-gray-100 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveModalEdit}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Save Stock</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
