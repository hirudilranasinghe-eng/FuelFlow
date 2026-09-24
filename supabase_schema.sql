-- Enable UUID generation
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
    id TEXT PRIMARY KEY,
    shift_id TEXT REFERENCES shifts(id) ON DELETE CASCADE,
    pumpid TEXT NOT NULL,
    pumpname TEXT NOT NULL,
    fueltype TEXT NOT NULL,
    tankid TEXT,
    assignedpumperid TEXT REFERENCES employees(id),
    replacementpumperid TEXT REFERENCES employees(id),
    initialpumpercash NUMERIC DEFAULT 0,
    handovermeter NUMERIC DEFAULT 0,
    handovernotes TEXT,
    startmeter NUMERIC NOT NULL,
    endmeter NUMERIC NOT NULL,
    testingqty NUMERIC DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('Active', 'Idle', 'Completed')),
    islocked BOOLEAN DEFAULT false,
    unitprice NUMERIC,
    actualcash NUMERIC DEFAULT 0,
    cashvariance NUMERIC DEFAULT 0,
    creditsalesamount NUMERIC DEFAULT 0,
    cardsalesamount NUMERIC DEFAULT 0,
    oilsalesamount NUMERIC DEFAULT 0,
    netexpectedcash NUMERIC DEFAULT 0
);

-- Shift Logs Table
CREATE TABLE shift_logs (
    id TEXT PRIMARY KEY,
    shift_id TEXT REFERENCES shifts(id) ON DELETE CASCADE,
    shift_name TEXT,
    supervisor_id TEXT,
    pump_id TEXT NOT NULL,
    pump_name TEXT NOT NULL,
    fuel_type TEXT NOT NULL,
    assigned_pumper_id TEXT,
    start_meter NUMERIC NOT NULL,
    end_meter NUMERIC NOT NULL,
    testing_qty NUMERIC DEFAULT 0,
    net_liters NUMERIC DEFAULT 0,
    unit_price NUMERIC DEFAULT 0,
    gross_revenue NUMERIC DEFAULT 0,
    credit_sales_amount NUMERIC DEFAULT 0,
    card_sales_amount NUMERIC DEFAULT 0,
    oil_sales_amount NUMERIC DEFAULT 0,
    expected_cash NUMERIC DEFAULT 0,
    actual_cash NUMERIC DEFAULT 0,
    cash_variance NUMERIC DEFAULT 0,
    closed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Customers Table
CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    customer_type TEXT NOT NULL CHECK (customer_type IN ('Cash', 'Credit', 'Deposit')),
    category TEXT DEFAULT 'Business',
    email TEXT,
    address TEXT,
    notes TEXT,
    credit_limit NUMERIC DEFAULT 0,
    deposit_balance NUMERIC DEFAULT 0,
    current_balance NUMERIC DEFAULT 0,
    allowed_days INTEGER DEFAULT 30,
    status TEXT NOT NULL CHECK (status IN ('Active', 'Suspended', 'Overdue', 'Blocked')),
    vehicle_numbers TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Customer Ledgers Table (Deposit top-ups, settlements, fuel deductions & statement transactions)
CREATE TABLE IF NOT EXISTS customer_ledgers (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    customer_name TEXT,
    transaction_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    transaction_type TEXT NOT NULL CHECK (transaction_type IN ('DEPOSIT_TOPUP', 'CREDIT_PAYMENT', 'FUEL_DISPENSE', 'ADJUSTMENT', 'INITIAL_DEPOSIT')),
    description TEXT,
    reference_no TEXT,
    vehicle_no TEXT,
    fuel_type TEXT,
    liters NUMERIC DEFAULT 0,
    rate_per_liter NUMERIC DEFAULT 0,
    debit NUMERIC DEFAULT 0,
    credit NUMERIC DEFAULT 0,
    amount NUMERIC NOT NULL DEFAULT 0,
    running_balance NUMERIC DEFAULT 0,
    payment_mode TEXT,
    notes TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Credit Sales Table
CREATE TABLE IF NOT EXISTS credit_sales (
    id TEXT PRIMARY KEY,
    shift_id TEXT REFERENCES shifts(id) ON DELETE CASCADE,
    pump_id TEXT,
    customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
    customer_name TEXT,
    vehicle_no TEXT,
    invoice_no TEXT,
    fuel_type TEXT,
    liters NUMERIC DEFAULT 0,
    price_per_liter NUMERIC DEFAULT 0,
    amount NUMERIC DEFAULT 0,
    total_amount NUMERIC DEFAULT 0,
    sale_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    due_date TIMESTAMPTZ,
    status TEXT DEFAULT 'Approved',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Card Sales Table
CREATE TABLE IF NOT EXISTS card_sales (
    id TEXT PRIMARY KEY,
    shift_id TEXT REFERENCES shifts(id) ON DELETE CASCADE,
    pump_id TEXT,
    card_type TEXT DEFAULT 'Visa/Master',
    amount NUMERIC NOT NULL DEFAULT 0,
    status TEXT DEFAULT 'Settled',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Payment Settlements Table
CREATE TABLE payment_settlements (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    payment_mode TEXT NOT NULL CHECK (payment_mode IN ('Cash', 'Cheque', 'Bank Transfer')),
    amount NUMERIC NOT NULL,
    reference_no TEXT,
    payment_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pumper Non-Cash Sales Table (Credit & Card Sales per Shift/Pump/Pumper)
CREATE TABLE pumper_non_cash_sales (
    id TEXT PRIMARY KEY,
    shift_id TEXT REFERENCES shifts(id) ON DELETE CASCADE,
    pump_id TEXT,
    pumper_id TEXT REFERENCES employees(id),
    payment_type TEXT NOT NULL CHECK (payment_type IN ('CREDIT', 'CARD')),
    amount NUMERIC NOT NULL DEFAULT 0,
    customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
    vehicle_no TEXT,
    reference_no TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Automated Balance Sync Function & Triggers for Customers Balance
CREATE OR REPLACE FUNCTION update_customer_balance_on_credit_sale()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE customers
    SET current_balance = COALESCE(current_balance, 0) + NEW.total_amount
    WHERE id = NEW.customer_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_credit_sale_balance_sync ON credit_sales;
CREATE TRIGGER trg_credit_sale_balance_sync
AFTER INSERT ON credit_sales
FOR EACH ROW
EXECUTE FUNCTION update_customer_balance_on_credit_sale();

CREATE OR REPLACE FUNCTION update_customer_balance_on_settlement()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE customers
    SET current_balance = GREATEST(0, COALESCE(current_balance, 0) - NEW.amount)
    WHERE id = NEW.customer_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_settlement_balance_sync ON payment_settlements;
CREATE TRIGGER trg_settlement_balance_sync
AFTER INSERT ON payment_settlements
FOR EACH ROW
EXECUTE FUNCTION update_customer_balance_on_settlement();

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

-- Shift Bank Deposits (Multi-entry Partial Cash Drops per Shift)
CREATE TABLE IF NOT EXISTS shift_bank_deposits (
    id TEXT PRIMARY KEY,
    shift_id TEXT REFERENCES shifts(id) ON DELETE CASCADE,
    shift_name TEXT,
    deposited_amount NUMERIC NOT NULL DEFAULT 0,
    deposited_by TEXT NOT NULL DEFAULT 'Supervisor',
    bank_name TEXT DEFAULT 'Commercial Bank of Ceylon',
    account_number TEXT,
    slip_no TEXT,
    notes TEXT,
    deposit_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Disable Row Level Security (RLS) for all tables to allow simple public access
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE fuel_tanks DISABLE ROW LEVEL SECURITY;
ALTER TABLE pumps DISABLE ROW LEVEL SECURITY;
ALTER TABLE shifts DISABLE ROW LEVEL SECURITY;
ALTER TABLE pump_readings DISABLE ROW LEVEL SECURITY;
ALTER TABLE shift_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE stock_deliveries DISABLE ROW LEVEL SECURITY;
ALTER TABLE price_schedules DISABLE ROW LEVEL SECURITY;
ALTER TABLE customers DISABLE ROW LEVEL SECURITY;
ALTER TABLE credit_sales DISABLE ROW LEVEL SECURITY;
ALTER TABLE card_sales DISABLE ROW LEVEL SECURITY;
ALTER TABLE payment_settlements DISABLE ROW LEVEL SECURITY;
ALTER TABLE pumper_non_cash_sales DISABLE ROW LEVEL SECURITY;
ALTER TABLE customer_ledgers DISABLE ROW LEVEL SECURITY;
ALTER TABLE shift_bank_deposits DISABLE ROW LEVEL SECURITY;

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

DROP POLICY IF EXISTS "Enable all access for shift_logs" ON shift_logs;
CREATE POLICY "Enable all access for shift_logs" ON shift_logs FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Enable all access for stock_deliveries" ON stock_deliveries;
CREATE POLICY "Enable all access for stock_deliveries" ON stock_deliveries FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Enable all access for price_schedules" ON price_schedules;
CREATE POLICY "Enable all access for price_schedules" ON price_schedules FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Enable all access for customers" ON customers;
CREATE POLICY "Enable all access for customers" ON customers FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Enable all access for credit_sales" ON credit_sales;
CREATE POLICY "Enable all access for credit_sales" ON credit_sales FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Enable all access for payment_settlements" ON payment_settlements;
CREATE POLICY "Enable all access for payment_settlements" ON payment_settlements FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Enable all access for pumper_non_cash_sales" ON pumper_non_cash_sales;
CREATE POLICY "Enable all access for pumper_non_cash_sales" ON pumper_non_cash_sales FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Enable all access for card_sales" ON card_sales;
CREATE POLICY "Enable all access for card_sales" ON card_sales FOR ALL TO public USING (true) WITH CHECK (true);
