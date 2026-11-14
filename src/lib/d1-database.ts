/* eslint-disable @typescript-eslint/no-explicit-any */
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { getEnvVar } from "./runtime-env";
import {
  sendOtpSms,
  verifyOtpCode,
  normalizeIranMobile,
  registerOtpPersistenceHook,
  sendEventNotificationSms,
  otpStore,
  toAsciiDigits,
  type SmsLogPayload,
} from "./sms-service";
import {
  sendOtpEmail,
  verifyEmailOtpCode,
  registerEmailPersistenceHook,
  sendEventNotificationEmail,
} from "./email-service";

let cachedDbSync: any = null;
function getDatabaseSync() {
  if (cachedDbSync !== null) return cachedDbSync;
  try {
    if (typeof process !== "undefined" && process.versions?.node) {
      const require = createRequire(import.meta.url);
      const sqliteMod = require("node:sqlite");
      cachedDbSync = sqliteMod?.DatabaseSync || false;
      return cachedDbSync;
    }
  } catch {
    cachedDbSync = false;
  }
  return false;
}

export interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement;
  all<T = any>(): Promise<{ results: T[]; success: boolean }>;
  first<T = any>(colName?: string): Promise<T | null>;
  run(): Promise<{ success: boolean }>;
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  exec(sql: string): Promise<any>;
  batch(statements: D1PreparedStatement[]): Promise<any[]>;
}

let cloudflareD1Binding: D1Database | null = null;
let schemaInitPromise: Promise<void> | null = null;
let schemaInitDoneForD1 = false;

export function setCloudflareD1Binding(db: any) {
  if (db && typeof db.prepare === "function") {
    const hadBinding = Boolean(cloudflareD1Binding);
    cloudflareD1Binding = db;
    if (!hadBinding && !schemaInitDoneForD1) {
      schemaInitPromise = null;
    }
  }
}

const globalForD1 = globalThis as unknown as { __terrabar_d1_local__?: D1Database };

function getLocalSqlite(): D1Database {
  if (globalForD1.__terrabar_d1_local__) return globalForD1.__terrabar_d1_local__;

  try {
    const DbSync = getDatabaseSync();
    if (!DbSync) throw new Error("node:sqlite is not available");

    const dbPath = path.resolve(process.cwd(), ".d1-local.sqlite");
    const rawDb = new DbSync(dbPath);

    const instance: D1Database = {
      prepare(sql: string) {
        let boundValues: any[] = [];
        return {
          bind(...values: any[]) {
            boundValues = values;
            return this;
          },
          async all<T = any>() {
            const stmt = rawDb.prepare(sql);
            const rows = stmt.all(...boundValues) as T[];
            return { results: rows, success: true };
          },
          async first<T = any>(colName?: string) {
            const stmt = rawDb.prepare(sql);
            const row = stmt.get(...boundValues) as any;
            if (!row) return null;
            if (colName) return row[colName] ?? null;
            return row as T;
          },
          async run() {
            const stmt = rawDb.prepare(sql);
            stmt.run(...boundValues);
            return { success: true };
          },
        };
      },
      async exec(sql: string) {
        rawDb.exec(sql);
        return { success: true };
      },
      async batch(statements: D1PreparedStatement[]) {
        const results = [];
        for (const stmt of statements) {
          results.push(await stmt.run());
        }
        return results;
      },
    };

    globalForD1.__terrabar_d1_local__ = instance;
    return instance;
  } catch {
    return {
      prepare() {
        return {
          bind() {
            return this;
          },
          async all() {
            return { results: [], success: true };
          },
          async first() {
            return null;
          },
          async run() {
            return { success: true };
          },
        };
      },
      async exec() {
        return { success: true };
      },
      async batch() {
        return [];
      },
    };
  }
}

export function getD1(): D1Database {
  if (cloudflareD1Binding) return cloudflareD1Binding;
  const globalDb = (globalThis as any)?.__env__?.DB;
  if (globalDb && typeof globalDb.prepare === "function") {
    setCloudflareD1Binding(globalDb);
    return globalDb;
  }
  return getLocalSqlite();
}

// ==========================================
// Cryptographic Password Hashing (scrypt)
// ==========================================

export function hashPassword(rawPassword: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(rawPassword, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function isLegacyBase64Hash(stored: string): boolean {
  return Boolean(stored && !stored.startsWith("scrypt$"));
}

export function verifyPassword(rawPassword: string, storedHash: string): boolean {
  if (!rawPassword || !storedHash) return false;
  if (storedHash.startsWith("scrypt$")) {
    const parts = storedHash.split("$");
    if (parts.length !== 3) return false;
    const [, salt, hexDigest] = parts;
    try {
      const candidate = crypto.scryptSync(rawPassword, salt, 64);
      const expected = Buffer.from(hexDigest, "hex");
      if (candidate.length !== expected.length) return false;
      return crypto.timingSafeEqual(candidate, expected);
    } catch {
      return false;
    }
  }
  // Backward compatibility for pre-existing local SQLite Base64 hashes
  try {
    const legacyB64 = Buffer.from(rawPassword).toString("base64");
    return storedHash === legacyB64 || storedHash === rawPassword;
  } catch {
    return false;
  }
}

function generateSecureToken(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(24).toString("hex")}`;
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

// ==========================================
// Schema Initialization & Safe Migrations
// ==========================================

export function getAdminPhoneForOtp(): string {
  const raw = getEnvVar("ADMIN_PHONE_FOR_OTP") || getEnvVar("ADMIN_PHONE") || "09124653082";
  return normalizeIranMobile(raw) || raw.trim();
}

export function getAdminUsername(): string {
  return (getEnvVar("ADMIN_USERNAME") || getEnvVar("ADMIN_NAME") || "Rahavard").trim() || "Rahavard";
}

export function getAdminDisplayName(): string {
  return (
    getEnvVar("ADMIN_DISPLAY_NAME") ||
    getEnvVar("ADMIN_NAME") ||
    "مدیر کل ترابار"
  ).trim() || "مدیر کل ترابار";
}

export function getAdminRecoveryEmail(): string {
  return (getEnvVar("ADMIN_RECOVERY_EMAIL") || getEnvVar("ADMIN_EMAIL") || "").trim().toLowerCase();
}

export async function initD1Schema(): Promise<void> {
  if (schemaInitPromise) return schemaInitPromise;

  schemaInitPromise = (async () => {
    const db = getD1();
    const schemaSql = `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        phone TEXT,
        email TEXT,
        password_hash TEXT,
        full_name TEXT,
        role TEXT DEFAULT 'buyer',
        city TEXT,
        province TEXT,
        activity TEXT,
        is_verified INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS members (
        id TEXT PRIMARY KEY,
        auth_user_id TEXT UNIQUE,
        full_name TEXT,
        phone TEXT,
        email TEXT,
        city TEXT,
        province TEXT,
        role TEXT DEFAULT 'buyer',
        verification_status TEXT DEFAULT 'approved',
        products TEXT,
        is_active INTEGER DEFAULT 1,
        is_archived INTEGER DEFAULT 0,
        joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS member_roles (
        id TEXT PRIMARY KEY,
        member_id TEXT,
        role_code TEXT,
        approval_status TEXT DEFAULT 'pending',
        request_note TEXT,
        approved_at TEXT,
        approved_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS admin_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS admin_users (
        id TEXT PRIMARY KEY,
        auth_user_id TEXT UNIQUE,
        display_name TEXT,
        login_username TEXT,
        city TEXT,
        password_hash TEXT,
        admin_role TEXT DEFAULT 'main_admin',
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS admin_user_cities (
        id TEXT PRIMARY KEY,
        admin_user_id TEXT,
        city_name TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        token TEXT UNIQUE,
        phone TEXT,
        email TEXT,
        expires_at INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS otp_codes (
        target TEXT PRIMARY KEY,
        channel TEXT,
        code TEXT,
        expires_at INTEGER,
        attempts INTEGER DEFAULT 0,
        last_sent_at INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS rate_limits (
        rate_key TEXT PRIMARY KEY,
        count INTEGER DEFAULT 0,
        window_start INTEGER
      );

      CREATE TABLE IF NOT EXISTS invoice_sequences (
        seq_name TEXT PRIMARY KEY,
        current_value INTEGER DEFAULT 1000
      );

      CREATE TABLE IF NOT EXISTS loads (
        id TEXT PRIMARY KEY,
        member_id TEXT,
        owner_member_id TEXT,
        name TEXT,
        product_type TEXT,
        category TEXT,
        engine TEXT,
        city TEXT,
        origin TEXT,
        source_region TEXT,
        source_market TEXT,
        quality TEXT,
        quantity REAL,
        count INTEGER,
        price REAL,
        price_unit TEXT DEFAULT 'تومان',
        sale_type TEXT,
        status TEXT DEFAULT 'active',
        package_type TEXT,
        package_weight REAL,
        min_quantity REAL,
        min_order_quantity REAL,
        ready_date TEXT,
        ad_start_date TEXT,
        ad_end_date TEXT,
        response_start_time TEXT,
        response_end_time TEXT,
        destination_scope TEXT,
        fleet_type TEXT,
        archived_at TEXT,
        description TEXT,
        seller_type TEXT,
        role TEXT,
        unit TEXT DEFAULT 'کیلوگرم',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS load_price_tiers (
        id TEXT PRIMARY KEY,
        load_id TEXT,
        sale_type TEXT,
        unit_price REAL,
        minimum_packages INTEGER,
        min_quantity REAL,
        max_quantity REAL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS load_images (
        id TEXT PRIMARY KEY,
        load_id TEXT,
        storage_path TEXT,
        display_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS carts (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        member_id TEXT,
        load_id TEXT,
        sale_type TEXT,
        quantity INTEGER,
        expires_at INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        invoice_number TEXT,
        idempotency_key TEXT,
        load_id TEXT,
        buyer_member_id TEXT,
        seller_member_id TEXT,
        customer_name TEXT,
        customer_phone TEXT,
        customer_email TEXT,
        customer_city TEXT,
        sale_type TEXT,
        quantity REAL,
        unit TEXT DEFAULT 'کیلوگرم',
        price REAL,
        total_price REAL,
        delivery_address TEXT,
        delivery_type TEXT,
        status TEXT DEFAULT 'pending',
        payment_status TEXT DEFAULT 'pending',
        delivery_status TEXT DEFAULT 'pending',
        paid_at TEXT,
        shipped_at TEXT,
        delivered_at TEXT,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS purchase_requests (
        id TEXT PRIMARY KEY,
        request_number INTEGER,
        member_id TEXT,
        buyer_member_id TEXT,
        load_id TEXT,
        product_name TEXT,
        quantity REAL,
        quantity_unit TEXT DEFAULT 'کیلوگرم',
        max_price REAL,
        city TEXT,
        destination_city TEXT,
        quality_requirements TEXT,
        needed_by TEXT,
        details TEXT,
        notes TEXT,
        status TEXT DEFAULT 'open',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS ratings (
        id TEXT PRIMARY KEY,
        rater_member_id TEXT,
        reviewer_member_id TEXT,
        rated_member_id TEXT,
        target_member_id TEXT,
        target_type TEXT DEFAULT 'member',
        load_id TEXT,
        target_load_id TEXT,
        order_id TEXT,
        score INTEGER,
        review_text TEXT,
        status TEXT DEFAULT 'approved',
        is_visible INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS rating_messages (
        id TEXT PRIMARY KEY,
        rating_id TEXT,
        sender_user_id TEXT,
        message TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS seller_bank_accounts (
        id TEXT PRIMARY KEY,
        member_id TEXT UNIQUE,
        bank_name TEXT,
        account_holder_name TEXT,
        iban TEXT,
        verification_status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS seller_financial_transactions (
        id TEXT PRIMARY KEY,
        member_id TEXT,
        order_id TEXT,
        transaction_type TEXT,
        amount REAL,
        description TEXT,
        reference_code TEXT,
        payout_status TEXT DEFAULT 'pending',
        transaction_date TEXT DEFAULT CURRENT_TIMESTAMP,
        processed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS platform_financial_ledger (
        id TEXT PRIMARY KEY,
        entry_type TEXT,
        entry_status TEXT,
        amount REAL,
        currency TEXT DEFAULT 'IRT',
        order_id TEXT,
        member_id TEXT,
        provider TEXT,
        external_reference TEXT,
        description TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS city_neighbors (
        id TEXT PRIMARY KEY,
        city_name TEXT,
        neighbor_city_name TEXT,
        is_enabled INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS site_visits (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        member_id TEXT,
        route TEXT,
        visited_at TEXT DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sms_logs (
        id TEXT PRIMARY KEY,
        recipient TEXT,
        channel TEXT DEFAULT 'sms',
        event_type TEXT,
        template_id TEXT,
        message_summary TEXT,
        status TEXT,
        provider_status TEXT,
        error_message TEXT,
        related_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        actor_user_id TEXT,
        actor_role TEXT,
        action TEXT,
        target_type TEXT,
        target_id TEXT,
        details TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `;

    const statements = schemaSql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    try {
      await db.batch(statements.map((stmt) => db.prepare(stmt)));
    } catch {
      for (const stmt of statements) {
        try {
          await db.exec(stmt + ";");
        } catch {
          try {
            await db.prepare(stmt).run();
          } catch {
            // Ignore if exists
          }
        }
      }
    }

    const requiredColumnsByTable: Record<string, Record<string, string>> = {
      users: {
        phone: "TEXT",
        email: "TEXT",
        password_hash: "TEXT",
        full_name: "TEXT",
        role: "TEXT DEFAULT 'buyer'",
        city: "TEXT",
        province: "TEXT",
        activity: "TEXT",
        is_verified: "INTEGER DEFAULT 1",
        created_at: "TEXT",
        updated_at: "TEXT",
      },
      members: {
        auth_user_id: "TEXT",
        full_name: "TEXT",
        phone: "TEXT",
        email: "TEXT",
        city: "TEXT",
        province: "TEXT",
        role: "TEXT DEFAULT 'buyer'",
        verification_status: "TEXT DEFAULT 'approved'",
        products: "TEXT",
        is_active: "INTEGER DEFAULT 1",
        is_archived: "INTEGER DEFAULT 0",
        joined_at: "TEXT",
        created_at: "TEXT",
        updated_at: "TEXT",
      },
      member_roles: {
        member_id: "TEXT",
        role_code: "TEXT",
        approval_status: "TEXT DEFAULT 'pending'",
        request_note: "TEXT",
        approved_at: "TEXT",
        approved_by: "TEXT",
        created_at: "TEXT",
      },
      admin_users: {
        auth_user_id: "TEXT",
        display_name: "TEXT",
        login_username: "TEXT",
        city: "TEXT",
        password_hash: "TEXT",
        admin_role: "TEXT DEFAULT 'main_admin'",
        is_active: "INTEGER DEFAULT 1",
        created_at: "TEXT",
      },
      sessions: {
        user_id: "TEXT",
        token: "TEXT",
        phone: "TEXT",
        email: "TEXT",
        expires_at: "INTEGER",
        created_at: "TEXT",
      },
      otp_codes: {
        channel: "TEXT",
        code: "TEXT",
        expires_at: "INTEGER",
        attempts: "INTEGER DEFAULT 0",
        last_sent_at: "INTEGER",
        created_at: "TEXT",
      },
      loads: {
        member_id: "TEXT",
        owner_member_id: "TEXT",
        name: "TEXT",
        product_type: "TEXT",
        category: "TEXT",
        engine: "TEXT",
        city: "TEXT",
        origin: "TEXT",
        source_region: "TEXT",
        source_market: "TEXT",
        quality: "TEXT",
        quantity: "REAL",
        count: "INTEGER",
        price: "REAL",
        price_unit: "TEXT DEFAULT 'تومان'",
        sale_type: "TEXT",
        status: "TEXT DEFAULT 'active'",
        package_type: "TEXT",
        package_weight: "REAL",
        min_quantity: "REAL",
        min_order_quantity: "REAL",
        ready_date: "TEXT",
        ad_start_date: "TEXT",
        ad_end_date: "TEXT",
        response_start_time: "TEXT",
        response_end_time: "TEXT",
        destination_scope: "TEXT",
        fleet_type: "TEXT",
        archived_at: "TEXT",
        description: "TEXT",
        seller_type: "TEXT",
        role: "TEXT",
        unit: "TEXT DEFAULT 'کیلوگرم'",
        created_at: "TEXT",
        updated_at: "TEXT",
      },
      orders: {
        invoice_number: "TEXT",
        idempotency_key: "TEXT",
        load_id: "TEXT",
        buyer_member_id: "TEXT",
        seller_member_id: "TEXT",
        customer_name: "TEXT",
        customer_phone: "TEXT",
        customer_email: "TEXT",
        customer_city: "TEXT",
        sale_type: "TEXT",
        quantity: "REAL",
        unit: "TEXT DEFAULT 'کیلوگرم'",
        price: "REAL",
        total_price: "REAL",
        delivery_address: "TEXT",
        delivery_type: "TEXT",
        status: "TEXT DEFAULT 'pending'",
        payment_status: "TEXT DEFAULT 'pending'",
        delivery_status: "TEXT DEFAULT 'pending'",
        paid_at: "TEXT",
        shipped_at: "TEXT",
        delivered_at: "TEXT",
        notes: "TEXT",
        created_at: "TEXT",
        updated_at: "TEXT",
      },
      purchase_requests: {
        request_number: "INTEGER",
        member_id: "TEXT",
        buyer_member_id: "TEXT",
        load_id: "TEXT",
        product_name: "TEXT",
        quantity: "REAL",
        quantity_unit: "TEXT DEFAULT 'کیلوگرم'",
        max_price: "REAL",
        city: "TEXT",
        destination_city: "TEXT",
        quality_requirements: "TEXT",
        needed_by: "TEXT",
        details: "TEXT",
        notes: "TEXT",
        status: "TEXT DEFAULT 'open'",
        created_at: "TEXT",
        updated_at: "TEXT",
      },
      ratings: {
        rater_member_id: "TEXT",
        reviewer_member_id: "TEXT",
        rated_member_id: "TEXT",
        target_member_id: "TEXT",
        target_type: "TEXT DEFAULT 'member'",
        load_id: "TEXT",
        target_load_id: "TEXT",
        order_id: "TEXT",
        score: "INTEGER",
        review_text: "TEXT",
        status: "TEXT DEFAULT 'approved'",
        is_visible: "INTEGER DEFAULT 1",
        created_at: "TEXT",
      },
      site_visits: {
        user_id: "TEXT",
        member_id: "TEXT",
        route: "TEXT",
        visited_at: "TEXT",
        created_at: "TEXT",
      },
    };

    const tableEntries = Object.entries(requiredColumnsByTable);
    const pragmaResults = await Promise.all(
      tableEntries.map(async ([tableName]) => {
        try {
          const info = await db.prepare(`PRAGMA table_info('${tableName}')`).all<{ name: string }>();
          if (Array.isArray(info?.results) && info.results.length > 0) {
            return new Set(info.results.map((r) => String(r.name || "").toLowerCase()));
          }
        } catch {
          // Fallback to direct ALTER statements
        }
        return null;
      }),
    );

    const alterStatements: string[] = [];
    tableEntries.forEach(([tableName, expectedCols], idx) => {
      const existingCols = pragmaResults[idx];
      for (const [colName, colDef] of Object.entries(expectedCols)) {
        if (existingCols && existingCols.has(colName.toLowerCase())) {
          continue;
        }
        alterStatements.push(`ALTER TABLE ${tableName} ADD COLUMN ${colName} ${colDef}`);
      }
    });

    if (alterStatements.length > 0) {
      try {
        await db.batch(alterStatements.map((s) => db.prepare(s)));
      } catch {
        for (const alterSql of alterStatements) {
          try {
            await db.prepare(alterSql).run();
          } catch {
            try {
              await db.exec(alterSql + ";");
            } catch {
              // Ignore if column already exists
            }
          }
        }
      }
    }

    const indexStatements = [
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency ON orders(idempotency_key)",
      "CREATE INDEX IF NOT EXISTS idx_loads_member ON loads(member_id)",
      "CREATE INDEX IF NOT EXISTS idx_load_images_load ON load_images(load_id)",
      "CREATE INDEX IF NOT EXISTS idx_load_tiers_load ON load_price_tiers(load_id)",
      "CREATE INDEX IF NOT EXISTS idx_carts_user ON carts(user_id)",
    ];

    try {
      await db.batch(indexStatements.map((idxStmt) => db.prepare(idxStmt)));
    } catch {
      for (const idxStmt of indexStatements) {
        try {
          await db.prepare(idxStmt).run();
        } catch {
          try {
            await db.exec(idxStmt + ";");
          } catch {
            // Ignore if index exists
          }
        }
      }
    }

    // Initialize sequential counters
    try {
      await db.batch([
        db.prepare("INSERT OR IGNORE INTO invoice_sequences (seq_name, current_value) VALUES ('order_invoice', 1000)"),
        db.prepare("INSERT OR IGNORE INTO invoice_sequences (seq_name, current_value) VALUES ('purchase_request', 100)"),
      ]);
    } catch {
      // Ignore
    }

    // Seed initial city neighbor pairs if empty
    try {
      const existingNeighbors = await db
        .prepare("SELECT count(*) as c FROM city_neighbors")
        .first<{ c: number }>();
      if (!existingNeighbors || existingNeighbors.c === 0) {
        const pairs: Array<[string, string]> = [
          ["کرج", "تهران"],
          ["کرج", "شهریار"],
          ["کرج", "ساوجبلاغ"],
          ["کرج", "قزوین"],
          ["تهران", "شهریار"],
          ["تهران", "اسلامشهر"],
          ["تهران", "ورامین"],
          ["اصفهان", "کاشان"],
          ["اصفهان", "نجف‌آباد"],
          ["شیراز", "مرودشت"],
          ["مشهد", "نیشابور"],
          ["تبریز", "مراغه"],
          ["اهواز", "دزفول"],
          ["رشت", "لاهیجان"],
          ["ساری", "بابل"],
          ["قم", "ساوه"],
        ];
        await db.batch(
          pairs.map(([c1, c2]) =>
            db
              .prepare("INSERT INTO city_neighbors (id, city_name, neighbor_city_name, is_enabled) VALUES (?, ?, ?, 1)")
              .bind(generateId("cn"), c1, c2),
          ),
        );
      }
    } catch {
      // Ignore
    }

    // Seed & sync main admin profile cleanly WITHOUT hardcoding passwords in code
    await syncMainAdminFromEnv(db);

    if (cloudflareD1Binding) {
      schemaInitDoneForD1 = true;
    }
  })().catch((err) => {
    schemaInitPromise = null;
    throw err;
  });

  return schemaInitPromise;
}

// ==========================================
// OTP, Rate Limit, Logs & Sequence Helpers
// ==========================================

function normalizeOtpTarget(target: string): string {
  const trimmed = toAsciiDigits(target || "").trim().toLowerCase();
  if (!trimmed) return "";
  if (trimmed.includes("@")) return trimmed;
  return normalizeIranMobile(trimmed) || trimmed;
}

export async function saveOtpToD1(
  target: string,
  channel: "sms" | "email",
  code: string,
  expiresAt: number,
): Promise<void> {
  const cleanTarget = normalizeOtpTarget(target);
  const cleanCode = toAsciiDigits(code || "").trim();
  otpStore.set(cleanTarget, { code: cleanCode, expiresAt, attempts: 0 });

  await initD1Schema();
  const db = getD1();
  const nowMs = Date.now();

  try {
    await db
      .prepare(
        `INSERT INTO otp_codes (target, channel, code, expires_at, attempts, last_sent_at, created_at)
         VALUES (?, ?, ?, ?, 0, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(target) DO UPDATE SET
           channel = excluded.channel,
           code = excluded.code,
           expires_at = excluded.expires_at,
           attempts = 0,
           last_sent_at = excluded.last_sent_at`,
      )
      .bind(cleanTarget, channel, cleanCode, expiresAt, nowMs)
      .run();
  } catch {
    try {
      await db
        .prepare(
          "CREATE TABLE IF NOT EXISTS otp_codes (target TEXT PRIMARY KEY, channel TEXT, code TEXT, expires_at INTEGER, attempts INTEGER DEFAULT 0, last_sent_at INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP)",
        )
        .run();
      await db.prepare("DELETE FROM otp_codes WHERE target = ?").bind(cleanTarget).run();
      await db
        .prepare(
          `INSERT INTO otp_codes (target, channel, code, expires_at, attempts, last_sent_at, created_at)
           VALUES (?, ?, ?, ?, 0, ?, CURRENT_TIMESTAMP)`,
        )
        .bind(cleanTarget, channel, cleanCode, expiresAt, nowMs)
        .run();
    } catch (err) {
      console.warn("[d1] saveOtpToD1 fallback to memory store:", err);
    }
  }
}

export async function verifyOtpFromD1(
  target: string,
  inputCode: string,
): Promise<{ success: boolean; message: string }> {
  await initD1Schema();
  const db = getD1();
  const rawLower = (target || "").trim().toLowerCase();
  const cleanTarget = normalizeOtpTarget(target);
  const cleanCode = toAsciiDigits(inputCode || "").trim();

  let matchedTarget = cleanTarget;
  let row: any = null;
  try {
    row = await db
      .prepare("SELECT * FROM otp_codes WHERE target = ? LIMIT 1")
      .bind(cleanTarget)
      .first<any>();
    if (!row && rawLower && rawLower !== cleanTarget) {
      row = await db
        .prepare("SELECT * FROM otp_codes WHERE target = ? LIMIT 1")
        .bind(rawLower)
        .first<any>();
      if (row) matchedTarget = rawLower;
    }
  } catch (err) {
    console.warn("[d1] verifyOtpFromD1 query error, checking memory store:", err);
  }

  if (!row) {
    const memKey = otpStore.has(cleanTarget) ? cleanTarget : rawLower;
    const memStored = memKey ? otpStore.get(memKey) : undefined;
    if (!memStored) {
      return {
        success: false,
        message: "کد تأییدی برای این شناسه ثبت نشده یا منقضی شده است. لطفاً مجدداً درخواست کد دهید.",
      };
    }
    if (Date.now() > memStored.expiresAt) {
      otpStore.delete(memKey);
      return { success: false, message: "کد تأیید منقضی شده است. لطفاً کد جدید دریافت کنید." };
    }
    memStored.attempts += 1;
    if (memStored.attempts > 5) {
      otpStore.delete(memKey);
      return { success: false, message: "تعداد تلاش‌های ناموفق بیش از حد مجاز بود. کد جدید درخواست دهید." };
    }
    if (String(memStored.code) !== cleanCode) {
      return { success: false, message: "کد تأیید وارد شده صحیح نیست. لطفاً دوباره بررسی کنید." };
    }
    otpStore.delete(memKey);
    return { success: true, message: "کد تأیید با موفقیت احراز شد." };
  }

  if (Date.now() > Number(row.expires_at)) {
    await db.prepare("DELETE FROM otp_codes WHERE target = ?").bind(matchedTarget).run();
    otpStore.delete(cleanTarget);
    otpStore.delete(matchedTarget);
    return { success: false, message: "کد تأیید منقضی شده است. لطفاً کد جدید دریافت کنید." };
  }

  const nextAttempts = Number(row.attempts || 0) + 1;
  if (nextAttempts > 5) {
    await db.prepare("DELETE FROM otp_codes WHERE target = ?").bind(matchedTarget).run();
    otpStore.delete(cleanTarget);
    otpStore.delete(matchedTarget);
    return { success: false, message: "تعداد تلاش‌های ناموفق بیش از حد مجاز بود. کد جدید درخواست دهید." };
  }

  if (String(row.code) !== cleanCode) {
    await db
      .prepare("UPDATE otp_codes SET attempts = ? WHERE target = ?")
      .bind(nextAttempts, matchedTarget)
      .run();
    return { success: false, message: "کد تأیید وارد شده صحیح نیست. لطفاً دوباره بررسی کنید." };
  }

  await db.prepare("DELETE FROM otp_codes WHERE target = ?").bind(matchedTarget).run();
  otpStore.delete(cleanTarget);
  otpStore.delete(matchedTarget);
  return { success: true, message: "کد تأیید با موفقیت احراز شد." };
}

export async function insertSmsLog(entry: SmsLogPayload): Promise<void> {
  try {
    await initD1Schema();
    const db = getD1();
    await db
      .prepare(
        `INSERT INTO sms_logs (id, recipient, channel, event_type, template_id, message_summary, status, provider_status, error_message, related_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      )
      .bind(
        generateId("log"),
        entry.recipient,
        entry.channel || "sms",
        entry.eventType,
        entry.templateId || null,
        entry.messageSummary,
        entry.status,
        entry.providerStatus || null,
        entry.errorMessage || null,
        entry.relatedId || null,
      )
      .run();
  } catch (err) {
    console.warn("[d1] insertSmsLog error:", err);
  }
}

export async function recordAuditLog(params: {
  actorUserId: string;
  actorRole: string;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: string;
}): Promise<void> {
  try {
    await initD1Schema();
    const db = getD1();
    await db
      .prepare(
        `INSERT INTO audit_logs (id, actor_user_id, actor_role, action, target_type, target_id, details, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      )
      .bind(
        generateId("audit"),
        params.actorUserId,
        params.actorRole,
        params.action,
        params.targetType || null,
        params.targetId || null,
        params.details || null,
      )
      .run();
  } catch (err) {
    console.warn("[d1] recordAuditLog error:", err);
  }
}

export async function checkRateLimit(
  rateKey: string,
  maxRequests: number,
  windowMs: number,
): Promise<{ allowed: boolean; retryAfterSec?: number }> {
  await initD1Schema();
  const db = getD1();
  const now = Date.now();
  const row = await db
    .prepare("SELECT * FROM rate_limits WHERE rate_key = ? LIMIT 1")
    .bind(rateKey)
    .first<{ rate_key: string; count: number; window_start: number }>();

  if (!row || now - Number(row.window_start) > windowMs) {
    await db
      .prepare(
        "INSERT INTO rate_limits (rate_key, count, window_start) VALUES (?, 1, ?) ON CONFLICT(rate_key) DO UPDATE SET count = 1, window_start = excluded.window_start",
      )
      .bind(rateKey, now)
      .run();
    return { allowed: true };
  }

  if (Number(row.count) >= maxRequests) {
    const retryAfterSec = Math.max(1, Math.ceil((Number(row.window_start) + windowMs - now) / 1000));
    return { allowed: false, retryAfterSec };
  }

  await db
    .prepare("UPDATE rate_limits SET count = count + 1 WHERE rate_key = ?")
    .bind(rateKey)
    .run();
  return { allowed: true };
}

export async function nextSequenceValue(seqName: "order_invoice" | "purchase_request"): Promise<number> {
  await initD1Schema();
  const db = getD1();
  const defaultBase = seqName === "order_invoice" ? 1000 : 100;
  await db
    .prepare("INSERT OR IGNORE INTO invoice_sequences (seq_name, current_value) VALUES (?, ?)")
    .bind(seqName, defaultBase)
    .run();

  const updated = await db
    .prepare(
      "UPDATE invoice_sequences SET current_value = current_value + 1 WHERE seq_name = ? RETURNING current_value",
    )
    .bind(seqName)
    .first<{ current_value: number }>();

  if (updated?.current_value) return Number(updated.current_value);

  const row = await db
    .prepare("SELECT current_value FROM invoice_sequences WHERE seq_name = ? LIMIT 1")
    .bind(seqName)
    .first<{ current_value: number }>();
  return Number(row?.current_value || defaultBase + 1);
}

// Register persistence hooks once module loads
registerOtpPersistenceHook({
  saveOtp: saveOtpToD1,
  verifyOtp: verifyOtpFromD1,
  logMessage: insertSmsLog,
});

registerEmailPersistenceHook({
  saveOtp: saveOtpToD1,
  verifyOtp: verifyOtpFromD1,
  logMessage: insertSmsLog,
});

// ==========================================
// Authentication & Session Management
// ==========================================

export interface UserRegistrationPayload {
  phone: string;
  fullName?: string;
  city?: string;
  province?: string;
  role?: string;
  activity?: string;
  mode?: "login" | "signup";
}

export interface UserAuthResult {
  user: {
    id: string;
    phone: string | null;
    full_name: string;
    role: string;
    city: string;
    province: string;
    email?: string;
    activity?: string;
  };
  member: {
    id: string;
    auth_user_id: string;
    full_name: string;
    phone: string | null;
    email?: string;
    role: string;
    city: string;
    province: string;
    verification_status?: string;
    products?: string;
  };
  roles: string[];
  sessionToken: string;
}

async function resolveUserRolesAndAdmin(
  userId: string,
  memberId?: string,
  userRole?: string,
): Promise<string[]> {
  const db = getD1();
  const roles: string[] = ["buyer"];

  const lowerUserRole = String(userRole || "").toLowerCase();
  if (userId === "admin_user_main" || lowerUserRole === "admin" || lowerUserRole === "main_admin") {
    if (!roles.includes("admin")) roles.push("admin");
    if (!roles.includes("main_admin")) roles.push("main_admin");
  } else if (lowerUserRole === "city_manager") {
    if (!roles.includes("city_manager")) roles.push("city_manager");
  }

  if (memberId) {
    let roleRowsList: { role_code: string; approval_status: string }[] = [];
    try {
      const roleRows = await db
        .prepare("SELECT role_code, approval_status FROM member_roles WHERE member_id = ?")
        .bind(memberId)
        .all<{ role_code: string; approval_status: string }>();
      roleRowsList = roleRows.results || [];

      for (const r of roleRowsList) {
        const code = String(r.role_code || "").toLowerCase();
        if (String(r.approval_status || "").toLowerCase() === "approved") {
          const normalized = code === "bar_seller" ? "seller" : code;
          if (!roles.includes(normalized)) roles.push(normalized);
          if (code === "bar_seller" && !roles.includes("bar_seller")) roles.push("bar_seller");
        }
      }
    } catch {
      // Ignore role table read failure
    }

    try {
      const memberRow = await db
        .prepare("SELECT role, verification_status FROM members WHERE id = ? LIMIT 1")
        .bind(memberId)
        .first<{ role?: string; verification_status?: string }>();
      if (memberRow && String(memberRow.verification_status || "").toLowerCase() === "approved") {
        const rawMemberRole = String(memberRow.role || "").toLowerCase();
        const normalizedMemberRole = rawMemberRole === "bar_seller" ? "seller" : rawMemberRole;
        const isPro = ["seller", "supplier", "special_buyer", "buyer_special"].includes(normalizedMemberRole);
        const explicitlyRejected = roleRowsList.some(
          (r) =>
            (r.role_code === normalizedMemberRole || r.role_code === rawMemberRole) &&
            String(r.approval_status || "").toLowerCase() === "rejected",
        );
        if (isPro && !explicitlyRejected) {
          if (!roles.includes(normalizedMemberRole)) roles.push(normalizedMemberRole);
          if (rawMemberRole === "bar_seller" && !roles.includes("bar_seller")) roles.push("bar_seller");
        }
      }
    } catch {
      // Ignore member role fallback
    }
  }

  try {
    const admin = await db
      .prepare("SELECT admin_role FROM admin_users WHERE auth_user_id = ? AND is_active = 1 LIMIT 1")
      .bind(userId)
      .first<{ admin_role: string }>();

    if (admin) {
      if (!roles.includes("admin")) roles.push("admin");
      if (admin.admin_role && !roles.includes(admin.admin_role)) roles.push(admin.admin_role);
    }
  } catch {
    // Ignore admin_users read failure
  }

  return roles;
}

async function runWithSchemaRepair<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err: any) {
    const msg = String(err?.message || err || "").toLowerCase();
    if (msg.includes("no column named") || msg.includes("no such column") || msg.includes("no such table")) {
      schemaInitDoneForD1 = false;
      schemaInitPromise = null;
      await initD1Schema();
      return await op();
    }
    throw err;
  }
}

export async function registerOrLoginUserWithPhone(
  payload: UserRegistrationPayload,
): Promise<UserAuthResult> {
  await initD1Schema();
  const db = getD1();

  const phone = normalizeIranMobile(payload.phone.trim());
  const cleanPhone = phone.replace(/[^\d]/g, "");
  const mode = payload.mode || "login";

  const existingUser = await db
    .prepare("SELECT * FROM users WHERE phone = ? LIMIT 1")
    .bind(phone)
    .first<any>();

  if (mode === "signup" && existingUser) {
    throw new Error("این شماره موبایل قبلاً در سامانه ثبت شده است. لطفاً از بخش «ورود» وارد حساب خود شوید.");
  }

  let userId: string;
  let userFullName: string;
  let userCity: string;
  let userProvince: string;
  let userRole: string;
  let userEmail: string;

  if (existingUser) {
    userId = existingUser.id;
    userFullName = existingUser.full_name || `کاربر ${cleanPhone.slice(-4)}`;
    userCity = existingUser.city || "";
    userProvince = existingUser.province || "";
    userRole = existingUser.role || "buyer";
    userEmail = existingUser.email || `phone_${cleanPhone}@terrabar.ir`;
  } else {
    userId = generateId("usr");
    userFullName = payload.fullName?.trim() || `کاربر ${cleanPhone.slice(-4)}`;
    userCity = payload.city?.trim() || "";
    userProvince = payload.province?.trim() || "";
    const requestedRole = (payload.role?.trim() || "buyer").toLowerCase();
    userRole = requestedRole === "bar_seller" ? "seller" : requestedRole;
    userEmail = `phone_${cleanPhone}@terrabar.ir`;
    const activity = payload.activity?.trim() || "";

    await runWithSchemaRepair(() =>
      db
        .prepare(
          `INSERT INTO users (id, phone, email, full_name, role, city, province, activity, is_verified, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        )
        .bind(userId, phone, userEmail, userFullName, userRole, userCity, userProvince, activity)
        .run(),
    );
  }

  const existingMember = await db
    .prepare("SELECT * FROM members WHERE auth_user_id = ? OR phone = ? LIMIT 1")
    .bind(userId, phone)
    .first<any>();

  let memberId: string;
  let memberRecord: any;

  if (existingMember) {
    memberId = existingMember.id;
    memberRecord = existingMember;
  } else {
    const normalizedRole = userRole === "bar_seller" ? "seller" : userRole || "buyer";
    const isProfessionalSignup = normalizedRole === "seller" || normalizedRole === "supplier";
    const initialVerification = isProfessionalSignup ? "pending" : "approved";
    memberId = generateId("mem");

    await runWithSchemaRepair(() =>
      db
        .prepare(
          `INSERT INTO members (id, auth_user_id, full_name, phone, email, city, province, role, verification_status, products, is_active, is_archived, joined_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        )
        .bind(
          memberId,
          userId,
          userFullName,
          phone,
          userEmail,
          userCity,
          userProvince,
          normalizedRole,
          initialVerification,
          payload.activity?.trim() || "",
        )
        .run(),
    );

    const approvalStatus = isProfessionalSignup ? "pending" : "approved";
    const roleTitle =
      normalizedRole === "seller"
        ? "بارفروش / حجره‌دار"
        : normalizedRole === "supplier"
          ? "تأمین‌کننده"
          : "خریدار";
    const regNote =
      payload.activity?.trim() || `ثبت‌نام جدید در ترابار با نقش ${roleTitle}`;

    await runWithSchemaRepair(() =>
      db
        .prepare(
          `INSERT INTO member_roles (id, member_id, role_code, approval_status, request_note, approved_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        )
        .bind(
          generateId("role"),
          memberId,
          normalizedRole,
          approvalStatus,
          regNote,
          approvalStatus === "approved" ? new Date().toISOString() : null,
        )
        .run(),
    );

    memberRecord = await db.prepare("SELECT * FROM members WHERE id = ? LIMIT 1").bind(memberId).first<any>();
  }

  const assignedRoles = await resolveUserRolesAndAdmin(userId, memberId);
  const sessionToken = generateSecureToken("tbsess");
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

  await saveSessionRecord(db, {
    id: generateId("sess"),
    userId,
    token: sessionToken,
    phone,
    email: userEmail,
    expiresAt,
  });

  const authResult: UserAuthResult = {
    user: {
      id: userId,
      phone,
      full_name: userFullName,
      role: userRole,
      city: userCity,
      province: userProvince,
      email: userEmail,
      activity: existingUser?.activity || payload.activity || "",
    },
    member: memberRecord,
    roles: assignedRoles,
    sessionToken,
  };
  cacheSessionResult(sessionToken, authResult, expiresAt);

  return authResult;
}

export interface EmailAuthPayload {
  email: string;
  password?: string;
  fullName?: string;
  phone?: string;
  city?: string;
  province?: string;
  role?: string;
  activity?: string;
  mode?: "login" | "signup";
}

export async function registerOrLoginUserWithEmail(
  payload: EmailAuthPayload,
): Promise<UserAuthResult> {
  await initD1Schema();
  const db = getD1();

  const email = (payload.email || "").trim().toLowerCase();
  const rawPassword = payload.password?.trim() || "";
  const mode = payload.mode || "login";

  const existingUser = await db
    .prepare("SELECT * FROM users WHERE LOWER(email) = ? LIMIT 1")
    .bind(email)
    .first<any>();

  if (mode === "signup" && existingUser) {
    throw new Error("این نشانی ایمیل قبلاً ثبت شده است. لطفاً از بخش «ورود» استفاده کنید.");
  }

  let userId: string;
  let userFullName: string;
  let userCity: string;
  let userProvince: string;
  let userRole: string;
  let userPhone: string | null;

  if (existingUser) {
    if (mode === "login" && rawPassword) {
      if (!existingUser.password_hash || !verifyPassword(rawPassword, existingUser.password_hash)) {
        throw new Error("رمز عبور وارد شده نادرست است.");
      }
      if (isLegacyBase64Hash(existingUser.password_hash)) {
        const upgraded = hashPassword(rawPassword);
        await db
          .prepare("UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .bind(upgraded, existingUser.id)
          .run();
      }
    }

    userId = existingUser.id;
    userFullName = existingUser.full_name || email.split("@")[0] || "کاربر ترابار";
    userCity = existingUser.city || "";
    userProvince = existingUser.province || "";
    userRole = existingUser.role || "buyer";
    userPhone = existingUser.phone || null;
  } else {
    if (mode === "login" && rawPassword) {
      throw new Error("کاربری با این نشانی ایمیل پیدا نشد. لطفاً ابتدا ثبت‌نام فرمایید.");
    }

    userId = generateId("usr");
    userFullName = payload.fullName?.trim() || email.split("@")[0] || "کاربر ترابار";
    userCity = payload.city?.trim() || "";
    userProvince = payload.province?.trim() || "";
    const requestedRole = (payload.role?.trim() || "buyer").toLowerCase();
    userRole = requestedRole === "bar_seller" ? "seller" : requestedRole;
    userPhone = payload.phone?.trim() ? normalizeIranMobile(payload.phone.trim()) : null;
    const passwordHash = rawPassword ? hashPassword(rawPassword) : "";
    const activity = payload.activity?.trim() || "";

    if (userPhone) {
      const phoneDup = await db
        .prepare("SELECT id FROM users WHERE phone = ? LIMIT 1")
        .bind(userPhone)
        .first<any>();
      if (phoneDup) {
        throw new Error("این شماره موبایل قبلاً در سامانه ثبت شده است.");
      }
    }

    await runWithSchemaRepair(() =>
      db
        .prepare(
          `INSERT INTO users (id, phone, email, password_hash, full_name, role, city, province, activity, is_verified, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        )
        .bind(
          userId,
          userPhone,
          email,
          passwordHash,
          userFullName,
          userRole,
          userCity,
          userProvince,
          activity,
        )
        .run(),
    );
  }

  const existingMember = await db
    .prepare("SELECT * FROM members WHERE auth_user_id = ? OR LOWER(email) = ? LIMIT 1")
    .bind(userId, email)
    .first<any>();

  let memberId: string;
  let memberRecord: any;

  if (existingMember) {
    memberId = existingMember.id;
    memberRecord = existingMember;
  } else {
    const normalizedRole = userRole === "bar_seller" ? "seller" : userRole || "buyer";
    const isProfessionalSignup = normalizedRole === "seller" || normalizedRole === "supplier";
    const initialVerification = isProfessionalSignup ? "pending" : "approved";
    memberId = generateId("mem");

    await runWithSchemaRepair(() =>
      db
        .prepare(
          `INSERT INTO members (id, auth_user_id, full_name, phone, email, city, province, role, verification_status, products, is_active, is_archived, joined_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        )
        .bind(
          memberId,
          userId,
          userFullName,
          userPhone,
          email,
          userCity,
          userProvince,
          normalizedRole,
          initialVerification,
          payload.activity?.trim() || "",
        )
        .run(),
    );

    const approvalStatus = isProfessionalSignup ? "pending" : "approved";
    const roleTitle =
      normalizedRole === "seller"
        ? "بارفروش / حجره‌دار"
        : normalizedRole === "supplier"
          ? "تأمین‌کننده"
          : "خریدار";
    const regNote =
      payload.activity?.trim() || `ثبت‌نام جدید در ترابار با ایمیل (${roleTitle})`;

    await runWithSchemaRepair(() =>
      db
        .prepare(
          `INSERT INTO member_roles (id, member_id, role_code, approval_status, request_note, approved_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        )
        .bind(
          generateId("role"),
          memberId,
          normalizedRole,
          approvalStatus,
          regNote,
          approvalStatus === "approved" ? new Date().toISOString() : null,
        )
        .run(),
    );

    memberRecord = await db.prepare("SELECT * FROM members WHERE id = ? LIMIT 1").bind(memberId).first<any>();
  }

  const assignedRoles = await resolveUserRolesAndAdmin(userId, memberId);
  const sessionToken = generateSecureToken("tbsess");
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

  await saveSessionRecord(db, {
    id: generateId("sess"),
    userId,
    token: sessionToken,
    phone: userPhone,
    email,
    expiresAt,
  });

  const authResult: UserAuthResult = {
    user: {
      id: userId,
      phone: userPhone,
      full_name: userFullName,
      role: userRole,
      city: userCity,
      province: userProvince,
      email,
      activity: existingUser?.activity || payload.activity || "",
    },
    member: memberRecord,
    roles: assignedRoles,
    sessionToken,
  };
  cacheSessionResult(sessionToken, authResult, expiresAt);

  return authResult;
}

const globalForSessions = globalThis as unknown as {
  __terrabar_session_cache__?: Map<string, { result: UserAuthResult; expiresAt: number }>;
};

const sessionCache =
  globalForSessions.__terrabar_session_cache__ ||
  new Map<string, { result: UserAuthResult; expiresAt: number }>();
globalForSessions.__terrabar_session_cache__ = sessionCache;

function cacheSessionResult(token: string, result: UserAuthResult, expiresAt: number) {
  if (!token) return;
  sessionCache.set(token, { result, expiresAt });
}

function invalidateSessionCacheForUser(userId?: string | null, memberId?: string | null) {
  if (!userId && !memberId) return;
  for (const [tok, entry] of sessionCache.entries()) {
    const uMatch = userId && entry.result?.user?.id === userId;
    const mMatch = memberId && entry.result?.member?.id === memberId;
    if (uMatch || mMatch) {
      sessionCache.delete(tok);
    }
  }
}

async function saveSessionRecord(
  db: D1Database,
  record: { id: string; userId: string; token: string; phone: string | null; email: string | null; expiresAt: number },
) {
  try {
    await db
      .prepare(
        "INSERT INTO sessions (id, user_id, token, phone, email, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
      )
      .bind(record.id, record.userId, record.token, record.phone, record.email, record.expiresAt)
      .run();
  } catch {
    try {
      await db
        .prepare(
          "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT, token TEXT UNIQUE, phone TEXT, email TEXT, expires_at INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP)",
        )
        .run();
      await db
        .prepare("ALTER TABLE sessions ADD COLUMN email TEXT")
        .run()
        .catch(() => {});
      await db
        .prepare(
          "INSERT INTO sessions (id, user_id, token, phone, email, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
        )
        .bind(record.id, record.userId, record.token, record.phone, record.email, record.expiresAt)
        .run();
    } catch (err) {
      console.warn("[d1] saveSessionRecord failed:", err);
    }
  }
}

export async function validateD1Session(sessionToken: string): Promise<UserAuthResult | null> {
  if (!sessionToken || sessionToken.length < 12) return null;
  await initD1Schema();
  const db = getD1();

  let session: any = null;
  try {
    session = await db
      .prepare("SELECT * FROM sessions WHERE token = ? AND expires_at > ? LIMIT 1")
      .bind(sessionToken, Date.now())
      .first<any>();
  } catch (err) {
    console.warn("[d1] validateD1Session sessions query failed:", err);
  }

  if (!session) {
    const cached = sessionCache.get(sessionToken);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }
    sessionCache.delete(sessionToken);
    return null;
  }

  let user = await db
    .prepare("SELECT * FROM users WHERE id = ? LIMIT 1")
    .bind(session.user_id)
    .first<any>();

  if (!user) {
    if (session.user_id === "admin_user_main") {
      await syncMainAdminFromEnv(db);
      user = await db
        .prepare("SELECT * FROM users WHERE id = 'admin_user_main' LIMIT 1")
        .first<any>();
    }
    if (!user) {
      const adminRow = await db
        .prepare("SELECT * FROM admin_users WHERE auth_user_id = ? AND is_active = 1 LIMIT 1")
        .bind(session.user_id)
        .first<any>();
      if (adminRow || session.user_id === "admin_user_main") {
        user = {
          id: session.user_id,
          phone: session.phone || getAdminPhoneForOtp(),
          email: session.email || getAdminRecoveryEmail() || "admin@terrabar.ir",
          full_name: adminRow?.display_name || getAdminDisplayName(),
          role: adminRow?.admin_role === "city_manager" ? "city_manager" : "admin",
          city: adminRow?.city || "تهران",
          province: "تهران",
          activity: "",
        };
      } else {
        const cached = sessionCache.get(sessionToken);
        if (cached && cached.expiresAt > Date.now()) {
          return cached.result;
        }
        return null;
      }
    }
  }

  const member = await db
    .prepare("SELECT * FROM members WHERE auth_user_id = ? LIMIT 1")
    .bind(user.id)
    .first<any>();

  const roles = await resolveUserRolesAndAdmin(user.id, member?.id, user.role);

  const authResult: UserAuthResult = {
    user: {
      id: user.id,
      phone: user.phone,
      full_name: user.full_name,
      role: user.role,
      city: user.city,
      province: user.province,
      email: user.email,
      activity: user.activity || member?.products || "",
    },
    member: member || {
      id: `mem_${user.id}`,
      auth_user_id: user.id,
      full_name: user.full_name,
      phone: user.phone,
      email: user.email,
      role: user.role,
      city: user.city,
      province: user.province,
      verification_status: roles.includes("admin") ? "approved" : "pending",
      products: user.activity || "",
    },
    roles,
    sessionToken,
  };
  cacheSessionResult(sessionToken, authResult, Number(session.expires_at) || Date.now() + 30 * 24 * 60 * 60 * 1000);
  return authResult;
}

export async function invalidateD1Session(sessionToken: string): Promise<void> {
  if (!sessionToken) return;
  sessionCache.delete(sessionToken);
  await initD1Schema();
  const db = getD1();
  await db.prepare("DELETE FROM sessions WHERE token = ?").bind(sessionToken).run();
}

export async function updateUserProfile(
  userId: string,
  data: { fullName?: string; email?: string; city?: string; province?: string; activity?: string },
): Promise<UserAuthResult | null> {
  await initD1Schema();
  const db = getD1();

  const user = await db.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").bind(userId).first<any>();
  if (!user) return null;

  const fullName = data.fullName?.trim() || user.full_name;
  const email = data.email?.trim() ? data.email.trim().toLowerCase() : user.email;
  const city = data.city?.trim() || user.city;
  const province = data.province?.trim() || user.province;
  const activity = typeof data.activity === "string" ? data.activity.trim() : user.activity || "";

  await db
    .prepare(
      "UPDATE users SET full_name = ?, email = ?, city = ?, province = ?, activity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    )
    .bind(fullName, email, city, province, activity, userId)
    .run();

  await db
    .prepare(
      "UPDATE members SET full_name = ?, email = ?, city = ?, province = ?, products = ?, updated_at = CURRENT_TIMESTAMP WHERE auth_user_id = ?",
    )
    .bind(fullName, email, city, province, activity, userId)
    .run();

  const member = await db.prepare("SELECT * FROM members WHERE auth_user_id = ? LIMIT 1").bind(userId).first<any>();
  const roles = await resolveUserRolesAndAdmin(userId, member?.id);

  return {
    user: {
      id: user.id,
      phone: user.phone,
      full_name: fullName,
      role: user.role,
      city,
      province,
      email,
      activity,
    },
    member,
    roles,
    sessionToken: "",
  };
}

// ==========================================
// Admin Authentication & Password Management
// ==========================================

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export async function syncMainAdminFromEnv(dbArg?: D1Database): Promise<void> {
  const db = dbArg || getD1();
  try {
    const envPhone = getEnvVar("ADMIN_PHONE_FOR_OTP") || getEnvVar("ADMIN_PHONE");
    const envEmail = getAdminRecoveryEmail();
    const envDisplayName = getEnvVar("ADMIN_DISPLAY_NAME") || getEnvVar("ADMIN_NAME");
    const envUsername = getAdminUsername();
    const envAdminPass = getEnvVar("ADMIN_DEFAULT_PASSWORD");

    const phone = getAdminPhoneForOtp();
    const email = envEmail || "admin@terrabar.ir";
    const displayName = getAdminDisplayName();

    const existingUser = await db
      .prepare("SELECT id, phone, email, full_name, password_hash FROM users WHERE id = 'admin_user_main' LIMIT 1")
      .first<any>();
    const existingAdmin = await db
      .prepare("SELECT id, login_username, display_name, password_hash FROM admin_users WHERE auth_user_id = 'admin_user_main' LIMIT 1")
      .first<any>();
    const settingPass = await db
      .prepare("SELECT value FROM admin_settings WHERE key = 'admin_password' LIMIT 1")
      .first<{ value: string }>();
    const envDigestSetting = await db
      .prepare("SELECT value FROM admin_settings WHERE key = 'admin_default_pw_digest' LIMIT 1")
      .first<{ value: string }>();
    const pwSourceSetting = await db
      .prepare("SELECT value FROM admin_settings WHERE key = 'admin_password_source' LIMIT 1")
      .first<{ value: string }>();

    const currentEnvDigest = envAdminPass ? sha256Hex(envAdminPass) : "";
    const envPasswordChanged = Boolean(envAdminPass && envDigestSetting?.value !== currentEnvDigest);
    const hasAnyStoredPassword = Boolean(existingUser?.password_hash || existingAdmin?.password_hash || settingPass?.value);
    const shouldApplyEnvPassword = Boolean(
      envAdminPass &&
        (!hasAnyStoredPassword ||
          (envPasswordChanged && (Boolean(envDigestSetting?.value) || pwSourceSetting?.value !== "otp"))),
    );
    const hashedAdminPass = shouldApplyEnvPassword ? hashPassword(envAdminPass) : null;

    if (!existingUser) {
      await runWithSchemaRepair(() =>
        db
          .prepare(
            `INSERT INTO users (id, phone, email, password_hash, full_name, role, city, province, is_verified, created_at, updated_at)
             VALUES ('admin_user_main', ?, ?, ?, ?, 'admin', 'تهران', 'تهران', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          )
          .bind(phone, email, hashedAdminPass, displayName)
          .run(),
      );
    } else {
      const nextPhone = envPhone ? phone : existingUser.phone || phone;
      const nextEmail = envEmail || existingUser.email || "admin@terrabar.ir";
      const nextName = envDisplayName ? displayName : existingUser.full_name || displayName;
      const nextHash = hashedAdminPass || existingUser.password_hash || settingPass?.value || null;
      await db
        .prepare(
          `UPDATE users SET phone = ?, email = ?, full_name = ?, password_hash = COALESCE(?, password_hash), role = 'admin', is_verified = 1, updated_at = CURRENT_TIMESTAMP
           WHERE id = 'admin_user_main'`,
        )
        .bind(nextPhone, nextEmail, nextName, nextHash)
        .run();
    }

    if (!existingAdmin) {
      await runWithSchemaRepair(() =>
        db
          .prepare(
            `INSERT INTO admin_users (id, auth_user_id, display_name, login_username, city, password_hash, admin_role, is_active, created_at)
             VALUES ('adm_main', 'admin_user_main', ?, ?, 'تهران', ?, 'main_admin', 1, CURRENT_TIMESTAMP)`,
          )
          .bind(displayName, envUsername, hashedAdminPass || settingPass?.value || null)
          .run(),
      );
    } else {
      const nextAdminName = envDisplayName ? displayName : existingAdmin.display_name || displayName;
      await db
        .prepare(
          `UPDATE admin_users SET display_name = ?, login_username = ?, password_hash = COALESCE(?, password_hash), admin_role = 'main_admin', is_active = 1
           WHERE auth_user_id = 'admin_user_main'`,
        )
        .bind(nextAdminName, envUsername, hashedAdminPass || null)
        .run();
    }

    if (hashedAdminPass) {
      await db
        .prepare(
          "INSERT INTO admin_settings (key, value, updated_at) VALUES ('admin_password', ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
        )
        .bind(hashedAdminPass)
        .run();
      if (currentEnvDigest) {
        await db
          .prepare(
            "INSERT INTO admin_settings (key, value, updated_at) VALUES ('admin_default_pw_digest', ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
          )
          .bind(currentEnvDigest)
          .run();
      }
    }
  } catch (err) {
    console.warn("[d1] syncMainAdminFromEnv error:", err);
  }
}

export async function authenticateAdmin(
  username: string,
  password: string,
): Promise<{ success: boolean; message: string; result?: UserAuthResult }> {
  await initD1Schema();
  const db = getD1();
  await syncMainAdminFromEnv(db);

  const cleanUser = toAsciiDigits((username || "").trim());
  const cleanUserLower = cleanUser.toLowerCase();
  const normalizedPhoneInput = normalizeIranMobile(cleanUser);
  const cleanPass = (password || "").trim();

  const expectedUsername = getAdminUsername();
  const expectedDisplayName = getAdminDisplayName();
  const expectedEmail = getAdminRecoveryEmail();
  const expectedPhone = getAdminPhoneForOtp();

  let adminRow: any = null;
  let userRow: any = null;

  const isMainAdminIdentifier =
    cleanUserLower === expectedUsername.toLowerCase() ||
    cleanUserLower === "admin" ||
    cleanUserLower === "rahavard" ||
    (expectedDisplayName && cleanUserLower === expectedDisplayName.toLowerCase()) ||
    (expectedEmail && cleanUserLower === expectedEmail) ||
    (expectedPhone && normalizedPhoneInput === expectedPhone);

  if (isMainAdminIdentifier) {
    userRow = await db.prepare("SELECT * FROM users WHERE id = 'admin_user_main' LIMIT 1").first<any>();
    adminRow = await db.prepare("SELECT * FROM admin_users WHERE auth_user_id = 'admin_user_main' AND is_active = 1 LIMIT 1").first<any>();
  } else {
    adminRow = await db
      .prepare("SELECT * FROM admin_users WHERE (LOWER(login_username) = ? OR LOWER(display_name) = ?) AND is_active = 1 LIMIT 1")
      .bind(cleanUserLower, cleanUserLower)
      .first<any>();
    if (!adminRow) {
      const matchedUser = await db
        .prepare("SELECT * FROM users WHERE LOWER(email) = ? OR phone = ? LIMIT 1")
        .bind(cleanUserLower, normalizedPhoneInput)
        .first<any>();
      if (matchedUser) {
        const linkedAdmin = await db
          .prepare("SELECT * FROM admin_users WHERE auth_user_id = ? AND is_active = 1 LIMIT 1")
          .bind(matchedUser.id)
          .first<any>();
        if (linkedAdmin) {
          adminRow = linkedAdmin;
          userRow = matchedUser;
        }
      }
    }
    if (adminRow?.auth_user_id && !userRow) {
      userRow = await db.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").bind(adminRow.auth_user_id).first<any>();
    }
  }

  if (!adminRow && !userRow) {
    return { success: false, message: "نام کاربری، نام ادمین، ایمیل یا شماره تماس مدیر نادرست است." };
  }

  const settingRow = await db
    .prepare("SELECT value FROM admin_settings WHERE key = 'admin_password' LIMIT 1")
    .first<{ value: string }>();

  const storedHash =
    adminRow?.password_hash ||
    (adminRow?.id === "adm_main" || userRow?.id === "admin_user_main" ? settingRow?.value : null) ||
    userRow?.password_hash ||
    "";

  let verified = false;
  if (storedHash) {
    verified = verifyPassword(cleanPass, storedHash);
    if (verified && isLegacyBase64Hash(storedHash)) {
      const upgraded = hashPassword(cleanPass);
      if (userRow?.id === "admin_user_main") {
        await setAdminPassword(cleanPass);
      } else if (userRow?.id) {
        await db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(upgraded, userRow.id).run();
      }
    }
  }

  if (!verified && (adminRow?.id === "adm_main" || userRow?.id === "admin_user_main")) {
    const envPass = getEnvVar("ADMIN_DEFAULT_PASSWORD");
    if (envPass && cleanPass === envPass && !storedHash) {
      verified = true;
      await setAdminPassword(cleanPass);
    }
  }

  if (!verified) {
    return {
      success: false,
      message: storedHash
        ? "رمز عبور مدیر نادرست است."
        : "رمز عبور مدیر هنوز تنظیم نشده است؛ از بخش بازیابی رمز مدیر اقدام کنید یا ADMIN_DEFAULT_PASSWORD را در تنظیمات کلودفلر وارد نمایید.",
    };
  }

  const targetUserId = userRow?.id || adminRow?.auth_user_id || "admin_user_main";
  const token = generateSecureToken("admsess");
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;

  await saveSessionRecord(db, {
    id: generateId("sess"),
    userId: targetUserId,
    token,
    phone: userRow?.phone || expectedPhone,
    email: userRow?.email || expectedEmail || "admin@terrabar.ir",
    expiresAt,
  });

  const roles = await resolveUserRolesAndAdmin(targetUserId, undefined, userRow?.role || "admin");
  if (!roles.includes("admin")) roles.push("admin");

  await recordAuditLog({
    actorUserId: targetUserId,
    actorRole: adminRow?.admin_role || "main_admin",
    action: "admin_login",
    targetType: "session",
    targetId: targetUserId,
    details: `ورود مدیر با شناسه ${cleanUser}`,
  });

  const result: UserAuthResult = {
    user: {
      id: targetUserId,
      phone: userRow?.phone || expectedPhone,
      full_name: userRow?.full_name || adminRow?.display_name || expectedDisplayName,
      role: userRow?.role || (adminRow?.admin_role === "city_manager" ? "city_manager" : "admin"),
      city: userRow?.city || adminRow?.city || "تهران",
      province: userRow?.province || "تهران",
      email: userRow?.email || expectedEmail || "admin@terrabar.ir",
    },
    member: {
      id: `mem_${targetUserId}`,
      auth_user_id: targetUserId,
      full_name: userRow?.full_name || adminRow?.display_name || expectedDisplayName,
      phone: userRow?.phone || expectedPhone,
      email: userRow?.email || expectedEmail || "admin@terrabar.ir",
      role: userRow?.role || (adminRow?.admin_role === "city_manager" ? "city_manager" : "admin"),
      city: userRow?.city || adminRow?.city || "تهران",
      province: userRow?.province || "تهران",
    },
    roles,
    sessionToken: token,
  };
  cacheSessionResult(token, result, expiresAt);

  return {
    success: true,
    message: "ورود مدیر با موفقیت تأیید شد.",
    result,
  };
}

export async function setAdminPassword(newPassword: string): Promise<void> {
  const cleanPass = newPassword.trim();
  const hashed = hashPassword(cleanPass);
  await initD1Schema();
  const db = getD1();

  await db
    .prepare(
      "INSERT INTO admin_settings (key, value, updated_at) VALUES ('admin_password', ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
    )
    .bind(hashed)
    .run();

  await db
    .prepare(
      "INSERT INTO admin_settings (key, value, updated_at) VALUES ('admin_password_source', 'otp', CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
    )
    .run();

  await db
    .prepare("UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 'admin_user_main'")
    .bind(hashed)
    .run();

  await db
    .prepare("UPDATE admin_users SET password_hash = ? WHERE auth_user_id = 'admin_user_main'")
    .bind(hashed)
    .run();
}

// ==========================================
// Membership & Roles
// ==========================================

export async function getPendingRoleRequests(): Promise<any[]> {
  try {
    await initD1Schema();
    const db = getD1();
    const rows = await db
      .prepare(`
        SELECT 
          mr.id,
          mr.member_id,
          mr.role_code,
          mr.approval_status,
          mr.created_at,
          mr.request_note,
          m.full_name as member_name,
          m.phone as member_phone,
          m.email as member_email,
          m.city as member_city,
          m.province as member_province,
          COALESCE(mr.request_note, m.products, 'ثبت‌نام جدید') as activity
        FROM member_roles mr
        LEFT JOIN members m ON mr.member_id = m.id
        WHERE mr.approval_status = 'pending'
        ORDER BY mr.created_at DESC
      `)
      .all<any>();
    return rows.results || [];
  } catch (err) {
    console.warn("[d1] getPendingRoleRequests error:", err);
    return [];
  }
}

export interface MembershipRequestPayload {
  userId?: string;
  memberId?: string;
  fullName?: string;
  phone?: string;
  province?: string;
  city?: string;
  role: string;
  description?: string;
}

export async function submitMembershipRequest(payload: MembershipRequestPayload): Promise<{
  success: boolean;
  message: string;
  requestId?: string;
}> {
  try {
    await initD1Schema();
    const db = getD1();

    const rawRole = (payload.role || "buyer").trim().toLowerCase();
    const roleCode = rawRole === "bar_seller" ? "seller" : rawRole;
    const description = payload.description?.trim() || "";

    let member: any = null;
    if (payload.memberId) {
      member = await db.prepare("SELECT * FROM members WHERE id = ? LIMIT 1").bind(payload.memberId).first<any>();
    }
    if (!member && payload.userId) {
      member = await db.prepare("SELECT * FROM members WHERE auth_user_id = ? LIMIT 1").bind(payload.userId).first<any>();
    }

    const fullName = payload.fullName?.trim() || member?.full_name || "کاربر ترابار";
    const phone = payload.phone?.trim() || member?.phone || "";
    const city = payload.city?.trim() || member?.city || "کرج";
    const province = payload.province?.trim() || member?.province || "البرز";

    let memberId: string;
    if (member) {
      memberId = member.id;
      await runWithSchemaRepair(() =>
        db
          .prepare(
            "UPDATE members SET full_name = ?, phone = COALESCE(NULLIF(?, ''), phone), city = ?, province = ?, products = COALESCE(NULLIF(?, ''), products), is_active = 1, is_archived = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          )
          .bind(fullName, phone, city, province, description, memberId)
          .run(),
      );
    } else {
      const userRow = payload.userId
        ? await db.prepare("SELECT email FROM users WHERE id = ? LIMIT 1").bind(payload.userId).first<{ email?: string }>()
        : null;
      memberId = generateId("mem");
      await runWithSchemaRepair(() =>
        db
          .prepare(
            `INSERT INTO members (id, auth_user_id, full_name, phone, email, city, province, role, verification_status, products, is_active, is_archived, joined_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          )
          .bind(
            memberId,
            payload.userId || generateId("usr"),
            fullName,
            phone,
            userRow?.email || null,
            city,
            province,
            roleCode,
            description,
          )
          .run(),
      );
    }

    const roleTitle =
      roleCode === "seller"
        ? "بارفروش / حجره‌دار"
        : roleCode === "supplier"
          ? "تأمین‌کننده"
          : roleCode === "special_buyer"
            ? "خریدار ویژه"
            : "خریدار";
    const requestNote = description || `درخواست عضویت در نقش ${roleTitle}`;

    const existingRole = await db
      .prepare(
        "SELECT * FROM member_roles WHERE member_id = ? AND (role_code = ? OR (role_code IN ('seller', 'bar_seller') AND ? IN ('seller', 'bar_seller'))) LIMIT 1",
      )
      .bind(memberId, roleCode, roleCode)
      .first<any>();

    let requestId: string;
    if (existingRole) {
      requestId = existingRole.id;
      await db
        .prepare(
          "UPDATE member_roles SET approval_status = 'pending', approved_at = NULL, request_note = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?",
        )
        .bind(requestNote, existingRole.id)
        .run();
    } else {
      requestId = generateId("role");
      await db
        .prepare(
          "INSERT INTO member_roles (id, member_id, role_code, approval_status, request_note, created_at) VALUES (?, ?, ?, 'pending', ?, CURRENT_TIMESTAMP)",
        )
        .bind(requestId, memberId, roleCode, requestNote)
        .run();
    }

    await db.prepare("UPDATE members SET verification_status = 'pending' WHERE id = ?").bind(memberId).run();

    return {
      success: true,
      message: "درخواست شما با موفقیت در پایگاه داده ثبت شد و برای بررسی مدیر ارسال گردید.",
      requestId,
    };
  } catch (err: any) {
    console.error("[d1] submitMembershipRequest error:", err);
    return { success: false, message: "خطا در ثبت درخواست در پایگاه داده: " + (err?.message || err) };
  }
}

export async function getMyRoleRequests(userIdOrMemberId: string): Promise<any[]> {
  try {
    await initD1Schema();
    const db = getD1();
    const rows = await db
      .prepare(`
        SELECT 
          mr.id, mr.member_id, mr.role_code, mr.approval_status,
          mr.request_note, mr.created_at, mr.approved_at
        FROM member_roles mr
        INNER JOIN members m ON mr.member_id = m.id
        WHERE m.auth_user_id = ? OR m.id = ?
        ORDER BY mr.created_at DESC
      `)
      .bind(userIdOrMemberId, userIdOrMemberId)
      .all<any>();
    return rows.results || [];
  } catch (err) {
    console.error("[d1] getMyRoleRequests error:", err);
    return [];
  }
}

export async function updateRoleApprovalStatus(
  roleId: string,
  status: "approved" | "rejected",
  actorUserId = "admin_user_main",
  options?: { memberId?: string; roleCode?: string },
): Promise<{
  success: boolean;
  error?: string;
  member?: any;
  roleRequest?: any;
}> {
  try {
    await initD1Schema();
    const db = getD1();
    const cleanRoleId = (roleId || "").trim();
    const cleanMemberIdHint = (options?.memberId || "").trim();
    const cleanRoleCodeHint = (options?.roleCode || "").trim().toLowerCase();

    let targetRole = cleanRoleId
      ? await runWithSchemaRepair(() =>
          db
            .prepare(
              "SELECT mr.*, m.phone, m.email, m.full_name, m.role as member_role, m.auth_user_id FROM member_roles mr LEFT JOIN members m ON mr.member_id = m.id WHERE mr.id = ? LIMIT 1",
            )
            .bind(cleanRoleId)
            .first<any>(),
        )
      : null;

    if (!targetRole && (cleanRoleId || cleanMemberIdHint)) {
      const lookupMemberId = cleanMemberIdHint || cleanRoleId;
      targetRole = await runWithSchemaRepair(() =>
        db
          .prepare(
            "SELECT mr.*, m.phone, m.email, m.full_name, m.role as member_role, m.auth_user_id FROM member_roles mr LEFT JOIN members m ON mr.member_id = m.id WHERE mr.member_id = ? ORDER BY CASE WHEN mr.approval_status = 'pending' THEN 0 ELSE 1 END, mr.created_at DESC LIMIT 1",
          )
          .bind(lookupMemberId)
          .first<any>(),
      );
    }

    let resolvedMember: any = null;
    if (targetRole?.member_id) {
      resolvedMember = await db
        .prepare("SELECT * FROM members WHERE id = ? LIMIT 1")
        .bind(targetRole.member_id)
        .first<any>();
    }

    if (!resolvedMember) {
      const candidateIds = [cleanMemberIdHint, cleanRoleId].filter(Boolean);
      for (const cid of candidateIds) {
        resolvedMember = await db
          .prepare("SELECT * FROM members WHERE id = ? OR auth_user_id = ? LIMIT 1")
          .bind(cid, cid)
          .first<any>();
        if (resolvedMember) break;
      }
    }

    // Fallback: if user existed in users table without a members row, synthesize & persist members row now
    if (!resolvedMember) {
      const candidateIds = [cleanMemberIdHint, cleanRoleId].filter(Boolean);
      for (const cid of candidateIds) {
        const cleanUid = cid.startsWith("mem_") ? cid.slice(4) : cid;
        const userRow = await db
          .prepare("SELECT * FROM users WHERE id = ? OR id = ? LIMIT 1")
          .bind(cid, cleanUid)
          .first<any>();
        if (userRow) {
          const newMemberId = generateId("mem");
          const normalizedUserRole =
            String(userRow.role || cleanRoleCodeHint || "buyer").toLowerCase() === "bar_seller"
              ? "seller"
              : String(userRow.role || cleanRoleCodeHint || "buyer").toLowerCase();
          await runWithSchemaRepair(() =>
            db
              .prepare(
                `INSERT INTO members (id, auth_user_id, full_name, phone, email, city, province, role, verification_status, products, is_active, is_archived, joined_at, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
              )
              .bind(
                newMemberId,
                userRow.id,
                userRow.full_name || "کاربر ترابار",
                userRow.phone || null,
                userRow.email || null,
                userRow.city || "",
                userRow.province || "",
                normalizedUserRole,
                status,
                userRow.activity || "",
              )
              .run(),
          );
          resolvedMember = await db
            .prepare("SELECT * FROM members WHERE id = ? LIMIT 1")
            .bind(newMemberId)
            .first<any>();
          break;
        }
      }
    }

    if (!targetRole && !resolvedMember) {
      return {
        success: false,
        error: "درخواست یا پرونده کاربری با این شناسه در پایگاه داده یافت نشد.",
      };
    }

    const effectiveMemberId = targetRole?.member_id || resolvedMember?.id || cleanMemberIdHint || cleanRoleId;
    const rawRoleCode = String(
      targetRole?.role_code || cleanRoleCodeHint || resolvedMember?.role || "buyer",
    ).toLowerCase();
    const effectiveRoleCode = rawRoleCode === "bar_seller" ? "seller" : rawRoleCode;
    const nowIso = new Date().toISOString();

    let roleUpdated = false;
    let effectiveRoleId = targetRole?.id || "";

    if (targetRole) {
      try {
        await runWithSchemaRepair(() =>
          db
            .prepare(
              "UPDATE member_roles SET approval_status = ?, approved_at = ?, approved_by = ? WHERE id = ?",
            )
            .bind(status, status === "approved" ? nowIso : null, actorUserId, targetRole.id)
            .run(),
        );
        roleUpdated = true;
      } catch {
        try {
          await db
            .prepare("UPDATE member_roles SET approval_status = ?, approved_at = ? WHERE id = ?")
            .bind(status, status === "approved" ? nowIso : null, targetRole.id)
            .run();
          roleUpdated = true;
        } catch {
          await db
            .prepare("UPDATE member_roles SET approval_status = ? WHERE id = ?")
            .bind(status, targetRole.id)
            .run();
          roleUpdated = true;
        }
      }
    } else if (resolvedMember) {
      effectiveRoleId = generateId("role");
      try {
        await runWithSchemaRepair(() =>
          db
            .prepare(
              "INSERT INTO member_roles (id, member_id, role_code, approval_status, request_note, approved_at, approved_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
            )
            .bind(
              effectiveRoleId,
              resolvedMember.id,
              effectiveRoleCode,
              status,
              resolvedMember.products || "درخواست عضویت",
              status === "approved" ? nowIso : null,
              actorUserId,
            )
            .run(),
        );
        roleUpdated = true;
      } catch {
        await db
          .prepare(
            "INSERT INTO member_roles (id, member_id, role_code, approval_status, request_note, created_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
          )
          .bind(
            effectiveRoleId,
            resolvedMember.id,
            effectiveRoleCode,
            status,
            resolvedMember.products || "درخواست عضویت",
          )
          .run();
        roleUpdated = true;
      }
    }

    if (resolvedMember || effectiveMemberId) {
      const currentMemberRole = String(resolvedMember?.role || "").toLowerCase();
      const shouldPromoteRole =
        status === "approved" &&
        ["seller", "supplier", "special_buyer"].includes(effectiveRoleCode) &&
        (!currentMemberRole || currentMemberRole === "buyer" || currentMemberRole === "bar_seller");
      const nextMemberRole = shouldPromoteRole ? effectiveRoleCode : resolvedMember?.role || effectiveRoleCode;

      if (status === "approved") {
        await runWithSchemaRepair(() =>
          db
            .prepare(
              "UPDATE members SET verification_status = 'approved', role = COALESCE(NULLIF(?, ''), role), is_active = 1, is_archived = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            )
            .bind(nextMemberRole, effectiveMemberId)
            .run(),
        );
        if (resolvedMember?.auth_user_id) {
          await runWithSchemaRepair(() =>
            db
              .prepare(
                "UPDATE users SET role = COALESCE(NULLIF(?, ''), role), is_verified = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
              )
              .bind(nextMemberRole, resolvedMember.auth_user_id)
              .run(),
          );
        }
      } else {
        // Only mark member as rejected if they have no other approved roles
        const otherApproved = await db
          .prepare(
            "SELECT id FROM member_roles WHERE member_id = ? AND approval_status = 'approved' AND id != ? LIMIT 1",
          )
          .bind(effectiveMemberId, effectiveRoleId)
          .first<any>()
          .catch(() => null);
        if (!otherApproved) {
          await runWithSchemaRepair(() =>
            db
              .prepare("UPDATE members SET verification_status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
              .bind(effectiveMemberId)
              .run(),
          );
        }
      }
    }

    invalidateSessionCacheForUser(resolvedMember?.auth_user_id || targetRole?.auth_user_id, effectiveMemberId);

    const updatedRoleRow = effectiveRoleId
      ? await db
          .prepare(
            "SELECT mr.*, m.full_name as member_name, m.phone as member_phone, m.email as member_email, m.city as member_city, m.province as member_province FROM member_roles mr LEFT JOIN members m ON mr.member_id = m.id WHERE mr.id = ? LIMIT 1",
          )
          .bind(effectiveRoleId)
          .first<any>()
          .catch(() => null)
      : null;

    const updatedMemberRow = effectiveMemberId
      ? await db.prepare("SELECT * FROM members WHERE id = ? LIMIT 1").bind(effectiveMemberId).first<any>().catch(() => null)
      : null;

    let enrichedUpdatedMember = updatedMemberRow;
    if (updatedMemberRow) {
      const mRoles = await db
        .prepare("SELECT * FROM member_roles WHERE member_id = ? ORDER BY created_at DESC")
        .bind(updatedMemberRow.id)
        .all<any>()
        .catch(() => ({ results: [] }));
      enrichedUpdatedMember = { ...updatedMemberRow, member_roles: mRoles.results || [] };
    }

    await recordAuditLog({
      actorUserId,
      actorRole: "admin",
      action: status === "approved" ? "approve_member_role" : "reject_member_role",
      targetType: "member_role",
      targetId: effectiveRoleId || cleanRoleId,
      details: `${status} برای عضو ${updatedMemberRow?.full_name || targetRole?.full_name || effectiveMemberId}`,
    });

    const smsPhone = updatedMemberRow?.phone || targetRole?.phone;
    const smsName = updatedMemberRow?.full_name || targetRole?.full_name || "کاربر گرامی";
    if (smsPhone) {
      Promise.resolve(
        sendEventNotificationSms({
          mobile: smsPhone,
          eventType: status === "approved" ? "role_approved" : "role_rejected",
          messageText:
            status === "approved"
              ? `ترابار: عضویت و دسترسی ${effectiveRoleCode} برای حساب ${smsName} تأیید و فعال شد.`
              : `ترابار: درخواست ارتقای نقش ${effectiveRoleCode} تأیید نشد. جزئیات را در حساب کاربری ببینید.`,
          relatedId: effectiveMemberId,
        }),
      ).catch((smsErr) => {
        console.warn("[d1] role approval sms error:", smsErr);
      });
    }

    return {
      success: roleUpdated || Boolean(updatedMemberRow),
      member: enrichedUpdatedMember,
      roleRequest: updatedRoleRow,
    };
  } catch (err: any) {
    console.error("[d1] updateRoleApprovalStatus error:", err);
    return {
      success: false,
      error: err?.message || "خطای پایگاه داده در به‌روزرسانی وضعیت درخواست",
    };
  }
}

export async function deleteRoleRequest(
  roleId: string,
  memberId?: string,
  actorUserId = "admin_user_main",
): Promise<{ success: boolean; message: string }> {
  try {
    await initD1Schema();
    const db = getD1();
    const cleanRoleId = (roleId || "").trim();
    const cleanMemberId = (memberId || "").trim();

    const existing = cleanRoleId
      ? await db.prepare("SELECT * FROM member_roles WHERE id = ? LIMIT 1").bind(cleanRoleId).first<any>()
      : null;

    if (existing) {
      await db.prepare("DELETE FROM member_roles WHERE id = ?").bind(existing.id).run();
      await recordAuditLog({
        actorUserId,
        actorRole: "admin",
        action: "delete_role_request",
        targetType: "member_role",
        targetId: existing.id,
        details: `حذف درخواست نقش ${existing.role_code} عضو ${existing.member_id}`,
      });
      return { success: true, message: "درخواست با موفقیت حذف شد." };
    }

    // If it was a synthetic pending request tied directly to a member without member_roles row
    const targetMemId = cleanMemberId || cleanRoleId;
    if (targetMemId) {
      await db.prepare("DELETE FROM member_roles WHERE member_id = ? AND approval_status = 'pending'").bind(targetMemId).run();
      const mem = await db.prepare("SELECT id, verification_status, auth_user_id FROM members WHERE id = ? LIMIT 1").bind(targetMemId).first<any>();
      if (mem) {
        if (mem.verification_status === "pending") {
          await db
            .prepare("UPDATE members SET verification_status = 'rejected', role = 'buyer', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
            .bind(mem.id)
            .run();
        }
        invalidateSessionCacheForUser(mem.auth_user_id, mem.id);
        await recordAuditLog({
          actorUserId,
          actorRole: "admin",
          action: "delete_role_request",
          targetType: "member",
          targetId: mem.id,
          details: "حذف درخواست در انتظار بررسی",
        });
        return { success: true, message: "درخواست با موفقیت حذف شد." };
      }
    }

    return { success: false, message: "درخواست مورد نظر برای حذف پیدا نشد." };
  } catch (err: any) {
    console.error("[d1] deleteRoleRequest error:", err);
    return { success: false, message: err?.message || "خطا در حذف درخواست" };
  }
}

export async function resubmitSellingApprovalRequest(params: {
  userId?: string;
  memberId?: string;
  roleCode?: string;
  fullName?: string;
  phone?: string;
  city?: string;
  province?: string;
  note?: string;
}): Promise<{ success: boolean; message: string; requestId?: string }> {
  return submitMembershipRequest({
    userId: params.userId,
    memberId: params.memberId,
    fullName: params.fullName,
    phone: params.phone,
    city: params.city,
    province: params.province,
    role: params.roleCode || "seller",
    description: params.note || "درخواست بررسی و فعال‌سازی امکانات فروش حرفه‌ای",
  });
}

export async function getMemberSellingStatus(userId: string): Promise<{
  memberId: string | null;
  primaryRole: string;
  hasSupplierRole: boolean;
  hasSellerRole: boolean;
  hasSpecialBuyerRole: boolean;
  supplierApproved: boolean;
  sellerApproved: boolean;
  specialBuyerApproved: boolean;
  sellingApproved: boolean;
  pendingRequest: boolean;
}> {
  try {
    await initD1Schema();
    const db = getD1();
    const member = await db.prepare("SELECT * FROM members WHERE auth_user_id = ? LIMIT 1").bind(userId).first<any>();
    const user = await db.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").bind(userId).first<any>();

    const userRole = String(member?.role || user?.role || "buyer").toLowerCase();
    const isSupplier = userRole === "supplier";
    const isSeller = ["seller", "bar_seller"].includes(userRole);
    const isSpecialBuyer = ["special_buyer", "buyer_special"].includes(userRole);

    if (!member) {
      return {
        memberId: null,
        primaryRole: isSupplier ? "supplier" : isSeller ? "seller" : "buyer",
        hasSupplierRole: isSupplier,
        hasSellerRole: isSeller,
        hasSpecialBuyerRole: isSpecialBuyer,
        supplierApproved: false,
        sellerApproved: false,
        specialBuyerApproved: false,
        sellingApproved: false,
        pendingRequest: isSupplier || isSeller || isSpecialBuyer,
      };
    }

    const roleRows = await db
      .prepare("SELECT role_code, approval_status FROM member_roles WHERE member_id = ?")
      .bind(member.id)
      .all<any>();

    const rows = roleRows.results || [];
    const hasSupplier = isSupplier || rows.some((r) => r.role_code === "supplier");
    const hasSeller = isSeller || rows.some((r) => ["seller", "bar_seller"].includes(r.role_code));
    const hasSpecialBuyer = isSpecialBuyer || rows.some((r) => ["special_buyer", "buyer_special"].includes(r.role_code));

    const supplierApproved =
      rows.some((r) => r.role_code === "supplier" && r.approval_status === "approved") ||
      (isSupplier &&
        member.verification_status === "approved" &&
        !rows.some((r) => r.role_code === "supplier" && r.approval_status === "rejected"));
    const sellerApproved =
      rows.some((r) => ["seller", "bar_seller"].includes(r.role_code) && r.approval_status === "approved") ||
      (isSeller &&
        member.verification_status === "approved" &&
        !rows.some((r) => ["seller", "bar_seller"].includes(r.role_code) && r.approval_status === "rejected"));
    const specialBuyerApproved =
      rows.some((r) => ["special_buyer", "buyer_special"].includes(r.role_code) && r.approval_status === "approved") ||
      (isSpecialBuyer && member.verification_status === "approved");
    const pendingRequest = rows.some((r) => r.approval_status === "pending") || member.verification_status === "pending";

    return {
      memberId: member.id,
      primaryRole: hasSupplier ? "supplier" : hasSeller ? "seller" : hasSpecialBuyer ? "special_buyer" : "buyer",
      hasSupplierRole: hasSupplier,
      hasSellerRole: hasSeller,
      hasSpecialBuyerRole: hasSpecialBuyer,
      supplierApproved,
      sellerApproved,
      specialBuyerApproved,
      sellingApproved: (hasSupplier && supplierApproved) || (hasSeller && sellerApproved),
      pendingRequest,
    };
  } catch (err) {
    console.error("[d1] getMemberSellingStatus error:", err);
    return {
      memberId: null,
      primaryRole: "buyer",
      hasSupplierRole: false,
      hasSellerRole: false,
      hasSpecialBuyerRole: false,
      supplierApproved: false,
      sellerApproved: false,
      specialBuyerApproved: false,
      sellingApproved: false,
      pendingRequest: false,
    };
  }
}

export async function requestUserPasswordResetOtp(
  identifier: string,
  preferredMethod?: "sms" | "email",
): Promise<{
  success: boolean;
  message: string;
  deliveryMethod?: "phone" | "email";
  target?: string;
}> {
  await initD1Schema();
  const db = getD1();
  const rawId = (identifier || "").trim();
  if (!rawId) {
    return { success: false, message: "شماره تماس یا نشانی ایمیل را وارد فرمایید." };
  }

  const isEmail = rawId.includes("@");
  const cleanId = isEmail ? rawId.toLowerCase() : normalizeIranMobile(rawId);

  let user: any = null;
  if (isEmail) {
    user = await db.prepare("SELECT * FROM users WHERE LOWER(email) = ? LIMIT 1").bind(cleanId).first<any>();
    if (!user) user = await db.prepare("SELECT * FROM members WHERE LOWER(email) = ? LIMIT 1").bind(cleanId).first<any>();
  } else {
    user = await db.prepare("SELECT * FROM users WHERE phone = ? LIMIT 1").bind(cleanId).first<any>();
    if (!user) user = await db.prepare("SELECT * FROM members WHERE phone = ? LIMIT 1").bind(cleanId).first<any>();
  }

  if (!user) {
    return {
      success: false,
      message: isEmail ? "حسابی با این نشانی ایمیل پیدا نشد." : "حسابی با این شماره تماس پیدا نشد.",
    };
  }

  const phone = user.phone ? normalizeIranMobile(user.phone) : !isEmail ? cleanId : "";
  const email = (user.email || (isEmail ? cleanId : "")).toLowerCase();
  const sendByEmail =
    preferredMethod === "email" || (isEmail && preferredMethod !== "sms") || (!phone && Boolean(email));

  if (sendByEmail && email) {
    const emailRes = await sendOtpEmail(email, "reset_password");
    const parts = email.split("@");
    const masked = (parts[0]?.slice(0, 3) || "") + "***@" + (parts[1] || "");
    return {
      success: emailRes.success,
      message: emailRes.message,
      deliveryMethod: "email",
      target: masked,
    };
  }

  if (phone) {
    const smsRes = await sendOtpSms(phone, "password_reset_otp");
    const masked = phone.slice(0, 4) + "***" + phone.slice(-4);
    return {
      success: smsRes.success,
      message: smsRes.message,
      deliveryMethod: "phone",
      target: masked,
    };
  }

  return { success: false, message: "اطلاعات تماس یا ایمیل معتبری برای این حساب ثبت نشده است." };
}

export async function resetUserPasswordWithOtp(params: {
  identifier: string;
  code: string;
  newPassword: string;
}): Promise<{ success: boolean; message: string }> {
  await initD1Schema();
  const db = getD1();
  const rawId = toAsciiDigits(params.identifier || "").trim();
  const isEmail = rawId.includes("@");
  const cleanId = isEmail ? rawId.toLowerCase() : normalizeIranMobile(rawId);
  const cleanCode = toAsciiDigits(params.code || "").trim();
  const newPass = (params.newPassword || "").trim();

  if (!cleanCode || cleanCode.length < 5) {
    return { success: false, message: "کد تأیید پیامک یا ایمیل شده را به درستی وارد فرمایید." };
  }

  if (!newPass || newPass.length < 6) {
    return { success: false, message: "کلمه عبور جدید باید حداقل ۶ کاراکتر باشد." };
  }

  let verifyResult = isEmail
    ? await verifyEmailOtpCode(cleanId, cleanCode)
    : await verifyOtpCode(cleanId, cleanCode);

  if (!verifyResult.success && verifyResult.message.includes("ثبت نشده")) {
    const user = isEmail
      ? (await db.prepare("SELECT phone, email FROM users WHERE LOWER(email) = ? LIMIT 1").bind(cleanId).first<any>()) ||
        (await db.prepare("SELECT phone, email FROM members WHERE LOWER(email) = ? LIMIT 1").bind(cleanId).first<any>())
      : (await db.prepare("SELECT phone, email FROM users WHERE phone = ? LIMIT 1").bind(cleanId).first<any>()) ||
        (await db.prepare("SELECT phone, email FROM members WHERE phone = ? LIMIT 1").bind(cleanId).first<any>());
    if (user) {
      if (isEmail && user.phone) {
        verifyResult = await verifyOtpCode(normalizeIranMobile(user.phone), cleanCode);
      } else if (!isEmail && user.email) {
        verifyResult = await verifyEmailOtpCode(String(user.email).toLowerCase(), cleanCode);
      }
    }
  }

  if (!verifyResult.success) {
    return { success: false, message: verifyResult.message };
  }

  const passwordHash = hashPassword(newPass);

  if (isEmail) {
    const matchedAdmin = await db
      .prepare("SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1")
      .bind(cleanId)
      .first<{ id: string }>();
    await db
      .prepare("UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE LOWER(email) = ?")
      .bind(passwordHash, cleanId)
      .run();
    if (matchedAdmin?.id === "admin_user_main" || cleanId === getAdminRecoveryEmail()) {
      await setAdminPassword(newPass);
    } else if (matchedAdmin?.id) {
      await db
        .prepare("UPDATE admin_users SET password_hash = ? WHERE auth_user_id = ?")
        .bind(passwordHash, matchedAdmin.id)
        .run()
        .catch(() => {});
    }
  } else {
    const matchedAdmin = await db
      .prepare("SELECT id FROM users WHERE phone = ? LIMIT 1")
      .bind(cleanId)
      .first<{ id: string }>();
    await db
      .prepare("UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE phone = ?")
      .bind(passwordHash, cleanId)
      .run();
    if (matchedAdmin?.id === "admin_user_main" || cleanId === getAdminPhoneForOtp()) {
      await setAdminPassword(newPass);
    } else if (matchedAdmin?.id) {
      await db
        .prepare("UPDATE admin_users SET password_hash = ? WHERE auth_user_id = ?")
        .bind(passwordHash, matchedAdmin.id)
        .run()
        .catch(() => {});
    }
  }

  return {
    success: true,
    message: "رمز عبور جدید شما با موفقیت در پایگاه داده ثبت شد.",
  };
}

// ==========================================
// City Access & Neighbor Rules
// ==========================================

export async function getCityAccessForUser(userId: string): Promise<{
  city: string;
  accessMode: "all" | "assigned" | "nearby" | "own" | "unavailable";
  allowedCities: string[];
  approvedRoleCodes: string[];
}> {
  await initD1Schema();
  const db = getD1();

  const member = await db.prepare("SELECT * FROM members WHERE auth_user_id = ? LIMIT 1").bind(userId).first<any>();
  const adminRows = (
    await db.prepare("SELECT * FROM admin_users WHERE auth_user_id = ? AND is_active = 1").bind(userId).all<any>()
  ).results || [];
  const roleRows = member?.id
    ? (await db.prepare("SELECT role_code, approval_status FROM member_roles WHERE member_id = ?").bind(member.id).all<any>()).results || []
    : [];

  const approvedRoleCodes = roleRows
    .filter((r: any) => String(r.approval_status).toLowerCase() === "approved")
    .map((r: any) => String(r.role_code).toLowerCase());

  const adminRoles = adminRows.map((r: any) => String(r.admin_role).toLowerCase());
  const ownCity = String(member?.city || "").trim();

  if (adminRoles.some((r) => ["main_admin", "main-administrator", "admin"].includes(r))) {
    return { city: ownCity || "تهران", accessMode: "all", allowedCities: [], approvedRoleCodes };
  }

  if (adminRoles.includes("city_manager")) {
    const adminIds = adminRows.map((r: any) => r.id);
    const assigned: string[] = [];
    for (const id of adminIds) {
      const cRows = (
        await db.prepare("SELECT city_name FROM admin_user_cities WHERE admin_user_id = ?").bind(id).all<any>()
      ).results || [];
      for (const c of cRows) assigned.push(String(c.city_name));
    }
    for (const r of adminRows) {
      if (r.city) assigned.push(String(r.city));
    }
    return {
      city: ownCity,
      accessMode: "assigned",
      allowedCities: [...new Set(assigned.filter(Boolean))],
      approvedRoleCodes,
    };
  }

  if (!ownCity) {
    return { city: "", accessMode: "unavailable", allowedCities: [], approvedRoleCodes };
  }

  if (
    approvedRoleCodes.some((r) => ["special_buyer", "buyer_special", "seller", "bar_seller", "supplier"].includes(r))
  ) {
    const outRows = (
      await db
        .prepare("SELECT neighbor_city_name FROM city_neighbors WHERE city_name = ? AND is_enabled = 1")
        .bind(ownCity)
        .all<any>()
    ).results || [];
    const inRows = (
      await db
        .prepare("SELECT city_name FROM city_neighbors WHERE neighbor_city_name = ? AND is_enabled = 1")
        .bind(ownCity)
        .all<any>()
    ).results || [];

    const neighbors = [
      ...outRows.map((r: any) => String(r.neighbor_city_name)),
      ...inRows.map((r: any) => String(r.city_name)),
    ];
    return {
      city: ownCity,
      accessMode: "nearby",
      allowedCities: [...new Set([ownCity, ...neighbors])],
      approvedRoleCodes,
    };
  }

  return {
    city: ownCity,
    accessMode: "own",
    allowedCities: [ownCity],
    approvedRoleCodes,
  };
}

// ==========================================
// Loads, Tiers & Images
// ==========================================

export async function syncLoadToDatabase(load: any): Promise<any> {
  await initD1Schema();
  const db = getD1();
  const id = load.id || generateId("load");
  const memberId = load.member_id || load.owner_member_id || "";
  const name = load.name || [load.product_type, load.engine].filter(Boolean).join(" ") || "محصول";
  const productType = load.product_type || load.name || "";
  const engine = load.engine || null;
  const category = load.category || null;
  const city = load.city || "";
  const origin = load.origin || load.source_region || "";
  const quality = load.quality || "standard";
  const quantity = Number(load.quantity) || 0;
  const count = Number(load.count) || 0;
  const price = Number(load.price) || 0;
  const priceUnit = load.price_unit || "تومان";
  const saleType = load.sale_type || "regular";
  const status = load.status || "pending";
  const packageType = load.package_type || "کارتن";
  const packageWeight = Number(load.package_weight) || 0;
  const minQuantity = Number(load.min_quantity) || 0;
  const minOrderQuantity = Number(load.min_order_quantity) || 1;
  const readyDate = load.ready_date || null;
  const adStartDate = load.ad_start_date || null;
  const adEndDate = load.ad_end_date || null;
  const responseStartTime = load.response_start_time || null;
  const responseEndTime = load.response_end_time || null;
  const destinationScope = load.destination_scope || null;
  const fleetType = load.fleet_type || null;
  const description = load.description || null;
  const sellerType = load.seller_type || load.role || "seller";
  const role = load.role || "seller";
  const unit = load.unit || "کیلوگرم";

  await db
    .prepare(
      `INSERT INTO loads (
        id, member_id, owner_member_id, name, product_type, category, engine, city, origin, source_region,
        quality, quantity, count, price, price_unit, sale_type, status, package_type, package_weight,
        min_quantity, min_order_quantity, ready_date, ad_start_date, ad_end_date,
        response_start_time, response_end_time, destination_scope, fleet_type,
        description, seller_type, role, unit, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, CURRENT_TIMESTAMP
      )
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        product_type = excluded.product_type,
        category = excluded.category,
        engine = excluded.engine,
        city = excluded.city,
        origin = excluded.origin,
        source_region = excluded.source_region,
        quality = excluded.quality,
        quantity = excluded.quantity,
        count = excluded.count,
        price = excluded.price,
        sale_type = excluded.sale_type,
        status = excluded.status,
        package_type = excluded.package_type,
        package_weight = excluded.package_weight,
        min_quantity = excluded.min_quantity,
        min_order_quantity = excluded.min_order_quantity,
        ready_date = excluded.ready_date,
        ad_start_date = excluded.ad_start_date,
        ad_end_date = excluded.ad_end_date,
        response_start_time = excluded.response_start_time,
        response_end_time = excluded.response_end_time,
        destination_scope = excluded.destination_scope,
        fleet_type = excluded.fleet_type,
        description = excluded.description,
        updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      id,
      memberId,
      memberId,
      name,
      productType,
      category,
      engine,
      city,
      origin,
      origin,
      quality,
      quantity,
      count,
      price,
      priceUnit,
      saleType,
      status,
      packageType,
      packageWeight,
      minQuantity,
      minOrderQuantity,
      readyDate,
      adStartDate,
      adEndDate,
      responseStartTime,
      responseEndTime,
      destinationScope,
      fleetType,
      description,
      sellerType,
      role,
      unit,
    )
    .run();

  if (Array.isArray(load.tiers)) {
    await db.prepare("DELETE FROM load_price_tiers WHERE load_id = ?").bind(id).run();
    for (const tier of load.tiers) {
      await db
        .prepare(
          `INSERT INTO load_price_tiers (id, load_id, sale_type, unit_price, minimum_packages, min_quantity, max_quantity, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        )
        .bind(
          generateId("tier"),
          id,
          String(tier.sale_type || "regular"),
          Number(tier.unit_price) || 0,
          Number(tier.minimum_packages) || 1,
          Number(tier.min_quantity) || 0,
          tier.max_quantity == null ? null : Number(tier.max_quantity),
        )
        .run();
    }
  }

  if (Array.isArray(load.images)) {
    await db.prepare("DELETE FROM load_images WHERE load_id = ?").bind(id).run();
    for (let idx = 0; idx < load.images.length; idx++) {
      const img = load.images[idx];
      const storagePath = typeof img === "string" ? img : img?.storage_path;
      if (!storagePath) continue;
      await db
        .prepare(
          `INSERT INTO load_images (id, load_id, storage_path, display_order, created_at)
           VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        )
        .bind(generateId("limg"), id, storagePath, Number(img?.display_order ?? idx))
        .run();
    }
  }

  return getLoadByIdFromDatabase(id);
}

async function attachTiersAndImages(loads: any[]): Promise<any[]> {
  if (!loads.length) return [];
  const db = getD1();
  const tiersRows = (await db.prepare("SELECT * FROM load_price_tiers ORDER BY min_quantity ASC").all<any>()).results || [];
  const imageRows = (await db.prepare("SELECT * FROM load_images ORDER BY display_order ASC").all<any>()).results || [];

  const tiersByLoad = new Map<string, any[]>();
  for (const t of tiersRows) {
    const key = String(t.load_id);
    if (!tiersByLoad.has(key)) tiersByLoad.set(key, []);
    tiersByLoad.get(key)!.push(t);
  }

  const imagesByLoad = new Map<string, any[]>();
  for (const img of imageRows) {
    const key = String(img.load_id);
    if (!imagesByLoad.has(key)) imagesByLoad.set(key, []);
    imagesByLoad.get(key)!.push(img);
  }

  return loads.map((l) => ({
    ...l,
    tiers: tiersByLoad.get(String(l.id)) || [],
    images: imagesByLoad.get(String(l.id)) || [],
  }));
}

export async function getLoadByIdFromDatabase(loadId: string): Promise<any | null> {
  await initD1Schema();
  const db = getD1();
  const row = await db
    .prepare(
      `SELECT l.*, m.full_name as member_name, m.phone as member_phone, m.city as member_city, m.role as member_role
       FROM loads l
       LEFT JOIN members m ON l.member_id = m.id OR l.owner_member_id = m.id
       WHERE l.id = ? LIMIT 1`,
    )
    .bind(loadId)
    .first<any>();

  if (!row) return null;
  const enriched = await attachTiersAndImages([row]);
  return enriched[0] || null;
}

export async function getAllLoadsFromDatabase(filter?: {
  memberId?: string;
  city?: string;
  status?: string;
  mode?: "market" | "professional" | "all";
}): Promise<any[]> {
  await initD1Schema();
  const db = getD1();
  let sql = `
    SELECT l.*, m.full_name as member_name, m.phone as member_phone, m.city as member_city, m.role as member_role
    FROM loads l
    LEFT JOIN members m ON l.member_id = m.id OR l.owner_member_id = m.id
    WHERE l.archived_at IS NULL
  `;
  const binds: any[] = [];
  if (filter?.memberId) {
    sql += " AND (l.member_id = ? OR l.owner_member_id = ?)";
    binds.push(filter.memberId, filter.memberId);
  }
  if (filter?.status) {
    sql += " AND l.status = ?";
    binds.push(filter.status);
  }
  if (filter?.city) {
    sql += " AND l.city = ?";
    binds.push(filter.city);
  }
  sql += " ORDER BY l.created_at DESC";

  let stmt = db.prepare(sql);
  if (binds.length) stmt = stmt.bind(...binds);
  const result = await stmt.all<any>();
  const rows = await attachTiersAndImages(result.results || []);

  if (!filter?.mode || filter.mode === "all") return rows;

  return rows.filter((row) => {
    const tierTypes = (row.tiers || []).map((t: any) => String(t.sale_type || "").toLowerCase());
    const loadSaleType = String(row.sale_type || "").toLowerCase();
    const isPro =
      tierTypes.some((s: string) => s === "professional" || s === "pro") ||
      loadSaleType.includes("pro") ||
      String(row.city || "").includes("سراسر");
    return filter.mode === "professional" ? isPro : !isPro;
  });
}

export async function updateLoadStatusInDatabase(loadId: string, status: string): Promise<boolean> {
  await initD1Schema();
  const db = getD1();
  const res = await db
    .prepare("UPDATE loads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(status, loadId)
    .run();
  return !!res.success;
}

export async function deleteLoadFromDatabase(loadId: string, softArchive = false): Promise<boolean> {
  await initD1Schema();
  const db = getD1();
  if (softArchive) {
    const res = await db
      .prepare("UPDATE loads SET status = 'archived', archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(loadId)
      .run();
    return !!res.success;
  }
  await db.prepare("DELETE FROM load_price_tiers WHERE load_id = ?").bind(loadId).run();
  await db.prepare("DELETE FROM load_images WHERE load_id = ?").bind(loadId).run();
  const res = await db.prepare("DELETE FROM loads WHERE id = ?").bind(loadId).run();
  return !!res.success;
}

// ==========================================
// Cart Persistence (6-Hour TTL in D1)
// ==========================================

const CART_TTL_MS = 6 * 60 * 60 * 1000;

export async function getCartFromDatabase(userId: string): Promise<any[]> {
  await initD1Schema();
  const db = getD1();
  await db.prepare("DELETE FROM carts WHERE expires_at <= ?").bind(Date.now()).run();

  const rows = (
    await db
      .prepare("SELECT * FROM carts WHERE user_id = ? AND expires_at > ? ORDER BY updated_at DESC")
      .bind(userId, Date.now())
      .all<any>()
  ).results || [];

  const result: any[] = [];
  for (const row of rows) {
    const load = await getLoadByIdFromDatabase(row.load_id);
    if (load) {
      result.push({
        id: row.id,
        load,
        saleType: row.sale_type,
        quantity: Number(row.quantity),
        expiresAt: Number(row.expires_at),
      });
    }
  }
  return result;
}

export async function upsertCartItemsInDatabase(
  userId: string,
  memberId: string,
  items: Array<{ loadId: string; saleType: string; quantity: number; expiresAt?: number }>,
): Promise<void> {
  await initD1Schema();
  const db = getD1();
  await db.prepare("DELETE FROM carts WHERE user_id = ?").bind(userId).run();

  for (const item of items) {
    await db
      .prepare(
        `INSERT INTO carts (id, user_id, member_id, load_id, sale_type, quantity, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .bind(
        generateId("cart"),
        userId,
        memberId,
        String(item.loadId),
        String(item.saleType || "regular"),
        Math.max(1, Number(item.quantity) || 1),
        Number(item.expiresAt) || Date.now() + CART_TTL_MS,
      )
      .run();
  }
}

export async function clearCartInDatabase(userId: string): Promise<void> {
  await initD1Schema();
  const db = getD1();
  await db.prepare("DELETE FROM carts WHERE user_id = ?").bind(userId).run();
}

// ==========================================
// Orders, Stock Deduction, 5% Commission & Notifications
// ==========================================

export async function syncOrderToDatabase(order: any): Promise<any> {
  await initD1Schema();
  const db = getD1();

  if (order.idempotency_key) {
    const existing = await db
      .prepare("SELECT * FROM orders WHERE idempotency_key = ? LIMIT 1")
      .bind(String(order.idempotency_key))
      .first<any>();
    if (existing) {
      return existing;
    }
  }

  const loadId = order.load_id ? String(order.load_id) : null;
  let loadRow: any = null;
  if (loadId) {
    loadRow = await db.prepare("SELECT * FROM loads WHERE id = ? LIMIT 1").bind(loadId).first<any>();
    if (loadRow) {
      const reqQty = Number(order.quantity) || 1;
      const availablePkg = Number(loadRow.count) > 0 ? Number(loadRow.count) : Number(loadRow.quantity) || 0;
      if (availablePkg > 0 && reqQty > availablePkg) {
        throw new Error(`موجودی این بار کافی نیست (حداکثر موجودی: ${availablePkg}).`);
      }
    }
  }

  const id = order.id || generateId("ord");
  const seqNum = order.invoice_number ? null : await nextSequenceValue("order_invoice");
  const invoiceNumber = String(order.invoice_number || seqNum);
  const buyerMemberId = order.buyer_member_id || null;
  const sellerMemberId = order.seller_member_id || loadRow?.member_id || null;
  const customerName = order.customer_name || "مشتری ترابار";
  const customerPhone = order.customer_phone || "";
  const customerEmail = order.customer_email || "";
  const customerCity = order.customer_city || "";
  const saleType = order.sale_type || "regular";
  const quantity = Number(order.quantity) || 1;
  const unit = order.unit || "بسته";
  const price = Number(order.price) || 0;
  const totalPrice = Number(order.total_price) || quantity * price;
  const deliveryAddress = order.delivery_address || null;
  const deliveryType = order.delivery_type || "pickup";
  const status = order.status || "pending";
  const paymentStatus = order.payment_status || "unpaid";
  const deliveryStatus = order.delivery_status || "pending";
  const notes = order.notes || null;
  const idempotencyKey = order.idempotency_key ? String(order.idempotency_key) : null;

  await db
    .prepare(
      `INSERT INTO orders (
        id, invoice_number, idempotency_key, load_id, buyer_member_id, seller_member_id, customer_name, customer_phone,
        customer_email, customer_city, sale_type, quantity, unit, price, total_price, delivery_address, delivery_type,
        status, payment_status, delivery_status, notes, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, CURRENT_TIMESTAMP
      )
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        payment_status = excluded.payment_status,
        delivery_status = excluded.delivery_status,
        notes = excluded.notes,
        updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      id,
      invoiceNumber,
      idempotencyKey,
      loadId,
      buyerMemberId,
      sellerMemberId,
      customerName,
      customerPhone,
      customerEmail,
      customerCity,
      saleType,
      quantity,
      unit,
      price,
      totalPrice,
      deliveryAddress,
      deliveryType,
      status,
      paymentStatus,
      deliveryStatus,
      notes,
    )
    .run();

  const savedOrder = await db.prepare("SELECT * FROM orders WHERE id = ? LIMIT 1").bind(id).first<any>();

  // Trigger buyer + seller SMS & Email notifications asynchronously
  const productTitle = loadRow?.product_type || loadRow?.name || "محصول";
  if (customerPhone) {
    void sendEventNotificationSms({
      mobile: customerPhone,
      eventType: "order_created_buyer",
      messageText: `ترابار: سفارش شما با شماره فاکتور #${invoiceNumber} برای «${productTitle}» (${quantity} ${unit}) ثبت شد و در انتظار تأیید فروشنده است.`,
      relatedId: id,
    });
  }
  if (customerEmail) {
    void sendEventNotificationEmail({
      email: customerEmail,
      eventType: "order_created_buyer_email",
      subject: `ثبت سفارش #${invoiceNumber} در ترابار`,
      heading: `سفارش شما با موفقیت ثبت شد`,
      description: `سفارش «${productTitle}» به نام ${customerName} در سامانه ثبت گردید و برای فروشنده ارسال شد.`,
      detailsRows: [
        { label: "شماره فاکتور", value: `#${invoiceNumber}` },
        { label: "محصول", value: productTitle },
        { label: "مقدار", value: `${quantity} ${unit}` },
        { label: "مبلغ کل", value: `${Number(totalPrice).toLocaleString("fa-IR")} تومان` },
      ],
      relatedId: id,
    });
  }

  if (sellerMemberId) {
    const sellerMember = await db
      .prepare("SELECT full_name, phone, email FROM members WHERE id = ? LIMIT 1")
      .bind(sellerMemberId)
      .first<any>();
    if (sellerMember?.phone) {
      void sendEventNotificationSms({
        mobile: sellerMember.phone,
        eventType: "order_created_seller",
        messageText: `ترابار: سفارش جدید #${invoiceNumber} برای «${productTitle}» از ${customerName} ثبت شد. لطفاً در بخش مدیریت سفارش‌ها بررسی و تأیید کنید.`,
        relatedId: id,
      });
    }
    if (sellerMember?.email) {
      void sendEventNotificationEmail({
        email: sellerMember.email,
        eventType: "order_created_seller_email",
        subject: `سفارش جدید #${invoiceNumber} در ترابار`,
        heading: "یک سفارش جدید دریافت کردید",
        description: `خریدار (${customerName}) سفارش جدیدی برای محصول «${productTitle}» ثبت کرده است.`,
        detailsRows: [
          { label: "شماره فاکتور", value: `#${invoiceNumber}` },
          { label: "مقدار سفارش", value: `${quantity} ${unit}` },
          { label: "مبلغ کل", value: `${Number(totalPrice).toLocaleString("fa-IR")} تومان` },
        ],
        relatedId: id,
      });
    }
  }

  return savedOrder;
}

export async function updateOrderLifecycle(params: {
  orderId: string;
  action: "accept" | "reject" | "ship" | "deliver" | "mark_paid";
  actorUserId: string;
  actorRole: string;
  notes?: string;
}): Promise<{ success: boolean; message: string; order?: any }> {
  await initD1Schema();
  const db = getD1();
  const order = await db.prepare("SELECT * FROM orders WHERE id = ? LIMIT 1").bind(params.orderId).first<any>();
  if (!order) {
    return { success: false, message: "سفارش مورد نظر پیدا نشد." };
  }

  const nowIso = new Date().toISOString();
  let nextStatus = order.status;
  let nextPaymentStatus = order.payment_status;
  let nextDeliveryStatus = order.delivery_status;
  let paidAt = order.paid_at;
  let shippedAt = order.shipped_at;
  let deliveredAt = order.delivered_at;

  if (params.action === "accept") {
    if (order.status === "accepted" || order.status === "confirmed") {
      return { success: false, message: "این سفارش قبلاً تأیید شده است." };
    }
    nextStatus = "accepted";
    // Deduct stock on load if available
    if (order.load_id) {
      const load = await db.prepare("SELECT * FROM loads WHERE id = ? LIMIT 1").bind(order.load_id).first<any>();
      if (load) {
        const orderPkg = Number(order.quantity) || 0;
        const pkgWeight = Number(load.package_weight) || 1;
        const nextCount = Math.max(0, Number(load.count || 0) - orderPkg);
        const nextQuantity = Math.max(0, Number(load.quantity || 0) - orderPkg * pkgWeight);
        const nextLoadStatus = nextCount <= 0 ? "sold_out" : load.status;
        await db
          .prepare("UPDATE loads SET count = ?, quantity = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .bind(nextCount, nextQuantity, nextLoadStatus, load.id)
          .run();
      }
    }
  } else if (params.action === "reject") {
    nextStatus = "rejected";
  } else if (params.action === "ship") {
    nextDeliveryStatus = "shipped";
    shippedAt = nowIso;
    if (nextStatus === "pending") nextStatus = "accepted";
  } else if (params.action === "deliver") {
    nextDeliveryStatus = "delivered";
    deliveredAt = nowIso;
    if (nextStatus === "pending") nextStatus = "accepted";
  } else if (params.action === "mark_paid") {
    nextPaymentStatus = "paid";
    paidAt = nowIso;
  }

  await db
    .prepare(
      `UPDATE orders
       SET status = ?, payment_status = ?, delivery_status = ?, paid_at = ?, shipped_at = ?, delivered_at = ?, notes = COALESCE(?, notes), updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .bind(
      nextStatus,
      nextPaymentStatus,
      nextDeliveryStatus,
      paidAt,
      shippedAt,
      deliveredAt,
      params.notes || null,
      order.id,
    )
    .run();

  // Settle 5% platform commission + 95% seller net credit once order is paid & accepted/delivered
  if (nextPaymentStatus === "paid" && nextStatus !== "rejected" && order.seller_member_id) {
    const existingLedger = await db
      .prepare("SELECT id FROM platform_financial_ledger WHERE order_id = ? AND entry_type = 'commission' LIMIT 1")
      .bind(order.id)
      .first<any>();

    if (!existingLedger) {
      const gross = Math.max(0, Number(order.total_price) || 0);
      const commission = Math.round(gross * 0.05);
      const sellerNet = Math.max(0, gross - commission);

      await db
        .prepare(
          `INSERT INTO platform_financial_ledger (id, entry_type, entry_status, amount, currency, order_id, member_id, provider, description, created_at)
           VALUES (?, 'commission', 'settled', ?, 'IRT', ?, ?, 'terrabar', ?, CURRENT_TIMESTAMP)`,
        )
        .bind(
          generateId("pled"),
          commission,
          order.id,
          order.seller_member_id,
          `کمیسیون ۵ درصدی ترابار بابت فاکتور #${order.invoice_number}`,
        )
        .run();

      await db
        .prepare(
          `INSERT INTO seller_financial_transactions (id, member_id, order_id, transaction_type, amount, description, reference_code, payout_status, transaction_date)
           VALUES (?, ?, ?, 'sale_credit', ?, ?, ?, 'settled', CURRENT_TIMESTAMP)`,
        )
        .bind(
          generateId("ftx"),
          order.seller_member_id,
          order.id,
          sellerNet,
          `خالص فروش فاکتور #${order.invoice_number} پس از کسر ۵٪ کارمزد (${commission.toLocaleString("fa-IR")} تومان)`,
          `INV-${order.invoice_number}`,
        )
        .run();
    }
  }

  const updated = await db.prepare("SELECT * FROM orders WHERE id = ? LIMIT 1").bind(order.id).first<any>();

  // Notify buyer via SMS on status updates
  const statusLabelMap: Record<string, string> = {
    accept: "تأیید شد",
    reject: "رد شد",
    ship: "ارسال شد",
    deliver: "تحویل داده شد",
    mark_paid: "تسویه/پرداخت ثبت شد",
  };
  if (order.customer_phone) {
    void sendEventNotificationSms({
      mobile: order.customer_phone,
      eventType: "order_status_updated",
      messageText: `ترابار: وضعیت سفارش #${order.invoice_number} به «${statusLabelMap[params.action]}» تغییر یافت.`,
      relatedId: order.id,
    });
  }

  await recordAuditLog({
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
    action: `order_${params.action}`,
    targetType: "order",
    targetId: order.id,
    details: `فاکتور #${order.invoice_number} -> ${params.action}`,
  });

  return { success: true, message: "وضعیت سفارش با موفقیت به‌روزرسانی شد.", order: updated };
}

export async function getOrdersFromDatabase(filter?: {
  buyerMemberId?: string;
  sellerMemberId?: string;
}): Promise<any[]> {
  await initD1Schema();
  const db = getD1();
  let sql = `
    SELECT o.*, l.product_type as load_product_type, l.name as load_name, l.city as load_city, l.package_weight as load_package_weight
    FROM orders o
    LEFT JOIN loads l ON o.load_id = l.id
    WHERE 1=1
  `;
  const binds: any[] = [];
  if (filter?.buyerMemberId && filter?.sellerMemberId) {
    sql += " AND (o.buyer_member_id = ? OR o.seller_member_id = ?)";
    binds.push(filter.buyerMemberId, filter.sellerMemberId);
  } else if (filter?.buyerMemberId) {
    sql += " AND o.buyer_member_id = ?";
    binds.push(filter.buyerMemberId);
  } else if (filter?.sellerMemberId) {
    sql += " AND o.seller_member_id = ?";
    binds.push(filter.sellerMemberId);
  }
  sql += " ORDER BY o.created_at DESC";

  let stmt = db.prepare(sql);
  if (binds.length) stmt = stmt.bind(...binds);
  const result = await stmt.all<any>();
  return result.results || [];
}

// ==========================================
// Purchase Requests (درخواست خرید مستقیم)
// ==========================================

export async function createPurchaseRequest(data: {
  buyerMemberId: string;
  loadId?: string | null;
  productType: string;
  quantity: number;
  quantityUnit?: string;
  destinationCity: string;
  qualityRequirements?: string;
  neededBy?: string;
  maxPrice?: number;
  notes?: string;
}): Promise<any> {
  await initD1Schema();
  const db = getD1();
  const id = generateId("preq");
  const requestNumber = await nextSequenceValue("purchase_request");

  await db
    .prepare(
      `INSERT INTO purchase_requests (
        id, request_number, member_id, buyer_member_id, load_id, product_name,
        quantity, quantity_unit, max_price, city, destination_city,
        quality_requirements, needed_by, details, notes, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    )
    .bind(
      id,
      requestNumber,
      data.buyerMemberId,
      data.buyerMemberId,
      data.loadId || null,
      data.productType,
      Number(data.quantity) || 1,
      data.quantityUnit || "کیلوگرم",
      Number(data.maxPrice) || 0,
      data.destinationCity,
      data.destinationCity,
      data.qualityRequirements || "",
      data.neededBy || "",
      data.notes || "",
      data.notes || "",
    )
    .run();

  return db.prepare("SELECT * FROM purchase_requests WHERE id = ? LIMIT 1").bind(id).first<any>();
}

export async function getPurchaseRequests(filter?: {
  buyerMemberId?: string;
  onlyDirect?: boolean;
}): Promise<any[]> {
  await initD1Schema();
  const db = getD1();
  let sql = `
    SELECT pr.*, COALESCE(pr.product_name, '') as product_type, m.full_name as buyer_name, m.phone as buyer_phone
    FROM purchase_requests pr
    LEFT JOIN members m ON pr.buyer_member_id = m.id OR pr.member_id = m.id
    WHERE 1=1
  `;
  const binds: any[] = [];
  if (filter?.buyerMemberId) {
    sql += " AND (pr.buyer_member_id = ? OR pr.member_id = ?)";
    binds.push(filter.buyerMemberId, filter.buyerMemberId);
  }
  if (filter?.onlyDirect) {
    sql += " AND pr.load_id IS NULL";
  }
  sql += " ORDER BY pr.created_at DESC";
  let stmt = db.prepare(sql);
  if (binds.length) stmt = stmt.bind(...binds);
  return (await stmt.all<any>()).results || [];
}

export async function updatePurchaseRequestStatus(id: string, status: string): Promise<boolean> {
  await initD1Schema();
  const db = getD1();
  const res = await db
    .prepare("UPDATE purchase_requests SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(status, id)
    .run();
  return !!res.success;
}

// ==========================================
// Ratings & Messages
// ==========================================

export async function getRatingsSummary(targetType: "member" | "load", targetId: string): Promise<{
  count: number;
  average: number;
  ratings: any[];
}> {
  await initD1Schema();
  const db = getD1();
  const col = targetType === "load" ? "(load_id = ? OR target_load_id = ?)" : "(rated_member_id = ? OR target_member_id = ?)";
  const rows = (
    await db
      .prepare(
        `SELECT r.*, m.full_name as reviewer_name
         FROM ratings r
         LEFT JOIN members m ON r.rater_member_id = m.id OR r.reviewer_member_id = m.id
         WHERE ${col} AND (r.is_visible = 1 OR r.is_visible IS NULL) AND r.status = 'approved'
         ORDER BY r.created_at DESC`,
      )
      .bind(targetId, targetId)
      .all<any>()
  ).results || [];

  const count = rows.length;
  const sum = rows.reduce((s, r) => s + Number(r.score || 0), 0);
  const average = count > 0 ? Math.round((sum / count) * 10) / 10 : 0;
  return { count, average, ratings: rows };
}

export async function checkOrderReviewEligibility(
  orderId: string,
  buyerMemberId: string,
): Promise<{ eligible: boolean; alreadyReviewed: boolean; order?: any }> {
  await initD1Schema();
  const db = getD1();
  const order = await db
    .prepare("SELECT * FROM orders WHERE id = ? AND buyer_member_id = ? LIMIT 1")
    .bind(orderId, buyerMemberId)
    .first<any>();

  if (!order) return { eligible: false, alreadyReviewed: false };
  const existing = await db
    .prepare("SELECT id FROM ratings WHERE order_id = ? LIMIT 1")
    .bind(orderId)
    .first<any>();

  const isCompleted =
    order.status === "accepted" || order.delivery_status === "delivered" || order.payment_status === "paid";

  return {
    eligible: isCompleted && !existing,
    alreadyReviewed: Boolean(existing),
    order,
  };
}

export async function createRating(data: {
  reviewerMemberId: string;
  targetType: "member" | "load";
  targetMemberId?: string;
  targetLoadId?: string;
  orderId?: string;
  score: number;
  reviewText?: string;
}): Promise<any> {
  await initD1Schema();
  const db = getD1();
  const id = generateId("rat");
  await db
    .prepare(
      `INSERT INTO ratings (
        id, rater_member_id, reviewer_member_id, rated_member_id, target_member_id,
        target_type, load_id, target_load_id, order_id, score, review_text, status, is_visible, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', 1, CURRENT_TIMESTAMP)`,
    )
    .bind(
      id,
      data.reviewerMemberId,
      data.reviewerMemberId,
      data.targetMemberId || null,
      data.targetMemberId || null,
      data.targetType,
      data.targetLoadId || null,
      data.targetLoadId || null,
      data.orderId || null,
      Math.min(5, Math.max(1, Math.round(data.score))),
      data.reviewText || "",
    )
    .run();

  return db.prepare("SELECT * FROM ratings WHERE id = ? LIMIT 1").bind(id).first<any>();
}

export async function getRatingMessages(ratingId: string): Promise<any[]> {
  await initD1Schema();
  const db = getD1();
  return (
    await db
      .prepare("SELECT * FROM rating_messages WHERE rating_id = ? ORDER BY created_at ASC")
      .bind(ratingId)
      .all<any>()
  ).results || [];
}

export async function addRatingMessage(ratingId: string, senderUserId: string, message: string): Promise<any> {
  await initD1Schema();
  const db = getD1();
  const id = generateId("rmsg");
  await db
    .prepare("INSERT INTO rating_messages (id, rating_id, sender_user_id, message, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)")
    .bind(id, ratingId, senderUserId, message)
    .run();
  return db.prepare("SELECT * FROM rating_messages WHERE id = ? LIMIT 1").bind(id).first<any>();
}

// ==========================================
// Finance, IBAN (شبا), 5% Commission & Payouts
// ==========================================

export async function getMemberFinanceSummary(memberId: string): Promise<{
  bankAccount: any | null;
  orders: any[];
  transactions: any[];
  salesTotal: number;
  commissionTotal: number;
  netSalesTotal: number;
  settledPayoutsTotal: number;
  pendingPayoutsTotal: number;
  availableBalance: number;
}> {
  await initD1Schema();
  const db = getD1();

  const bankAccount = await db
    .prepare("SELECT * FROM seller_bank_accounts WHERE member_id = ? LIMIT 1")
    .bind(memberId)
    .first<any>();

  const orders = (
    await db
      .prepare("SELECT * FROM orders WHERE seller_member_id = ? OR buyer_member_id = ? ORDER BY created_at DESC")
      .bind(memberId, memberId)
      .all<any>()
  ).results || [];

  const transactions = (
    await db
      .prepare("SELECT * FROM seller_financial_transactions WHERE member_id = ? ORDER BY transaction_date DESC")
      .bind(memberId)
      .all<any>()
  ).results || [];

  const sellerPaidOrders = orders.filter(
    (o) =>
      String(o.seller_member_id) === String(memberId) &&
      o.status !== "rejected" &&
      o.payment_status === "paid",
  );

  const salesTotal = sellerPaidOrders.reduce((sum, o) => sum + Math.max(0, Number(o.total_price || 0)), 0);
  const commissionTotal = Math.round(salesTotal * 0.05);
  const netSalesTotal = Math.max(0, salesTotal - commissionTotal);

  const payouts = transactions.filter((t) => t.transaction_type === "payout" || t.transaction_type === "payout_request");
  const settledPayoutsTotal = payouts
    .filter((t) => ["settled", "paid"].includes(String(t.payout_status)))
    .reduce((sum, t) => sum + Math.abs(Number(t.amount || 0)), 0);
  const pendingPayoutsTotal = payouts
    .filter((t) => String(t.payout_status) === "pending")
    .reduce((sum, t) => sum + Math.abs(Number(t.amount || 0)), 0);

  const availableBalance = Math.max(0, netSalesTotal - settledPayoutsTotal - pendingPayoutsTotal);

  return {
    bankAccount: bankAccount || null,
    orders,
    transactions,
    salesTotal,
    commissionTotal,
    netSalesTotal,
    settledPayoutsTotal,
    pendingPayoutsTotal,
    availableBalance,
  };
}

export async function upsertSellerBankAccount(params: {
  memberId: string;
  bankName: string;
  accountHolderName: string;
  iban: string;
}): Promise<any> {
  await initD1Schema();
  const db = getD1();
  const cleanIban = params.iban.replace(/\s+/g, "").toUpperCase();
  if (!/^IR\d{24}$/.test(cleanIban)) {
    throw new Error("شماره شبا باید با IR شروع شود و مجموعاً ۲۶ کاراکتر (IR + ۲۴ رقم) باشد.");
  }

  await db
    .prepare(
      `INSERT INTO seller_bank_accounts (id, member_id, bank_name, account_holder_name, iban, verification_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(member_id) DO UPDATE SET
         bank_name = excluded.bank_name,
         account_holder_name = excluded.account_holder_name,
         iban = excluded.iban,
         verification_status = 'pending',
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      generateId("bank"),
      params.memberId,
      params.bankName.trim(),
      params.accountHolderName.trim(),
      cleanIban,
    )
    .run();

  return db.prepare("SELECT * FROM seller_bank_accounts WHERE member_id = ? LIMIT 1").bind(params.memberId).first<any>();
}

export async function requestSellerPayout(params: {
  memberId: string;
  amount: number;
  description?: string;
}): Promise<{ success: boolean; message: string; transaction?: any }> {
  await initD1Schema();
  const db = getD1();
  const summary = await getMemberFinanceSummary(params.memberId);

  if (!summary.bankAccount) {
    return { success: false, message: "ابتدا شماره شبا و اطلاعات حساب بانکی خود را ثبت کنید." };
  }
  if (summary.bankAccount.verification_status !== "verified") {
    return { success: false, message: "شماره شبای شما هنوز توسط مدیریت تأیید نشده است." };
  }
  const amount = Math.round(Number(params.amount) || 0);
  if (amount <= 0) {
    return { success: false, message: "مبلغ تسویه باید بزرگ‌تر از صفر باشد." };
  }
  if (amount > summary.availableBalance) {
    return {
      success: false,
      message: `مبلغ درخواستی از موجودی قابل تسویه شما (${summary.availableBalance.toLocaleString("fa-IR")} تومان) بیشتر است.`,
    };
  }

  const id = generateId("ftx");
  const ref = `REQ-${Date.now().toString().slice(-6)}`;
  await db
    .prepare(
      `INSERT INTO seller_financial_transactions (id, member_id, transaction_type, amount, description, reference_code, payout_status, transaction_date)
       VALUES (?, ?, 'payout', ?, ?, ?, 'pending', CURRENT_TIMESTAMP)`,
    )
    .bind(
      id,
      params.memberId,
      amount,
      params.description || `درخواست تسویه حساب به شبای ${summary.bankAccount.iban}`,
      ref,
    )
    .run();

  const member = await db.prepare("SELECT phone, full_name FROM members WHERE id = ? LIMIT 1").bind(params.memberId).first<any>();
  if (member?.phone) {
    void sendEventNotificationSms({
      mobile: member.phone,
      eventType: "payout_requested",
      messageText: `ترابار: درخواست تسویه حساب شما به مبلغ ${amount.toLocaleString("fa-IR")} تومان (کد ${ref}) ثبت شد و در صف پرداخت است.`,
      relatedId: id,
    });
  }

  const tx = await db.prepare("SELECT * FROM seller_financial_transactions WHERE id = ? LIMIT 1").bind(id).first<any>();
  return { success: true, message: "درخواست تسویه حساب با موفقیت ثبت شد.", transaction: tx };
}

// ==========================================
// Visits, Admin Dashboard & Management
// ==========================================

export async function recordSiteVisit(params: { userId?: string; memberId?: string; route: string }): Promise<void> {
  await initD1Schema();
  const db = getD1();
  await db
    .prepare("INSERT INTO site_visits (id, user_id, member_id, route, visited_at, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)")
    .bind(generateId("vis"), params.userId || null, params.memberId || null, params.route || "/")
    .run();
}

export async function getAdminDashboardData(): Promise<any> {
  await initD1Schema();
  const db = getD1();

  const safeAll = async <T = any>(sql: string): Promise<{ results: T[] }> => {
    try {
      const res = await db.prepare(sql).all<T>();
      return { results: res?.results || [] };
    } catch (err) {
      console.warn("[d1] getAdminDashboardData query fallback:", sql.slice(0, 60), err);
      return { results: [] };
    }
  };

  const [
    membersRes,
    roleRequestsRes,
    loadsRes,
    ordersRes,
    purchaseRequestsRes,
    ratingsRes,
    visitsRes,
    bankAccountsRes,
    financeTxRes,
    platformLedgerRes,
    adminUsersRes,
    adminCitiesRes,
    smsLogsRes,
    auditLogsRes,
    neighborsRes,
  ] = await Promise.all([
    safeAll("SELECT * FROM members ORDER BY created_at DESC"),
    safeAll(`
      SELECT mr.*, m.full_name as member_name, m.phone as member_phone, m.email as member_email, m.city as member_city, m.province as member_province
      FROM member_roles mr LEFT JOIN members m ON mr.member_id = m.id
      ORDER BY mr.created_at DESC
    `),
    getAllLoadsFromDatabase({ mode: "all" }).catch(() => []),
    getOrdersFromDatabase().catch(() => []),
    getPurchaseRequests().catch(() => []),
    safeAll("SELECT * FROM ratings ORDER BY created_at DESC"),
    safeAll("SELECT v.*, m.full_name, m.phone, m.city FROM site_visits v LEFT JOIN members m ON v.member_id = m.id OR v.user_id = m.auth_user_id ORDER BY v.created_at DESC LIMIT 100"),
    safeAll("SELECT b.*, m.full_name as member_name, m.phone as member_phone FROM seller_bank_accounts b LEFT JOIN members m ON b.member_id = m.id ORDER BY b.updated_at DESC"),
    safeAll("SELECT f.*, m.full_name as member_name FROM seller_financial_transactions f LEFT JOIN members m ON f.member_id = m.id ORDER BY f.transaction_date DESC"),
    safeAll("SELECT * FROM platform_financial_ledger ORDER BY created_at DESC"),
    safeAll("SELECT * FROM admin_users ORDER BY created_at DESC"),
    safeAll("SELECT * FROM admin_user_cities ORDER BY created_at DESC"),
    safeAll("SELECT * FROM sms_logs ORDER BY created_at DESC LIMIT 200"),
    safeAll("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200"),
    safeAll("SELECT * FROM city_neighbors ORDER BY city_name ASC"),
  ]);

  const members = [...(membersRes.results || [])];

  // Reconcile any registered users (non-admin) missing from members table so they always show in users list
  try {
    const usersRes = await safeAll("SELECT * FROM users WHERE COALESCE(role, 'buyer') != 'admin' AND id != 'admin_user_main' ORDER BY created_at DESC");
    const memberAuthIds = new Set(members.map((m) => String(m.auth_user_id || "")).filter(Boolean));
    for (const u of usersRes.results || []) {
      if (!memberAuthIds.has(String(u.id))) {
        const rawRole = String(u.role || "buyer").toLowerCase();
        const normalizedRole = rawRole === "bar_seller" ? "seller" : rawRole;
        const isPro = normalizedRole === "seller" || normalizedRole === "supplier";
        const newMemId = generateId("mem");
        const verStatus = isPro ? "pending" : "approved";
        await db
          .prepare(
            `INSERT INTO members (id, auth_user_id, full_name, phone, email, city, province, role, verification_status, products, is_active, is_archived, joined_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          )
          .bind(
            newMemId,
            u.id,
            u.full_name || "کاربر ترابار",
            u.phone || null,
            u.email || null,
            u.city || "",
            u.province || "",
            normalizedRole,
            verStatus,
            u.activity || "",
          )
          .run()
          .catch(() => {});
        const insertedMem = await db.prepare("SELECT * FROM members WHERE id = ? LIMIT 1").bind(newMemId).first<any>().catch(() => null);
        if (insertedMem) {
          members.unshift(insertedMem);
          memberAuthIds.add(String(u.id));
        }
      }
    }
  } catch {
    // Non-fatal reconciliation guard
  }

  const roles = [...(roleRequestsRes.results || [])];
  const rolesByMember = new Map<string, any[]>();
  for (const r of roles) {
    const key = String(r.member_id);
    if (!rolesByMember.has(key)) rolesByMember.set(key, []);
    rolesByMember.get(key)!.push(r);
  }

  for (const m of members) {
    if (m.verification_status === "pending" && !rolesByMember.has(String(m.id))) {
      const synthetic = {
        id: m.id,
        member_id: m.id,
        role_code: m.role || "buyer",
        approval_status: "pending",
        request_note: m.products || "درخواست عضویت در انتظار بررسی",
        created_at: m.created_at || m.joined_at || new Date().toISOString(),
        member_name: m.full_name,
        member_phone: m.phone,
        member_email: m.email,
        member_city: m.city,
        member_province: m.province,
      };
      roles.unshift(synthetic);
      rolesByMember.set(String(m.id), [synthetic]);
    }
  }

  const enrichedMembers = members.map((m) => ({
    ...m,
    member_roles: rolesByMember.get(String(m.id)) || [],
  }));

  const orders = ordersRes || [];
  const totalSales = orders
    .filter((o) => o.status !== "rejected")
    .reduce((s, o) => s + Number(o.total_price || 0), 0);
  const settledSales = orders
    .filter((o) => o.status !== "rejected" && o.payment_status === "paid")
    .reduce((s, o) => s + Number(o.total_price || 0), 0);

  return {
    members: enrichedMembers,
    roleRequests: roles,
    pendingRoleRequests: roles.filter((r) => r.approval_status === "pending"),
    loads: loadsRes,
    orders,
    purchaseRequests: purchaseRequestsRes,
    ratings: ratingsRes.results || [],
    recentVisits: visitsRes.results || [],
    bankAccounts: bankAccountsRes.results || [],
    financeTransactions: financeTxRes.results || [],
    platformLedger: platformLedgerRes.results || [],
    adminUsers: adminUsersRes.results || [],
    adminUserCities: adminCitiesRes.results || [],
    smsLogs: smsLogsRes.results || [],
    auditLogs: auditLogsRes.results || [],
    cityNeighbors: neighborsRes.results || [],
    performanceStats: {
      totalMembers: members.length,
      approvedMembers: members.filter((m) => m.verification_status === "approved").length,
      activeLoads: loadsRes.filter((l) => l.status === "active").length,
      pendingLoads: loadsRes.filter((l) => l.status === "pending").length,
      totalOrders: orders.length,
      paidOrders: orders.filter((o) => o.payment_status === "paid").length,
      totalSalesAmount: totalSales,
      settledSalesAmount: settledSales,
      totalCommissionAmount: Math.round(settledSales * 0.05),
      totalVisits: (visitsRes.results || []).length,
      sentSmsCount: (smsLogsRes.results || []).filter((s) => s.status === "sent").length,
      failedSmsCount: (smsLogsRes.results || []).filter((s) => s.status === "failed").length,
    },
  };
}

export async function adminUpdateMember(params: {
  memberId: string;
  action: "edit" | "archive" | "restore" | "delete" | "approve";
  data?: { fullName?: string; phone?: string; email?: string; city?: string; province?: string; role?: string; verificationStatus?: string };
  actorUserId: string;
}): Promise<boolean> {
  await initD1Schema();
  const db = getD1();

  if (params.action === "archive") {
    await db
      .prepare("UPDATE members SET is_archived = 1, is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(params.memberId)
      .run();
  } else if (params.action === "restore") {
    await db
      .prepare("UPDATE members SET is_archived = 0, is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(params.memberId)
      .run();
  } else if (params.action === "approve") {
    const res = await updateRoleApprovalStatus(params.memberId, "approved", params.actorUserId, {
      memberId: params.memberId,
    });
    return res.success;
  } else if (params.action === "delete") {
    const member = await db.prepare("SELECT * FROM members WHERE id = ? LIMIT 1").bind(params.memberId).first<any>();
    if (!member) return false;
    if (member.auth_user_id === "admin_user_main") return false;

    const cleanupQueries = [
      () => db.prepare("DELETE FROM member_roles WHERE member_id = ?").bind(params.memberId).run(),
      () => db.prepare("DELETE FROM seller_bank_accounts WHERE member_id = ?").bind(params.memberId).run(),
      () => db.prepare("DELETE FROM admin_users WHERE auth_user_id = ? AND admin_role != 'main_admin'").bind(member.auth_user_id || "").run(),
      () => db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(member.auth_user_id || "").run(),
      () => db.prepare("DELETE FROM carts WHERE user_id = ?").bind(member.auth_user_id || "").run(),
    ];
    for (const q of cleanupQueries) {
      await q().catch(() => {});
    }

    await db.prepare("DELETE FROM members WHERE id = ?").bind(params.memberId).run();
    if (member.auth_user_id && member.auth_user_id !== "admin_user_main") {
      await db.prepare("DELETE FROM users WHERE id = ?").bind(member.auth_user_id).run().catch(() => {});
    }
    invalidateSessionCacheForUser(member.auth_user_id, params.memberId);
  } else if (params.action === "edit" && params.data) {
    const member = await db.prepare("SELECT * FROM members WHERE id = ? LIMIT 1").bind(params.memberId).first<any>();
    if (!member) return false;

    const fullName = params.data.fullName?.trim() || member.full_name;
    const phone = params.data.phone?.trim() ? normalizeIranMobile(params.data.phone.trim()) : member.phone;
    const email = params.data.email?.trim() ? params.data.email.trim().toLowerCase() : member.email;
    const city = params.data.city?.trim() || member.city;
    const province = params.data.province?.trim() || member.province;
    const role = params.data.role?.trim() || member.role;
    const verStatus = params.data.verificationStatus?.trim() || member.verification_status;

    await db
      .prepare(
        "UPDATE members SET full_name = ?, phone = ?, email = ?, city = ?, province = ?, role = ?, verification_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      )
      .bind(fullName, phone, email, city, province, role, verStatus, params.memberId)
      .run();

    if (verStatus === "approved" && role && role !== "buyer") {
      const normalizedRole = role === "bar_seller" ? "seller" : role;
      const existingRole = await db
        .prepare("SELECT id FROM member_roles WHERE member_id = ? AND role_code IN (?, ?) LIMIT 1")
        .bind(params.memberId, normalizedRole, role)
        .first<any>()
        .catch(() => null);
      if (existingRole) {
        await db
          .prepare("UPDATE member_roles SET approval_status = 'approved', approved_at = CURRENT_TIMESTAMP WHERE id = ?")
          .bind(existingRole.id)
          .run()
          .catch(() => {});
      } else {
        await db
          .prepare(
            "INSERT INTO member_roles (id, member_id, role_code, approval_status, request_note, approved_at, created_at) VALUES (?, ?, ?, 'approved', 'تأیید‌شده از طریق ویرایش عضو', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
          )
          .bind(generateId("role"), params.memberId, normalizedRole)
          .run()
          .catch(() => {});
      }
    }

    if (member.auth_user_id) {
      await db
        .prepare("UPDATE users SET full_name = ?, phone = ?, email = ?, city = ?, province = ?, role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(fullName, phone, email, city, province, role, member.auth_user_id)
        .run();
    }
    invalidateSessionCacheForUser(member.auth_user_id, params.memberId);
  }

  await recordAuditLog({
    actorUserId: params.actorUserId,
    actorRole: "admin",
    action: `member_${params.action}`,
    targetType: "member",
    targetId: params.memberId,
    details: params.data ? JSON.stringify(params.data) : params.action,
  });

  return true;
}

export async function adminManageCityManager(params: {
  action: "assign" | "deactivate";
  memberId?: string;
  adminUserId?: string;
  cities?: string[];
  password?: string;
  actorUserId: string;
}): Promise<{ success: boolean; message: string }> {
  await initD1Schema();
  const db = getD1();

  if (params.action === "deactivate" && params.adminUserId) {
    await db.prepare("UPDATE admin_users SET is_active = 0 WHERE id = ?").bind(params.adminUserId).run();
    await recordAuditLog({
      actorUserId: params.actorUserId,
      actorRole: "admin",
      action: "deactivate_city_manager",
      targetType: "admin_user",
      targetId: params.adminUserId,
    });
    return { success: true, message: "دسترسی مدیر شهری غیرفعال شد." };
  }

  if (params.action === "assign" && params.memberId && params.cities?.length) {
    const member = await db.prepare("SELECT * FROM members WHERE id = ? LIMIT 1").bind(params.memberId).first<any>();
    if (!member) return { success: false, message: "عضو انتخاب‌شده پیدا نشد." };

    const adminId = generateId("cm");
    const loginUsername = `cm_${String(member.phone || member.id).replace(/[^\d]/g, "").slice(-6) || "city"}`;
    const passHash = params.password ? hashPassword(params.password) : null;

    await db
      .prepare(
        `INSERT INTO admin_users (id, auth_user_id, display_name, login_username, city, password_hash, admin_role, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'city_manager', 1, CURRENT_TIMESTAMP)
         ON CONFLICT(auth_user_id) DO UPDATE SET is_active = 1, city = excluded.city, display_name = excluded.display_name, password_hash = COALESCE(excluded.password_hash, admin_users.password_hash)`,
      )
      .bind(adminId, member.auth_user_id, member.full_name, loginUsername, params.cities[0], passHash)
      .run();

    const row = await db.prepare("SELECT id FROM admin_users WHERE auth_user_id = ? LIMIT 1").bind(member.auth_user_id).first<any>();
    const effectiveAdminId = row?.id || adminId;
    await db.prepare("DELETE FROM admin_user_cities WHERE admin_user_id = ?").bind(effectiveAdminId).run();
    for (const c of params.cities) {
      await db
        .prepare("INSERT INTO admin_user_cities (id, admin_user_id, city_name) VALUES (?, ?, ?)")
        .bind(generateId("auc"), effectiveAdminId, c.trim())
        .run();
    }

    await recordAuditLog({
      actorUserId: params.actorUserId,
      actorRole: "admin",
      action: "assign_city_manager",
      targetType: "member",
      targetId: member.id,
      details: `شهرها: ${params.cities.join("، ")}`,
    });

    return { success: true, message: `مدیر شهری برای شهرهای ${params.cities.join("، ")} با نام کاربری ${loginUsername} ثبت شد.` };
  }

  return { success: false, message: "پارامترهای مدیریت شهری کامل نیست." };
}

export async function adminVerifyBankAccount(
  memberId: string,
  status: "verified" | "rejected",
  actorUserId: string,
): Promise<boolean> {
  await initD1Schema();
  const db = getD1();
  const res = await db
    .prepare("UPDATE seller_bank_accounts SET verification_status = ?, updated_at = CURRENT_TIMESTAMP WHERE member_id = ?")
    .bind(status, memberId)
    .run();

  await recordAuditLog({
    actorUserId,
    actorRole: "admin",
    action: `bank_account_${status}`,
    targetType: "seller_bank_account",
    targetId: memberId,
  });

  return !!res.success;
}

export async function adminCreatePayout(params: {
  memberId: string;
  amount: number;
  description?: string;
  referenceCode?: string;
  actorUserId: string;
}): Promise<any> {
  await initD1Schema();
  const db = getD1();
  const id = generateId("ftx");
  const ref = params.referenceCode || `PAY-${Date.now().toString().slice(-6)}`;
  await db
    .prepare(
      `INSERT INTO seller_financial_transactions (id, member_id, transaction_type, amount, description, reference_code, payout_status, transaction_date)
       VALUES (?, ?, 'payout', ?, ?, ?, 'pending', CURRENT_TIMESTAMP)`,
    )
    .bind(id, params.memberId, Math.round(Number(params.amount) || 0), params.description || "تسویه حساب مدیر", ref)
    .run();

  await recordAuditLog({
    actorUserId: params.actorUserId,
    actorRole: "admin",
    action: "admin_create_payout",
    targetType: "seller_financial_transactions",
    targetId: id,
    details: `${params.amount} تومان برای عضو ${params.memberId}`,
  });

  return db.prepare("SELECT * FROM seller_financial_transactions WHERE id = ? LIMIT 1").bind(id).first<any>();
}

export async function adminUpdatePayoutStatus(params: {
  transactionId: string;
  status: "settled" | "failed" | "cancelled";
  referenceCode?: string;
  actorUserId: string;
}): Promise<boolean> {
  await initD1Schema();
  const db = getD1();
  const tx = await db
    .prepare("SELECT * FROM seller_financial_transactions WHERE id = ? LIMIT 1")
    .bind(params.transactionId)
    .first<any>();

  if (!tx) return false;

  await db
    .prepare(
      "UPDATE seller_financial_transactions SET payout_status = ?, reference_code = COALESCE(NULLIF(?, ''), reference_code), processed_at = CURRENT_TIMESTAMP WHERE id = ?",
    )
    .bind(params.status, params.referenceCode || "", params.transactionId)
    .run();

  if (params.status === "settled") {
    await db
      .prepare(
        `INSERT INTO platform_financial_ledger (id, entry_type, entry_status, amount, currency, member_id, provider, external_reference, description, created_at)
         VALUES (?, 'payout', 'settled', ?, 'IRT', ?, 'bank_transfer', ?, ?, CURRENT_TIMESTAMP)`,
      )
      .bind(
        generateId("pled"),
        Math.abs(Number(tx.amount) || 0),
        tx.member_id,
        params.referenceCode || tx.reference_code || "",
        `واریز تسویه حساب عضو ${tx.member_id}`,
      )
      .run();

    const member = await db.prepare("SELECT phone FROM members WHERE id = ? LIMIT 1").bind(tx.member_id).first<any>();
    if (member?.phone) {
      void sendEventNotificationSms({
        mobile: member.phone,
        eventType: "payout_paid",
        messageText: `ترابار: مبلغ ${Math.abs(Number(tx.amount) || 0).toLocaleString("fa-IR")} تومان به شبای ثبت‌شده شما واریز شد. کد پیگیری: ${params.referenceCode || tx.reference_code || "-"}`,
        relatedId: tx.id,
      });
    }
  }

  await recordAuditLog({
    actorUserId: params.actorUserId,
    actorRole: "admin",
    action: `payout_${params.status}`,
    targetType: "seller_financial_transactions",
    targetId: params.transactionId,
  });

  return true;
}

export async function toggleCityNeighbor(cityName: string, neighborCityName: string, isEnabled: boolean): Promise<void> {
  await initD1Schema();
  const db = getD1();
  const existing = await db
    .prepare("SELECT id FROM city_neighbors WHERE city_name = ? AND neighbor_city_name = ? LIMIT 1")
    .bind(cityName, neighborCityName)
    .first<any>();
  if (existing) {
    await db.prepare("UPDATE city_neighbors SET is_enabled = ? WHERE id = ?").bind(isEnabled ? 1 : 0, existing.id).run();
  } else {
    await db
      .prepare("INSERT INTO city_neighbors (id, city_name, neighbor_city_name, is_enabled) VALUES (?, ?, ?, ?)")
      .bind(generateId("cn"), cityName, neighborCityName, isEnabled ? 1 : 0)
      .run();
  }
}

// ==========================================
// Database Stats & Exports
// ==========================================

export async function getDatabaseStats(): Promise<{
  usersCount: number;
  membersCount: number;
  memberRolesCount: number;
  loadsCount: number;
  activeLoadsCount: number;
  ordersCount: number;
  databaseSizeBytes: number;
  databaseSizeFormatted: string;
  lastBackupDate: string;
}> {
  await initD1Schema();
  const db = getD1();
  const [users, members, roles, loads, activeLoads, orders] = await Promise.all([
    db.prepare("SELECT count(*) as c FROM users").first<any>(),
    db.prepare("SELECT count(*) as c FROM members").first<any>(),
    db.prepare("SELECT count(*) as c FROM member_roles").first<any>(),
    db.prepare("SELECT count(*) as c FROM loads").first<any>(),
    db.prepare("SELECT count(*) as c FROM loads WHERE status = 'active'").first<any>(),
    db.prepare("SELECT count(*) as c FROM orders").first<any>(),
  ]);

  let sizeBytes = 0;
  try {
    const dbPath = path.resolve(process.cwd(), ".d1-local.sqlite");
    if (fs.existsSync(dbPath)) sizeBytes = fs.statSync(dbPath).size;
  } catch {
    sizeBytes = 1024 * 128;
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return {
    usersCount: users?.c ?? 0,
    membersCount: members?.c ?? 0,
    memberRolesCount: roles?.c ?? 0,
    loadsCount: loads?.c ?? 0,
    activeLoadsCount: activeLoads?.c ?? 0,
    ordersCount: orders?.c ?? 0,
    databaseSizeBytes: sizeBytes,
    databaseSizeFormatted: formatSize(sizeBytes),
    lastBackupDate: new Date().toISOString(),
  };
}

export async function exportDatabaseAsJson(): Promise<any> {
  await initD1Schema();
  const db = getD1();
  const tables = [
    "users",
    "members",
    "member_roles",
    "admin_settings",
    "admin_users",
    "admin_user_cities",
    "loads",
    "load_price_tiers",
    "load_images",
    "carts",
    "orders",
    "purchase_requests",
    "ratings",
    "rating_messages",
    "seller_bank_accounts",
    "seller_financial_transactions",
    "platform_financial_ledger",
    "city_neighbors",
    "site_visits",
    "sms_logs",
    "audit_logs",
  ];

  const backupData: Record<string, any[]> = {};
  for (const tbl of tables) {
    try {
      const rows = await db.prepare(`SELECT * FROM ${tbl}`).all<any>();
      backupData[tbl] = (rows.results || []).map((r) => {
        if ("password_hash" in r) {
          return { ...r, password_hash: "[REDACTED]" };
        }
        return r;
      });
    } catch {
      backupData[tbl] = [];
    }
  }

  return {
    app: "Terrabar Fruit & Vegetable Marketplace",
    version: "3.0.0",
    backupTimestamp: new Date().toISOString(),
    databaseType: "Cloudflare D1 / SQLite",
    tables: backupData,
  };
}

export async function exportDatabaseAsSql(): Promise<string> {
  const json = await exportDatabaseAsJson();
  let sql = `-- ========================================================\n`;
  sql += `-- TERRABAR FULL DATABASE BACKUP SCRIPT\n`;
  sql += `-- Generated At: ${json.backupTimestamp}\n`;
  sql += `-- ========================================================\n\n`;

  for (const [table, rows] of Object.entries(json.tables as Record<string, any[]>)) {
    if (!rows.length) continue;
    sql += `-- Table: ${table} (${rows.length} records)\n`;
    for (const row of rows) {
      const cols = Object.keys(row);
      const vals = Object.values(row).map((v) => {
        if (v === null || typeof v === "undefined") return "NULL";
        if (typeof v === "number") return String(v);
        return `'${String(v).replace(/'/g, "''")}'`;
      });
      sql += `INSERT OR REPLACE INTO ${table} (${cols.join(", ")}) VALUES (${vals.join(", ")});\n`;
    }
    sql += `\n`;
  }

  return sql;
}

export function getSqliteDatabaseBinary(): Buffer | null {
  try {
    const dbPath = path.resolve(process.cwd(), ".d1-local.sqlite");
    if (fs.existsSync(dbPath)) {
      return fs.readFileSync(dbPath);
    }
  } catch (err) {
    console.error("[d1] getSqliteDatabaseBinary error:", err);
  }
  return null;
}

// Keep legacy constants exported as dynamic helpers where needed without hardcoded passwords
export const ADMIN_PHONE_FOR_OTP = getAdminPhoneForOtp();
export const ADMIN_USERNAME = getAdminUsername();
