import React, { useState, useMemo } from 'react';
import { FuelTank, FuelType, PriceSchedule, AuthUser } from '../types';
import { Calendar, Trash2, Clock, Tag, Edit2, Save, X, CheckCircle2 } from 'lucide-react';
import { supabase, getTanksTableName } from '../lib/supabase';
import { isAdmin } from '../lib/auth';

interface PriceManagementTabProps {
  tanks: FuelTank[];
  setTanks: React.Dispatch<React.SetStateAction<FuelTank[]>>;
  priceSchedules: PriceSchedule[];
  setPriceSchedules: React.Dispatch<React.SetStateAction<PriceSchedule[]>>;
  user?: AuthUser | null;
  userRole?: string;
}

export default function PriceManagementTab({ tanks, setTanks, priceSchedules, setPriceSchedules, user, userRole }: PriceManagementTabProps) {
  const [editingTankId, setEditingTankId] = useState<string | null>(null);
  const [tempPrice, setTempPrice] = useState<number>(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const [schedFuelType, setSchedFuelType] = useState<FuelType>('Petrol 92');
  const [schedPrice, setSchedPrice] = useState<number>(0);
  const [schedDate, setSchedDate] = useState<string>('');

  const handleAddSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!schedDate || schedPrice <= 0) return;

    const newSchedule: PriceSchedule = {
      id: `sched-${Date.now()}`,
      fuelType: schedFuelType,
      newPrice: schedPrice,
      effectiveDate: schedDate,
      status: 'Pending'
    };

    setPriceSchedules(prev => [...prev, newSchedule]);
    
    try {
      await supabase.from('price_schedules').insert([{
        id: newSchedule.id,
        fueltype: newSchedule.fuelType,
        newprice: newSchedule.newPrice,
        effectivedate: newSchedule.effectiveDate,
        status: newSchedule.status
      }]);
    } catch (err) {
      console.warn("Supabase price schedule insert warning:", err);
    }

    setSchedPrice(0);
    setSchedDate('');
    showToast(`Price schedule logged for ${newSchedule.fuelType} effective ${new Date(schedDate).toLocaleString()}.`);
  };

  const handleCancelSchedule = async (id: string) => {
    if (!window.confirm("Are you sure you want to cancel this price schedule?")) return;
    const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
    if (isConfigured) {
      try {
        const { error } = await supabase.from('price_schedules').delete().eq('id', id);
        if (error) console.warn("Supabase schedule delete error:", error.message);
      } catch (err) {
        console.warn("Schedule delete error:", err);
      }
    }
    const updated = priceSchedules.filter(s => s.id !== id);
    setPriceSchedules(updated);
    try {
      localStorage.setItem('fms_priceSchedules', JSON.stringify(updated));
    } catch (_) {}
    showToast("Pending price schedule cancelled.");
  };

  const handleStartEdit = (tank: FuelTank) => {
    setEditingTankId(tank.id);
    setTempPrice(tank.pricePerLiter);
  };

  const handleSaveEdit = async (tankId: string) => {
    if (tempPrice <= 0) return;
    const updated = tanks.map(t => {
      if (t.id === tankId) {
        return {
          ...t,
          pricePerLiter: tempPrice
        };
      }
      return t;
    });
    setTanks(updated);
    setEditingTankId(null);

    // Save to localStorage immediately
    try {
      localStorage.setItem('fms_tanks', JSON.stringify(updated));
      const priceMap: { [fuelType: string]: number } = {};
      updated.forEach(t => {
        if (t.fuelType) priceMap[t.fuelType] = t.pricePerLiter;
      });
      localStorage.setItem('fuel_flow_fuel_prices', JSON.stringify(priceMap));
    } catch (_) {}

    const targetTank = updated.find(t => t.id === tankId);
    if (targetTank) {
      let sbSuccess = false;
      let lastErrMsg = '';

      // 1. Direct update to fuel_tanks / fuel_tank
      try {
        const tableName = getTanksTableName();
        const { error: err1 } = await supabase.from(tableName).update({ priceperliter: tempPrice, price_per_liter: tempPrice }).eq('id', tankId);
        if (err1) {
          const { error: err2 } = await supabase.from(tableName).update({ priceperliter: tempPrice }).eq('id', tankId);
          if (err2) {
            const { error: err3 } = await supabase.from(tableName).update({ price_per_liter: tempPrice }).eq('id', tankId);
            if (!err3) sbSuccess = true;
            else lastErrMsg = err3.message || String(err3);
          } else {
            sbSuccess = true;
          }
        } else {
          sbSuccess = true;
        }
      } catch (err: any) {
        lastErrMsg = err?.message || String(err);
        console.warn("Supabase update price error:", err);
      }

      // 2. Direct update to underground_tanks table if exists
      try {
        await supabase.from('underground_tanks').update({ price_per_liter: tempPrice, priceperliter: tempPrice }).eq('id', tankId);
      } catch (_) {}

      // 3. Direct upsert to fuel_prices table if exists
      try {
        await supabase.from('fuel_prices').upsert([
          { id: tankId, fuel_type: targetTank.fuelType, price: tempPrice, price_per_liter: tempPrice, updated_at: new Date().toISOString() },
          { id: targetTank.fuelType, fuel_type: targetTank.fuelType, price: tempPrice, price_per_liter: tempPrice, updated_at: new Date().toISOString() }
        ]);
      } catch (_) {}

      // 4. Direct update to products table if exists
      try {
        await supabase.from('products').update({ price: tempPrice, selling_price: tempPrice, unit_price: tempPrice }).eq('name', targetTank.fuelType);
      } catch (_) {}

      // 5. Broadcast global events for instant app-wide synchronization
      window.dispatchEvent(new CustomEvent('fuel-prices-updated', {
        detail: { updatedTanks: updated, fuelType: targetTank.fuelType, newPrice: tempPrice, tankId }
      }));
      window.dispatchEvent(new CustomEvent('tanks-updated', {
        detail: { tanks: updated }
      }));

      if (sbSuccess || !lastErrMsg) {
        showToast(`✓ Retail price for ${targetTank.name} (${targetTank.fuelType}) saved & synced to Rs. ${tempPrice.toFixed(2)}.`);
      } else {
        showToast(`Price updated locally. Database sync notice: ${lastErrMsg}`);
      }
    }
  };

    const handleCancelEdit = () => {
    setEditingTankId(null);
    setTempPrice(0);
  };

  const formatCurrency = (val: number) => {
    return `Rs. ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val)}`;
  };

  // Naturally sort tanks in ascending order (Tank 01, Tank 02, etc.)
  const sortedTanks = useMemo(() => {
    return [...tanks].sort((a, b) => (a.name || a.id || '').localeCompare(b.name || b.id || '', undefined, { numeric: true, sensitivity: 'base' }));
  }, [tanks]);

  // Group tanks by fuel type to display nicely
  const fuelTypes = Array.from(new Set(sortedTanks.map(t => t.fuelType)));

  return (
    <div id="price-management-root" className="space-y-4 w-full max-w-6xl mx-auto animate-fade-in pb-12">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100 bg-gray-50/50">
          <h3 className="font-bold text-[#1C1C1C] text-sm uppercase tracking-wider">Current Retail Prices</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-gray-50/90 backdrop-blur-sm">
              <tr className="border-b border-gray-100 text-gray-500 font-bold text-xs uppercase tracking-wider">
                <th className="py-4 px-6">Product</th>
                <th className="py-4 px-6">Storage Tank</th>
                <th className="py-4 px-6 text-right">Selling Price (per Liter)</th>
                <th className="py-4 px-6 text-center w-32">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 text-sm">
              {sortedTanks.map((tank) => (
                <tr key={tank.id} className="hover:bg-gray-50/50 transition-colors group">
                  <td className="py-4 px-6">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold ${
                      tank.fuelType.includes('Petrol') ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'
                    }`}>
                      {tank.fuelType}
                    </span>
                  </td>
                  <td className="py-4 px-6 text-gray-600 font-medium">
                    {tank.name}
                  </td>
                  <td className="py-4 px-6 text-right">
                    {editingTankId === tank.id ? (
                      <div className="flex items-center justify-end gap-2">
                        <span className="text-sm font-bold text-gray-500">Rs.</span>
                        <input
                          type="number"
                          step="0.01"
                          value={tempPrice}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => setTempPrice(parseFloat(e.target.value) || 0)}
                          className="w-24 px-3 py-1.5 border border-blue-500 bg-white text-[#1C1C1C] rounded-lg tabular-nums font-semibold text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-right"
                          autoFocus
                        />
                      </div>
                    ) : (
                      <span className="tabular-nums font-extrabold text-lg text-[#1C1C1C]">
                        {formatCurrency(tank.pricePerLiter)}
                      </span>
                    )}
                  </td>
                  <td className="py-4 px-6 text-center">
                    {editingTankId === tank.id ? (
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={handleCancelEdit}
                          className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
                          title="Cancel"
                        >
                          <X className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleSaveEdit(tank.id)}
                          className="p-1.5 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                          title="Save Price"
                        >
                          <Save className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleStartEdit(tank)}
                        className="flex items-center justify-center gap-2 w-full px-3 py-1.5 bg-gray-50 hover:bg-blue-50 text-gray-600 hover:text-blue-600 border border-gray-200 hover:border-blue-200 rounded-lg transition-colors font-medium text-xs cursor-pointer"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        <span>Edit</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Schedule Future Price Change Section */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mt-6">
        <div className="px-6 py-5 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-gray-500" />
            <h3 className="font-bold text-[#1C1C1C] text-sm uppercase tracking-wider">Schedule Future Price Change</h3>
          </div>
        </div>
        <div className="p-6">
          <form onSubmit={handleAddSchedule} className="flex flex-col md:flex-row gap-4 items-end">
            <div className="flex-1 w-full">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1.5">Fuel Type</label>
              <select
                value={schedFuelType}
                onChange={(e) => setSchedFuelType(e.target.value as FuelType)}
                className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-[#1C1C1C] text-sm focus:outline-none focus:border-blue-500"
              >
                {fuelTypes.map(ft => (
                  <option key={ft} value={ft}>{ft}</option>
                ))}
              </select>
            </div>
            <div className="flex-1 w-full">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1.5">New Selling Price (per Liter)</label>
              <div className="relative">
                <span className="absolute left-3.5 top-2.5 text-sm font-bold text-gray-500">Rs.</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={schedPrice || ''}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setSchedPrice(parseFloat(e.target.value) || 0)}
                  className="w-full pl-10 pr-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-[#1C1C1C] text-sm tabular-nums font-semibold focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <div className="flex-1 w-full">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1.5">Effective Date & Time</label>
              <input
                type="datetime-local"
                required
                value={schedDate}
                onChange={(e) => setSchedDate(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-[#1C1C1C] text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <button
              type="submit"
              className="w-full md:w-auto px-6 py-2.5 bg-[#1C1C1C] text-white font-bold text-sm rounded-xl hover:bg-gray-800 transition-all shadow-md cursor-pointer"
            >
              Schedule
            </button>
          </form>
        </div>
      </div>

      {/* Pending Price Schedules */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mt-6">
        <div className="px-6 py-5 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-gray-500" />
            <h3 className="font-bold text-[#1C1C1C] text-sm uppercase tracking-wider">Pending Price Schedules</h3>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-gray-50/90 backdrop-blur-sm">
              <tr className="border-b border-gray-100 text-gray-500 font-bold text-xs uppercase tracking-wider">
                <th className="py-4 px-6">Product</th>
                <th className="py-4 px-6 text-right">Scheduled Price</th>
                <th className="py-4 px-6">Target Time</th>
                <th className="py-4 px-6">Status</th>
                <th className="py-4 px-6 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 text-sm">
              {priceSchedules.length > 0 ? (
                priceSchedules.map((sched) => (
                  <tr key={sched.id} className="hover:bg-gray-50/50 transition-colors group">
                    <td className="py-4 px-6">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold ${
                        sched.fuelType.includes('Petrol') ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'
                      }`}>
                        {sched.fuelType}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-right">
                      <span className="tabular-nums font-extrabold text-[#1C1C1C]">
                        {formatCurrency(sched.newPrice)}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-gray-600 font-medium">
                      {new Date(sched.effectiveDate).toLocaleString()}
                    </td>
                    <td className="py-4 px-6">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${
                        sched.status === 'Pending' ? 'bg-amber-100 text-amber-700' :
                        sched.status === 'Applied' ? 'bg-emerald-100 text-emerald-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>
                        {sched.status}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-center">
                      {sched.status === 'Pending' && isAdmin(user?.role || userRole) && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            handleCancelSchedule(sched.id);
                          }}
                          className="flex items-center justify-center gap-1.5 w-full px-3 py-1.5 bg-gray-50 hover:bg-red-50 text-gray-500 hover:text-red-600 border border-gray-200 hover:border-red-200 rounded-lg transition-colors font-medium text-xs cursor-pointer z-30"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Cancel</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-gray-400 font-medium text-sm">
                    No active price schedules found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-[#1C1C1C] text-white px-4 py-3 rounded-xl shadow-2xl border border-white/10 text-xs font-semibold animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
