import connection from '../database/connection.js';

export type SidActivityAction =
  | 'SID_VIEWED'
  | 'SID_OPENED'
  | 'SID_UPDATED'
  | 'SID_DELETED'
  | 'SID_NOTE_ADDED'
  | 'SID_NOTE_PINNED'
  | 'SID_NOTE_UNPINNED'
  | 'SID_NICS_REPLACED'
  | 'SID_IPS_REPLACED'
  | 'SID_PASSWORD_UPDATED';

export interface LogSidActivityParams {
  actorUserId: number;
  siteId: number;
  sidId: number;
  action: SidActivityAction;
  summary: string;
  diff?: unknown;
}

export async function logSidActivity(params: LogSidActivityParams): Promise<void> {
  if (!Number.isFinite(params.actorUserId) || params.actorUserId <= 0) return;
  if (!Number.isFinite(params.siteId) || params.siteId <= 0) return;
  if (!Number.isFinite(params.sidId) || params.sidId <= 0) return;
  if (!connection.isConnected()) return;

  const diffJson = params.diff === undefined ? null : JSON.stringify(params.diff);

  await connection.getAdapter().execute(
    `INSERT INTO sid_activity_log (site_id, sid_id, actor_user_id, action, summary, diff_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      params.siteId,
      params.sidId,
      params.actorUserId,
      params.action,
      params.summary,
      diffJson,
    ]
  );
}
