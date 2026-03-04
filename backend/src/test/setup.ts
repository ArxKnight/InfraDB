// Test setup helpers
import mysql from 'mysql2/promise';
import connection from '../database/connection.js';
import { initializeDatabase, InitOptions } from '../database/init.js';
import { DatabaseAdapter } from '../database/adapters/base.js';
import type { SslOptions } from 'mysql2';

let testDatabaseName: string | null = null;
let testDatabaseCreated = false;
let migrationsEnsured = false;
let migrationsPromise: Promise<void> | null = null;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined) {
    throw new Error(`Missing required env var for MySQL tests: ${name}`);
  }
  return String(value);
}

function getMySqlTestConfig() {
  // Require explicit env so tests don't accidentally run against a real/dev database.
  const host = requireEnv('MYSQL_HOST');
  const user = requireEnv('MYSQL_USER');
  const password = process.env.MYSQL_PASSWORD ? String(process.env.MYSQL_PASSWORD) : '';
  const port = Number.parseInt(process.env.MYSQL_PORT || '3306', 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid MYSQL_PORT for tests: ${process.env.MYSQL_PORT}`);
  }

  const sslEnabled = (process.env.MYSQL_SSL || '').toLowerCase() === 'true';
  const ssl: string | SslOptions | undefined = sslEnabled ? {} : undefined;

  return { host, port, user, password, ssl };
}

function getMySqlTestAdminConfig(base: ReturnType<typeof getMySqlTestConfig>) {
  // For ephemeral DB-per-test, we need an admin user with CREATE DATABASE + GRANT.
  // Keep this explicit so tests don't accidentally run destructive operations elsewhere.
  const adminUser = process.env.MYSQL_ADMIN_USER ? String(process.env.MYSQL_ADMIN_USER) : base.user;
  const adminPassword = process.env.MYSQL_ADMIN_PASSWORD
    ? String(process.env.MYSQL_ADMIN_PASSWORD)
    : base.password;
  const adminHost = process.env.MYSQL_ADMIN_HOST ? String(process.env.MYSQL_ADMIN_HOST) : base.host;
  const adminPort = process.env.MYSQL_ADMIN_PORT
    ? Number.parseInt(String(process.env.MYSQL_ADMIN_PORT), 10)
    : base.port;

  if (!Number.isFinite(adminPort) || adminPort <= 0 || adminPort > 65535) {
    throw new Error(`Invalid MYSQL_ADMIN_PORT for tests: ${process.env.MYSQL_ADMIN_PORT}`);
  }

  return {
    host: adminHost,
    port: adminPort,
    user: adminUser,
    password: adminPassword,
    ssl: base.ssl,
  };
}

async function clearAllTables(adapter: DatabaseAdapter): Promise<void> {
  // Keep the migrations table so we don't re-run migrations every time.
  const tables = [
    'sid_connection_cables',
    'sid_connections',
    'sid_nics',
    'sid_passwords',
    'sid_notes',
    'sid_activity_log',
    'sids',
    'sid_device_models',
    'sid_cpu_models',
    'sid_types',
    'sid_statuses',
    'sid_platforms',
    'sid_password_types',
    'sid_nic_types',
    'sid_nic_speeds',
    'site_vlans',
    'invitation_sites',
    'invitations',
    'password_reset_tokens',
    'labels',
    'site_memberships',
    'site_counters',
    'site_locations',
    'cable_types',
    'sites',
    'users',
    'app_settings',
  ];

  const config = connection.getConfig();
  if (!config?.database) {
    return;
  }

  const existingRows = await adapter.query(
    'SELECT TABLE_NAME AS table_name FROM information_schema.tables WHERE table_schema = ?',
    [config.database],
  );
  const existing = new Set((existingRows as any[]).map((r) => String(r.table_name)));

  await adapter.execute('SET FOREIGN_KEY_CHECKS = 0');
  for (const table of tables) {
    if (existing.has(table)) {
      await adapter.execute(`TRUNCATE TABLE \`${table}\``);
    }
  }
  await adapter.execute('SET FOREIGN_KEY_CHECKS = 1');
}

export async function setupTestDatabase(options: InitOptions = {}): Promise<DatabaseAdapter> {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-jwt-secret';

  const base = getMySqlTestConfig();
  if (!testDatabaseName) {
    const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    testDatabaseName = `infradb_test_${suffix}`;
    testDatabaseCreated = false;
    migrationsEnsured = false;
  }

  if (!testDatabaseCreated) {
    const admin = getMySqlTestAdminConfig(base);
    const adminConn = await mysql.createConnection({
      host: admin.host,
      port: admin.port,
      user: admin.user,
      password: admin.password,
      ssl: admin.ssl,
      multipleStatements: true,
    });

    try {
      await adminConn.query(
        `CREATE DATABASE IF NOT EXISTS \`${testDatabaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      );

      // Ensure the normal test user can access the per-test database.
      if (admin.user !== base.user) {
        const db = String(testDatabaseName).replace(/`/g, '``');
        const userLiteral = adminConn.escape(base.user);
        const hostLiteral = adminConn.escape(process.env.MYSQL_USER_HOST ? String(process.env.MYSQL_USER_HOST) : '%');
        await adminConn.query(`GRANT ALL PRIVILEGES ON \`${db}\`.* TO ${userLiteral}@${hostLiteral}`);
        await adminConn.query('FLUSH PRIVILEGES');
      }
      testDatabaseCreated = true;
    } finally {
      await adminConn.end();
    }
  }

  const currentConfig = connection.getConfig();
  const needsConnect =
    !connection.isConnected() ||
    !currentConfig ||
    currentConfig.host !== base.host ||
    currentConfig.port !== base.port ||
    currentConfig.user !== base.user ||
    currentConfig.password !== base.password ||
    currentConfig.database !== testDatabaseName;

  if (needsConnect) {
    await connection.connect({
      host: base.host,
      port: base.port,
      user: base.user,
      password: base.password,
      database: testDatabaseName,
      ssl: base.ssl,
    });
  }

  if ((options.runMigrations ?? true) && !migrationsEnsured) {
    if (!migrationsPromise) {
      migrationsPromise = (async () => {
        await initializeDatabase({
          runMigrations: true,
          seedData: false,
        });
        migrationsEnsured = true;
      })().finally(() => {
        migrationsPromise = null;
      });
    }

    await migrationsPromise;
  }

  await clearAllTables(connection.getAdapter());

  if (options.seedData) {
    await initializeDatabase({
      runMigrations: false,
      seedData: true,
    });
  }

  return connection.getAdapter();
}

export async function cleanupTestDatabase(): Promise<void> {
  if (!connection.isConnected()) {
    return;
  }

  await clearAllTables(connection.getAdapter());
}
