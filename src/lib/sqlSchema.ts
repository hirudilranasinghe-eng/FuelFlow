export const SUPABASE_SQL = `-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Employees Table
CREATE TABLE employees (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('Supervisor', 'Pumper')),
    phone TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('Active', 'On Shift', 'Off-duty', 'Suspended')),
    avatarcolor TEXT NOT NULL
);

-- Fuel Tanks Table
CREATE TABLE fuel_tanks (
    id TEXT PRIMARY KEY,
    fueltype TEXT NOT NULL,
    name TEXT NOT NULL,
    capacity NUMERIC NOT NULL,
    currentlevel NUMERIC NOT NULL,
    priceperliter NUMERIC NOT NULL
);

-- Oil (Lubricants) Storage Tanks Table
CREATE TABLE oil_tanks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    grade TEXT NOT NULL,
    capacity NUMERIC NOT NULL,
    currentlevel NUMERIC NOT NULL,
    priceperliter NUMERIC NOT NULL
);

-- Pumps Table
CREATE TABLE pumps (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    fueltype TEXT NOT NULL,
    tankid TEXT,
    status TEXT NOT NULL CHECK (status IN ('Active', 'Idle', 'Maintenance'))
);

-- Shifts Table
CREATE TABLE shifts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    supervisorid TEXT REFERENCES employees(id),
    starttime TIMESTAMPTZ NOT NULL,
    endtime TIMESTAMPTZ,
    isactive BOOLEAN NOT NULL DEFAULT true,
    totalfuelsold NUMERIC DEFAULT 0,
    totalnetsold NUMERIC DEFAULT 0,
    totalnetsales NUMERIC DEFAULT 0
);

-- Pump Readings Table (Linked to Shifts)
CREATE TABLE pump_readings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shift_id TEXT REFERENCES shifts(id) ON DELETE CASCADE,
    pumpid TEXT NOT NULL,
    pumpname TEXT NOT NULL,
    fueltype TEXT NOT NULL,
    tankid TEXT,
    assignedpumperid TEXT REFERENCES employees(id),
    startmeter NUMERIC NOT NULL,
    endmeter NUMERIC NOT NULL,
    testingqty NUMERIC DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('Active', 'Idle', 'Completed')),
    islocked BOOLEAN DEFAULT false,
    unitprice NUMERIC
);

-- Stock Deliveries Table
CREATE TABLE stock_deliveries (
    id TEXT PRIMARY KEY,
    date TIMESTAMPTZ NOT NULL,
    fueltype TEXT NOT NULL,
    tankid TEXT,
    quantity NUMERIC NOT NULL,
    supplier TEXT NOT NULL,
    cost NUMERIC NOT NULL
);

-- Price Schedules Table
CREATE TABLE price_schedules (
    id TEXT PRIMARY KEY,
    fueltype TEXT NOT NULL,
    newprice NUMERIC NOT NULL,
    effectivedate TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('Pending', 'Applied', 'Cancelled'))
);

-- Packaged Lubricants Inventory Table
CREATE TABLE IF NOT EXISTS packaged_lubricants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    grade TEXT NOT NULL,
    package_size TEXT NOT NULL,
    current_stock NUMERIC NOT NULL DEFAULT 0,
    min_reorder_level NUMERIC NOT NULL DEFAULT 10,
    unit_cost NUMERIC NOT NULL DEFAULT 0,
    retail_price NUMERIC NOT NULL DEFAULT 0,
    barcode TEXT,
    location TEXT
);

-- Ensure all potential column variations exist for packaged_lubricants
ALTER TABLE packaged_lubricants ADD COLUMN IF NOT EXISTS product_name TEXT;
ALTER TABLE packaged_lubricants ADD COLUMN IF NOT EXISTS pack_size TEXT;
ALTER TABLE packaged_lubricants ADD COLUMN IF NOT EXISTS cost_price NUMERIC;

-- Bulk Lubricants Storage Tanks / Chambers / Drums Table
CREATE TABLE IF NOT EXISTS bulk_lubricants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    grade TEXT NOT NULL,
    capacity NUMERIC NOT NULL,
    current_level NUMERIC NOT NULL DEFAULT 0,
    price_per_liter NUMERIC NOT NULL DEFAULT 0,
    type TEXT NOT NULL DEFAULT 'drum',
    chamber_number NUMERIC
);

-- Lubricant GRN Receipts Table
CREATE TABLE IF NOT EXISTS lubricant_grn_receipts (
    id TEXT PRIMARY KEY,
    grn_number TEXT NOT NULL,
    date TIMESTAMPTZ NOT NULL,
    supplier TEXT NOT NULL,
    invoice_number TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('bulk', 'packaged')),
    tank_id TEXT,
    tank_name TEXT,
    liters_received NUMERIC,
    total_amount NUMERIC NOT NULL DEFAULT 0,
    received_by TEXT NOT NULL,
    notes TEXT,
    items JSONB
);

-- Lubricant GRN Line Items Table
CREATE TABLE IF NOT EXISTS lubricant_grn_items (
    id TEXT PRIMARY KEY,
    grn_id TEXT REFERENCES lubricant_grn_receipts(id) ON DELETE CASCADE,
    item_id TEXT,
    item_name TEXT NOT NULL,
    package_size TEXT,
    quantity NUMERIC NOT NULL,
    unit_cost NUMERIC NOT NULL,
    total_cost NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS gas_inventory (
  id VARCHAR(50) PRIMARY KEY,
  size VARCHAR(20) NOT NULL,
  full_count INTEGER DEFAULT 0,
  empty_count INTEGER DEFAULT 0,
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gas_adjustments (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  gas_item_id VARCHAR(50) REFERENCES gas_inventory(id),
  full_count_change INTEGER NOT NULL,
  empty_count_change INTEGER NOT NULL,
  reason VARCHAR(255) NOT NULL,
  adjusted_by VARCHAR(255),
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lp_gas_purchases (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  date DATE NOT NULL,
  size VARCHAR(20) NOT NULL,
  full_quantity INTEGER NOT NULL,
  empty_returned INTEGER NOT NULL,
  unit_price NUMERIC NOT NULL,
  total_cost NUMERIC NOT NULL,
  supplier VARCHAR(255) NOT NULL,
  invoice_no VARCHAR(100) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Disable Row Level Security (RLS) for all tables to allow simple public access
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE fuel_tanks DISABLE ROW LEVEL SECURITY;
ALTER TABLE oil_tanks DISABLE ROW LEVEL SECURITY;
ALTER TABLE pumps DISABLE ROW LEVEL SECURITY;
ALTER TABLE shifts DISABLE ROW LEVEL SECURITY;
ALTER TABLE pump_readings DISABLE ROW LEVEL SECURITY;
ALTER TABLE stock_deliveries DISABLE ROW LEVEL SECURITY;
ALTER TABLE price_schedules DISABLE ROW LEVEL SECURITY;
ALTER TABLE packaged_lubricants DISABLE ROW LEVEL SECURITY;
ALTER TABLE bulk_lubricants DISABLE ROW LEVEL SECURITY;
ALTER TABLE lubricant_grn_receipts DISABLE ROW LEVEL SECURITY;
ALTER TABLE lubricant_grn_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE gas_inventory DISABLE ROW LEVEL SECURITY;
ALTER TABLE gas_adjustments DISABLE ROW LEVEL SECURITY;
ALTER TABLE lp_gas_purchases DISABLE ROW LEVEL SECURITY;
ALTER TABLE lubricant_grn_items DISABLE ROW LEVEL SECURITY;

-- Role Access & Permissions (RBAC) Table
CREATE TABLE IF NOT EXISTS role_permissions (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    module TEXT NOT NULL,
    is_visible BOOLEAN NOT NULL DEFAULT true,
    can_view BOOLEAN NOT NULL DEFAULT true,
    can_create BOOLEAN NOT NULL DEFAULT false,
    can_edit BOOLEAN NOT NULL DEFAULT false,
    can_delete BOOLEAN NOT NULL DEFAULT false,
    can_export BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_role_module UNIQUE (role, module)
);

ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT true;
ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS can_view BOOLEAN DEFAULT true;
ALTER TABLE role_permissions DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable all access for role_permissions" ON role_permissions;
CREATE POLICY "Enable all access for role_permissions" ON role_permissions FOR ALL TO public USING (true) WITH CHECK (true);

-- User-Specific Permission Overrides Table
CREATE TABLE IF NOT EXISTS user_permissions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    user_name TEXT,
    user_role TEXT,
    module TEXT NOT NULL,
    is_visible BOOLEAN NOT NULL DEFAULT true,
    can_view BOOLEAN NOT NULL DEFAULT true,
    can_create BOOLEAN NOT NULL DEFAULT false,
    can_edit BOOLEAN NOT NULL DEFAULT false,
    can_delete BOOLEAN NOT NULL DEFAULT false,
    can_export BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_user_module UNIQUE (user_id, module)
);

ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT true;
ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS can_view BOOLEAN DEFAULT true;
ALTER TABLE user_permissions DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable all access for user_permissions" ON user_permissions;
CREATE POLICY "Enable all access for user_permissions" ON user_permissions FOR ALL TO public USING (true) WITH CHECK (true);

-- Safe RPC function to fetch active Supabase auth users for admin dropdown
CREATE OR REPLACE FUNCTION get_supabase_auth_users()
RETURNS TABLE (
    id UUID,
    email TEXT,
    full_name TEXT,
    role TEXT
) 
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        u.id,
        u.email::TEXT,
        COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', u.email)::TEXT AS full_name,
        COALESCE(u.raw_user_meta_data->>'role', 'user')::TEXT AS role
    FROM auth.users u
    ORDER BY u.created_at DESC;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION get_supabase_auth_users() TO authenticated, anon, public;

-- Ensure tankid column exists on pumps table
ALTER TABLE pumps ADD COLUMN IF NOT EXISTS tankid TEXT;

-- Disable RLS for fuel_tank if it exists
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'fuel_tank') THEN
        ALTER TABLE fuel_tank DISABLE ROW LEVEL SECURITY;
    END IF;
END $$;

-- If Row Level Security is enabled/re-enabled, create permissive policies allowing full access
DROP POLICY IF EXISTS "Enable all access for employees" ON employees;
CREATE POLICY "Enable all access for employees" ON employees FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Enable all access for fuel_tanks" ON fuel_tanks;
CREATE POLICY "Enable all access for fuel_tanks" ON fuel_tanks FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Enable all access for oil_tanks" ON oil_tanks;
CREATE POLICY "Enable all access for oil_tanks" ON oil_tanks FOR ALL TO public USING (true) WITH CHECK (true);

-- Permissive policy for fuel_tank if it exists
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'fuel_tank') THEN
        EXECUTE 'DROP POLICY IF EXISTS "Enable all access for fuel_tank" ON fuel_tank';
        EXECUTE 'CREATE POLICY "Enable all access for fuel_tank" ON fuel_tank FOR ALL TO public USING (true) WITH CHECK (true)';
    END IF;
END $$;

DROP POLICY IF EXISTS "Enable all access for pumps" ON pumps;
CREATE POLICY "Enable all access for pumps" ON pumps FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Enable all access for shifts" ON shifts;
CREATE POLICY "Enable all access for shifts" ON shifts FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Enable all access for pump_readings" ON pump_readings;
CREATE POLICY "Enable all access for pump_readings" ON pump_readings FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Enable all access for stock_deliveries" ON stock_deliveries;
CREATE POLICY "Enable all access for stock_deliveries" ON stock_deliveries FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Enable all access for price_schedules" ON price_schedules;
CREATE POLICY "Enable all access for price_schedules" ON price_schedules FOR ALL TO public USING (true) WITH CHECK (true);`;
