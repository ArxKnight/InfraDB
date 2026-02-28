import type { Migration } from './index.js';
import { columnExists, tableExists } from './schemaChecks.js';

export const Migration002_SidDeviceModelsSwitchFields: Migration = {
  id: '002',
  name: 'sid_device_models_switch_fields_2026_02',
  up: async (adapter) => {
    if (!(await tableExists(adapter, 'sid_device_models'))) {
      return;
    }

    if (!(await columnExists(adapter, 'sid_device_models', 'is_switch'))) {
      await adapter.execute(
        'ALTER TABLE sid_device_models ADD COLUMN is_switch TINYINT(1) NOT NULL DEFAULT 0 AFTER description'
      );
    }

    if (!(await columnExists(adapter, 'sid_device_models', 'default_switch_port_count'))) {
      await adapter.execute(
        'ALTER TABLE sid_device_models ADD COLUMN default_switch_port_count INT NULL AFTER is_switch'
      );
    }

    await adapter.execute(
      `UPDATE sid_device_models dm
       JOIN sids s ON s.device_model_id = dm.id AND s.site_id = dm.site_id
       LEFT JOIN sid_types st ON st.id = s.sid_type_id
       SET dm.is_switch = 1
       WHERE dm.is_switch = 0
         AND LOWER(TRIM(COALESCE(st.name, ''))) LIKE '%switch%'`
    );

    await adapter.execute(
      `UPDATE sid_device_models dm
       JOIN (
         SELECT device_model_id, MAX(switch_port_count) AS max_ports
         FROM sids
         WHERE device_model_id IS NOT NULL
           AND switch_port_count IS NOT NULL
           AND switch_port_count > 0
         GROUP BY device_model_id
       ) x ON x.device_model_id = dm.id
       SET dm.default_switch_port_count = COALESCE(dm.default_switch_port_count, x.max_ports),
           dm.is_switch = 1
       WHERE dm.default_switch_port_count IS NULL`
    );
  },
  down: async (adapter) => {
    if (!(await tableExists(adapter, 'sid_device_models'))) {
      return;
    }

    if (await columnExists(adapter, 'sid_device_models', 'default_switch_port_count')) {
      await adapter.execute('ALTER TABLE sid_device_models DROP COLUMN default_switch_port_count');
    }

    if (await columnExists(adapter, 'sid_device_models', 'is_switch')) {
      await adapter.execute('ALTER TABLE sid_device_models DROP COLUMN is_switch');
    }
  },
};
