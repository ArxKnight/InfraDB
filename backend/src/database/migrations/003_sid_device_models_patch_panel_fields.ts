import type { Migration } from './index.js';
import { columnExists, tableExists } from './schemaChecks.js';

export const Migration003_SidDeviceModelsPatchPanelFields: Migration = {
  id: '003',
  name: 'sid_device_models_patch_panel_fields_2026_02',
  up: async (adapter) => {
    if (!(await tableExists(adapter, 'sid_device_models'))) {
      return;
    }

    if (!(await columnExists(adapter, 'sid_device_models', 'is_patch_panel'))) {
      await adapter.execute(
        'ALTER TABLE sid_device_models ADD COLUMN is_patch_panel TINYINT(1) NOT NULL DEFAULT 0 AFTER default_switch_port_count'
      );
    }

    if (!(await columnExists(adapter, 'sid_device_models', 'default_patch_panel_port_count'))) {
      await adapter.execute(
        'ALTER TABLE sid_device_models ADD COLUMN default_patch_panel_port_count INT NULL AFTER is_patch_panel'
      );
    }
  },
  down: async (adapter) => {
    if (!(await tableExists(adapter, 'sid_device_models'))) {
      return;
    }

    if (await columnExists(adapter, 'sid_device_models', 'default_patch_panel_port_count')) {
      await adapter.execute('ALTER TABLE sid_device_models DROP COLUMN default_patch_panel_port_count');
    }

    if (await columnExists(adapter, 'sid_device_models', 'is_patch_panel')) {
      await adapter.execute('ALTER TABLE sid_device_models DROP COLUMN is_patch_panel');
    }
  },
};
