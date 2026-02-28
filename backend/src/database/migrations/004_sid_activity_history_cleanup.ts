import type { Migration } from './index.js';
import { tableExists } from './schemaChecks.js';

export const Migration004_SidActivityHistoryCleanup: Migration = {
  id: '004',
  name: 'sid_activity_history_cleanup_2026_02',
  up: async (adapter) => {
    if (!(await tableExists(adapter, 'sid_activity_log'))) {
      return;
    }

    await adapter.execute(
      `DELETE FROM sid_activity_log
       WHERE action IN ('SID_VIEWED', 'SID_NOTE_ADDED', 'SID_NOTE_PINNED', 'SID_NOTE_UNPINNED', 'SID_CLOSING_NOTE')`
    );

    await adapter.execute(
      `DELETE FROM sid_activity_log
       WHERE action IN ('SID_UPDATED', 'SID_PASSWORD_UPDATED', 'SID_NICS_REPLACED', 'SID_IPS_REPLACED')
         AND (
           diff_json IS NULL
           OR TRIM(diff_json) = ''
           OR (
             JSON_VALID(diff_json) = 1
             AND COALESCE(JSON_LENGTH(JSON_EXTRACT(CAST(diff_json AS JSON), '$.changes')), 0) = 0
             AND COALESCE(JSON_LENGTH(JSON_EXTRACT(CAST(diff_json AS JSON), '$.changes.changes')), 0) = 0
           )
         )`
    );
  },
  down: async () => {
    // Irreversible data cleanup migration.
  },
};
