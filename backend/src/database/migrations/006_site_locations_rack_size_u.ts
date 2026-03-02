import type { Migration } from './index.js';
import { columnExists, tableExists } from './schemaChecks.js';

export const Migration006_SiteLocationsRackSizeU: Migration = {
  id: '006',
  name: 'site_locations_rack_size_u_2026_03',
  up: async (adapter) => {
    if (!(await tableExists(adapter, 'site_locations'))) {
      return;
    }

    if (!(await columnExists(adapter, 'site_locations', 'rack_size_u'))) {
      await adapter.execute(
        'ALTER TABLE site_locations ADD COLUMN rack_size_u INT NULL AFTER rack'
      );
    }

    await adapter.execute('UPDATE site_locations SET rack_size_u = 42 WHERE rack_size_u IS NULL');
  },
  down: async (adapter) => {
    if (!(await tableExists(adapter, 'site_locations'))) {
      return;
    }

    if (await columnExists(adapter, 'site_locations', 'rack_size_u')) {
      await adapter.execute('ALTER TABLE site_locations DROP COLUMN rack_size_u');
    }
  },
};
