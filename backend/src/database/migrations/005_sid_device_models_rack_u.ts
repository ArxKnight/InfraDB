import type { Migration } from './index.js';
import { columnExists, tableExists } from './schemaChecks.js';

export const Migration005_SidDeviceModelsRackU: Migration = {
  id: '005',
  name: 'sid_device_models_rack_u_2026_03',
  up: async (adapter) => {
    if (!(await tableExists(adapter, 'sid_device_models'))) {
      return;
    }

    if (!(await columnExists(adapter, 'sid_device_models', 'rack_u'))) {
      await adapter.execute(
        'ALTER TABLE sid_device_models ADD COLUMN rack_u INT NULL AFTER description'
      );
    }
  },
  down: async (adapter) => {
    if (!(await tableExists(adapter, 'sid_device_models'))) {
      return;
    }

    if (await columnExists(adapter, 'sid_device_models', 'rack_u')) {
      await adapter.execute('ALTER TABLE sid_device_models DROP COLUMN rack_u');
    }
  },
};
