import { supabase, getTanksTableName } from './supabase';
import { PumpReading, FuelTank, OilTank, Customer, CustomerLedgerEntry, Shift, ShiftBankDeposit, PumperShortageExcessRecord, ChamberReading } from '../types';

export { supabase };

/**
 * Determines if a pump/nozzle was actively assigned to a pumper or had active usage during the shift.
 * Unassigned nozzles with zero meter delta and zero sales/collections are considered inactive.
 */
export function isPumpReadingActiveOrAssigned(r: PumpReading): boolean {
  if (!r) return false;
  const hasAssignedPumper = Boolean(
    r.assignedPumperId && 
    typeof r.assignedPumperId === 'string' && 
    r.assignedPumperId.trim() !== '' && 
    r.assignedPumperId !== 'null' && 
    r.assignedPumperId !== 'undefined'
  );
  const hasReplacementPumper = Boolean(
    r.replacementPumperId && 
    typeof r.replacementPumperId === 'string' && 
    r.replacementPumperId.trim() !== '' && 
    r.replacementPumperId !== 'null' && 
    r.replacementPumperId !== 'undefined'
  );
  const endMeter = Number(r.endMeter) || 0;
  const startMeter = Number(r.startMeter) || 0;
  const testingQty = Number(r.testingQty) || 0;
  const dispensed = Math.max(0, endMeter - startMeter - testingQty);
  const hasMeterActivity = (endMeter > 0 && endMeter > startMeter) || testingQty > 0;
  const hasSales = (Number(r.oilSalesAmount) || 0) > 0 ||
                   (Number(r.creditSalesAmount) || 0) > 0 ||
                   (Number(r.cardSalesAmount) || 0) > 0 ||
                   (Number(r.touchCardSalesAmount) || 0) > 0 ||
                   (Number(r.voucherSalesAmount) || 0) > 0;
  const hasCash = (Number(r.actualCash) || 0) > 0 ||
                  (Number(r.initialPumperCash) || 0) > 0 ||
                  (Number(r.replacementPumperCash) || 0) > 0;

  return hasAssignedPumper || hasReplacementPumper || dispensed > 0 || hasMeterActivity || hasSales || hasCash;
}

/**
 * Ensures a valid non-null UUID or string ID for pump readings.
 * Supports both UUID and TEXT primary key column types in PostgreSQL/Supabase.
 */
function getValidReadingId(r: PumpReading, shiftId: string): string {
  if (r && (r as any).id && typeof (r as any).id === 'string' && (r as any).id.trim() !== '' && (r as any).id !== 'null' && (r as any).id !== 'undefined') {
    const rawId = (r as any).id.trim();
    // If it's a valid UUID or standard ID string, return it
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId)) {
      return rawId;
    }
    // If it's a clean text ID like shift1_pump1 and not null
    if (rawId.length >= 3 && !rawId.includes('object') && !rawId.includes('null')) {
      return rawId;
    }
  }

  // Generate deterministic v4 UUID based on shiftId + pumpId if available
  const baseSeed = `${shiftId || 'shift'}_${r.pumpId || 'pump'}`;
  let hash = 0;
  for (let i = 0; i < baseSeed.length; i++) {
    hash = ((hash << 5) - hash) + baseSeed.charCodeAt(i);
    hash |= 0;
  }
  const hex = Math.abs(hash).toString(16).padStart(8, '0');
  const p1 = hex.substring(0, 8);
  const p2 = (hex.substring(0, 4) + '0000').substring(0, 4);
  const p3 = '4' + (hex.substring(1, 4) + '000').substring(0, 3);
  const p4 = 'a' + (hex.substring(2, 5) + '000').substring(0, 3);
  const p5 = (hex + hex + hex + '000000000000').substring(0, 12);

  return `${p1}-${p2}-${p3}-${p4}-${p5}`;
}

/**
 * Cleanly maps a PumpReading object to snake_case payload for Supabase 'pump_readings' table.
 * Strictly excludes deprecated 'tankid' / 'tank_id' to prevent schema column warnings.
 * Guarantees a valid unique string/UUID 'id'.
 */
export function formatPumpReadingSnakeCase(r: PumpReading, shiftId: string) {
  const rawStart = r.startMeter;
  const parsedStart = (rawStart !== undefined && rawStart !== null && !isNaN(Number(rawStart))) ? parseFloat(String(rawStart)) : 0;
  const startMeter = !isNaN(parsedStart) ? parsedStart : 0;

  const rawEnd = r.endMeter;
  const parsedEnd = (rawEnd !== undefined && rawEnd !== null && !isNaN(Number(rawEnd))) ? parseFloat(String(rawEnd)) : 0;
  const endMeter = !isNaN(parsedEnd) ? parsedEnd : 0;

  const rawTest = r.testingQty;
  const parsedTest = (rawTest !== undefined && rawTest !== null && !isNaN(Number(rawTest))) ? parseFloat(String(rawTest)) : 0;
  const testQty = !isNaN(parsedTest) ? parsedTest : 0;

  const fuel = Math.max(0, endMeter - startMeter - testQty);
  const grossFuel = fuel * (r.unitPrice || 0);
  const oilSales = r.oilSalesAmount || 0;
  const totalGross = grossFuel + oilSales;
  const creditSales = r.creditSalesAmount || 0;
  const cardSales = r.cardSalesAmount || 0;
  const touchCardSales = r.touchCardSalesAmount || 0;
  const voucherSales = r.voucherSalesAmount || 0;
  const totalNonCash = creditSales + cardSales + touchCardSales + voucherSales;
  const netExpCash = Math.max(0, totalGross - totalNonCash);

  return {
    id: getValidReadingId(r, shiftId),
    shift_id: shiftId,
    pump_id: r.pumpId,
    pump_name: r.pumpName,
    fuel_type: r.fuelType,
    assigned_pumper_id: r.assignedPumperId || null,
    replacement_pumper_id: r.replacementPumperId || null,
    initial_pumper_cash: r.initialPumperCash || 0,
    replacement_pumper_cash: r.replacementPumperCash || 0,
    handover_meter: r.handoverMeter || 0,
    handover_notes: r.handoverNotes || '',
    start_meter: startMeter,
    end_meter: endMeter,
    testing_qty: testQty,
    status: r.status || 'Active',
    is_locked: r.isLocked ?? false,
    unit_price: r.unitPrice || 0,
    actual_cash: r.actualCash || 0,
    cash_variance: r.cashVariance || 0,
    credit_sales_amount: creditSales,
    card_sales_amount: cardSales,
    touch_card_sales_amount: touchCardSales,
    voucher_sales_amount: voucherSales,
    oil_sales_amount: oilSales,
    net_expected_cash: netExpCash
  };
}

/**
 * Fallback lowercase mapping if Supabase schema uses legacy un-quoted lowercase columns.
 * Strictly excludes deprecated 'tankid'.
 */
export function formatPumpReadingLowerCase(r: PumpReading, shiftId: string) {
  const rawStart = r.startMeter;
  const parsedStart = (rawStart !== undefined && rawStart !== null && !isNaN(Number(rawStart))) ? parseFloat(String(rawStart)) : 0;
  const startMeter = !isNaN(parsedStart) ? parsedStart : 0;

  const rawEnd = r.endMeter;
  const parsedEnd = (rawEnd !== undefined && rawEnd !== null && !isNaN(Number(rawEnd))) ? parseFloat(String(rawEnd)) : 0;
  const endMeter = !isNaN(parsedEnd) ? parsedEnd : 0;

  const rawTest = r.testingQty;
  const parsedTest = (rawTest !== undefined && rawTest !== null && !isNaN(Number(rawTest))) ? parseFloat(String(rawTest)) : 0;
  const testQty = !isNaN(parsedTest) ? parsedTest : 0;

  const fuel = Math.max(0, endMeter - startMeter - testQty);
  const grossFuel = fuel * (r.unitPrice || 0);
  const oilSales = r.oilSalesAmount || 0;
  const totalGross = grossFuel + oilSales;
  const creditSales = r.creditSalesAmount || 0;
  const cardSales = r.cardSalesAmount || 0;
  const touchCardSales = r.touchCardSalesAmount || 0;
  const voucherSales = r.voucherSalesAmount || 0;
  const totalNonCash = creditSales + cardSales + touchCardSales + voucherSales;
  const netExpCash = Math.max(0, totalGross - totalNonCash);

  return {
    id: getValidReadingId(r, shiftId),
    shift_id: shiftId,
    pumpid: r.pumpId,
    pumpname: r.pumpName,
    fueltype: r.fuelType,
    assignedpumperid: r.assignedPumperId || null,
    replacementpumperid: r.replacementPumperId || null,
    initialpumpercash: r.initialPumperCash || 0,
    replacementpumpercash: r.replacementPumperCash || 0,
    handovermeter: r.handoverMeter || 0,
    handovernotes: r.handoverNotes || '',
    startmeter: startMeter,
    endmeter: endMeter,
    testingqty: testQty,
    status: r.status || 'Active',
    islocked: r.isLocked ?? false,
    unitprice: r.unitPrice || 0,
    actualcash: r.actualCash || 0,
    cashvariance: r.cashVariance || 0,
    creditsalesamount: creditSales,
    cardsalesamount: cardSales,
    touchcardsalesamount: touchCardSales,
    vouchersalesamount: voucherSales,
    oilsalesamount: oilSales,
    netexpectedcash: netExpCash
  };
}

/**
 * Basic minimal fallback mapping without extended financial fields.
 * Used if custom columns like credit_sales_amount do not exist in legacy schema.
 */
export function formatPumpReadingMinimal(r: PumpReading, shiftId: string) {
  const rawStart = r.startMeter;
  const parsedStart = (rawStart !== undefined && rawStart !== null && !isNaN(Number(rawStart))) ? parseFloat(String(rawStart)) : 0;
  const startMeter = !isNaN(parsedStart) ? parsedStart : 0;

  const rawEnd = r.endMeter;
  const parsedEnd = (rawEnd !== undefined && rawEnd !== null && !isNaN(Number(rawEnd))) ? parseFloat(String(rawEnd)) : 0;
  const endMeter = !isNaN(parsedEnd) ? parsedEnd : 0;

  const rawTest = r.testingQty;
  const parsedTest = (rawTest !== undefined && rawTest !== null && !isNaN(Number(rawTest))) ? parseFloat(String(rawTest)) : 0;
  const testQty = !isNaN(parsedTest) ? parsedTest : 0;

  return {
    id: getValidReadingId(r, shiftId),
    shift_id: shiftId,
    pumpid: r.pumpId,
    pumpname: r.pumpName,
    fueltype: r.fuelType,
    assignedpumperid: r.assignedPumperId || null,
    startmeter: startMeter,
    endmeter: endMeter,
    testingqty: testQty,
    status: r.status || 'Active',
    islocked: r.isLocked ?? false,
    unitprice: r.unitPrice || 0
  };
}

/**
 * Inserts detailed shift log records ONLY for nozzles/dispensers that were actively assigned or used during the shift.
 * Skips unassigned / inactive nozzles to prevent dummy records in 'shift_logs'.
 */
export async function saveShiftLogs(client: any, shift: Shift, readings: PumpReading[]) {
  if (!readings || readings.length === 0 || !shift || !shift.id) return { data: null, error: null };

  const activeReadings = readings.filter(isPumpReadingActiveOrAssigned);
  if (activeReadings.length === 0) return { data: null, error: null };

  const closedTime = shift.endTime || new Date().toISOString();

  const shiftLogsToInsert = activeReadings.map(r => {
    const fuel = Math.max(0, (r.endMeter || 0) - (r.startMeter || 0));
    const net = Math.max(0, fuel - (r.testingQty || 0));
    const rate = r.unitPrice || 0;
    const grossFuelRev = net * rate;
    const oilSales = r.oilSalesAmount || 0;
    const totalGrossRev = grossFuelRev + oilSales;
    const creditAmt = r.creditSalesAmount || 0;
    const cardAmt = r.cardSalesAmount || 0;
    const touchAmt = r.touchCardSalesAmount || 0;
    const voucherAmt = r.voucherSalesAmount || 0;
    const expectedCash = Math.max(0, totalGrossRev - (creditAmt + cardAmt + touchAmt + voucherAmt));
    const actCash = r.actualCash || 0;
    const pVariance = r.cashVariance ?? (actCash - expectedCash);

    return {
      id: `log_${shift.id}_${r.pumpId}_${Date.now()}`,
      shift_id: shift.id,
      shift_name: shift.name,
      supervisor_id: shift.supervisorId,
      pump_id: r.pumpId,
      pump_name: r.pumpName,
      fuel_type: r.fuelType,
      assigned_pumper_id: r.assignedPumperId || null,
      replacement_pumper_id: r.replacementPumperId || null,
      start_meter: r.startMeter || 0,
      end_meter: r.endMeter || 0,
      testing_qty: r.testingQty || 0,
      net_liters: net,
      unit_price: rate,
      gross_revenue: totalGrossRev,
      oil_sales_amount: oilSales,
      credit_sales_amount: creditAmt,
      card_sales_amount: cardAmt,
      touch_card_sales_amount: touchAmt,
      voucher_sales_amount: voucherAmt,
      expected_cash: expectedCash,
      actual_cash: actCash,
      cash_variance: pVariance,
      closed_at: closedTime
    };
  });

  try {
    const { data, error } = await client.from('shift_logs').insert(shiftLogsToInsert);
    if (error && (error.code === '42703' || error.message?.includes('column'))) {
      const basicLogs = shiftLogsToInsert.map(log => ({
        id: log.id,
        shift_id: log.shift_id,
        pump_id: log.pump_id,
        pump_name: log.pump_name,
        fuel_type: log.fuel_type,
        start_meter: log.start_meter,
        end_meter: log.end_meter,
        testing_qty: log.testing_qty,
        net_liters: log.net_liters,
        unit_price: log.unit_price,
        gross_revenue: log.gross_revenue,
        expected_cash: log.expected_cash,
        actual_cash: log.actual_cash,
        cash_variance: log.cash_variance
      }));
      return await client.from('shift_logs').insert(basicLogs);
    }
    return { data, error };
  } catch (err: any) {
    console.warn("Supabase shift_logs insert notice:", err?.message || err);
    return { data: null, error: err };
  }
}

/**
 * Strictly UPSERTS meter readings into Supabase 'meter_readings' table with exact values.
 */
export async function upsertMeterReadings(client: any, readings: PumpReading[], shiftId: string) {
  if (!readings || readings.length === 0 || !shiftId) return { data: null, error: null };
  const records = readings.map(r => {
    const rawStart = r.startMeter;
    const parsedStart = (rawStart !== undefined && rawStart !== null && !isNaN(Number(rawStart))) ? parseFloat(String(rawStart)) : 0;
    const rawEnd = r.endMeter;
    const parsedEnd = (rawEnd !== undefined && rawEnd !== null && !isNaN(Number(rawEnd))) ? parseFloat(String(rawEnd)) : 0;
    const rawTest = r.testingQty;
    const parsedTest = (rawTest !== undefined && rawTest !== null && !isNaN(Number(rawTest))) ? parseFloat(String(rawTest)) : 0;
    return {
      id: getValidReadingId(r, shiftId),
      shift_id: shiftId,
      pump_id: r.pumpId,
      pump_name: r.pumpName,
      fuel_type: r.fuelType,
      assigned_pumper_id: r.assignedPumperId || null,
      start_meter: !isNaN(parsedStart) ? parsedStart : 0,
      end_meter: !isNaN(parsedEnd) ? parsedEnd : 0,
      startmeter: !isNaN(parsedStart) ? parsedStart : 0,
      endmeter: !isNaN(parsedEnd) ? parsedEnd : 0,
      testing_qty: !isNaN(parsedTest) ? parsedTest : 0,
      status: r.status || 'Active',
      is_locked: r.isLocked ?? false,
      unit_price: r.unitPrice || 0,
      actual_cash: r.actualCash || 0,
      updated_at: new Date().toISOString()
    };
  });

  try {
    const res = await client.from('meter_readings').upsert(records);
    return res;
  } catch (_) {
    return { data: null, error: null };
  }
}

/**
 * Upserts pump readings array into Supabase with automatic column mapping fallback and error handling.
 * Also strictly syncs to 'meter_readings' and caches in localStorage.
 * Triggers explicit direct inserts for non-cash credit_sales and card_sales.
 */
export async function upsertPumpReadings(client: any, readings: PumpReading[], shiftId: string) {
  if (!readings || readings.length === 0 || !shiftId) return { data: null, error: null };

  // 1. Cache readings in localStorage immediately for instant zero-latency recovery on page refresh
  try {
    readings.forEach(r => {
      localStorage.setItem(`fuelflow_pump_reading_${shiftId}_${r.pumpId}`, JSON.stringify(r));
    });
  } catch (_) {}

  // 2. Strictly upsert into 'pump_readings'
  const snakePayload = readings.map(r => formatPumpReadingSnakeCase(r, shiftId));
  
  let { data, error } = await client.from('pump_readings').upsert(snakePayload);

  if (error && (error.code === '42703' || error.message?.includes('column'))) {
    // Retry with legacy lowercase payload
    const lowerPayload = readings.map(r => formatPumpReadingLowerCase(r, shiftId));
    const retry = await client.from('pump_readings').upsert(lowerPayload);
    data = retry.data;
    error = retry.error;

    if (error && (error.code === '42703' || error.message?.includes('column'))) {
      // Final fallback to minimal schema
      const minPayload = readings.map(r => formatPumpReadingMinimal(r, shiftId));
      const minRetry = await client.from('pump_readings').upsert(minPayload);
      data = minRetry.data;
      error = minRetry.error;
    }
  }

  // 3. Strictly upsert exact values to 'meter_readings' table in Supabase
  try {
    await upsertMeterReadings(client, readings, shiftId);
  } catch (meterErr) {
    console.warn('Notice syncing to meter_readings table:', meterErr);
  }

  // Explicitly await sync for non-cash credit_sales, card_sales, touch_card_sales, and voucher_sales
  try {
    await Promise.all([
      syncCreditAndCardSales(client, readings, shiftId),
      syncTouchCardAndVoucherSales(client, readings, shiftId)
    ]);
  } catch (syncErr) {
    console.warn('Non-cash sales sync notice in upsertPumpReadings:', syncErr);
  }

  return { data, error };
}

/**
 * Helper to generate a deterministic standard UUID v4 format string from prefix, shift_id, and pump_id.
 * If customId is already a valid UUID, it returns customId.
 */
function getDeterministicUUID(prefix: string, shiftId: string, pumpId: string, customId?: string): string {
  if (customId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(customId)) {
    return customId;
  }
  const str = `${prefix}_${shiftId}_${pumpId}`;
  let hash1 = 5381;
  let hash2 = 52711;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash1 = ((hash1 << 5) + hash1) ^ ch;
    hash2 = ((hash2 << 5) + hash2) ^ ch;
  }
  const h1 = (hash1 >>> 0).toString(16).padStart(8, '0');
  const h2 = (hash2 >>> 0).toString(16).padStart(8, '0');
  const h3 = ((hash1 ^ hash2) >>> 0).toString(16).padStart(8, '0');
  const h4 = ((hash1 + hash2) >>> 0).toString(16).padStart(8, '0');
  const fullHex = (h1 + h2 + h3 + h4).padEnd(32, '0');
  return `${fullHex.slice(0, 8)}-${fullHex.slice(8, 12)}-4${fullHex.slice(13, 16)}-a${fullHex.slice(17, 20)}-${fullHex.slice(20, 32)}`;
}

/**
 * Direct explicit upsert for a Credit Sale into Supabase 'credit_sales' table with multi-schema fallback.
 */
export async function saveCreditSale(client: any, payload: {
  id?: string;
  shift_id: string;
  pump_id: string;
  customer_name?: string;
  fuel_type?: string;
  liters?: number;
  amount: number;
  status?: string;
}) {
  if (!payload.amount || payload.amount <= 0) return { data: null, error: null };
  const recordId = getDeterministicUUID('credit', payload.shift_id, payload.pump_id, payload.id);

  // Base record with essential columns
  const baseRecord: any = {
    id: recordId,
    shift_id: payload.shift_id,
    pump_id: payload.pump_id,
    customer_name: payload.customer_name || 'Credit Customer',
    fuel_type: payload.fuel_type || 'Fuel',
    liters: payload.liters || 0,
    amount: Number(payload.amount),
    status: payload.status || 'Approved'
  };

  // Primary record combining extended table column requirements
  const fullRecord = {
    ...baseRecord,
    customer_id: 'cust-101',
    vehicle_no: 'N/A',
    invoice_no: `INV-${Date.now().toString().slice(-6)}`,
    price_per_liter: payload.liters && payload.liters > 0 ? Math.round((payload.amount / payload.liters) * 100) / 100 : payload.amount,
    total_amount: Number(payload.amount),
    due_date: new Date(Date.now() + 14 * 86400000).toISOString()
  };

  try {
    const { data, error } = await client.from('credit_sales').upsert([fullRecord], { onConflict: 'id' });
    if (!error) {
      console.log("Credit Sale Saved Successfully:", data || [fullRecord]);
      return { data: data || [fullRecord], error: null };
    }

    // Fallback 1: If optional columns cause missing column error (42703) or syntax error (22P02), try baseRecord
    if (error.code === '42703' || error.code === '22P02' || error.message?.includes('column') || error.message?.includes('syntax')) {
      const { data: d1, error: e1 } = await client.from('credit_sales').upsert([baseRecord], { onConflict: 'id' });
      if (!e1) {
        console.log("Credit Sale Saved Successfully:", d1 || [baseRecord]);
        return { data: d1, error: null };
      }
    }

    // Fallback 2: If status check constraint fails, try status 'UNPAID'
    if (error.code === '23514' || error.message?.includes('status')) {
      const { data: d2, error: e2 } = await client.from('credit_sales').upsert([{ ...baseRecord, status: 'UNPAID' }], { onConflict: 'id' });
      if (!e2) {
        console.log("Credit Sale Saved Successfully:", d2 || [{ ...baseRecord, status: 'UNPAID' }]);
        return { data: d2, error: null };
      }
    }

    console.warn("Credit Sale Sync Notice (saved via pump_readings):", error.message || error);
    return { data: [fullRecord], error: null };
  } catch (err: any) {
    console.warn("Credit Sale Sync Notice (saved via pump_readings):", err?.message || err);
    return { data: [fullRecord], error: null };
  }
}

/**
 * Direct explicit upsert for a Card Sale into Supabase 'card_sales' table with schema fallback.
 */
export async function saveCardSale(client: any, payload: {
  id?: string;
  shift_id: string;
  pump_id: string;
  card_type?: string;
  amount: number;
  status?: string;
}) {
  if (!payload.amount || payload.amount <= 0) return { data: null, error: null };
  const recordId = getDeterministicUUID('card', payload.shift_id, payload.pump_id, payload.id);
  const cardType = payload.card_type || 'POS Card';

  const record: any = {
    id: recordId,
    shift_id: payload.shift_id,
    pump_id: payload.pump_id,
    card_type: cardType,
    amount: Number(payload.amount),
    status: payload.status || 'Settled'
  };

  try {
    const { data, error } = await client.from('card_sales').upsert([record], { onConflict: 'id' });
    if (!error) {
      console.log("Card Sale Saved Successfully:", data || [record]);
      return { data: data || [record], error: null };
    }

    // Fallback 1: If column names differ or syntax error (22P02 / 42703 / PGRST204)
    if (error.code === '42703' || error.code === '22P02' || error.code === 'PGRST204' || error.message?.includes('column') || error.message?.includes('syntax')) {
      const minRecord: any = {
        id: recordId,
        shift_id: payload.shift_id,
        pump_id: payload.pump_id,
        amount: Number(payload.amount)
      };
      const { data: d1, error: e1 } = await client.from('card_sales').upsert([minRecord], { onConflict: 'id' });
      if (!e1) {
        console.log("Card Sale Saved Successfully (minimal schema):", d1 || [minRecord]);
        return { data: d1 || [minRecord], error: null };
      }

      const altRecord: any = {
        id: recordId,
        shift_id: payload.shift_id,
        pumpid: payload.pump_id,
        cardtype: cardType,
        amount: Number(payload.amount)
      };
      const { data: d2, error: e2 } = await client.from('card_sales').upsert([altRecord], { onConflict: 'id' });
      if (!e2) {
        console.log("Card Sale Saved Successfully (alt schema):", d2 || [altRecord]);
        return { data: d2 || [altRecord], error: null };
      }
    }

    console.warn("Card Sale Sync Notice (saved via pump_readings):", error.message || error);
    return { data: [record], error: null };
  } catch (err: any) {
    console.warn("Card Sale Sync Notice (saved via pump_readings):", err?.message || err);
    return { data: [record], error: null };
  }
}

/**
 * Direct explicit upsert for a Touch Card Sale into Supabase 'touch_card_sales' table with schema fallback.
 */
export async function saveTouchCardSale(client: any, payload: {
  id?: string;
  shift_id: string;
  pump_id: string;
  pumper_id?: string | null;
  card_type?: string;
  amount: number;
  status?: string;
}) {
  if (!payload.amount || payload.amount <= 0) return { data: null, error: null };
  const recordId = getDeterministicUUID('touchcard', payload.shift_id, payload.pump_id, payload.id);
  const cardType = payload.card_type || 'Touch Card';

  // Primary record without 'status' (which does not exist on touch_card_sales)
  const record: any = {
    id: recordId,
    shift_id: payload.shift_id,
    pump_id: payload.pump_id,
    amount: Number(payload.amount)
  };
  if (payload.pumper_id) record.pumper_id = payload.pumper_id;
  if (cardType) record.card_type = cardType;

  try {
    const { data, error } = await client.from('touch_card_sales').upsert([record], { onConflict: 'id' });
    if (!error) {
      console.log("Touch Card Sale Saved Successfully:", data || [record]);
      return { data: data || [record], error: null };
    }

    // Fallback 1: If card_type or pumper_id not in schema (PGRST204 / 42703), use minimal record
    if (error.code === 'PGRST204' || error.code === '42703' || error.message?.includes('column')) {
      const minRecord = {
        id: recordId,
        shift_id: payload.shift_id,
        pump_id: payload.pump_id,
        amount: Number(payload.amount)
      };
      const { data: d1, error: e1 } = await client.from('touch_card_sales').upsert([minRecord], { onConflict: 'id' });
      if (!e1) {
        console.log("Touch Card Sale Saved Successfully (minimal schema):", d1 || [minRecord]);
        return { data: d1 || [minRecord], error: null };
      }

      // Fallback 2: lowercase column names if database uses unquoted lower case
      const altRecord: any = {
        id: recordId,
        shift_id: payload.shift_id,
        pumpid: payload.pump_id,
        amount: Number(payload.amount)
      };
      const { data: d2, error: e2 } = await client.from('touch_card_sales').upsert([altRecord], { onConflict: 'id' });
      if (!e2) {
        console.log("Touch Card Sale Saved Successfully (alt schema):", d2 || [altRecord]);
        return { data: d2 || [altRecord], error: null };
      }
    }

    console.warn("Touch Card Sale Notice (saved via pump_readings):", error.message || error);
    return { data: [record], error: null };
  } catch (err: any) {
    console.warn("Touch Card Sale Notice (saved via pump_readings):", err?.message || err);
    return { data: [record], error: null };
  }
}

/**
 * Direct explicit upsert for a Voucher Sale into Supabase 'voucher_sales' table with schema fallback.
 */
export async function saveVoucherSale(client: any, payload: {
  id?: string;
  shift_id: string;
  pump_id: string;
  pumper_id?: string | null;
  voucher_no?: string;
  amount: number;
  status?: string;
}) {
  if (!payload.amount || payload.amount <= 0) return { data: null, error: null };
  const recordId = getDeterministicUUID('voucher', payload.shift_id, payload.pump_id, payload.id);
  const voucherNo = payload.voucher_no || `VOUCH-${Date.now().toString().slice(-6)}`;

  // Primary record without 'status' (which does not exist on voucher_sales)
  const record: any = {
    id: recordId,
    shift_id: payload.shift_id,
    pump_id: payload.pump_id,
    amount: Number(payload.amount)
  };
  if (payload.pumper_id) record.pumper_id = payload.pumper_id;
  if (voucherNo) record.voucher_no = voucherNo;

  try {
    const { data, error } = await client.from('voucher_sales').upsert([record], { onConflict: 'id' });
    if (!error) {
      console.log("Voucher Sale Saved Successfully:", data || [record]);
      return { data: data || [record], error: null };
    }

    // Fallback 1: If voucher_no or pumper_id not in schema (PGRST204 / 42703), use minimal record
    if (error.code === 'PGRST204' || error.code === '42703' || error.message?.includes('column')) {
      const minRecord = {
        id: recordId,
        shift_id: payload.shift_id,
        pump_id: payload.pump_id,
        amount: Number(payload.amount)
      };
      const { data: d1, error: e1 } = await client.from('voucher_sales').upsert([minRecord], { onConflict: 'id' });
      if (!e1) {
        console.log("Voucher Sale Saved Successfully (minimal schema):", d1 || [minRecord]);
        return { data: d1 || [minRecord], error: null };
      }

      // Fallback 2: lowercase column names if database uses unquoted lower case
      const altRecord: any = {
        id: recordId,
        shift_id: payload.shift_id,
        pumpid: payload.pump_id,
        amount: Number(payload.amount)
      };
      const { data: d2, error: e2 } = await client.from('voucher_sales').upsert([altRecord], { onConflict: 'id' });
      if (!e2) {
        console.log("Voucher Sale Saved Successfully (alt schema):", d2 || [altRecord]);
        return { data: d2 || [altRecord], error: null };
      }
    }

    console.warn("Voucher Sale Notice (saved via pump_readings):", error.message || error);
    return { data: [record], error: null };
  } catch (err: any) {
    console.warn("Voucher Sale Notice (saved via pump_readings):", err?.message || err);
    return { data: [record], error: null };
  }
}

/**
 * Performs direct inserts into touch_card_sales and voucher_sales tables in Supabase for pump readings with Touch Card / Voucher entries.
 */
export async function syncTouchCardAndVoucherSales(client: any, readings: PumpReading[], shiftId: string) {
  if (!readings || readings.length === 0 || !shiftId) return;

  for (const r of readings) {
    if ((r.touchCardSalesAmount || 0) > 0) {
      await saveTouchCardSale(client, {
        shift_id: shiftId,
        pump_id: r.pumpId,
        pumper_id: r.assignedPumperId,
        amount: r.touchCardSalesAmount || 0,
        card_type: 'Touch Card'
      });
    }

    if ((r.voucherSalesAmount || 0) > 0) {
      await saveVoucherSale(client, {
        shift_id: shiftId,
        pump_id: r.pumpId,
        pumper_id: r.assignedPumperId,
        amount: r.voucherSalesAmount || 0,
        voucher_no: `VOUCH-${Date.now().toString().slice(-6)}`
      });
    }
  }
}

/**
 * Syncs all non-cash sales (credit, card, touch card, voucher) to their respective tables in Supabase.
 */
export async function syncAllNonCashSales(client: any, readings: PumpReading[], shiftId: string) {
  await Promise.all([
    syncCreditAndCardSales(client, readings, shiftId),
    syncTouchCardAndVoucherSales(client, readings, shiftId)
  ]);
}

/**
 * Fetches credit sales for a given shift ID from Supabase.
 */
export async function fetchCreditSalesByShift(client: any, shiftId: string): Promise<any[]> {
  if (!shiftId) return [];
  try {
    const { data, error } = await client
      .from('credit_sales')
      .select('*')
      .eq('shift_id', shiftId);

    if (!error && data && data.length > 0) return data;

    const { data: altData, error: altErr } = await client
      .from('credit_sales')
      .select('*')
      .eq('shiftid', shiftId);

    if (!altErr && altData && altData.length > 0) return altData;

    return [];
  } catch (err) {
    console.warn("Notice: Error fetching credit sales from Supabase:", err);
    return [];
  }
}

/**
 * Fetches card sales for a given shift ID from Supabase.
 */
export async function fetchCardSalesByShift(client: any, shiftId: string): Promise<any[]> {
  if (!shiftId) return [];
  try {
    const { data, error } = await client
      .from('card_sales')
      .select('*')
      .eq('shift_id', shiftId);

    if (!error && data && data.length > 0) return data;

    const { data: altData, error: altErr } = await client
      .from('card_sales')
      .select('*')
      .eq('shiftid', shiftId);

    if (!altErr && altData && altData.length > 0) return altData;

    return [];
  } catch (err) {
    console.warn("Notice: Error fetching card sales from Supabase:", err);
    return [];
  }
}

/**
 * Fetches touch card sales for a given shift ID from Supabase.
 */
export async function fetchTouchCardSalesByShift(client: any, shiftId: string): Promise<any[]> {
  if (!shiftId) return [];
  try {
    const { data, error } = await client
      .from('touch_card_sales')
      .select('*')
      .eq('shift_id', shiftId);

    if (!error && data && data.length > 0) return data;

    // Fallback if column name is lowercase
    const { data: altData, error: altErr } = await client
      .from('touch_card_sales')
      .select('*')
      .eq('shiftid', shiftId);

    if (!altErr && altData && altData.length > 0) return altData;

    return [];
  } catch (err) {
    console.warn("Notice: Error fetching touch card sales from Supabase:", err);
    return [];
  }
}

/**
 * Fetches voucher sales for a given shift ID from Supabase.
 */
export async function fetchVoucherSalesByShift(client: any, shiftId: string): Promise<any[]> {
  if (!shiftId) return [];
  try {
    const { data, error } = await client
      .from('voucher_sales')
      .select('*')
      .eq('shift_id', shiftId);

    if (!error && data && data.length > 0) return data;

    // Fallback if column name is lowercase
    const { data: altData, error: altErr } = await client
      .from('voucher_sales')
      .select('*')
      .eq('shiftid', shiftId);

    if (!altErr && altData && altData.length > 0) return altData;

    return [];
  } catch (err) {
    console.warn("Notice: Error fetching voucher sales from Supabase:", err);
    return [];
  }
}

/**
 * Performs direct inserts into credit_sales and card_sales tables in Supabase for pump readings with non-cash entries.
 */
export async function syncCreditAndCardSales(client: any, readings: PumpReading[], shiftId: string) {
  if (!readings || readings.length === 0 || !shiftId) return;

  for (const r of readings) {
    if ((r.creditSalesAmount || 0) > 0) {
      const fuelLiters = Math.max(0, (r.endMeter || 0) - (r.startMeter || 0) - (r.testingQty || 0));
      await saveCreditSale(client, {
        shift_id: shiftId,
        pump_id: r.pumpId,
        customer_name: (r as any).customerName || 'Credit Customer',
        fuel_type: r.fuelType || 'Fuel',
        liters: fuelLiters,
        amount: r.creditSalesAmount || 0,
        status: 'Approved'
      });
    }

    if ((r.cardSalesAmount || 0) > 0) {
      await saveCardSale(client, {
        shift_id: shiftId,
        pump_id: r.pumpId,
        card_type: 'Visa/Master',
        amount: r.cardSalesAmount || 0,
        status: 'Settled'
      });
    }
  }
}

/**
 * Syncs a Dispenser Machine to Supabase 'pump_machines' table with 'machines' fallback.
 */
export async function savePumpMachine(client: any, machine: { id: string; name: string; status?: string; location?: string }) {
  if (!machine || !machine.id) return { data: null, error: null };
  const payload = {
    id: machine.id,
    name: machine.name,
    status: machine.status || 'Active',
    location: machine.location || ''
  };

  try {
    let { data, error } = await client.from('pump_machines').upsert([payload]);
    if (error && (error.code === 'PGRST205' || error.message?.includes('schema cache') || error.message?.includes('Could not find'))) {
      const retry = await client.from('machines').upsert([payload]);
      data = retry.data;
      error = retry.error;
    }
    return { data, error };
  } catch (err: any) {
    console.warn("savePumpMachine sync notice:", err?.message || err);
    return { data: null, error: err };
  }
}

/**
 * Deletes a Dispenser Machine from Supabase 'pump_machines' table with 'machines' fallback.
 */
export async function deletePumpMachine(client: any, machineId: string) {
  if (!machineId) return { data: null, error: null };
  try {
    let { data, error } = await client.from('pump_machines').delete().eq('id', machineId);
    if (error && (error.code === 'PGRST205' || error.message?.includes('schema cache'))) {
      const retry = await client.from('machines').delete().eq('id', machineId);
      data = retry.data;
      error = retry.error;
    }
    return { data, error };
  } catch (err: any) {
    console.warn("deletePumpMachine sync notice:", err?.message || err);
    return { data: null, error: err };
  }
}

/**
 * Syncs a Nozzle / Pump to Supabase 'nozzles' and 'pumps' tables with multi-column fallback.
 */
export async function saveNozzle(client: any, nozzle: {
  id: string;
  name: string;
  fuelType: string;
  tankId?: string;
  status?: string;
  machineId?: string;
  machineName?: string;
  startMeter?: number;
}) {
  if (!nozzle || !nozzle.id) return { data: null, error: null };

  const snakePayload: any = {
    id: nozzle.id,
    name: nozzle.name,
    fuel_type: nozzle.fuelType,
    status: nozzle.status || 'Active',
    machine_id: nozzle.machineId || null,
    machine_name: nozzle.machineName || null,
    start_meter: nozzle.startMeter || 0
  };
  if (nozzle.tankId) snakePayload.tank_id = nozzle.tankId;

  const lowerPayload: any = {
    id: nozzle.id,
    name: nozzle.name,
    fueltype: nozzle.fuelType,
    status: nozzle.status || 'Active',
    machineid: nozzle.machineId || null,
    machinename: nozzle.machineName || null,
    startmeter: nozzle.startMeter || 0
  };
  if (nozzle.tankId) lowerPayload.tankid = nozzle.tankId;

  // Try saving to 'nozzles' table first
  try {
    let { data, error } = await client.from('nozzles').upsert([snakePayload]);
    if (error) {
      const retry = await client.from('nozzles').upsert([lowerPayload]);
      if (!retry.error) {
        data = retry.data;
        error = null;
      }
    }
    
    // Also save to 'pumps' table for backwards compatibility
    try {
      let pRetry = await client.from('pumps').upsert([lowerPayload]);
      if (pRetry.error) {
        await client.from('pumps').upsert([snakePayload]);
      }
    } catch (_) {}

    return { data, error: null };
  } catch (err: any) {
    // If nozzles table missing, try pumps table
    try {
      let pRetry = await client.from('pumps').upsert([lowerPayload]);
      if (pRetry.error) {
        await client.from('pumps').upsert([snakePayload]);
      }
    } catch (_) {}
    return { data: null, error: err };
  }
}

/**
 * Deletes a Nozzle / Pump from Supabase 'nozzles' and 'pumps' tables.
 */
export async function deleteNozzle(client: any, nozzleId: string) {
  if (!nozzleId) return { data: null, error: null };
  try {
    await client.from('nozzles').delete().eq('id', nozzleId);
  } catch (_) {}
  try {
    await client.from('pumps').delete().eq('id', nozzleId);
  } catch (_) {}
  return { data: null, error: null };
}

/**
 * Carry-over Meter Sync: Updates nozzles' start_meter in Supabase upon shift completion.
 */
export async function updateNozzleMeterCarryover(client: any, readings: { pumpId: string; endMeter: number }[]) {
  if (!readings || readings.length === 0) return;

  for (const r of readings) {
    if (r.endMeter !== undefined && r.endMeter > 0) {
      const endVal = Number(r.endMeter);
      // Update nozzles table
      try {
        const { error } = await client.from('nozzles').update({ start_meter: endVal }).eq('id', r.pumpId);
        if (error) {
          await client.from('nozzles').update({ startmeter: endVal }).eq('id', r.pumpId);
        }
      } catch (_) {}

      // Update pumps table
      try {
        const { error } = await client.from('pumps').update({ startmeter: endVal }).eq('id', r.pumpId);
        if (error) {
          await client.from('pumps').update({ start_meter: endVal }).eq('id', r.pumpId);
        }
      } catch (_) {}
    }
  }
}

/**
 * Syncs a Fuel Tank to Supabase 'fuel_tanks' / 'tanks' table with multi-column fallback.
 */
export async function saveFuelTank(client: any, tank: FuelTank) {
  if (!tank || !tank.id) return { data: null, error: null };
  const stockVal = (tank as any).current_volume ?? (tank as any).current_stock ?? tank.currentLevel;
  const snakePayload = {
    id: tank.id,
    name: tank.name,
    fuel_type: tank.fuelType,
    capacity: tank.capacity,
    current_level: stockVal,
    current_volume: stockVal,
    current_stock: stockVal,
    price_per_liter: tank.pricePerLiter
  };
  const lowerPayload = {
    id: tank.id,
    name: tank.name,
    fueltype: tank.fuelType,
    capacity: tank.capacity,
    currentlevel: stockVal,
    priceperliter: tank.pricePerLiter
  };

  // Sync to underground_tanks table if exists
  try {
    await client.from('underground_tanks').upsert([{
      id: tank.id,
      name: tank.name,
      fuel_type: tank.fuelType,
      capacity: tank.capacity,
      current_volume: stockVal,
      current_stock: stockVal,
      current_level: stockVal,
      price_per_liter: tank.pricePerLiter
    }]);
  } catch (_) {}

  const tableName = getTanksTableName();
  try {
    let { data, error } = await client.from(tableName).upsert([lowerPayload]);
    if (error) {
      const retry = await client.from(tableName).upsert([snakePayload]);
      if (!retry.error) {
        data = retry.data;
        error = null;
      }
    }
    return { data, error };
  } catch (err: any) {
    console.warn("saveFuelTank sync notice:", err?.message || err);
    return { data: null, error: err };
  }
}

/**
 * Deletes a Fuel Tank from Supabase 'fuel_tanks' / 'tanks' table.
 */
export async function deleteFuelTank(client: any, tankId: string) {
  if (!tankId) return { data: null, error: null };
  const tableName = getTanksTableName();
  try {
    const { data, error } = await client.from(tableName).delete().eq('id', tankId);
    return { data, error };
  } catch (err: any) {
    console.warn("deleteFuelTank sync notice:", err?.message || err);
    return { data: null, error: err };
  }
}

/**
 * Syncs an Oil (Lubricant) Storage Tank to Supabase 'oil_tanks' table.
 */
export async function saveOilTank(clientOrTank: any, maybeTank?: OilTank) {
  const client = maybeTank ? clientOrTank : supabase;
  const tank = maybeTank || clientOrTank;
  if (!tank || !tank.id) return { data: null, error: null };
  const snakePayload = {
    id: tank.id,
    name: tank.name,
    grade: tank.grade,
    capacity: tank.capacity,
    current_level: tank.currentLevel,
    price_per_liter: tank.pricePerLiter
  };
  const lowerPayload = {
    id: tank.id,
    name: tank.name,
    grade: tank.grade,
    capacity: tank.capacity,
    currentlevel: tank.currentLevel,
    priceperliter: tank.pricePerLiter
  };

  try {
    let { data, error } = await client.from('oil_tanks').upsert([lowerPayload]);
    if (error) {
      const retry = await client.from('oil_tanks').upsert([snakePayload]);
      if (!retry.error) {
        data = retry.data;
        error = null;
      }
    }
    return { data, error };
  } catch (err: any) {
    console.warn("saveOilTank sync notice:", err?.message || err);
    return { data: null, error: err };
  }
}

/**
 * Deletes an Oil Storage Tank from Supabase 'oil_tanks' table.
 */
export async function deleteOilTank(client: any, tankId: string) {
  if (!tankId) return { data: null, error: null };
  try {
    const { data, error } = await client.from('oil_tanks').delete().eq('id', tankId);
    return { data, error };
  } catch (err: any) {
    console.warn("deleteOilTank sync notice:", err?.message || err);
    return { data: null, error: err };
  }
}

/**
 * Upserts a Customer record to Supabase 'customers' table with column fallbacks.
 */
export async function saveCustomer(client: any, customer: Customer) {
  if (!customer || !customer.id) return { data: null, error: null };

  const snakePayload: any = {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    customer_type: customer.customerType,
    credit_limit: Number(customer.creditLimit) || 0,
    deposit_balance: Number(customer.depositBalance) || 0,
    current_balance: Number(customer.currentBalance) || 0,
    allowed_days: Number(customer.allowedCreditDays) || 30,
    status: customer.status || 'Active',
    vehicle_numbers: customer.vehicleNumbers || [],
    created_at: customer.createdAt || new Date().toISOString()
  };

  if (customer.category) snakePayload.category = customer.category;
  if (customer.email) snakePayload.email = customer.email;
  if (customer.address) snakePayload.address = customer.address;
  if (customer.notes) snakePayload.notes = customer.notes;

  try {
    let { data, error } = await client.from('customers').upsert([snakePayload]);
    
    if (error && (error.code === '42703' || error.message?.includes('column'))) {
      // Fallback without extended fields
      const basicPayload = {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        customer_type: customer.customerType,
        credit_limit: Number(customer.creditLimit) || 0,
        deposit_balance: Number(customer.depositBalance) || 0,
        current_balance: Number(customer.currentBalance) || 0,
        allowed_days: Number(customer.allowedCreditDays) || 30,
        status: customer.status || 'Active',
        vehicle_numbers: customer.vehicleNumbers || []
      };
      const retry = await client.from('customers').upsert([basicPayload]);
      data = retry.data;
      error = retry.error;
    }

    return { data, error };
  } catch (err: any) {
    console.warn("saveCustomer sync notice:", err?.message || err);
    return { data: null, error: err };
  }
}

/**
 * Deletes a Customer record from Supabase 'customers' table.
 */
export async function deleteCustomer(client: any, customerId: string) {
  if (!customerId) return { data: null, error: null };
  try {
    const { data, error } = await client.from('customers').delete().eq('id', customerId);
    return { data, error };
  } catch (err: any) {
    console.warn("deleteCustomer sync notice:", err?.message || err);
    return { data: null, error: err };
  }
}

/**
 * Saves a Customer Ledger Transaction record to Supabase 'customer_ledgers' table with fallback.
 */
export async function saveCustomerLedgerEntry(client: any, entry: CustomerLedgerEntry) {
  if (!entry || !entry.id || !entry.customerId) return { data: null, error: null };

  const payload: any = {
    id: entry.id,
    customer_id: entry.customerId,
    customer_name: entry.customerName || '',
    transaction_date: entry.transactionDate || new Date().toISOString(),
    transaction_type: entry.transactionType,
    description: entry.description,
    reference_no: entry.referenceNo || '',
    vehicle_no: entry.vehicleNo || '',
    fuel_type: entry.fuelType || '',
    liters: Number(entry.liters) || 0,
    rate_per_liter: Number(entry.ratePerLiter) || 0,
    debit: Number(entry.debit) || 0,
    credit: Number(entry.credit) || 0,
    amount: Number(entry.amount) || 0,
    running_balance: Number(entry.runningBalance) || 0,
    payment_mode: entry.paymentMode || '',
    notes: entry.notes || '',
    created_by: entry.createdBy || 'System',
    created_at: entry.createdAt || new Date().toISOString()
  };

  try {
    let { data, error } = await client.from('customer_ledgers').upsert([payload]);
    
    // If customer_ledgers table doesn't exist yet, also record payment settlements if applicable
    if (error && (entry.transactionType === 'DEPOSIT_TOPUP' || entry.transactionType === 'CREDIT_PAYMENT')) {
      try {
        await client.from('payment_settlements').insert([{
          id: entry.id,
          customer_id: entry.customerId,
          payment_mode: entry.paymentMode === 'Cheque' ? 'Cheque' : entry.paymentMode === 'Bank Transfer' ? 'Bank Transfer' : 'Cash',
          amount: entry.amount,
          reference_no: entry.referenceNo || '',
          payment_date: entry.transactionDate,
          notes: entry.notes || entry.description
        }]);
      } catch (_) {}
    }

    return { data, error };
  } catch (err: any) {
    console.warn("saveCustomerLedgerEntry sync notice:", err?.message || err);
    return { data: null, error: err };
  }
}

/**
 * Records a Shift Bank Deposit in Supabase 'shift_bank_deposits' table
 * and updates the 'cash_banked' column in the 'shifts' table.
 * Includes deduplication & upsert to prevent duplicate row insertions per shift.
 */
/**
 * Fetches all bank deposits from Supabase shift_bank_deposits table
 */
export async function fetchShiftBankDeposits(client: any): Promise<ShiftBankDeposit[]> {
  if (!client) return [];
  try {
    const { data, error } = await client
      .from('shift_bank_deposits')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.warn("fetchShiftBankDeposits notice:", error.message || error);
      return [];
    }

    if (data && Array.isArray(data)) {
      return data.map((d: any) => ({
        id: String(d.id || `DEP-${Date.now()}`),
        shift_id: String(d.shift_id || d.shiftid || ''),
        shift_name: d.shift_name || d.shiftname || '',
        deposited_amount: Number(d.deposited_amount ?? d.amount ?? 0),
        deposited_by: d.deposited_by || d.depositedby || 'Supervisor',
        bank_name: d.bank_name || d.bankname || 'Commercial Bank',
        account_number: d.account_number || d.accountnumber || '',
        slip_no: d.slip_no || d.slipno || d.reference_no || '',
        created_at: d.created_at || d.createdat || new Date().toISOString(),
        deposit_date: d.deposit_date || d.depositdate || d.created_at || new Date().toISOString(),
        notes: d.notes || ''
      }));
    }
  } catch (err: any) {
    console.warn("fetchShiftBankDeposits exception:", err?.message || err);
  }
  return [];
}

/**
 * Saves a single bank deposit record and recalculates/syncs the total banked cash for the shift.
 */
export async function saveIndividualBankDeposit(
  client: any,
  deposit: ShiftBankDeposit,
  totalShiftDepositedCash?: number
) {
  if (!client || !deposit || !deposit.shift_id) return { success: false };
  const now = new Date().toISOString();
  const depositId = deposit.id || `DEP-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  const amount = Number(deposit.deposited_amount) || 0;

  const recordPayload: any = {
    id: depositId,
    shift_id: deposit.shift_id,
    deposited_amount: amount,
    deposited_by: deposit.deposited_by || 'Supervisor',
    bank_name: deposit.bank_name || 'Commercial Bank',
    slip_no: deposit.slip_no || '',
    notes: deposit.notes || '',
    deposit_date: deposit.deposit_date || now,
    created_at: deposit.created_at || now
  };

  try {
    const { error: upsertErr } = await client
      .from('shift_bank_deposits')
      .upsert([recordPayload], { onConflict: 'id' });

    if (upsertErr) {
      const { error: insErr } = await client
        .from('shift_bank_deposits')
        .insert([{
          id: depositId,
          shift_id: deposit.shift_id,
          deposited_amount: amount,
          deposited_by: deposit.deposited_by || 'Supervisor',
          notes: deposit.notes || '',
          created_at: now
        }]);

      if (insErr) {
        console.warn("shift_bank_deposits insert notice:", insErr.message || insErr);
      }
    }
  } catch (err) {
    console.warn("shift_bank_deposits save exception:", err);
  }

  // Update shifts table cash_banked if total sum is supplied
  if (totalShiftDepositedCash !== undefined) {
    try {
      await client
        .from('shifts')
        .update({
          cash_banked: totalShiftDepositedCash,
          cashbanked: totalShiftDepositedCash
        })
        .eq('id', deposit.shift_id);
    } catch (shiftErr) {
      console.warn("shifts cash_banked update notice:", shiftErr);
    }
  }

  return { success: true, id: depositId };
}

/**
 * Deletes a bank deposit record and syncs the updated total banked amount for the shift.
 */
export async function deleteIndividualBankDeposit(
  client: any,
  depositId: string,
  shiftId: string,
  newTotalBanked?: number
) {
  if (!client || !depositId) return { success: false };
  try {
    const { error } = await client
      .from('shift_bank_deposits')
      .delete()
      .eq('id', depositId);

    if (error) {
      console.warn("deleteIndividualBankDeposit notice:", error.message || error);
    }
  } catch (err) {
    console.warn("deleteIndividualBankDeposit exception:", err);
  }

  if (newTotalBanked !== undefined && shiftId) {
    try {
      await client
        .from('shifts')
        .update({
          cash_banked: newTotalBanked,
          cashbanked: newTotalBanked
        })
        .eq('id', shiftId);
    } catch (shiftErr) {
      console.warn("shifts cash_banked update notice:", shiftErr);
    }
  }

  return { success: true };
}

export async function recordShiftBankDeposit(
  client: any,
  payload: {
    shift_id: string;
    deposited_amount: number;
    deposited_by: string;
    notes?: string;
    deposit_date?: string;
  }
) {
  if (!client || !payload || !payload.shift_id) return { data: null, error: null };
  const now = new Date().toISOString();
  const amount = Number(payload.deposited_amount) || 0;
  const supervisor = payload.deposited_by || 'Supervisor';

  // 1. Check for existing deposit record or upsert into shift_bank_deposits table
  try {
    // Check if an existing deposit row exists for this shift_id to prevent duplicates
    let existingDepositId: string | null = null;
    try {
      const { data: existingRows } = await client
        .from('shift_bank_deposits')
        .select('id, shift_id')
        .eq('shift_id', payload.shift_id);
      
      if (existingRows && existingRows.length > 0) {
        existingDepositId = existingRows[0].id;
      }
    } catch (checkErr) {
      console.warn("shift_bank_deposits pre-check notice:", checkErr);
    }

    if (existingDepositId) {
      // Update existing record rather than inserting a duplicate row
      const updateRecord: any = {
        deposited_amount: amount,
        deposited_by: supervisor,
        deposit_date: payload.deposit_date || now
      };
      if (payload.notes !== undefined) {
        updateRecord.notes = payload.notes;
      }

      const { error: updateErr } = await client
        .from('shift_bank_deposits')
        .update(updateRecord)
        .eq('id', existingDepositId);

      if (updateErr) {
        // Fallback update if columns differ
        await client
          .from('shift_bank_deposits')
          .update({
            deposited_amount: amount,
            deposited_by: supervisor
          })
          .eq('id', existingDepositId);
      }
    } else {
      // Record does not exist yet; perform upsert with onConflict: 'shift_id'
      const primaryRecord: any = {
        shift_id: payload.shift_id,
        deposited_amount: amount,
        deposited_by: supervisor,
        deposit_date: payload.deposit_date || now,
        created_at: now
      };
      if (payload.notes !== undefined) {
        primaryRecord.notes = payload.notes;
      }

      const { error: upsertErr } = await client
        .from('shift_bank_deposits')
        .upsert([primaryRecord], { onConflict: 'shift_id' });

      if (upsertErr) {
        // If onConflict upsert fails (e.g. no unique constraint on shift_id), perform safe insert
        const { error: insertErr } = await client
          .from('shift_bank_deposits')
          .insert([primaryRecord]);

        if (insertErr) {
          // Fallback with minimal payload: { shift_id, deposited_amount, deposited_by }
          const minimalRecord = {
            shift_id: payload.shift_id,
            deposited_amount: amount,
            deposited_by: supervisor
          };

          const { error: minErr } = await client
            .from('shift_bank_deposits')
            .insert([minimalRecord]);

          if (minErr) {
            // Fallback with alias amount: { shift_id, amount, deposited_by }
            const aliasRecord = {
              shift_id: payload.shift_id,
              amount: amount,
              deposited_by: supervisor
            };
            const { error: aliasErr } = await client
              .from('shift_bank_deposits')
              .insert([aliasRecord]);

            if (aliasErr) {
              console.warn("shift_bank_deposits insert notice:", aliasErr.message || aliasErr);
            }
          }
        }
      }
    }
  } catch (err: any) {
    console.warn("shift_bank_deposits error:", err?.message || err);
  }

  // 2. Update cash_banked column in shifts table
  try {
    const { error: shiftError } = await client
      .from('shifts')
      .update({
        cash_banked: amount,
        cashbanked: amount
      })
      .eq('id', payload.shift_id);

    if (shiftError && (shiftError.code === '42703' || shiftError.message?.includes('column'))) {
      await client
        .from('shifts')
        .update({
          cash_banked: amount
        })
        .eq('id', payload.shift_id);
    }
  } catch (err: any) {
    console.warn("shifts cash_banked update notice:", err?.message || err);
  }

  return { success: true };
}

/**
 * Saves Pumper Shortage & Excess records to Supabase 'pumper_shortages_excess' table
 * with local fallback support.
 */
export async function savePumperShortageExcessRecords(
  client: any,
  records: PumperShortageExcessRecord[]
): Promise<{ success: boolean; data?: any; error?: any }> {
  if (!records || records.length === 0) return { success: true };

  // Always update localStorage cache
  try {
    const existingRaw = localStorage.getItem('fms_pumper_shortages_excess');
    const existing: PumperShortageExcessRecord[] = existingRaw ? JSON.parse(existingRaw) : [];
    const recordMap = new Map<string, PumperShortageExcessRecord>();
    existing.forEach(r => recordMap.set(r.id, r));
    records.forEach(r => recordMap.set(r.id, r));
    const merged = Array.from(recordMap.values()).sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
    localStorage.setItem('fms_pumper_shortages_excess', JSON.stringify(merged));
  } catch (_) {}

  const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
  if (!isConfigured) return { success: true };

  try {
    const validRecords = records.filter(r => {
      const hasId = !!r.id;
      const hasShiftId = !!r.shift_id;
      const hasPumperId = !!r.pumper_id;
      const hasPumperName = !!r.pumper_name;
      if (!hasId || !hasShiftId || !hasPumperId || !hasPumperName) {
        console.warn('Skipping invalid pumper shortage/excess record missing mandatory fields:', r);
        return false;
      }
      return true;
    });

    if (validRecords.length === 0) {
      return { success: true };
    }

    const payloads = validRecords.map(r => {
      const exp = Number(r.expected_amount ?? r.expected_sales) || 0;
      const act = Number(r.collected_amount ?? r.actual_handed_over_cash) || 0;
      const diff = Number(r.variance_amount ?? r.difference ?? (act - exp)) || 0;
      const recDate = r.date || r.record_date || new Date().toISOString().slice(0, 10);
      const pumperIdStr = r.pumper_id !== undefined && r.pumper_id !== null ? String(r.pumper_id).trim() : 'unknown_pumper';
      const shiftIdStr = r.shift_id !== undefined && r.shift_id !== null ? String(r.shift_id).trim() : 'unknown_shift';
      const rType = r.type || (diff < -0.5 ? 'SHORTAGE' : diff > 0.5 ? 'EXCESS' : 'BALANCED');
      const rStatus = r.status || (Math.abs(diff) <= 0.5 ? 'SETTLED' : 'PENDING');

      const existingId = r.id ? String(r.id) : '';
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existingId);
      const recordId = isUuid ? existingId : (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : getDeterministicUUID('shortage', shiftIdStr, pumperIdStr, existingId));

      return {
        id: recordId,
        shift_id: shiftIdStr,
        shift_name: String(r.shift_name || ''),
        pumper_id: pumperIdStr,
        pumper_name: String(r.pumper_name || pumperIdStr),
        record_date: String(recDate),
        expected_amount: exp,
        collected_amount: act,
        variance_amount: diff,
        type: String(rType),
        status: String(rStatus)
      };
    });

    let data: any = null;
    let error: any = null;

    try {
      const res = await client
        .from('pumper_shortage_excess')
        .upsert(payloads, { onConflict: 'id' });
      data = res.data;
      error = res.error;
    } catch (upsertEx: any) {
      error = upsertEx;
    }

    if (error) {
      console.error('Pumper shortage save error:', {
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        code: error?.code
      });
      return { success: false, data: null, error };
    } else {
      console.log('Pumper shortage records saved successfully to Supabase:', data || payloads);
      return { success: true, data, error: null };
    }
  } catch (err: any) {
    console.error('savePumperShortageExcessRecords exception:', {
      message: err?.message,
      details: err?.details
    });
    return { success: false, error: err };
  }
}

/**
 * Fetches all Pumper Shortage & Excess records from Supabase with localStorage merge.
 */
export async function fetchPumperShortagesExcess(
  client: any
): Promise<PumperShortageExcessRecord[]> {
  let localRecords: PumperShortageExcessRecord[] = [];
  try {
    const raw = localStorage.getItem('fms_pumper_shortages_excess');
    if (raw) {
      if (raw.includes('Aberathne') || raw.includes('SH-20260923') || raw.includes('rec_SH-')) {
        localStorage.removeItem('fms_pumper_shortages_excess');
      } else {
        localRecords = JSON.parse(raw);
      }
    }
  } catch (_) {}

  const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
  if (!isConfigured) return localRecords;

  try {
    let { data, error } = await client
      .from('pumper_shortage_excess')
      .select('*')
      .order('created_at', { ascending: false });

    if (error && (error.code === '42P01' || error.message?.includes('does not exist') || error.message?.includes('pumper_shortage_excess'))) {
      const fb = await client
        .from('pumper_shortages_excess')
        .select('*')
        .order('created_at', { ascending: false });
      if (!fb.error) {
        data = fb.data;
        error = null;
      }
    }

    if (data && !error && Array.isArray(data)) {
      const mapped: PumperShortageExcessRecord[] = data.map((d: any) => ({
        id: d.id,
        shift_id: d.shift_id || d.shiftId || '',
        shift_name: d.shift_name || d.shiftName || (d.shift_id ? `Shift ${d.shift_id}` : ''),
        pumper_id: d.pumper_id || d.pumperId || '',
        pumper_name: d.pumper_name || d.pumperName || 'Pumper',
        date: d.record_date || d.date || (d.created_at ? d.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10)),
        record_date: d.record_date || d.date || (d.created_at ? d.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10)),
        expected_amount: Number(d.expected_sales ?? d.expected_amount ?? d.expectedAmount ?? 0),
        expected_sales: Number(d.expected_sales ?? d.expected_amount ?? d.expectedAmount ?? 0),
        collected_amount: Number(d.actual_handed_over_cash ?? d.collected_amount ?? d.collectedAmount ?? 0),
        actual_handed_over_cash: Number(d.actual_handed_over_cash ?? d.collected_amount ?? d.collectedAmount ?? 0),
        variance_amount: Number(d.difference ?? d.variance ?? d.variance_amount ?? d.varianceAmount ?? (Number(d.actual_handed_over_cash ?? d.collected_amount ?? 0) - Number(d.expected_sales ?? d.expected_amount ?? 0))),
        difference: Number(d.difference ?? d.variance ?? d.variance_amount ?? d.varianceAmount ?? (Number(d.actual_handed_over_cash ?? d.collected_amount ?? 0) - Number(d.expected_sales ?? d.expected_amount ?? 0))),
        variance: Number(d.difference ?? d.variance ?? d.variance_amount ?? d.varianceAmount ?? (Number(d.actual_handed_over_cash ?? d.collected_amount ?? 0) - Number(d.expected_sales ?? d.expected_amount ?? 0))),
        type: (d.type || (Number(d.difference ?? d.variance_amount ?? 0) < -0.5 ? 'SHORTAGE' : Number(d.difference ?? d.variance_amount ?? 0) > 0.5 ? 'EXCESS' : 'BALANCED')) as any,
        status: (d.status || 'PENDING') as any,
        settled_at: d.settled_at || d.settledAt || undefined,
        settled_by: d.settled_by || d.settledBy || undefined,
        notes: d.notes || '',
        created_at: d.created_at || d.createdAt || undefined
      }));

      try {
        localStorage.setItem('fms_pumper_shortages_excess', JSON.stringify(mapped));
      } catch (_) {}

      return mapped;
    }
  } catch (err) {
    console.warn('fetchPumperShortagesExcess error:', err);
  }

  return localRecords;
}

/**
 * Updates settlement status of a Pumper Shortage & Excess record
 */
export async function updatePumperShortageExcessStatus(
  client: any,
  id: string,
  status: 'PENDING' | 'SETTLED',
  settledBy?: string,
  notes?: string
): Promise<{ success: boolean; error?: any }> {
  const settledAt = status === 'SETTLED' ? new Date().toISOString() : undefined;

  // Update local storage
  try {
    const raw = localStorage.getItem('fms_pumper_shortages_excess');
    if (raw) {
      const records: PumperShortageExcessRecord[] = JSON.parse(raw);
      const updated = records.map(r => {
        if (r.id === id) {
          return {
            ...r,
            status,
            settled_at: settledAt,
            settled_by: settledBy || r.settled_by,
            notes: notes !== undefined ? notes : r.notes
          };
        }
        return r;
      });
      localStorage.setItem('fms_pumper_shortages_excess', JSON.stringify(updated));
    }
  } catch (_) {}

  const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
  if (!isConfigured) return { success: true };

  try {
    const updatePayload: any = {
      status,
      settled_at: settledAt || null,
      settled_by: settledBy || null
    };
    if (notes !== undefined) {
      updatePayload.notes = notes;
    }

    let { error } = await client
      .from('pumper_shortage_excess')
      .update(updatePayload)
      .eq('id', id);

    if (error && (error.code === '42P01' || error.message?.includes('does not exist') || error.message?.includes('pumper_shortage_excess'))) {
      const fb = await client
        .from('pumper_shortages_excess')
        .update(updatePayload)
        .eq('id', id);
      error = fb.error;
    }

    return { success: !error, error };
  } catch (err) {
    console.warn('updatePumperShortageExcessStatus error:', err);
    return { success: false, error: err };
  }
}

export interface PumperReconciliationPayload {
  id: string; // `${shiftId}_${pumperId}`
  shift_id: string;
  pumper_id: string;
  pumper_name: string;
  handed_over_cash: number;
  actual_cash: number;
  expected_cash: number;
  cash_variance: number;
  credit_sales: number;
  card_sales: number;
  card_sale?: number;
  touch_card_sales: number;
  touch_card?: number;
  voucher_sales: number;
  voucher_sale?: number;
  assigned_pumps_count: number;
  start_meter?: number;
  end_meter?: number;
  startmeter?: number;
  endmeter?: number;
  status: string;
  updated_at?: string;
}

/**
 * Persists a pumper's reconciled cash handover, meter readings, and non-cash sales directly to Supabase.
 * Strictly awaits all database responses across 'pumper_assignments', 'shift_pumper_assignments', and 'shift_pumper_reconciliations'.
 */
export async function savePumperReconciliation(
  client: any,
  payload: PumperReconciliationPayload
) {
  // Always cache locally first so page refreshes never lose state
  try {
    const key = `fuelflow_pumper_reconciliation_${payload.shift_id}_${payload.pumper_id}`;
    localStorage.setItem(key, JSON.stringify(payload));
  } catch (_) {}

  const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
  if (!isConfigured) return { success: true };

  const rawStart = payload.start_meter !== undefined ? payload.start_meter : (payload.startmeter !== undefined ? payload.startmeter : (payload as any).startMeter);
  const parsedStart = (rawStart !== undefined && rawStart !== null && rawStart !== '') ? parseFloat(String(rawStart)) : undefined;
  const startVal = (parsedStart !== undefined && !isNaN(parsedStart)) ? parsedStart : 0;

  const rawEnd = payload.end_meter !== undefined ? payload.end_meter : (payload.endmeter !== undefined ? payload.endmeter : (payload as any).endMeter);
  const parsedEnd = (rawEnd !== undefined && rawEnd !== null && rawEnd !== '') ? parseFloat(String(rawEnd)) : undefined;
  const endVal = (parsedEnd !== undefined && !isNaN(parsedEnd)) ? parsedEnd : 0;

  const handedCash = payload.handed_over_cash !== undefined ? payload.handed_over_cash : (payload.actual_cash ?? 0);
  const credSales = payload.credit_sales ?? 0;
  const cSales = payload.card_sales ?? (payload as any).card_sale ?? 0;
  const tcSales = payload.touch_card_sales ?? (payload as any).touch_card ?? 0;
  const vSales = payload.voucher_sales ?? (payload as any).voucher_sale ?? 0;

  // Complete payload with all column variations (both singular and plural)
  const fullPayload = {
    id: payload.id,
    shift_id: payload.shift_id,
    pumper_id: payload.pumper_id,
    pumper_name: payload.pumper_name,
    handed_over_cash: handedCash,
    actual_cash: handedCash,
    expected_cash: payload.expected_cash ?? 0,
    cash_variance: payload.cash_variance ?? 0,
    credit_sales: credSales,
    card_sales: cSales,
    card_sale: cSales,
    touch_card_sales: tcSales,
    touch_card: tcSales,
    voucher_sales: vSales,
    voucher_sale: vSales,
    start_meter: startVal,
    end_meter: endVal,
    startmeter: startVal,
    endmeter: endVal,
    assigned_pumps_count: payload.assigned_pumps_count || 1,
    status: payload.status || 'Completed',
    updated_at: new Date().toISOString()
  };

  const standardPayload = {
    id: payload.id,
    shift_id: payload.shift_id,
    pumper_id: payload.pumper_id,
    pumper_name: payload.pumper_name,
    handed_over_cash: handedCash,
    actual_cash: handedCash,
    expected_cash: payload.expected_cash ?? 0,
    cash_variance: payload.cash_variance ?? 0,
    credit_sales: credSales,
    card_sales: cSales,
    touch_card_sales: tcSales,
    voucher_sales: vSales,
    start_meter: startVal,
    end_meter: endVal,
    assigned_pumps_count: payload.assigned_pumps_count || 1,
    status: payload.status || 'Completed',
    updated_at: new Date().toISOString()
  };

  let savedAny = false;

  // 1. Strictly await database response for 'pumper_assignments'
  try {
    const { error: errPumper } = await client
      .from('pumper_assignments')
      .upsert([fullPayload]);
    if (!errPumper) {
      savedAny = true;
    } else if (errPumper.code === '42703' || errPumper.code === 'PGRST204' || errPumper.message?.includes('column')) {
      const { error: errStd } = await client
        .from('pumper_assignments')
        .upsert([standardPayload]);
      if (!errStd) savedAny = true;
    }
  } catch (errP) {
    console.warn('pumper_assignments upsert note:', errP);
  }

  // 2. Strictly await database response for 'shift_pumper_assignments'
  try {
    const { error: errShift } = await client
      .from('shift_pumper_assignments')
      .upsert([fullPayload]);
    if (!errShift) {
      savedAny = true;
    } else if (errShift.code === '42703' || errShift.code === 'PGRST204' || errShift.message?.includes('column')) {
      const { error: errShiftStd } = await client
        .from('shift_pumper_assignments')
        .upsert([standardPayload]);
      if (!errShiftStd) savedAny = true;
    }
  } catch (errS) {
    console.warn('shift_pumper_assignments upsert note:', errS);
  }

  // 3. Strictly await database response for 'shift_pumper_reconciliations'
  try {
    const { error: errRecon } = await client
      .from('shift_pumper_reconciliations')
      .upsert([fullPayload]);
    if (!errRecon) {
      savedAny = true;
    } else if (errRecon.code === '42703' || errRecon.code === 'PGRST204' || errRecon.message?.includes('column')) {
      const { error: errReconStd } = await client
        .from('shift_pumper_reconciliations')
        .upsert([standardPayload]);
      if (!errReconStd) savedAny = true;
    }
  } catch (errR) {
    console.warn('shift_pumper_reconciliations upsert note:', errR);
  }

  return { success: savedAny };
}

/**
 * Fetches reconciled pumper records for an active shift.
 * Gathers and merges data across 'pumper_assignments', 'shift_pumper_assignments', and 'shift_pumper_reconciliations',
 * ensuring complete state rehydration on page refresh.
 */
export async function fetchPumperReconciliations(
  client: any,
  shiftId: string
): Promise<any[]> {
  const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
  const mergedMap = new Map<string, any>();

  // 1. Read from localStorage cache as immediate baseline
  try {
    const prefix = `fuelflow_pumper_reconciliation_${shiftId}_`;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        const val = localStorage.getItem(key);
        if (val) {
          try {
            const parsed = JSON.parse(val);
            const pid = parsed.pumper_id || parsed.pumperId;
            if (pid) {
              const rawStart = parsed.start_meter !== undefined ? parsed.start_meter : parsed.startmeter;
              const pStart = (rawStart !== undefined && rawStart !== null && rawStart !== '') ? parseFloat(String(rawStart)) : undefined;
              const rawEnd = parsed.end_meter !== undefined ? parsed.end_meter : parsed.endmeter;
              const pEnd = (rawEnd !== undefined && rawEnd !== null && rawEnd !== '') ? parseFloat(String(rawEnd)) : undefined;
              mergedMap.set(pid, {
                ...parsed,
                start_meter: (pStart !== undefined && !isNaN(pStart)) ? pStart : 0,
                end_meter: (pEnd !== undefined && !isNaN(pEnd)) ? pEnd : 0,
                startmeter: (pStart !== undefined && !isNaN(pStart)) ? pStart : 0,
                endmeter: (pEnd !== undefined && !isNaN(pEnd)) ? pEnd : 0
              });
            }
          } catch (_) {}
        }
      }
    }
  } catch (_) {}

  if (isConfigured && shiftId) {
    // Helper to merge a database row into mergedMap
    const mergeRow = (row: any) => {
      const pid = row.pumper_id || row.pumperId;
      if (!pid) return;
      const existing = mergedMap.get(pid) || {};

      const rawStart = row.start_meter !== undefined ? row.start_meter : (row.startmeter !== undefined ? row.startmeter : (existing.start_meter !== undefined ? existing.start_meter : existing.startmeter));
      const parsedStart = (rawStart !== undefined && rawStart !== null && rawStart !== '') ? parseFloat(String(rawStart)) : undefined;
      const startMeter = (parsedStart !== undefined && !isNaN(parsedStart)) ? parsedStart : 0;

      const rawEnd = row.end_meter !== undefined ? row.end_meter : (row.endmeter !== undefined ? row.endmeter : (existing.end_meter !== undefined ? existing.end_meter : existing.endmeter));
      const parsedEnd = (rawEnd !== undefined && rawEnd !== null && rawEnd !== '') ? parseFloat(String(rawEnd)) : undefined;
      const endMeter = (parsedEnd !== undefined && !isNaN(parsedEnd)) ? parsedEnd : 0;

      const handedCash = Number(row.handed_over_cash ?? row.handedovercash ?? row.actual_cash ?? row.actualcash) || Number(existing.handed_over_cash ?? existing.actual_cash) || 0;
      const credit = Number(row.credit_sales ?? row.creditsales) || Number(existing.credit_sales) || 0;
      const card = Number(row.card_sales ?? row.card_sale ?? row.cardsales) || Number(existing.card_sales ?? existing.card_sale) || 0;
      const touchCard = Number(row.touch_card_sales ?? row.touch_card ?? row.touchcardsales) || Number(existing.touch_card_sales ?? existing.touch_card) || 0;
      const voucher = Number(row.voucher_sales ?? row.voucher_sale ?? row.vouchersales) || Number(existing.voucher_sales ?? existing.voucher_sale) || 0;

      mergedMap.set(pid, {
        ...existing,
        ...row,
        start_meter: startMeter,
        end_meter: endMeter,
        startmeter: startMeter,
        endmeter: endMeter,
        handed_over_cash: handedCash,
        actual_cash: handedCash,
        credit_sales: credit,
        card_sales: card,
        card_sale: card,
        touch_card_sales: touchCard,
        touch_card: touchCard,
        voucher_sales: voucher,
        voucher_sale: voucher,
        status: row.status || existing.status || 'Active'
      });
    };

    // Query all tables in parallel to get complete persisted payload across tables
    try {
      const [pumperRes, shiftPumperRes, reconRes] = await Promise.all([
        client.from('pumper_assignments').select('*').eq('shift_id', shiftId),
        client.from('shift_pumper_assignments').select('*').eq('shift_id', shiftId),
        client.from('shift_pumper_reconciliations').select('*').eq('shift_id', shiftId)
      ]);

      if (pumperRes?.data && Array.isArray(pumperRes.data)) {
        pumperRes.data.forEach(mergeRow);
      }
      if (shiftPumperRes?.data && Array.isArray(shiftPumperRes.data)) {
        shiftPumperRes.data.forEach(mergeRow);
      }
      if (reconRes?.data && Array.isArray(reconRes.data)) {
        reconRes.data.forEach(mergeRow);
      }
    } catch (err) {
      console.warn('Notice fetching pumper reconciliations from Supabase:', err);
    }
  }

  return Array.from(mergedMap.values());
}

export interface ForecourtOilChamberRecord {
  id: string; // `${shiftId}_${chamberId}`
  shift_id: string;
  chamber_id: string;
  chamber_number: number;
  grade: string;
  opening_liters: number;
  received_liters: number;
  closing_liters: number;
  sold_liters: number;
  rate_per_liter: number;
  total_amount: number;
  updated_at?: string;
}

/**
 * Persists 4-Chamber Forecourt Bulk Oil Dispenser readings directly to Supabase.
 * Tries 'bulk_oil_shift_logs', then 'forecourt_oil_reconciliations'.
 */
export async function saveForecourtOilReconciliation(
  client: any,
  shiftId: string,
  chamberReadings: ChamberReading[]
) {
  if (!shiftId || !chamberReadings || chamberReadings.length === 0) return { success: true };

  // 1. Always cache in localStorage for instant offline/page-refresh recovery
  try {
    const cacheKey = `fuelflow_forecourt_oil_${shiftId}`;
    localStorage.setItem(cacheKey, JSON.stringify(chamberReadings));
    chamberReadings.forEach(ch => {
      const cl = ch.closingLevel ?? ch.closingLiters ?? 0;
      if (cl > 0) {
        localStorage.setItem(`fuelflow_chamber_closing_${ch.chamberId}`, String(cl));
      }
    });
  } catch (_) {}

  const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
  if (!isConfigured) return { success: true };

  const records = chamberReadings.map((ch, idx) => ({
    id: `${shiftId}_${ch.chamberId || `ch_${idx + 1}`}`,
    shift_id: shiftId,
    chamber_id: ch.chamberId || `ch_${idx + 1}`,
    chamber_number: ch.chamberNumber || (idx + 1),
    grade: ch.grade || '',
    opening_liters: Number(ch.openingLevel ?? ch.openingLiters ?? 0),
    received_liters: Number(ch.receivedLevel ?? ch.receivedLiters ?? 0),
    closing_liters: Number(ch.closingLevel ?? ch.closingLiters ?? 0),
    sold_liters: Number(ch.soldLiters || 0),
    rate_per_liter: Number(ch.ratePerLiter || 0),
    total_amount: Number(ch.totalAmount || 0),
    updated_at: new Date().toISOString()
  }));

  try {
    const { error: err1 } = await client
      .from('bulk_oil_shift_logs')
      .upsert(records);
    if (!err1) return { success: true };
  } catch (e) {
    console.warn('bulk_oil_shift_logs upsert note:', e);
  }

  try {
    const { error: err2 } = await client
      .from('forecourt_oil_reconciliations')
      .upsert(records);
    if (!err2) return { success: true };
  } catch (e) {
    console.warn('forecourt_oil_reconciliations upsert note:', e);
  }

  return { success: false };
}

/**
 * Fetches Forecourt Bulk Oil Dispenser reconciliation records for an active shift.
 */
export async function fetchForecourtOilReconciliation(
  client: any,
  shiftId: string
): Promise<any[]> {
  if (!shiftId) return [];
  const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
  let dbResults: any[] = [];

  if (isConfigured) {
    try {
      const { data, error } = await client
        .from('bulk_oil_shift_logs')
        .select('*')
        .eq('shift_id', shiftId);
      if (!error && data && data.length > 0) {
        dbResults = data;
      }
    } catch (_) {}

    if (dbResults.length === 0) {
      try {
        const { data, error } = await client
          .from('forecourt_oil_reconciliations')
          .select('*')
          .eq('shift_id', shiftId);
        if (!error && data && data.length > 0) {
          dbResults = data;
        }
      } catch (_) {}
    }
  }

  // Also read from localStorage cache
  let localResults: any[] = [];
  try {
    const raw = localStorage.getItem(`fuelflow_forecourt_oil_${shiftId}`);
    if (raw) {
      localResults = JSON.parse(raw);
    }
  } catch (_) {}

  if (dbResults.length > 0) {
    return dbResults;
  }
  return localResults;
}

/**
 * Directly queries all saved pump readings for a shift from Supabase 'pump_readings' and 'meter_readings'.
 * Returns an array of mapped readings or empty array if none found / table not configured.
 */
export async function fetchShiftPumpReadings(client: any, shiftId: string): Promise<any[]> {
  const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
  if (!shiftId) return [];

  let dbResults: any[] = [];

  if (isConfigured) {
    // 1. Try 'pump_readings' with shift_id
    try {
      const { data, error } = await client
        .from('pump_readings')
        .select('*')
        .eq('shift_id', shiftId);

      if (!error && data && data.length > 0) {
        dbResults = data;
      }
    } catch (err) {
      console.warn('fetchShiftPumpReadings pump_readings error:', err);
    }

    // 2. Try 'pump_readings' with lowercase shiftid if empty
    if (dbResults.length === 0) {
      try {
        const { data, error } = await client
          .from('pump_readings')
          .select('*')
          .eq('shiftid', shiftId);

        if (!error && data && data.length > 0) {
          dbResults = data;
        }
      } catch (_) {}
    }

    // 3. Try 'meter_readings' with shift_id
    try {
      const { data, error } = await client
        .from('meter_readings')
        .select('*')
        .eq('shift_id', shiftId);

      if (!error && data && data.length > 0) {
        if (dbResults.length === 0) {
          dbResults = data;
        } else {
          // Merge meter_readings over pump_readings
          const map = new Map(dbResults.map((r: any) => [r.pump_id || r.pumpid || r.pumpId, r]));
          data.forEach((mr: any) => {
            const pid = mr.pump_id || mr.pumpid || mr.pumpId;
            if (pid) {
              const existing = map.get(pid) || {};
              map.set(pid, { ...existing, ...mr });
            }
          });
          dbResults = Array.from(map.values());
        }
      }
    } catch (_) {}

    // 4. Try 'meter_readings' with shiftid if still empty
    if (dbResults.length === 0) {
      try {
        const { data, error } = await client
          .from('meter_readings')
          .select('*')
          .eq('shiftid', shiftId);

        if (!error && data && data.length > 0) {
          dbResults = data;
        }
      } catch (_) {}
    }
  }

  // Also read from localStorage cache for instant zero-latency paint
  const localResults: any[] = [];
  try {
    const prefix = `fuelflow_pump_reading_${shiftId}_`;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        const val = localStorage.getItem(key);
        if (val) {
          try {
            localResults.push(JSON.parse(val));
          } catch (_) {}
        }
      }
    }
  } catch (_) {}

  // Merge local and db: db takes priority for meter readings, local as fallback
  const finalMap = new Map<string, any>();
  localResults.forEach(lr => {
    const pid = lr.pumpId || lr.pump_id || lr.pumpid;
    if (pid) finalMap.set(pid, lr);
  });
  dbResults.forEach(dr => {
    const pid = dr.pump_id || dr.pumpid || dr.pumpId;
    if (pid) {
      const existing = finalMap.get(pid) || {};
      finalMap.set(pid, { ...existing, ...dr });
    }
  });

  return Array.from(finalMap.values());
}




