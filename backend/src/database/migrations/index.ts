import connection from '../connection.js';
import { DatabaseAdapter } from '../adapters/base.js';
import { Migration001_BaselineSchema } from './001_baseline_schema.js';
import { Migration002_SidDeviceModelsSwitchFields } from './002_sid_device_models_switch_fields.js';
import { Migration003_SidDeviceModelsPatchPanelFields } from './003_sid_device_models_patch_panel_fields.js';
import { Migration004_SidActivityHistoryCleanup } from './004_sid_activity_history_cleanup.js';

export interface Migration {
  id: string;
  name: string;
  up: (adapter: DatabaseAdapter) => Promise<void>;
  down: (adapter: DatabaseAdapter) => Promise<void>;
}

// List of all migrations in order
const migrations: Migration[] = [
  Migration001_BaselineSchema,
  Migration002_SidDeviceModelsSwitchFields,
  Migration003_SidDeviceModelsPatchPanelFields,
  Migration004_SidActivityHistoryCleanup,
];

export const LATEST_MIGRATION_ID = migrations[migrations.length - 1]?.id;

export async function runMigrations(): Promise<void> {
  const adapter = connection.getAdapter();
  
  try {
    // Create migrations table if it doesn't exist
    const createMigrationsTable = `CREATE TABLE IF NOT EXISTS migrations (
      id VARCHAR(255) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      applied_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3)
    )`;
    
    await adapter.execute(createMigrationsTable);
    
    // Get applied migrations
    const appliedMigrations = await adapter.query('SELECT id FROM migrations');
    const appliedIds = new Set(appliedMigrations.map((m: any) => m.id));
    
    // Run pending migrations
    for (const migration of migrations) {
      if (!appliedIds.has(migration.id)) {
        console.log(`🔄 Running migration: ${migration.name}`);
        
        // Begin transaction for migration
        await adapter.beginTransaction();
        
        try {
          // Run migration
          await migration.up(adapter);
          
          // Record migration as applied
          await adapter.execute('INSERT INTO migrations (id, name) VALUES (?, ?)', [migration.id, migration.name]);
          
          await adapter.commit();
          console.log(`✅ Migration completed: ${migration.name}`);
        } catch (error) {
          await adapter.rollback();
          throw error;
        }
      }
    }
    
    console.log('✅ All migrations completed');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

export async function rollbackMigration(migrationId: string): Promise<void> {
  const adapter = connection.getAdapter();
  
  try {
    // Find migration
    const migration = migrations.find(m => m.id === migrationId);
    if (!migration) {
      throw new Error(`Migration not found: ${migrationId}`);
    }
    
    // Check if migration is applied
    const applied = await adapter.query('SELECT id FROM migrations WHERE id = ?', [migrationId]);
    if (applied.length === 0) {
      throw new Error(`Migration not applied: ${migrationId}`);
    }
    
    console.log(`🔄 Rolling back migration: ${migration.name}`);
    
    // Begin transaction for rollback
    await adapter.beginTransaction();
    
    try {
      // Run rollback
      await migration.down(adapter);
      
      // Remove migration record
      await adapter.execute('DELETE FROM migrations WHERE id = ?', [migrationId]);
      
      await adapter.commit();
      console.log(`✅ Migration rolled back: ${migration.name}`);
    } catch (error) {
      await adapter.rollback();
      throw error;
    }
  } catch (error) {
    console.error('❌ Migration rollback failed:', error);
    throw error;
  }
}

export async function getMigrationStatus(): Promise<Array<{ id: string; name: string; applied: boolean; appliedAt?: string }>> {
  const adapter = connection.getAdapter();
  
  try {
    // Get applied migrations
    const appliedMigrations = await adapter.query('SELECT id, applied_at FROM migrations');
    const appliedMap = new Map(appliedMigrations.map((m: any) => [m.id, m.applied_at]));
    
    // Return status for all migrations
    return migrations.map(migration => {
      const appliedAt = appliedMap.get(migration.id);
      return {
        id: migration.id,
        name: migration.name,
        applied: appliedMap.has(migration.id),
        ...(appliedAt ? { appliedAt } : {})
      };
    });
  } catch (error) {
    console.error('❌ Failed to get migration status:', error);
    throw error;
  }
}