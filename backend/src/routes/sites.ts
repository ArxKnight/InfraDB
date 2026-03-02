import { Router, Request, Response } from 'express';
import { z } from 'zod';
import SiteModel from '../models/Site.js';
import SiteLocationModel from '../models/SiteLocation.js';
import { DuplicateSiteLocationCoordsError, SiteLocationInUseError } from '../models/SiteLocation.js';
import CableTypeModel from '../models/CableType.js';
import connection from '../database/connection.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireGlobalRole, requireSiteRole, resolveSiteAccess } from '../middleware/permissions.js';
import { ApiResponse } from '../types/index.js';
import { logActivity } from '../services/ActivityLogService.js';
import { logSidActivity } from '../services/SidActivityLogService.js';
import { decryptSidSecret, encryptSidSecret, hasSidSecretKeyConfigured } from '../utils/sidSecrets.js';
import {
  buildCableReportDocxBuffer,
  formatDateTimeDDMMYYYY_HHMM,
  formatPrintedDateDDMonYYYY_HHMM,
  formatTimestampYYYYMMDD_HHMMSS,
  type CableReportLocation,
  type CableReportRun,
} from '../utils/cableReportDocx.js';

const router = Router();
const siteModel = new SiteModel();
const siteLocationModel = new SiteLocationModel();
const cableTypeModel = new CableTypeModel();
const getAdapter = () => connection.getAdapter();

function normalizeRackU(val: unknown): string | null {
  if (val === undefined) return null;
  if (val === null) return null;

  const raw = String(val).trim();
  if (raw === '') return null;

  // Accept "U12", "u 12a", etc.
  const cleaned = raw.replace(/^u\s*/i, '').trim();

  const m = cleaned.match(/^([0-9]{1,4})([a-z])?$/i);
  if (!m) {
    // If it's not in expected form, store trimmed input but clamp length.
    return cleaned.slice(0, 16);
  }

  const num = m[1];
  const suffix = (m[2] ?? '').toLowerCase();
  return `${num}${suffix}`.slice(0, 16);
}

function normalizeRamGb(val: unknown): number | null {
  if (val === undefined) return null;
  if (val === null) return null;
  if (val === '') return null;

  const n = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(n)) return null;

  const rounded = Math.round(n);
  if (Math.abs(n - rounded) < 1e-9) return rounded;
  return n;
}

const SID_HISTORY_NOTE_PREVIEW_MAX = 120;

function buildSidNotePreview(noteText: unknown): string {
  const condensed = String(noteText ?? '').replace(/\s+/g, ' ').trim();
  if (condensed === '') return '(empty)';
  if (condensed.length <= SID_HISTORY_NOTE_PREVIEW_MAX) return condensed;
  return `${condensed.slice(0, SID_HISTORY_NOTE_PREVIEW_MAX - 1)}…`;
}

// Validation schemas
const createSiteSchema = z.object({
  name: z.string().min(1, 'Site name is required').max(100, 'Site name must be less than 100 characters'),
  code: z.string().min(2, 'Abbreviation is required').max(20, 'Abbreviation must be 20 characters or less'),
  location: z.string().max(200, 'Location must be less than 200 characters').optional(),
  description: z.string().max(500, 'Description must be less than 500 characters').optional(),
});

const updateSiteSchema = z.object({
  name: z.string().min(1, 'Site name is required').max(100, 'Site name must be less than 100 characters').optional(),
  code: z.string().min(2, 'Abbreviation is required').max(20, 'Abbreviation must be 20 characters or less').optional(),
  location: z.string().max(200, 'Location must be less than 200 characters').optional(),
  description: z.string().max(500, 'Description must be less than 500 characters').optional(),
});

const getSitesQuerySchema = z.object({
  search: z.string().optional(),
  limit: z.coerce.number().min(1).max(1000).default(50).optional(),
  offset: z.coerce.number().min(0).default(0).optional(),
  include_counts: z.enum(['true', 'false']).default('false').optional(),
}).passthrough();

const siteIdSchema = z.object({
  id: z.coerce.number().min(1, 'Invalid site ID'),
});

const locationIdSchema = z.object({
  locationId: z.coerce.number().min(1, 'Invalid location ID'),
});

const cableTypeIdSchema = z.object({
  cableTypeId: z.coerce.number().min(1, 'Invalid cable type ID'),
});

const locationTemplateTypeSchema = z.enum(['DATACENTRE', 'DOMESTIC']);
const locationRackSizeUSchema = z.preprocess(
  (v) => {
    if (v === undefined || v === null) return v;
    if (v === '') return undefined;
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) return v;
    return Math.trunc(n);
  },
  z.coerce.number().int().min(1).max(99).optional()
);

const createLocationSchema = z
  .object({
    template_type: locationTemplateTypeSchema.default('DATACENTRE').optional(),
    label: z.string().max(255).optional(),
    floor: z.string().min(1, 'Floor is required').max(50),
    suite: z.string().max(50).optional(),
    row: z.string().max(50).optional(),
    rack: z.string().max(50).optional(),
    rack_size_u: locationRackSizeUSchema,
    area: z.string().max(64).optional(),
  })
  .superRefine((data, ctx) => {
    const template = (data.template_type ?? 'DATACENTRE') as 'DATACENTRE' | 'DOMESTIC';

    if (template === 'DATACENTRE') {
      if (!data.suite || data.suite.trim() === '') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['suite'], message: 'Suite is required' });
      }
      if (!data.row || data.row.trim() === '') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['row'], message: 'Row is required' });
      }
      if (!data.rack || data.rack.trim() === '') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['rack'], message: 'Rack is required' });
      }
      if (!Number.isFinite(Number(data.rack_size_u)) || Number(data.rack_size_u) <= 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['rack_size_u'], message: 'Rack Size (U) is required' });
      }
      if (data.area && data.area.trim() !== '') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['area'], message: 'Area must be empty for Datacentre/Commercial locations' });
      }
    } else {
      if (!data.area || data.area.trim() === '') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['area'], message: 'Area is required' });
      }
      if ((data.suite && data.suite.trim() !== '') || (data.row && data.row.trim() !== '') || (data.rack && data.rack.trim() !== '')) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [], message: 'Suite/Row/Rack must be empty for Domestic locations' });
      }
    }
  });

const updateLocationSchema = z
  .object({
    template_type: locationTemplateTypeSchema.optional(),
    label: z.string().max(255).optional().or(z.literal('')),
    floor: z.string().min(1).max(50).optional(),
    suite: z.string().max(50).optional().or(z.literal('')),
    row: z.string().max(50).optional().or(z.literal('')),
    rack: z.string().max(50).optional().or(z.literal('')),
    rack_size_u: locationRackSizeUSchema.or(z.literal('')),
    area: z.string().max(64).optional().or(z.literal('')),
  })
  .superRefine((data, ctx) => {
    // Template-specific required-field validation is enforced more strictly on create.
    // For update, we only block obviously invalid mixed-field submissions.
    if (data.template_type === 'DATACENTRE') {
      if (data.area !== undefined && data.area.trim() !== '') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['area'], message: 'Area must be empty for Datacentre/Commercial locations' });
      }
    }

    if (data.template_type === 'DOMESTIC') {
      if ((data.suite && data.suite.trim() !== '') || (data.row && data.row.trim() !== '') || (data.rack && data.rack.trim() !== '')) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [], message: 'Suite/Row/Rack must be empty for Domestic locations' });
      }
    }
  });

const deleteLocationQuerySchema = z.object({
  strategy: z.enum(['reassign', 'cascade']).optional(),
  cascade: z.string().optional(),
  target_location_id: z.coerce.number().int().positive().optional(),
}).passthrough();

const reassignAndDeleteSchema = z.object({
  reassign_to_location_id: z.coerce.number().int().positive(),
});

const createCableTypeSchema = z.object({
  name: z.string().min(1, 'Cable type name is required').max(255, 'Cable type name must be less than 255 characters'),
  description: z.string().max(1000, 'Description must be less than 1000 characters').optional(),
});

const updateCableTypeSchema = z.object({
  name: z.string().min(1, 'Cable type name is required').max(255, 'Cable type name must be less than 255 characters').optional(),
  // Frontend may send null to clear description
  description: z.union([
    z.string().max(1000, 'Description must be less than 1000 characters'),
    z.literal(''),
    z.null(),
  ]).optional(),
});

// SID Index schemas
const sidIdSchema = z.object({
  sidId: z.coerce.number().min(1, 'Invalid SID ID'),
});

const getSidsQuerySchema = z
  .object({
    search: z.string().optional(),
    search_field: z.enum(['any', 'status', 'sid', 'location', 'hostname', 'model', 'ip', 'cpu', 'power', 'switch_name']).optional(),
    exact: z.enum(['1', '0', 'true', 'false']).optional(),
    show_deleted: z.enum(['1', '0', 'true', 'false']).optional(),
    limit: z.coerce.number().min(1).max(1000).default(50).optional(),
    offset: z.coerce.number().min(0).default(0).optional(),
  })
  .passthrough();

function isDeletedSidStatus(status: any): boolean {
  return String(status ?? '').trim().toLowerCase() === 'deleted';
}

function sidReadOnlyResponse(res: Response) {
  return res.status(409).json({
    success: false,
    error: 'SID is deleted and read-only',
  } as ApiResponse);
}

async function getSidRowForWrite(opts: { adapter: any; siteId: number; sidId: number }) {
  const { adapter, siteId, sidId } = opts;
  const rows = await adapter.query(
    'SELECT id, sid_number, status FROM sids WHERE id = ? AND site_id = ? LIMIT 1',
    [sidId, siteId]
  );
  return (rows?.[0] as any) ?? null;
}

function parseCommaSeparatedTerms(input: string): string[] {
  const parts = input
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p !== '');

  // De-dupe while keeping order
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out.slice(0, 50);
}

const createSidSchema = z.object({
  sid_type_id: z.coerce.number().int().positive(),
  device_model_id: z.coerce.number().int().positive().optional().nullable(),
  cpu_model_id: z.coerce.number().int().positive().optional().nullable(),
  hostname: z.string().max(255).optional().nullable(),
  serial_number: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z.string().min(1).max(255)
  ),
  // Status defaults to "New SID" if omitted/blank.
  status: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z.union([z.string().min(1).max(64), z.literal(''), z.null()]).optional()
  ),
  cpu_count: z.preprocess(
    (v) => {
      if (v === undefined || v === null) return v;
      if (v === '') return null;
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) return v;
      if (n === 0) return null;
      return v;
    },
    z.coerce.number().int().positive().optional().nullable()
  ),
  cpu_cores: z.preprocess(
    (v) => {
      if (v === undefined || v === null) return v;
      if (v === '') return null;
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) return v;
      if (n === 0) return null;
      return v;
    },
    z.coerce.number().int().positive().optional().nullable()
  ),
  cpu_threads: z.preprocess(
    (v) => {
      if (v === undefined || v === null) return v;
      if (v === '') return null;
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) return v;
      if (n === 0) return null;
      return v;
    },
    z.coerce.number().int().positive().optional().nullable()
  ),
  ram_gb: z.preprocess(
    (v) => {
      if (v === undefined || v === null) return v;
      if (v === '') return null;
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) return v;
      if (n === 0) return null;
      return v;
    },
    z
      .coerce
      .number()
      .positive()
      // DB column is DECIMAL(10,3); keep inputs compatible.
      .refine((n) => Math.abs(n - Math.round(n * 1000) / 1000) < 1e-9, {
        message: 'RAM (GB) must have at most 3 decimal places',
      })
      .optional()
      .nullable()
  ),
  platform_id: z.coerce.number().int().positive().optional().nullable(),
  os_name: z.string().max(255).optional().nullable(),
  os_version: z.string().max(255).optional().nullable(),
  mgmt_ip: z.string().max(64).optional().nullable(),
  mgmt_mac: z.string().max(64).optional().nullable(),
  primary_ip: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z.union([z.string().max(64), z.literal(''), z.null()]).optional()
  ),
  subnet_ip: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z.union([z.string().max(64), z.literal(''), z.null()]).optional()
  ),
  gateway_ip: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z.union([z.string().max(64), z.literal(''), z.null()]).optional()
  ),
  // Used when this SID represents a network switch, to drive port dropdowns.
  switch_port_count: z.preprocess(
    (v) => {
      if (v === undefined || v === null) return v;
      if (v === '') return null;
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) return v;
      if (n === 0) return null;
      return v;
    },
    z.coerce.number().int().min(1).max(4096).optional().nullable()
  ),
  location_id: z.coerce.number().int().positive(),
  // Free-text note for power connection, e.g. "PDU-A1/12".
  pdu_power: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z.union([z.string().max(255), z.literal(''), z.null()]).optional()
  ),
  rack_u: z.preprocess(
    (v) => {
      if (v === undefined) return undefined;
      if (v === null) return null;
      return String(v);
    },
    z
      .union([z.string().max(16), z.null()])
      .optional()
  ),
});

const updateSidSchema = createSidSchema.partial();

const updateSidPasswordSchema = z
  .object({
    // username can be set, cleared (null / ''), or omitted (no change)
    username: z.union([z.string().max(255), z.literal(''), z.null()]).optional(),
    // password is never returned; supplying a non-empty string overwrites.
    // null clears, ''/undefined means "no change".
    password: z.union([z.string().max(10000), z.literal(''), z.null()]).optional(),
  })
  .passthrough();

const createSidTypedPasswordSchema = z
  .object({
    password_type_id: z.coerce.number().min(1, 'Password type is required'),
    username: z.preprocess(
      (v) => (typeof v === 'string' ? v.trim() : v),
      z.string().min(1, 'Username is required').max(255)
    ),
    password: z.string().min(1, 'Password is required').max(10000),
  })
  .passthrough();

const passwordTypeIdSchema = z.object({
  passwordTypeId: z.coerce.number().min(1, 'Invalid password type ID'),
});

async function getDefaultOsPasswordTypeId(params: {
  adapter: ReturnType<typeof getAdapter>;
  siteId: number;
}): Promise<number | null> {
  try {
    const rows = await params.adapter.query(
      "SELECT id FROM sid_password_types WHERE site_id = ? AND name = 'OS Credentials' ORDER BY id ASC LIMIT 1",
      [params.siteId]
    );
    const id = rows[0]?.id;
    return id ? Number(id) : null;
  } catch (error) {
    if (isNoSuchTableError(error)) return null;
    throw error;
  }
}

function normalizePasswordUsername(input: unknown): string | null {
  if (input === null) return null;
  if (input === undefined) return null;
  const raw = String(input);
  if (raw.trim() === '') return null;
  return raw;
}

const createSidNoteSchema = z.object({
  note_text: z.string().min(1, 'Note text is required').max(10000),
  type: z.enum(['NOTE', 'CLOSING']).optional(),
});

const sidNoteIdSchema = z.object({
  noteId: z.coerce.number().min(1, 'Invalid note ID'),
});

const setSidNotePinnedSchema = z.object({
  pinned: z.boolean(),
});

function normalizeTinyIntBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (s === '1' || s === 'true' || s === 'yes' || s === 'y') return true;
    if (s === '0' || s === 'false' || s === 'no' || s === 'n' || s === '') return false;
    const n = Number(s);
    if (!Number.isNaN(n)) return n === 1;
    return false;
  }
  return false;
}

function normalizeSidNoteRow(row: any): any {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    pinned: normalizeTinyIntBoolean((row as any).pinned),
  };
}

const replaceSidNicsSchema = z.object({
  nics: z
    .array(
      z
        .object({
          card_name: z.preprocess(
            (v) => (typeof v === 'string' ? v.trim() : v),
            z.union([z.string().max(255), z.literal(''), z.null()]).optional()
          ),
          name: z.string().min(1).max(255),
          mac_address: z.string().max(64).optional().nullable(),
          ip_address: z.string().max(64).optional().nullable(),
          site_vlan_id: z.coerce.number().int().positive().optional().nullable(),
          nic_type_id: z.coerce.number().int().positive().optional().nullable(),
          nic_speed_id: z.coerce.number().int().positive().optional().nullable(),
          switch_sid_id: z.coerce.number().int().positive().optional().nullable(),
          switch_port: z.string().max(255).optional().nullable(),
        })
        .superRefine((val, ctx) => {
          const hasSwitch = Number.isFinite(val.switch_sid_id as any) && (val.switch_sid_id as any) > 0;
          const hasPort = (val.switch_port ?? '').toString().trim() !== '';
          if (hasSwitch !== hasPort) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['switch_port'],
              message: 'Switch and port must be set together',
            });
          }
        })
    )
    .default([]),
});

const replaceSidIpAddressesSchema = z.object({
  ip_addresses: z
    .array(z.string().max(64))
    .default([]),
});

function isDuplicateKeyError(error: unknown): boolean {
  const anyErr = error as any;
  const code = anyErr?.code || anyErr?.errno;
  return code === 'ER_DUP_ENTRY' || code === 1062;
}

async function assertPicklistRowBelongsToSite(params: {
  adapter: ReturnType<typeof getAdapter>;
  table:
    | 'sid_types'
    | 'sid_device_models'
    | 'sid_cpu_models'
    | 'sid_platforms'
    | 'sid_statuses'
    | 'sid_password_types'
    | 'sid_nic_types'
    | 'sid_nic_speeds'
    | 'site_vlans';
  rowId: number;
  siteId: number;
}): Promise<void> {
  const rows = await params.adapter.query(`SELECT id FROM ${params.table} WHERE id = ? AND site_id = ?`, [
    params.rowId,
    params.siteId,
  ]);
  if (!rows.length) {
    throw new Error('Not found');
  }
}

function isNoSuchTableError(error: unknown): boolean {
  const anyErr = error as any;
  const code = anyErr?.code || anyErr?.errno;
  return code === 'ER_NO_SUCH_TABLE' || code === 1146;
}

async function getMissingSidCreatePrerequisites(params: {
  adapter: ReturnType<typeof getAdapter>;
  siteId: number;
}): Promise<string[]> {
  const { adapter, siteId } = params;
  const checks: Array<{ label: string; sql: string; args: any[] }> = [
    { label: 'Device Types', sql: 'SELECT 1 FROM sid_types WHERE site_id = ? LIMIT 1', args: [siteId] },
    { label: 'SID Statuses', sql: 'SELECT 1 FROM sid_statuses WHERE site_id = ? LIMIT 1', args: [siteId] },
    { label: 'Platforms', sql: 'SELECT 1 FROM sid_platforms WHERE site_id = ? LIMIT 1', args: [siteId] },
    { label: 'Locations', sql: 'SELECT 1 FROM site_locations WHERE site_id = ? LIMIT 1', args: [siteId] },
    { label: 'Models', sql: 'SELECT 1 FROM sid_device_models WHERE site_id = ? LIMIT 1', args: [siteId] },
    { label: 'CPU Models', sql: 'SELECT 1 FROM sid_cpu_models WHERE site_id = ? LIMIT 1', args: [siteId] },
    { label: 'Password Types', sql: 'SELECT 1 FROM sid_password_types WHERE site_id = ? LIMIT 1', args: [siteId] },
    { label: 'VLANs', sql: 'SELECT 1 FROM site_vlans WHERE site_id = ? LIMIT 1', args: [siteId] },
    { label: 'NIC Types', sql: 'SELECT 1 FROM sid_nic_types WHERE site_id = ? LIMIT 1', args: [siteId] },
    { label: 'NIC Speeds', sql: 'SELECT 1 FROM sid_nic_speeds WHERE site_id = ? LIMIT 1', args: [siteId] },
  ];

  const missing: string[] = [];
  for (const c of checks) {
    try {
      const rows = await adapter.query(c.sql, c.args);
      if (!rows?.length) missing.push(c.label);
    } catch (error) {
      if (isNoSuchTableError(error)) {
        missing.push(c.label);
        continue;
      }
      throw error;
    }
  }
  return missing;
}

async function assertSidStatusNameBelongsToSite(params: {
  adapter: ReturnType<typeof getAdapter>;
  siteId: number;
  statusName: string;
}): Promise<void> {
  const name = params.statusName.trim();
  if (!name) return;

  try {
    const rows = await params.adapter.query(
      'SELECT id FROM sid_statuses WHERE site_id = ? AND name = ? LIMIT 1',
      [params.siteId, name]
    );
    if (!rows.length) {
      throw new Error('Invalid status');
    }
  } catch (error) {
    // If the migration hasn't been applied yet, don't block SID edits.
    if (isNoSuchTableError(error)) return;
    throw error;
  }
}

/**
 * GET /api/sites
 * Get all sites for the authenticated user with optional filtering
 */
router.get('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      } as ApiResponse);
    }

    const queryValidation = getSitesQuerySchema.safeParse(req.query);
    if (!queryValidation.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid query parameters',
        details: queryValidation.error.errors,
      } as ApiResponse);
    }

    const { search, limit = 50, offset = 0, include_counts = 'false' } = queryValidation.data;

    const isGlobalAdmin = req.user.role === 'GLOBAL_ADMIN';
    let sites: any[] = [];
    let total = 0;

    if (isGlobalAdmin) {
      if (include_counts === 'true') {
        sites = await siteModel.findAllWithLabelCounts({
          ...(search ? { search } : {}),
          limit,
          offset,
        });
      } else {
        sites = await siteModel.findAll({
          ...(search ? { search } : {}),
          limit,
          offset,
        });
      }

      total = await siteModel.countAll(search ?? undefined);
    } else {
      if (include_counts === 'true') {
        sites = await siteModel.findByUserIdWithLabelCounts(req.user.userId, {
          ...(search ? { search } : {}),
          limit,
          offset,
        });
      } else {
        sites = await siteModel.findByUserId(req.user.userId, {
          ...(search ? { search } : {}),
          limit,
          offset,
        });
      }

      total = await siteModel.countByUserId(req.user.userId, search ?? undefined);
    }

    res.json({
      success: true,
      data: {
        sites,
        pagination: {
          total,
          limit,
          offset,
          has_more: offset + limit < total,
        },
      },
    } as ApiResponse);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: error.errors,
      } as ApiResponse);
    }

    console.error('Get sites error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    } as ApiResponse);
  }
});

/**
 * GET /api/sites/:id
 * Get a specific site by ID
 */
router.get('/:id', authenticateToken, resolveSiteAccess(req => Number(req.params.id)), async (req: Request, res: Response) => {
  try {
    // Validate site ID
    const { id } = siteIdSchema.parse(req.params);

    // Get site with label count
    const site = await siteModel.findByIdWithLabelCount(id, req.user!.userId);

    if (!site) {
      return res.status(404).json({
        success: false,
        error: 'Site not found',
      } as ApiResponse);
    }

    res.json({
      success: true,
      data: { site },
    } as ApiResponse);

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: error.errors,
      } as ApiResponse);
    }

    console.error('Get site error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    } as ApiResponse);
  }
});

/**
 * GET /api/sites/:id/sids
 * List SIDs (site-scoped)
 */
router.get(
  '/:id/sids',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  async (req: Request, res: Response) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const queryValidation = getSidsQuerySchema.safeParse(req.query);
      if (!queryValidation.success) {
        return res.status(400).json({
          success: false,
          error: 'Invalid query parameters',
          details: queryValidation.error.errors,
        } as ApiResponse);
      }

      const { search, search_field, exact, show_deleted, limit = 50, offset = 0 } = queryValidation.data;
      const isExact = exact === '1' || exact === 'true';
      const showDeleted = show_deleted === '1' || show_deleted === 'true';
      const safeLimit = Number.isFinite(limit) ? Math.min(1000, Math.max(1, Math.floor(limit))) : 50;
      const safeOffset = Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0;
      const adapter = getAdapter();

      const where: string[] = ['s.site_id = ?'];
      const params: any[] = [siteId];

      if (!showDeleted) {
        where.push(`(LOWER(TRIM(COALESCE(s.status, ''))) <> 'deleted')`);
      } else {
        where.push(`(LOWER(TRIM(COALESCE(s.status, ''))) = 'deleted')`);
      }

      if (search && search.trim() !== '') {
        const trimmedSearch = search.trim();
        const pattern = `%${trimmedSearch}%`;

        // Backwards-compatible behavior (no explicit search_field from older clients)
        if (!search_field) {
          where.push('(s.sid_number LIKE ? OR s.hostname LIKE ? OR s.serial_number LIKE ?)');
          params.push(pattern, pattern, pattern);
        } else if (search_field === 'sid') {
          const terms = parseCommaSeparatedTerms(trimmedSearch);
          if (terms.length > 0) {
            if (isExact) {
              where.push(`(s.sid_number IN (${terms.map(() => '?').join(', ')}))`);
              params.push(...terms);
            } else {
              where.push(`(${terms.map(() => 's.sid_number LIKE ?').join(' OR ')})`);
              params.push(...terms.map((t) => `${t}%`));
            }
          }
        } else if (search_field === 'hostname') {
          where.push('(s.hostname LIKE ?)');
          params.push(pattern);
        } else if (search_field === 'status') {
          where.push('(s.status LIKE ?)');
          params.push(pattern);
        } else if (search_field === 'model') {
          where.push('(dm.name LIKE ? OR dm.manufacturer LIKE ?)');
          params.push(pattern, pattern);
        } else if (search_field === 'ip') {
          where.push('(s.primary_ip LIKE ?)');
          params.push(pattern);
        } else if (search_field === 'cpu') {
          where.push('(cm.name LIKE ?)');
          params.push(pattern);
        } else if (search_field === 'power') {
          where.push('(CAST(COALESCE(s.pdu_power, \'\') AS CHAR) LIKE ?)');
          params.push(pattern);
        } else if (search_field === 'switch_name') {
          where.push(`EXISTS (
            SELECT 1
            FROM sid_nics sn
            LEFT JOIN sid_connections sc ON sc.nic_id = sn.id
            LEFT JOIN sids sw ON sw.id = sc.switch_sid_id
            WHERE sn.sid_id = s.id
              AND UPPER(TRIM(COALESCE(sn.name, ''))) = 'NIC1'
              AND COALESCE(NULLIF(TRIM(sn.card_name), ''), 'On-Board Network Card') = 'On-Board Network Card'
              AND sw.hostname LIKE ?
          )`);
          params.push(pattern);
        } else if (search_field === 'location') {
          where.push('(sl.label LIKE ? OR si.code LIKE ? OR sl.floor LIKE ? OR sl.suite LIKE ? OR sl.`row` LIKE ? OR sl.rack LIKE ? OR sl.area LIKE ?)');
          params.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern);
        } else {
          // search_field === 'any'
          where.push(`(
            s.status LIKE ?
            OR s.sid_number LIKE ?
            OR s.hostname LIKE ?
            OR dm.name LIKE ?
            OR dm.manufacturer LIKE ?
            OR s.primary_ip LIKE ?
            OR cm.name LIKE ?
            OR CAST(COALESCE(s.pdu_power, '') AS CHAR) LIKE ?
            OR sl.label LIKE ?
            OR si.code LIKE ?
            OR sl.floor LIKE ?
            OR sl.suite LIKE ?
            OR sl.\`row\` LIKE ?
            OR sl.rack LIKE ?
            OR sl.area LIKE ?
            OR EXISTS (
              SELECT 1
              FROM sid_nics sn
              LEFT JOIN sid_connections sc ON sc.nic_id = sn.id
              LEFT JOIN sids sw ON sw.id = sc.switch_sid_id
              WHERE sn.sid_id = s.id
                AND UPPER(TRIM(COALESCE(sn.name, ''))) = 'NIC1'
                AND COALESCE(NULLIF(TRIM(sn.card_name), ''), 'On-Board Network Card') = 'On-Board Network Card'
                AND sw.hostname LIKE ?
            )
          )`);
          params.push(
            pattern,
            pattern,
            pattern,
            pattern,
            pattern,
            pattern,
            pattern,
            pattern,
            pattern,
            pattern,
            pattern,
            pattern,
            pattern,
            pattern,
            pattern,
            pattern
          );
        }
      }

      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const totalRows = await adapter.query(
        `SELECT COUNT(*) as count
         FROM sids s
         LEFT JOIN sid_device_models dm ON dm.id = s.device_model_id
         LEFT JOIN site_locations sl ON sl.id = s.location_id
         LEFT JOIN sites si ON si.id = s.site_id
         ${whereSql}`,
        params
      );
      const total = Number(totalRows[0]?.count ?? 0);

      const rows = await adapter.query(
        `SELECT
          s.id,
          s.site_id,
          s.sid_number,
          s.hostname,
          s.primary_ip,
          s.serial_number,
          s.status,
          s.rack_u,
          s.pdu_power,
          s.switch_port_count,
          s.sid_type_id,
          st.name as sid_type_name,
          s.device_model_id,
          dm.manufacturer as device_model_manufacturer,
          dm.name as device_model_name,
          dm.is_switch as device_model_is_switch,
          dm.default_switch_port_count as device_model_default_switch_port_count,
          s.cpu_model_id,
          cm.name as cpu_model_name,
          (
            SELECT sw.hostname
            FROM sid_nics sn
            LEFT JOIN sid_connections sc ON sc.nic_id = sn.id
            LEFT JOIN sids sw ON sw.id = sc.switch_sid_id
            WHERE sn.sid_id = s.id
              AND UPPER(TRIM(COALESCE(sn.name, ''))) = 'NIC1'
              AND COALESCE(NULLIF(TRIM(sn.card_name), ''), 'On-Board Network Card') = 'On-Board Network Card'
            ORDER BY sn.id ASC, sc.id ASC
            LIMIT 1
          ) as primary_switch_hostname,
          sl.floor as location_floor,
          sl.suite as location_suite,
          sl.\`row\` as location_row,
          sl.rack as location_rack,
          sl.area as location_area,
          sl.label as location_label,
          sl.template_type as location_template_type,
          CASE
            WHEN sl.id IS NULL THEN NULL
            ELSE COALESCE(NULLIF(TRIM(sl.label), ''), si.code)
          END as location_effective_label,
          s.created_at,
          s.updated_at
        FROM sids s
        LEFT JOIN sid_types st ON st.id = s.sid_type_id
        LEFT JOIN sid_device_models dm ON dm.id = s.device_model_id
        LEFT JOIN sid_cpu_models cm ON cm.id = s.cpu_model_id
        LEFT JOIN site_locations sl ON sl.id = s.location_id
        LEFT JOIN sites si ON si.id = s.site_id
        ${whereSql}
        ORDER BY s.sid_number ASC
        LIMIT ${safeLimit} OFFSET ${safeOffset}`,
        params
      );

      const normalizedRows = (rows ?? []).map((r: any) => ({
        ...r,
        rack_u: normalizeRackU(r?.rack_u),
      }));

      return res.json({
        success: true,
        data: {
          sids: normalizedRows,
          pagination: {
            total,
            limit: safeLimit,
            offset: safeOffset,
            has_more: safeOffset + safeLimit < total,
          },
        },
      } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: error.errors,
        } as ApiResponse);
      }

      console.error('Get sids error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

/**
 * POST /api/sites/:id/sids
 * Create a SID
 */
router.post(
  '/:id/sids',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN', 'SITE_USER'),
  async (req: Request, res: Response) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const body = createSidSchema.parse(req.body);
      const rackU = body.rack_u === undefined ? null : normalizeRackU(body.rack_u);
      const adapter = getAdapter();

      const missingRequiredFields: string[] = [];
      if (!Number.isFinite(Number(body.cpu_count)) || Number(body.cpu_count) <= 0) {
        missingRequiredFields.push('CPU Count');
      }
      if (!Number.isFinite(Number(body.ram_gb)) || Number(body.ram_gb) <= 0) {
        missingRequiredFields.push('RAM (GB)');
      }
      if (missingRequiredFields.length > 0) {
        return res.status(400).json({
          success: false,
          error: `Missing required fields: ${missingRequiredFields.join(', ')}`,
          details: { missing_required_fields: missingRequiredFields },
        } as ApiResponse);
      }

      // Ensure default statuses exist (useful for new installs and older sites missing picklists).
      // This keeps SID creation functional and makes "New SID" available for defaulting.
      const defaultSidStatusNames = ['New SID', 'Active', 'Awaiting Decommision', 'Decommisioned', 'Deleted'] as const;
      for (const statusName of defaultSidStatusNames) {
        await adapter.execute(
          `INSERT INTO sid_statuses (site_id, name, description)
           VALUES (?, ?, NULL)
           ON DUPLICATE KEY UPDATE name = name`,
          [siteId, statusName]
        );
      }

      const requestedStatus = typeof body.status === 'string' ? body.status.trim() : '';
      if (requestedStatus.toLowerCase() === 'deleted') {
        return res.status(400).json({
          success: false,
          error: 'Status "Deleted" can only be set by deleting a SID',
        } as ApiResponse);
      }
      const statusNameToUse = requestedStatus ? requestedStatus : 'New SID';

      let effectiveSwitchPortCount = body.switch_port_count ?? null;
      if (body.device_model_id) {
        const modelRows = await adapter.query(
          'SELECT is_switch, default_switch_port_count FROM sid_device_models WHERE id = ? AND site_id = ? LIMIT 1',
          [body.device_model_id, siteId]
        );
        const model = (modelRows?.[0] as any) ?? null;
        if (model) {
          const modelIsSwitch = Number(model?.is_switch ?? 0) === 1 || model?.is_switch === true;
          if (!modelIsSwitch) {
            effectiveSwitchPortCount = null;
          } else if (effectiveSwitchPortCount === null || effectiveSwitchPortCount === undefined) {
            const defaultPorts = Number(model?.default_switch_port_count ?? 0);
            effectiveSwitchPortCount = Number.isFinite(defaultPorts) && defaultPorts > 0 ? defaultPorts : null;
          }
        }
      }

      const missing = await getMissingSidCreatePrerequisites({ adapter, siteId });
      if (missing.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'SID prerequisites not configured',
          details: { missing },
        } as ApiResponse);
      }

      try {
        await assertSidStatusNameBelongsToSite({ adapter, siteId, statusName: statusNameToUse });
      } catch (error) {
        if (error instanceof Error && error.message === 'Invalid status') {
          return res.status(400).json({ success: false, error: 'Invalid status' } as ApiResponse);
        }
        throw error;
      }

      await adapter.beginTransaction();
      try {
        // Ensure a counter row exists; seed counters from existing data if missing.
        await adapter.execute(
          `INSERT INTO site_counters (site_id, next_ref, next_sid)
           VALUES (
             ?,
             (SELECT COALESCE(MAX(ref_number), 0) + 1 FROM labels WHERE site_id = ?),
             (SELECT COALESCE(MAX(CAST(sid_number AS UNSIGNED)), 0) + 1
              FROM sids
              WHERE site_id = ?
                AND sid_number REGEXP '^[0-9]+$')
           )
           ON DUPLICATE KEY UPDATE next_sid = next_sid`,
          [siteId, siteId, siteId]
        );

        // Lock the counter row to allocate a unique SID number.
        const counterRows = await adapter.query(
          `SELECT next_sid FROM site_counters WHERE site_id = ? FOR UPDATE`,
          [siteId]
        );

        const currentNextSid = counterRows[0]?.next_sid ? Number(counterRows[0].next_sid) : 1;

        const sidNumberToUse = currentNextSid;
        const newNextSid = currentNextSid + 1;

        await adapter.execute(
          `UPDATE site_counters SET next_sid = ? WHERE site_id = ?`,
          [newNextSid, siteId]
        );

        const sidNumber = String(sidNumberToUse);

        const insert = await adapter.execute(
          `INSERT INTO sids (
            site_id, sid_number, sid_type_id, device_model_id, cpu_model_id,
            hostname, serial_number, status,
            cpu_count, cpu_cores, cpu_threads, ram_gb,
            platform_id,
            os_name, os_version,
            mgmt_ip, mgmt_mac,
            primary_ip, subnet_ip, gateway_ip,
            switch_port_count,
            location_id,
            pdu_power,
            rack_u
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            siteId,
            sidNumber,
            body.sid_type_id ?? null,
            body.device_model_id ?? null,
            body.cpu_model_id ?? null,
            body.hostname ?? null,
            body.serial_number ?? null,
            statusNameToUse,
            body.cpu_count ?? null,
            body.cpu_cores ?? null,
            body.cpu_threads ?? null,
            body.ram_gb ?? null,
            body.platform_id ?? null,
            body.os_name ?? null,
            body.os_version ?? null,
            body.mgmt_ip ?? null,
            body.mgmt_mac ?? null,
            typeof body.primary_ip === 'string'
              ? body.primary_ip.trim() === ''
                ? null
                : body.primary_ip.trim()
              : (body.primary_ip ?? null),
            typeof body.subnet_ip === 'string'
              ? body.subnet_ip.trim() === ''
                ? null
                : body.subnet_ip.trim()
              : (body.subnet_ip ?? null),
            typeof body.gateway_ip === 'string'
              ? body.gateway_ip.trim() === ''
                ? null
                : body.gateway_ip.trim()
              : (body.gateway_ip ?? null),
            effectiveSwitchPortCount,
            body.location_id ?? null,
            body.pdu_power === '' ? null : (body.pdu_power ?? null),
            rackU,
          ]
        );

        const sidId = Number(insert.insertId ?? adapter.getLastInsertId());

        // System note: best-effort; fall back to user-authored if DB is not yet migrated.
        try {
          await adapter.execute(
            `INSERT INTO sid_notes (sid_id, created_by, type, note_text)
             VALUES (?, ?, 'NOTE', ?)`,
            [sidId, null, 'SID Created']
          );
        } catch {
          try {
            await adapter.execute(
              `INSERT INTO sid_notes (sid_id, created_by, type, note_text)
               VALUES (?, ?, 'NOTE', ?)`,
              [sidId, req.user!.userId, 'SID Created']
            );
          } catch {
            // ignore
          }
        }

        await adapter.commit();
        const siteName = String(req.site?.name ?? '').trim();

        try {
          await logActivity({
            actorUserId: req.user!.userId,
            action: 'SID_CREATED',
            summary: `Created SID ${sidNumber}${siteName ? ` on ${siteName}` : ''}`,
            siteId,
            metadata: { site_id: siteId, sid_id: sidId, sid_number: sidNumber },
          });
        } catch (err) {
          console.warn('⚠️ Failed to log SID create activity:', err);
        }

        return res.status(201).json({
          success: true,
          data: {
            sid: {
              id: sidId,
              site_id: siteId,
              sid_number: sidNumber,
            },
          },
        } as ApiResponse);
      } catch (error) {
        try {
          await adapter.rollback();
        } catch {
          // ignore rollback failures
        }

        if (isDuplicateKeyError(error)) {
          return res.status(409).json({ success: false, error: 'Duplicate SID number' } as ApiResponse);
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: 'Validation failed', details: error.errors } as ApiResponse);
      }
      console.error('Create sid error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

/**
 * GET /api/sites/:id/sids/:sidId
 * Get a SID with notes and networking
 */
router.get(
  '/:id/sids/:sidId',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  async (req: Request, res: Response) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const { sidId } = sidIdSchema.parse(req.params);
      const adapter = getAdapter();

      const sidRows = await adapter.query(
        `SELECT
          s.*, 
          st.name as sid_type_name,
          dm.manufacturer as device_model_manufacturer,
          dm.name as device_model_name,
          dm.is_switch as device_model_is_switch,
          dm.default_switch_port_count as device_model_default_switch_port_count,
          cm.name as cpu_model_name,
          sp.name as platform_name,
          sl.floor as location_floor,
          sl.suite as location_suite,
          sl.\`row\` as location_row,
          sl.rack as location_rack,
          sl.area as location_area,
          sl.label as location_label,
          sl.template_type as location_template_type,
          CASE
            WHEN sl.id IS NULL THEN NULL
            ELSE COALESCE(NULLIF(TRIM(sl.label), ''), si.code)
          END as location_effective_label
        FROM sids s
        LEFT JOIN sid_types st ON st.id = s.sid_type_id
        LEFT JOIN sid_device_models dm ON dm.id = s.device_model_id
        LEFT JOIN sid_cpu_models cm ON cm.id = s.cpu_model_id
        LEFT JOIN sid_platforms sp ON sp.id = s.platform_id
        LEFT JOIN site_locations sl ON sl.id = s.location_id
        LEFT JOIN sites si ON si.id = s.site_id
        WHERE s.site_id = ? AND s.id = ?`,
        [siteId, sidId]
      );

      if (!sidRows.length) {
        return res.status(404).json({ success: false, error: 'SID not found' } as ApiResponse);
      }

      const sid = sidRows[0] as any;
      sid.ram_gb = normalizeRamGb(sid.ram_gb);
      sid.rack_u = normalizeRackU(sid.rack_u);

      const logViewParam = String((req.query as any)?.log_view ?? '').trim().toLowerCase();
      const shouldLogView = logViewParam === '' || (logViewParam !== '0' && logViewParam !== 'false');

      // Log SID open/view for Update History. Best-effort only.
      if (shouldLogView) {
        try {
          await logSidActivity({
            actorUserId: req.user!.userId,
            siteId,
            sidId,
            action: 'SID_VIEWED',
            summary: `Opened SID ${sid?.sid_number ?? sidId}${String(req.site?.name ?? '').trim() ? ` on ${String(req.site?.name ?? '').trim()}` : ''}`,
          });
        } catch {
          // ignore
        }
      }

      const noteRows = await adapter.query(
        `SELECT
          n.id,
          n.sid_id,
          n.created_by,
          u.username as created_by_username,
          u.email as created_by_email,
          n.type,
          n.note_text,
          n.pinned,
          n.pinned_at,
          n.pinned_by,
          n.created_at
        FROM sid_notes n
        LEFT JOIN users u ON u.id = n.created_by
        WHERE n.sid_id = ?
        ORDER BY n.pinned DESC, n.pinned_at DESC, n.created_at DESC`,
        [sidId]
      );

      const notes = noteRows.map(normalizeSidNoteRow);

      const nics = await adapter.query(
        `SELECT
          n.id,
          n.sid_id,
          n.card_name,
          n.name,
          n.mac_address,
          n.ip_address,
          n.site_vlan_id,
          v.vlan_id as vlan_id,
          v.name as vlan_name,
          n.nic_type_id,
          nt.name as nic_type_name,
          n.nic_speed_id,
          ns.name as nic_speed_name,
          c.switch_sid_id,
          sw.sid_number as switch_sid_number,
          sw.hostname as switch_hostname,
          sw.switch_port_count as switch_port_count,
          c.switch_port
        FROM sid_nics n
        LEFT JOIN site_vlans v ON v.id = n.site_vlan_id
        LEFT JOIN sid_nic_types nt ON nt.id = n.nic_type_id
        LEFT JOIN sid_nic_speeds ns ON ns.id = n.nic_speed_id
        LEFT JOIN sid_connections c ON c.nic_id = n.id
        LEFT JOIN sids sw ON sw.id = c.switch_sid_id
        WHERE n.sid_id = ?
        ORDER BY COALESCE(n.card_name, ''), n.name ASC`,
        [sidId]
      );

      return res.json({ success: true, data: { sid, notes, nics } } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: 'Validation failed', details: error.errors } as ApiResponse);
      }
      console.error('Get sid error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

/**
 * GET /api/sites/:id/sids/:sidId/history
 * Get SID Update History (meaningful field changes)
 */
router.get(
  '/:id/sids/:sidId/history',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  async (req: Request, res: Response) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const { sidId } = sidIdSchema.parse(req.params);
      const adapter = getAdapter();

      const sidExists = await adapter.query('SELECT id FROM sids WHERE id = ? AND site_id = ?', [sidId, siteId]);
      if (!sidExists.length) {
        return res.status(404).json({ success: false, error: 'SID not found' } as ApiResponse);
      }

      const rows = await adapter.query(
        `SELECT
          l.id,
          l.site_id,
          l.sid_id,
          l.actor_user_id,
          u.username as actor_username,
          u.email as actor_email,
          l.action,
          l.summary,
          l.diff_json,
          l.created_at
        FROM sid_activity_log l
        JOIN users u ON u.id = l.actor_user_id
        WHERE l.site_id = ? AND l.sid_id = ?
        ORDER BY l.created_at DESC
        LIMIT 500`,
        [siteId, sidId]
      );

      const excludedActions = new Set(['SID_VIEWED', 'SID_NOTE_ADDED', 'SID_NOTE_PINNED', 'SID_NOTE_UNPINNED', 'SID_CLOSING_NOTE']);
      const keepWithoutChanges = new Set(['SID_CREATED', 'SID_DELETED']);

      const getChangesFromDiff = (diffJson: any): any[] => {
        if (!diffJson) return [];
        try {
          const parsed = typeof diffJson === 'string' ? JSON.parse(diffJson) : diffJson;
          if (Array.isArray(parsed?.changes)) return parsed.changes;
          if (Array.isArray(parsed?.changes?.changes)) return parsed.changes.changes;
          return [];
        } catch {
          return [];
        }
      };

      const history = (rows as any[]).filter((row) => {
        const action = String(row?.action ?? '');
        if (excludedActions.has(action)) return false;
        if (keepWithoutChanges.has(action)) return true;

        const changes = getChangesFromDiff(row?.diff_json);
        return Array.isArray(changes) && changes.some((change) => change && typeof change.field === 'string');
      });

      return res.json({ success: true, data: { history } } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: 'Validation failed', details: error.errors } as ApiResponse);
      }
      console.error('Get SID history error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

/**
 * GET /api/sites/:id/sids/:sidId/password
 * Get OS login details metadata (password itself is never returned)
 */
router.get(
  '/:id/sids/:sidId/password',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req: Request, res: Response) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const { sidId } = sidIdSchema.parse(req.params);
      const adapter = getAdapter();

      const sidExists = await adapter.query('SELECT id FROM sids WHERE id = ? AND site_id = ?', [sidId, siteId]);
      if (!sidExists.length) {
        return res.status(404).json({ success: false, error: 'SID not found' } as ApiResponse);
      }

      const osTypeId = await getDefaultOsPasswordTypeId({ adapter, siteId });

      if (!osTypeId) {
        return res.json({
          success: true,
          data: {
            password: {
              sid_id: sidId,
              username: null,
              has_password: false,
              password_updated_at: null,
              password_updated_by: null,
              password_updated_by_username: null,
              password_updated_by_email: null,
              key_configured: hasSidSecretKeyConfigured(),
            },
          },
        } as ApiResponse);
      }

      const rows = await adapter.query(
        `SELECT
          p.sid_id,
          p.username,
          (p.password_ciphertext IS NOT NULL AND p.password_ciphertext <> '') as has_password,
          p.password_updated_at,
          p.password_updated_by,
          u.username as password_updated_by_username,
          u.email as password_updated_by_email
        FROM sid_passwords p
        LEFT JOIN users u ON u.id = p.password_updated_by
        WHERE p.sid_id = ? AND p.password_type_id = ?`,
        [sidId, osTypeId]
      );

      const row = rows[0] as any;
      return res.json({
        success: true,
        data: {
          password: {
            sid_id: sidId,
            username: row?.username ?? null,
            has_password: Boolean(row?.has_password),
            password_updated_at: row?.password_updated_at ?? null,
            password_updated_by: row?.password_updated_by ?? null,
            password_updated_by_username: row?.password_updated_by_username ?? null,
            password_updated_by_email: row?.password_updated_by_email ?? null,
            key_configured: hasSidSecretKeyConfigured(),
          },
        },
      } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: 'Validation failed', details: error.errors } as ApiResponse);
      }
      console.error('Get SID password error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

/**
 * GET /api/sites/:id/sids/:sidId/passwords
 * Get credential entries by password type.
 * Note: plaintext passwords are only returned to SITE_ADMIN users.
 */
router.get(
  '/:id/sids/:sidId/passwords',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req: Request, res: Response) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const { sidId } = sidIdSchema.parse(req.params);
      const adapter = getAdapter();

      const sidExists = await adapter.query('SELECT id FROM sids WHERE id = ? AND site_id = ?', [sidId, siteId]);
      if (!sidExists.length) {
        return res.status(404).json({ success: false, error: 'SID not found' } as ApiResponse);
      }

      const keyConfigured = hasSidSecretKeyConfigured();
      const rows = await adapter.query(
        `SELECT
          p.password_type_id,
          t.name as password_type_name,
          p.username,
          (p.password_ciphertext IS NOT NULL AND p.password_ciphertext <> '') as has_password,
          p.password_ciphertext,
          p.password_updated_at,
          p.password_updated_by,
          u.username as password_updated_by_username,
          u.email as password_updated_by_email
        FROM sid_passwords p
        JOIN sid_password_types t ON t.id = p.password_type_id
        LEFT JOIN users u ON u.id = p.password_updated_by
        WHERE p.sid_id = ?
        ORDER BY t.name ASC`,
        [sidId]
      );

      const passwords = (rows as any[]).map((r: any) => {
        const ciphertext = r?.password_ciphertext ?? null;
        let password: string | null = null;
        if (keyConfigured && ciphertext && String(ciphertext).trim() !== '') {
          try {
            password = decryptSidSecret(String(ciphertext));
          } catch {
            password = null;
          }
        }

        return {
          password_type_id: r?.password_type_id ?? null,
          password_type_name: r?.password_type_name ?? null,
          username: r?.username ?? null,
          has_password: Boolean(r?.has_password),
          password,
          password_updated_at: r?.password_updated_at ?? null,
          password_updated_by: r?.password_updated_by ?? null,
          password_updated_by_username: r?.password_updated_by_username ?? null,
          password_updated_by_email: r?.password_updated_by_email ?? null,
        };
      });

      return res.json({
        success: true,
        data: {
          passwords,
          key_configured: keyConfigured,
        },
      } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: 'Validation failed', details: error.errors } as ApiResponse);
      }
      console.error('Get SID passwords error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

/**
 * POST /api/sites/:id/sids/:sidId/passwords
 * Create a new credential entry (does not overwrite existing entries).
 */
router.post(
  '/:id/sids/:sidId/passwords',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req: Request, res: Response) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const { sidId } = sidIdSchema.parse(req.params);
      const body = createSidTypedPasswordSchema.parse(req.body);
      const adapter = getAdapter();

      if (!hasSidSecretKeyConfigured()) {
        return res.status(501).json({
          success: false,
          error: 'SID password encryption key is not configured',
          code: 'SID_PASSWORD_KEY_MISSING',
        } as any);
      }

      const sidRows = await adapter.query('SELECT id, sid_number, status FROM sids WHERE id = ? AND site_id = ?', [sidId, siteId]);
      const sidRow = sidRows[0] as any;
      if (!sidRow) {
        return res.status(404).json({ success: false, error: 'SID not found' } as ApiResponse);
      }

      if (isDeletedSidStatus(sidRow.status)) {
        return sidReadOnlyResponse(res);
      }

      const passwordTypeId = Number(body.password_type_id);
      await assertPicklistRowBelongsToSite({ adapter, table: 'sid_password_types', rowId: passwordTypeId, siteId });

      const typeRows = await adapter.query('SELECT id, name FROM sid_password_types WHERE id = ? AND site_id = ? LIMIT 1', [passwordTypeId, siteId]);
      const typeRow = typeRows[0] as any;
      const typeName = (typeRow?.name ?? 'Password').toString();

      const existingRows = await adapter.query(
        'SELECT sid_id, password_type_id FROM sid_passwords WHERE sid_id = ? AND password_type_id = ? LIMIT 1',
        [sidId, passwordTypeId]
      );
      if (existingRows.length) {
        return res.status(409).json({
          success: false,
          error: 'A password entry for that type already exists. Edit the existing password instead.',
          code: 'SID_PASSWORD_EXISTS',
        } as any);
      }

      const username = normalizePasswordUsername(body.username);
      if (!username) {
        return res.status(400).json({ success: false, error: 'Username is required' } as ApiResponse);
      }

      const passwordToStore = encryptSidSecret(String(body.password));

      await adapter.execute(
        `INSERT INTO sid_passwords (sid_id, password_type_id, username, password_ciphertext, password_updated_by, password_updated_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
        [sidId, passwordTypeId, username, passwordToStore, req.user!.userId]
      );

      try {
        const passwordChanges: Array<{ field: string; from: string; to: string }> = [
          { field: 'Password Type', from: '—', to: typeName },
          { field: `Username (${typeName})`, from: '—', to: username },
          { field: `Password (${typeName})`, from: 'Empty', to: 'Set' },
        ];

        await logSidActivity({
          actorUserId: req.user!.userId,
          siteId,
          sidId,
          action: 'SID_PASSWORD_UPDATED',
          summary: `Added ${typeName} for SID ${sidRow.sid_number}${String(req.site?.name ?? '').trim() ? ` on ${String(req.site?.name ?? '').trim()}` : ''}`,
          diff: {
            password_type_id: passwordTypeId,
            password_type_name: typeName,
            username_to: username,
            password_changed: true,
            changes: passwordChanges,
          },
        });
      } catch {
        // ignore
      }

      return res.status(201).json({ success: true, data: { created: true } } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: 'Validation failed', details: error.errors } as ApiResponse);
      }
      if (error instanceof Error && error.message === 'Not found') {
        return res.status(404).json({ success: false, error: 'Not found' } as ApiResponse);
      }
      console.error('Create SID typed password error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

/**
 * PUT /api/sites/:id/sids/:sidId/password
 * Update OS login details (encrypted at rest)
 */
router.put(
  '/:id/sids/:sidId/password',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req: Request, res: Response) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const { sidId } = sidIdSchema.parse(req.params);
      const body = updateSidPasswordSchema.parse(req.body);
      const adapter = getAdapter();

      const sidRows = await adapter.query('SELECT id, sid_number, status FROM sids WHERE id = ? AND site_id = ?', [sidId, siteId]);
      const sidRow = sidRows[0] as any;
      if (!sidRow) {
        return res.status(404).json({ success: false, error: 'SID not found' } as ApiResponse);
      }

      if (isDeletedSidStatus(sidRow.status)) {
        return sidReadOnlyResponse(res);
      }

      const osTypeId = await getDefaultOsPasswordTypeId({ adapter, siteId });
      if (!osTypeId) {
        return res.status(400).json({
          success: false,
          error: "Default password type 'OS Credentials' is not configured",
          code: 'OS_PASSWORD_TYPE_MISSING',
        } as any);
      }
      const existingRows = osTypeId
        ? await adapter.query(
            'SELECT sid_id, username, password_ciphertext FROM sid_passwords WHERE sid_id = ? AND password_type_id = ?',
            [sidId, osTypeId]
          )
        : [];
      const existing = existingRows[0] as any | undefined;

      const nextUsername =
        body.username === undefined
          ? (existing?.username ?? null)
          : body.username === ''
            ? null
            : normalizePasswordUsername(body.username);

      const existingCiphertext = existing?.password_ciphertext ?? null;

      const wantsSetPassword = typeof body.password === 'string' && body.password.trim() !== '';
      const wantsClearPassword = body.password === null;
      const wantsNoPasswordChange = body.password === undefined || body.password === '';

      if (wantsSetPassword && !hasSidSecretKeyConfigured()) {
        return res.status(501).json({
          success: false,
          error: 'SID password encryption key is not configured',
          code: 'SID_PASSWORD_KEY_MISSING',
        } as any);
      }

      const passwordToStore =
        wantsSetPassword
          ? encryptSidSecret(String(body.password))
          : wantsClearPassword
            ? null
            : wantsNoPasswordChange
              ? existingCiphertext
              : existingCiphertext;

      const passwordChanged = wantsSetPassword || wantsClearPassword;
      const previousUsername = existing?.username ?? null;

      // Legacy endpoint maps to OS Credentials.
      await adapter.execute(
        `INSERT INTO sid_passwords (sid_id, password_type_id, username, password_ciphertext, password_updated_by, password_updated_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE
           username = VALUES(username),
           password_ciphertext = VALUES(password_ciphertext),
           password_updated_by = VALUES(password_updated_by),
           password_updated_at = VALUES(password_updated_at)`,
        [sidId, osTypeId, nextUsername, passwordToStore, req.user!.userId]
      );

      try {
        const passwordChanges: Array<{ field: string; from: string; to: string }> = [];
        const nextUsernameText = nextUsername ?? null;
        if ((previousUsername ?? null) !== (nextUsernameText ?? null)) {
          passwordChanges.push({
            field: 'Username (OS Credentials)',
            from: previousUsername == null || String(previousUsername).trim() === '' ? '—' : String(previousUsername),
            to: nextUsernameText == null || String(nextUsernameText).trim() === '' ? '—' : String(nextUsernameText),
          });
        }

        if (passwordChanged) {
          const hadPassword = existingCiphertext !== null && String(existingCiphertext).trim() !== '';
          const fromState = hadPassword ? 'Set' : 'Empty';
          const toState = wantsClearPassword ? 'Empty' : hadPassword ? 'Updated' : 'Set';
          passwordChanges.push({ field: 'Password (OS Credentials)', from: fromState, to: toState });
        }

        if (passwordChanges.length > 0) {
          await logSidActivity({
            actorUserId: req.user!.userId,
            siteId,
            sidId,
            action: 'SID_PASSWORD_UPDATED',
            summary: `Updated OS login details for SID ${sidRow.sid_number}${String(req.site?.name ?? '').trim() ? ` on ${String(req.site?.name ?? '').trim()}` : ''}`,
            diff: {
              username_from: existing?.username ?? null,
              username_to: nextUsername ?? null,
              password_changed: passwordChanged,
              changes: passwordChanges,
            },
          });
        }
      } catch {
        // ignore
      }

      return res.json({ success: true, data: { updated: true } } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: 'Validation failed', details: error.errors } as ApiResponse);
      }
      console.error('Update SID password error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

/**
 * PUT /api/sites/:id/sids/:sidId/passwords/:passwordTypeId
 * Upsert credential entry for a specific password type
 */
router.put(
  '/:id/sids/:sidId/passwords/:passwordTypeId',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req: Request, res: Response) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const { sidId } = sidIdSchema.parse(req.params);
      const { passwordTypeId } = passwordTypeIdSchema.parse(req.params);
      const body = updateSidPasswordSchema.parse(req.body);
      const adapter = getAdapter();

      const sidRows = await adapter.query('SELECT id, sid_number, status FROM sids WHERE id = ? AND site_id = ?', [sidId, siteId]);
      const sidRow = sidRows[0] as any;
      if (!sidRow) {
        return res.status(404).json({ success: false, error: 'SID not found' } as ApiResponse);
      }

      if (isDeletedSidStatus(sidRow.status)) {
        return sidReadOnlyResponse(res);
      }

      await assertPicklistRowBelongsToSite({ adapter, table: 'sid_password_types', rowId: passwordTypeId, siteId });

      const typeRows = await adapter.query('SELECT id, name FROM sid_password_types WHERE id = ? AND site_id = ? LIMIT 1', [passwordTypeId, siteId]);
      const typeRow = typeRows[0] as any;
      const typeName = (typeRow?.name ?? 'Password').toString();

      const existingRows = await adapter.query(
        'SELECT sid_id, password_type_id, username, password_ciphertext FROM sid_passwords WHERE sid_id = ? AND password_type_id = ?',
        [sidId, passwordTypeId]
      );
      const existing = existingRows[0] as any | undefined;

      const nextUsername =
        body.username === undefined
          ? (existing?.username ?? null)
          : body.username === ''
            ? null
            : normalizePasswordUsername(body.username);

      const existingCiphertext = existing?.password_ciphertext ?? null;

      const wantsSetPassword = typeof body.password === 'string' && body.password.trim() !== '';
      const wantsClearPassword = body.password === null;
      const wantsNoPasswordChange = body.password === undefined || body.password === '';

      if (wantsSetPassword && !hasSidSecretKeyConfigured()) {
        return res.status(501).json({
          success: false,
          error: 'SID password encryption key is not configured',
          code: 'SID_PASSWORD_KEY_MISSING',
        } as any);
      }

      const passwordToStore =
        wantsSetPassword
          ? encryptSidSecret(String(body.password))
          : wantsClearPassword
            ? null
            : wantsNoPasswordChange
              ? existingCiphertext
              : existingCiphertext;

      const passwordChanged = wantsSetPassword || wantsClearPassword;
      const previousUsername = existing?.username ?? null;

      await adapter.execute(
        `INSERT INTO sid_passwords (sid_id, password_type_id, username, password_ciphertext, password_updated_by, password_updated_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE
           username = VALUES(username),
           password_ciphertext = VALUES(password_ciphertext),
           password_updated_by = VALUES(password_updated_by),
           password_updated_at = VALUES(password_updated_at)`,
        [sidId, passwordTypeId, nextUsername, passwordToStore, req.user!.userId]
      );

      try {
        const passwordChanges: Array<{ field: string; from: string; to: string }> = [];
        const nextUsernameText = nextUsername ?? null;
        if ((previousUsername ?? null) !== (nextUsernameText ?? null)) {
          passwordChanges.push({
            field: `Username (${typeName})`,
            from: previousUsername == null || String(previousUsername).trim() === '' ? '—' : String(previousUsername),
            to: nextUsernameText == null || String(nextUsernameText).trim() === '' ? '—' : String(nextUsernameText),
          });
        }

        if (passwordChanged) {
          const hadPassword = existingCiphertext !== null && String(existingCiphertext).trim() !== '';
          const fromState = hadPassword ? 'Set' : 'Empty';
          const toState = wantsClearPassword ? 'Empty' : hadPassword ? 'Updated' : 'Set';
          passwordChanges.push({ field: `Password (${typeName})`, from: fromState, to: toState });
        }

        if (!existing) {
          passwordChanges.unshift({ field: 'Credential', from: 'Missing', to: `Created (${typeName})` });
        }

        if (passwordChanges.length > 0) {
          await logSidActivity({
            actorUserId: req.user!.userId,
            siteId,
            sidId,
            action: 'SID_PASSWORD_UPDATED',
            summary: `Updated ${typeName} for SID ${sidRow.sid_number}${String(req.site?.name ?? '').trim() ? ` on ${String(req.site?.name ?? '').trim()}` : ''}`,
            diff: {
              password_type_id: passwordTypeId,
              password_type_name: typeName,
              username_from: existing?.username ?? null,
              username_to: nextUsername ?? null,
              password_changed: passwordChanged,
              changes: passwordChanges,
            },
          });
        }
      } catch {
        // ignore
      }

      return res.json({ success: true, data: { updated: true } } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: 'Validation failed', details: error.errors } as ApiResponse);
      }
      if (error instanceof Error && error.message === 'Not found') {
        return res.status(404).json({ success: false, error: 'Not found' } as ApiResponse);
      }
      console.error('Update SID typed password error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

/**
 * PUT /api/sites/:id/sids/:sidId
 * Update SID fields
 */
router.put(
  '/:id/sids/:sidId',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req: Request, res: Response) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const { sidId } = sidIdSchema.parse(req.params);
      const parsedBody = updateSidSchema.parse(req.body);
      const body: Record<string, any> = { ...parsedBody };
      const adapter = getAdapter();

      if (typeof body.status === 'string' && body.status.trim().toLowerCase() === 'deleted') {
        return res.status(400).json({
          success: false,
          error: 'Status "Deleted" can only be set by deleting a SID',
        } as ApiResponse);
      }

      try {
        if (body.status !== undefined && body.status !== null) {
          await assertSidStatusNameBelongsToSite({ adapter, siteId, statusName: body.status });
        }
      } catch (error) {
        if (error instanceof Error && error.message === 'Invalid status') {
          return res.status(400).json({ success: false, error: 'Invalid status' } as ApiResponse);
        }
        throw error;
      }

      const existingRows = await adapter.query('SELECT * FROM sids WHERE id = ? AND site_id = ?', [sidId, siteId]);
      const existing = existingRows[0] as any;
      if (!existing) {
        return res.status(404).json({ success: false, error: 'SID not found' } as ApiResponse);
      }

      if (Object.prototype.hasOwnProperty.call(body, 'device_model_id') && body.switch_port_count === undefined) {
        const nextDeviceModelId = body.device_model_id;
        if (!nextDeviceModelId) {
          body.switch_port_count = null;
        } else {
          const modelRows = await adapter.query(
            'SELECT is_switch, default_switch_port_count FROM sid_device_models WHERE id = ? AND site_id = ? LIMIT 1',
            [nextDeviceModelId, siteId]
          );
          const model = (modelRows?.[0] as any) ?? null;
          const modelIsSwitch = Number(model?.is_switch ?? 0) === 1 || model?.is_switch === true;
          if (!modelIsSwitch) {
            body.switch_port_count = null;
          } else {
            const defaultPorts = Number(model?.default_switch_port_count ?? 0);
            body.switch_port_count = Number.isFinite(defaultPorts) && defaultPorts > 0 ? defaultPorts : null;
          }
        }
      }

      if (isDeletedSidStatus(existing.status)) {
        return sidReadOnlyResponse(res);
      }

      const fields: string[] = [];
      const params: any[] = [];

      for (const [key, value] of Object.entries(body)) {
        if (value === undefined) continue;
        fields.push(`${key} = ?`);
        if (key === 'sid_number' && typeof value === 'string') {
          params.push(value.trim());
        } else if ((key === 'primary_ip' || key === 'subnet_ip' || key === 'gateway_ip') && typeof value === 'string') {
          const cleaned = value.trim();
          params.push(cleaned === '' ? null : cleaned);
        } else if (key === 'rack_u') {
          params.push(normalizeRackU(value));
        } else {
          params.push(value);
        }
      }

      if (!fields.length) {
        return res.json({ success: true, data: { sid: existing } } as ApiResponse);
      }

      const changes: Array<{ field: string; from: any; to: any }> = [];
      for (const [key, value] of Object.entries(body)) {
        if (value === undefined) continue;

        const nextValue =
          key === 'sid_number' && typeof value === 'string'
            ? value.trim()
            : (key === 'primary_ip' || key === 'subnet_ip' || key === 'gateway_ip') && typeof value === 'string'
              ? value.trim() === ''
                ? null
                : value.trim()
            : key === 'pdu_power' && typeof value === 'string'
              ? value.trim() === ''
                ? null
                : value.trim()
            : key === 'rack_u'
              ? normalizeRackU(value)
              : value;
        const before = (existing as any)[key];

        if (key === 'ram_gb') {
          const beforeNum = normalizeRamGb(before);
          const afterNum = normalizeRamGb(nextValue);
          if (beforeNum !== null && afterNum !== null && Math.abs(beforeNum - afterNum) < 1e-9) {
            continue;
          }
          if (beforeNum === null && (afterNum === null || afterNum === 0)) {
            // keep existing string-normalization behavior for null-ish
          }
        }

        const beforeNorm = before === undefined ? null : before === null ? null : String(before);
        const afterNorm = nextValue === undefined ? null : nextValue === null ? null : String(nextValue);
        if (beforeNorm === afterNorm) continue;

        changes.push({ field: key, from: before, to: nextValue });
      }

      // Make location changes readable in Update History.
      // Frontend renders `field: from → to`, so we convert location_id into a formatted path.
      const locationChange = changes.find((c) => c.field === 'location_id');
      if (locationChange) {
        const formatLocationRow = (row: any): string => {
          const label = String(row?.effective_label ?? row?.label ?? '').trim();
          const floor = String(row?.floor ?? '').trim();
          const suite = row?.suite === null || row?.suite === undefined ? '' : String(row.suite).trim();
          const area = row?.area === null || row?.area === undefined ? '' : String(row.area).trim();
          const rowKey = row?.row === null || row?.row === undefined ? '' : String(row.row).trim();
          const rack = row?.rack === null || row?.rack === undefined ? '' : String(row.rack).trim();

          const parts: string[] = [];
          if (label) parts.push(label);
          if (floor) parts.push(`Floor: ${floor}`);
          if (suite) parts.push(`Suite: ${suite}`);
          if (area) parts.push(`Area: ${area}`);
          if (rowKey) parts.push(`Row: ${rowKey}`);
          if (rack) parts.push(`Rack: ${rack}`);
          return parts.join(' | ');
        };

        const ids: number[] = [];
        const fromId = locationChange.from == null ? null : Number(locationChange.from);
        const toId = locationChange.to == null ? null : Number(locationChange.to);
        if (Number.isFinite(fromId as any) && (fromId as number) > 0) ids.push(fromId as number);
        if (Number.isFinite(toId as any) && (toId as number) > 0 && toId !== fromId) ids.push(toId as number);

        const byId = new Map<number, any>();
        if (ids.length) {
          try {
            const rows = await adapter.query(
              `SELECT
                 sl.id,
                 sl.template_type,
                 sl.floor,
                 sl.suite,
                 sl.\`row\` as \`row\`,
                 sl.rack,
                 sl.area,
                 sl.label,
                 COALESCE(NULLIF(TRIM(sl.label), ''), s.code) AS effective_label
               FROM site_locations sl
               JOIN sites s ON s.id = sl.site_id
               WHERE sl.site_id = ? AND sl.id IN (${ids.map(() => '?').join(',')})`,
              [siteId, ...ids]
            );
            for (const r of rows) {
              byId.set(Number((r as any).id), r);
            }
          } catch {
            // ignore
          }
        }

        const fromText =
          fromId === null || !Number.isFinite(fromId)
            ? '—'
            : byId.has(fromId)
              ? formatLocationRow(byId.get(fromId))
              : `#${fromId}`;
        const toText =
          toId === null || !Number.isFinite(toId)
            ? '—'
            : byId.has(toId)
              ? formatLocationRow(byId.get(toId))
              : `#${toId}`;

        locationChange.field = 'location';
        locationChange.from = fromText;
        locationChange.to = toText;
      }

      try {
        await adapter.execute(`UPDATE sids SET ${fields.join(', ')} WHERE id = ? AND site_id = ?`, [...params, sidId, siteId]);
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          return res.status(409).json({ success: false, error: 'Duplicate SID number' } as ApiResponse);
        }
        throw error;
      }

      const siteName = String(req.site?.name ?? '').trim();
      const sidUpdateSummary = `Updated SID ${existing.sid_number}${siteName ? ` on ${siteName}` : ''}`;
      const sidUpdateRemovedSummary = `Removed details from SID ${existing.sid_number}${siteName ? ` on ${siteName}` : ''}`;
      const sidUpdateAddedSummary = `Added details to SID ${existing.sid_number}${siteName ? ` on ${siteName}` : ''}`;

      try {
        await logActivity({
          actorUserId: req.user!.userId,
          action: 'SID_UPDATED',
          summary: sidUpdateSummary,
          siteId,
          metadata: { site_id: siteId, sid_id: sidId },
        });
      } catch (err) {
        console.warn('⚠️ Failed to log SID update activity:', err);
      }

      // SID-specific history (includes field-level diffs)
      if (changes.length > 0) {
        try {
          const isEmptySidValue = (value: unknown): boolean => {
            if (value === null || value === undefined) return true;
            if (typeof value === 'string') return value.trim() === '';
            return false;
          };

          const removedChanges = changes.filter((change) => !isEmptySidValue(change.from) && isEmptySidValue(change.to));
          const addedChanges = changes.filter((change) => isEmptySidValue(change.from) && !isEmptySidValue(change.to));
          const updatedChanges = changes.filter(
            (change) => !removedChanges.includes(change) && !addedChanges.includes(change)
          );

          if (removedChanges.length > 0) {
            await logSidActivity({
              actorUserId: req.user!.userId,
              siteId,
              sidId,
              action: 'SID_UPDATED',
              summary: sidUpdateRemovedSummary,
              diff: { changes: removedChanges },
            });
          }

          if (addedChanges.length > 0) {
            await logSidActivity({
              actorUserId: req.user!.userId,
              siteId,
              sidId,
              action: 'SID_UPDATED',
              summary: sidUpdateAddedSummary,
              diff: { changes: addedChanges },
            });
          }

          if (updatedChanges.length > 0) {
            await logSidActivity({
              actorUserId: req.user!.userId,
              siteId,
              sidId,
              action: 'SID_UPDATED',
              summary: sidUpdateSummary,
              diff: { changes: updatedChanges },
            });
          }
        } catch {
          // ignore
        }
      }

      const updated = await adapter.query('SELECT * FROM sids WHERE id = ? AND site_id = ?', [sidId, siteId]);
      const updatedSid = updated[0] as any;
      if (updatedSid) {
        updatedSid.ram_gb = normalizeRamGb(updatedSid.ram_gb);
        updatedSid.rack_u = normalizeRackU(updatedSid.rack_u);
      }
      return res.json({ success: true, data: { sid: updatedSid } } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: 'Validation failed', details: error.errors } as ApiResponse);
      }
      console.error('Update sid error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

/**
 * DELETE /api/sites/:id/sids/:sidId
 */
router.delete(
  '/:id/sids/:sidId',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req: Request, res: Response) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const { sidId } = sidIdSchema.parse(req.params);
      const adapter = getAdapter();

      const existing = await adapter.query(
        `SELECT s.id, s.sid_number, s.status, st.name AS site_name
         FROM sids s
         JOIN sites st ON st.id = s.site_id
         WHERE s.id = ? AND s.site_id = ?
         LIMIT 1`,
        [sidId, siteId]
      );
      const sidRow = existing[0] as any;
      if (!sidRow) {
        return res.status(404).json({ success: false, error: 'SID not found' } as ApiResponse);
      }

      if (!isDeletedSidStatus(sidRow.status)) {
        // Ensure the Deleted status exists for this site.
        await adapter.execute(
          `INSERT INTO sid_statuses (site_id, name, description)
           VALUES (?, 'Deleted', NULL)
           ON DUPLICATE KEY UPDATE name = name`,
          [siteId]
        );

        await adapter.execute(
          "UPDATE sids SET status = 'Deleted', updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND site_id = ?",
          [sidId, siteId]
        );

        const deleteSummary = `Deleted SID ${sidRow.sid_number}${String(sidRow.site_name ?? '').trim() ? ` on ${String(sidRow.site_name ?? '').trim()}` : ''}`;

        try {
          await logSidActivity({
            actorUserId: req.user!.userId,
            siteId,
            sidId,
            action: 'SID_DELETED',
            summary: deleteSummary,
            diff: { status_to: 'Deleted' },
          });
        } catch {
          // ignore
        }

        try {
          await logActivity({
            actorUserId: req.user!.userId,
            action: 'SID_DELETED',
            summary: deleteSummary,
            siteId,
            metadata: { site_id: siteId, sid_id: sidId, sid_number: sidRow.sid_number },
          });
        } catch (err) {
          console.warn('⚠️ Failed to log SID delete activity:', err);
        }

        return res.json({ success: true, data: { deleted: true } } as ApiResponse);
      }

      const deleteSummary = `Deleted SID ${sidRow.sid_number}${String(sidRow.site_name ?? '').trim() ? ` on ${String(sidRow.site_name ?? '').trim()}` : ''}`;

      try {
        await logActivity({
          actorUserId: req.user!.userId,
          action: 'SID_DELETED',
          summary: deleteSummary,
          siteId,
          metadata: { site_id: siteId, sid_id: sidId, sid_number: sidRow.sid_number },
        });
      } catch (err) {
        console.warn('⚠️ Failed to log SID delete activity:', err);
      }

      return res.json({ success: true, data: { deleted: true } } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: 'Validation failed', details: error.errors } as ApiResponse);
      }
      console.error('Delete sid error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

/**
 * POST /api/sites/:id/sids/:sidId/notes
 */
router.post(
  '/:id/sids/:sidId/notes',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  async (req: Request, res: Response) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const { sidId } = sidIdSchema.parse(req.params);
      const body = createSidNoteSchema.parse(req.body);
      const adapter = getAdapter();

      const existing = await adapter.query('SELECT id, sid_number, status FROM sids WHERE id = ? AND site_id = ? LIMIT 1', [sidId, siteId]);
      const sidRow = existing[0] as any;
      if (!sidRow) {
        return res.status(404).json({ success: false, error: 'SID not found' } as ApiResponse);
      }

      if (isDeletedSidStatus(sidRow.status)) {
        return sidReadOnlyResponse(res);
      }

      const type = body.type ?? 'NOTE';

      const insert = await adapter.execute(
        'INSERT INTO sid_notes (sid_id, created_by, type, note_text) VALUES (?, ?, ?, ?)',
        [sidId, req.user!.userId, type, body.note_text]
      );

      const noteId = Number(insert.insertId ?? adapter.getLastInsertId());
      const siteName = String(sidRow.site_name ?? '').trim();
      const summary = `${type === 'CLOSING' ? 'Added closing note' : 'Added note'} for SID ${sidRow.sid_number}${siteName ? ` on ${siteName}` : ''}`;

      try {
        await logActivity({
          actorUserId: req.user!.userId,
          action: type === 'CLOSING' ? 'SID_CLOSING_NOTE' : 'SID_NOTE_ADDED',
          summary,
          siteId,
          metadata: { site_id: siteId, sid_id: sidId, note_id: noteId, note_type: type },
        });
      } catch (err) {
        console.warn('⚠️ Failed to log SID note activity:', err);
      }

      const noteRows = await adapter.query(
        `SELECT n.id, n.sid_id, n.created_by, u.username as created_by_username, u.email as created_by_email, n.type, n.note_text, n.pinned, n.pinned_at, n.pinned_by, n.created_at
         FROM sid_notes n JOIN users u ON u.id = n.created_by
         WHERE n.id = ?`,
        [noteId]
      );

      return res.status(201).json({ success: true, data: { note: normalizeSidNoteRow(noteRows[0]) } } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: 'Validation failed', details: error.errors } as ApiResponse);
      }
      console.error('Create sid note error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

/**
 * PATCH /api/sites/:id/sids/:sidId/notes/:noteId/pin
 * Pin/unpin a SID note.
 * - Users can pin only their own notes (unless SITE_ADMIN)
 * - Only SITE_ADMIN can unpin
 */
router.patch(
  '/:id/sids/:sidId/notes/:noteId/pin',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  async (req: Request, res: Response) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const { sidId } = sidIdSchema.parse(req.params);
      const { noteId } = sidNoteIdSchema.parse(req.params);
      const body = setSidNotePinnedSchema.parse(req.body);
      const adapter = getAdapter();

      const rows = await adapter.query(
        `SELECT n.id, n.sid_id, n.created_by, n.pinned, s.status as sid_status
         FROM sid_notes n
         JOIN sids s ON s.id = n.sid_id
         WHERE n.id = ? AND n.sid_id = ? AND s.site_id = ?`,
        [noteId, sidId, siteId]
      );

      const note = rows[0] as any;
      if (!note) {
        return res.status(404).json({ success: false, error: 'Note not found' } as ApiResponse);
      }

      if (isDeletedSidStatus(note.sid_status)) {
        return sidReadOnlyResponse(res);
      }

      const isAdmin = req.siteRole === 'SITE_ADMIN';

      if (body.pinned) {
        if (!isAdmin && Number(note.created_by) !== Number(req.user!.userId)) {
          return res.status(403).json({ success: false, error: 'Insufficient permissions' } as ApiResponse);
        }
      } else {
        if (!isAdmin) {
          return res.status(403).json({ success: false, error: 'Site admin access required' } as ApiResponse);
        }
      }

      if (body.pinned) {
        await adapter.execute(
          `UPDATE sid_notes
           SET pinned = 1, pinned_at = CURRENT_TIMESTAMP(3), pinned_by = ?
           WHERE id = ?`,
          [req.user!.userId, noteId]
        );

        try {
          const pinChanges = [
            { field: 'Pinned', from: Boolean(note.pinned) ? 'Yes' : 'No', to: 'Yes' },
          ];

          await logSidActivity({
            actorUserId: req.user!.userId,
            siteId,
            sidId,
            action: 'SID_NOTE_PINNED',
            summary: `Pinned a note for SID ${sidId}${String(req.site?.name ?? '').trim() ? ` on ${String(req.site?.name ?? '').trim()}` : ''}`,
            diff: { note_id: noteId, changes: pinChanges },
          });
        } catch {
          // ignore
        }
      } else {
        await adapter.execute(
          `UPDATE sid_notes
           SET pinned = 0, pinned_at = NULL, pinned_by = NULL
           WHERE id = ?`,
          [noteId]
        );

        try {
          const pinChanges = [
            { field: 'Pinned', from: Boolean(note.pinned) ? 'Yes' : 'No', to: 'No' },
          ];

          await logSidActivity({
            actorUserId: req.user!.userId,
            siteId,
            sidId,
            action: 'SID_NOTE_UNPINNED',
            summary: `Unpinned a note for SID ${sidId}${String(req.site?.name ?? '').trim() ? ` on ${String(req.site?.name ?? '').trim()}` : ''}`,
            diff: { note_id: noteId, changes: pinChanges },
          });
        } catch {
          // ignore
        }
      }

      const noteRows = await adapter.query(
        `SELECT n.id, n.sid_id, n.created_by, u.username as created_by_username, u.email as created_by_email, n.type, n.note_text, n.pinned, n.pinned_at, n.pinned_by, n.created_at
         FROM sid_notes n
         JOIN users u ON u.id = n.created_by
         WHERE n.id = ?`,
        [noteId]
      );

      return res.json({ success: true, data: { note: normalizeSidNoteRow(noteRows[0]) } } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: 'Validation failed', details: error.errors } as ApiResponse);
      }
      console.error('Set sid note pinned error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

/**
 * PUT /api/sites/:id/sids/:sidId/nics
 * Replace NIC list (and switch connections)
 */
router.put(
  '/:id/sids/:sidId/nics',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req: Request, res: Response) => {
    const adapter = getAdapter();
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const { sidId } = sidIdSchema.parse(req.params);
      const body = replaceSidNicsSchema.parse(req.body);

      const sidRow = await getSidRowForWrite({ adapter, siteId, sidId });
      if (!sidRow) {
        return res.status(404).json({ success: false, error: 'SID not found' } as ApiResponse);
      }

      if (isDeletedSidStatus(sidRow.status)) {
        return sidReadOnlyResponse(res);
      }

      const previousNics = await adapter.query(
        `SELECT
          n.id,
          n.sid_id,
          n.card_name,
          n.name,
          n.mac_address,
          n.ip_address,
          n.site_vlan_id,
          v.vlan_id as vlan_id,
          v.name as vlan_name,
          n.nic_type_id,
          nt.name as nic_type_name,
          n.nic_speed_id,
          ns.name as nic_speed_name,
          c.switch_sid_id,
          sw.sid_number as switch_sid_number,
          sw.hostname as switch_hostname,
          sw.switch_port_count as switch_port_count,
          c.switch_port
        FROM sid_nics n
        LEFT JOIN site_vlans v ON v.id = n.site_vlan_id
        LEFT JOIN sid_nic_types nt ON nt.id = n.nic_type_id
        LEFT JOIN sid_nic_speeds ns ON ns.id = n.nic_speed_id
        LEFT JOIN sid_connections c ON c.nic_id = n.id
        LEFT JOIN sids sw ON sw.id = c.switch_sid_id
        WHERE n.sid_id = ?
        ORDER BY COALESCE(n.card_name, ''), n.name ASC`,
        [sidId]
      );

      // Validate referenced switch SIDs belong to the same site
      const switchIds = Array.from(
        new Set(
          body.nics
            .map(n => n.switch_sid_id)
            .filter((v): v is number => Number.isFinite(v as any) && (v as any) > 0)
        )
      );
      if (switchIds.length) {
        const rows = await adapter.query(
          `SELECT id FROM sids WHERE site_id = ? AND id IN (${switchIds.map(() => '?').join(',')})`,
          [siteId, ...switchIds]
        );
        const found = new Set(rows.map((r: any) => Number(r.id)));
        const missing = switchIds.filter(id => !found.has(id));
        if (missing.length) {
          return res.status(400).json({ success: false, error: 'Invalid switch SID', details: { missing } } as ApiResponse);
        }
      }

      await adapter.beginTransaction();
      try {
        // Remove old connections and nics
        await adapter.execute('DELETE FROM sid_connections WHERE sid_id = ? AND site_id = ?', [sidId, siteId]);
        await adapter.execute('DELETE FROM sid_nics WHERE sid_id = ?', [sidId]);

        for (const nic of body.nics) {
          const cardName = (nic as any).card_name === '' ? null : ((nic as any).card_name ?? null);
          const inserted = await adapter.execute(
            'INSERT INTO sid_nics (sid_id, card_name, name, mac_address, ip_address, site_vlan_id, nic_type_id, nic_speed_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [
              sidId,
              cardName,
              nic.name,
              nic.mac_address ?? null,
              nic.ip_address ?? null,
              nic.site_vlan_id ?? null,
              (nic as any).nic_type_id ?? null,
              (nic as any).nic_speed_id ?? null,
            ]
          );
          const nicId = Number(inserted.insertId ?? adapter.getLastInsertId());

          if (nic.switch_sid_id && nic.switch_port) {
            const port = nic.switch_port.trim();
            if (port) {
              try {
                await adapter.execute(
                  'INSERT INTO sid_connections (site_id, sid_id, nic_id, switch_sid_id, switch_port) VALUES (?, ?, ?, ?, ?)',
                  [siteId, sidId, nicId, nic.switch_sid_id, port]
                );
              } catch (error) {
                if (isDuplicateKeyError(error)) {
                  const err: any = new Error('SWITCH_PORT_IN_USE');
                  err.kind = 'SWITCH_PORT_IN_USE';
                  err.details = { switch_sid_id: nic.switch_sid_id, switch_port: port };
                  throw err;
                }
                throw error;
              }
            }
          }
        }

        await adapter.commit();
      } catch (error) {
        await adapter.rollback();
        if ((error as any)?.kind === 'SWITCH_PORT_IN_USE') {
          return res.status(409).json({
            success: false,
            error: 'Switch port already in use',
            code: 'SWITCH_PORT_IN_USE',
            details: (error as any).details,
          } as any);
        }
        throw error;
      }

      const nics = await adapter.query(
        `SELECT
          n.id,
          n.sid_id,
          n.card_name,
          n.name,
          n.mac_address,
          n.ip_address,
          n.site_vlan_id,
          v.vlan_id as vlan_id,
          v.name as vlan_name,
          n.nic_type_id,
          nt.name as nic_type_name,
          n.nic_speed_id,
          ns.name as nic_speed_name,
          c.switch_sid_id,
          sw.sid_number as switch_sid_number,
          sw.hostname as switch_hostname,
          sw.switch_port_count as switch_port_count,
          c.switch_port
        FROM sid_nics n
        LEFT JOIN site_vlans v ON v.id = n.site_vlan_id
        LEFT JOIN sid_nic_types nt ON nt.id = n.nic_type_id
        LEFT JOIN sid_nic_speeds ns ON ns.id = n.nic_speed_id
        LEFT JOIN sid_connections c ON c.nic_id = n.id
        LEFT JOIN sids sw ON sw.id = c.switch_sid_id
        WHERE n.sid_id = ?
        ORDER BY COALESCE(n.card_name, ''), n.name ASC`,
        [sidId]
      );

      const normalizeNicValue = (value: any): string => {
        if (value === null || value === undefined) return '—';
        const text = String(value).trim();
        return text === '' ? '—' : text;
      };

      const nicCardDisplay = (value: any): string => {
        const text = String(value ?? '').trim();
        return text === '' ? 'On-Board Network Card' : text;
      };

      const toNicModel = (row: any) => ({
        card: nicCardDisplay(row?.card_name),
        name: normalizeNicValue(row?.name),
        mac: normalizeNicValue(row?.mac_address),
        ip: normalizeNicValue(row?.ip_address),
        vlan: row?.vlan_id === null || row?.vlan_id === undefined ? '—' : String(row.vlan_id),
        nicType: normalizeNicValue(row?.nic_type_name),
        nicSpeed: normalizeNicValue(row?.nic_speed_name),
        switchSid: normalizeNicValue(row?.switch_sid_number),
        switchPort: normalizeNicValue(row?.switch_port),
      });

      const keyWithOrdinal = (rows: any[]) => {
        const keyCounts = new Map<string, number>();
        return (rows ?? []).map((row) => {
          const nic = toNicModel(row);
          const base = `${nic.card}::${nic.name}`;
          const count = (keyCounts.get(base) ?? 0) + 1;
          keyCounts.set(base, count);
          const key = `${base}#${count}`;
          return { key, nic };
        });
      };

      const previousKeyed = keyWithOrdinal(previousNics as any[]);
      const nextKeyed = keyWithOrdinal(nics as any[]);
      const previousMap = new Map(previousKeyed.map((x) => [x.key, x.nic]));
      const nextMap = new Map(nextKeyed.map((x) => [x.key, x.nic]));

      const allKeys = Array.from(new Set([...previousMap.keys(), ...nextMap.keys()])).sort((a, b) => a.localeCompare(b));

      const nicChanges: Array<{ field: string; from: string; to: string }> = [];
      for (const key of allKeys) {
        const before = previousMap.get(key);
        const after = nextMap.get(key);

        const keyParts = key.split('#');
        const labelBase = keyParts.length > 0 && keyParts[0] ? keyParts[0] : key;
        const label = labelBase.replace('::', ' / ');

        if (!before && after) {
          nicChanges.push({ field: `NIC ${label}`, from: '—', to: 'Added' });
          continue;
        }

        if (before && !after) {
          nicChanges.push({ field: `NIC ${label}`, from: 'Present', to: 'Removed' });
          continue;
        }

        if (!before || !after) continue;

        const compare: Array<{ prop: keyof typeof before; title: string }> = [
          { prop: 'mac', title: 'MAC' },
          { prop: 'ip', title: 'IP' },
          { prop: 'vlan', title: 'VLAN' },
          { prop: 'nicType', title: 'NIC Type' },
          { prop: 'nicSpeed', title: 'NIC Speed' },
          { prop: 'switchSid', title: 'Switch SID' },
          { prop: 'switchPort', title: 'Switch Port' },
        ];

        for (const item of compare) {
          if (before[item.prop] !== after[item.prop]) {
            nicChanges.push({
              field: `NIC ${label} ${item.title}`,
              from: before[item.prop],
              to: after[item.prop],
            });
          }
        }
      }

      if (nicChanges.length > 0) {
        try {
          const nicSummary = `Replaced NIC list for SID ${sidId}${String(req.site?.name ?? '').trim() ? ` on ${String(req.site?.name ?? '').trim()}` : ''}`;
          const nicRemovedSummary = `Removed NICs from SID ${sidId}${String(req.site?.name ?? '').trim() ? ` on ${String(req.site?.name ?? '').trim()}` : ''}`;
          const nicAddedSummary = `Added NICs to SID ${sidId}${String(req.site?.name ?? '').trim() ? ` on ${String(req.site?.name ?? '').trim()}` : ''}`;
          const removedNicChanges = nicChanges.filter((change) => String(change.from) === 'Present' && String(change.to) === 'Removed');
          const addedNicChanges = nicChanges.filter((change) => String(change.from) === '—' && String(change.to) === 'Added');
          const updatedNicChanges = nicChanges.filter(
            (change) => !removedNicChanges.includes(change) && !addedNicChanges.includes(change)
          );

          if (removedNicChanges.length > 0) {
            await logSidActivity({
              actorUserId: req.user!.userId,
              siteId,
              sidId,
              action: 'SID_NICS_REPLACED',
              summary: nicRemovedSummary,
              diff: {
                nic_count: Array.isArray(body.nics) ? body.nics.length : 0,
                changes: removedNicChanges,
              },
            });
          }

          if (addedNicChanges.length > 0) {
            await logSidActivity({
              actorUserId: req.user!.userId,
              siteId,
              sidId,
              action: 'SID_NICS_REPLACED',
              summary: nicAddedSummary,
              diff: {
                nic_count: Array.isArray(body.nics) ? body.nics.length : 0,
                changes: addedNicChanges,
              },
            });
          }

          if (updatedNicChanges.length > 0) {
            await logSidActivity({
              actorUserId: req.user!.userId,
              siteId,
              sidId,
              action: 'SID_NICS_REPLACED',
              summary: nicSummary,
              diff: {
                nic_count: Array.isArray(body.nics) ? body.nics.length : 0,
                changes: updatedNicChanges,
              },
            });
          }
        } catch {
          // ignore
        }
      }

      return res.json({ success: true, data: { nics } } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: 'Validation failed', details: error.errors } as ApiResponse);
      }
      console.error('Replace sid nics error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

/**
 * GET /api/sites/:id/sids/:sidId/ip-addresses
 * List IP addresses for a SID.
 */
router.get(
  '/:id/sids/:sidId/ip-addresses',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  async (req: Request, res: Response) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const { sidId } = sidIdSchema.parse(req.params);
      const adapter = getAdapter();

      const existing = await adapter.query('SELECT id FROM sids WHERE id = ? AND site_id = ?', [sidId, siteId]);
      if (!existing.length) {
        return res.status(404).json({ success: false, error: 'SID not found' } as ApiResponse);
      }

      try {
        const rows = await adapter.query(
          'SELECT ip_address FROM sid_ip_addresses WHERE sid_id = ? ORDER BY ip_address ASC',
          [sidId]
        );
        const ip_addresses = (rows ?? []).map((r: any) => String(r.ip_address));
        return res.json({ success: true, data: { ip_addresses } } as ApiResponse);
      } catch (error) {
        if (isNoSuchTableError(error)) {
          return res.json({ success: true, data: { ip_addresses: [] } } as ApiResponse);
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: 'Validation failed', details: error.errors } as ApiResponse);
      }
      console.error('Get sid ip addresses error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

/**
 * PUT /api/sites/:id/sids/:sidId/ip-addresses
 * Replace IP addresses for a SID.
 */
router.put(
  '/:id/sids/:sidId/ip-addresses',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req: Request, res: Response) => {
    const adapter = getAdapter();
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const { sidId } = sidIdSchema.parse(req.params);
      const body = replaceSidIpAddressesSchema.parse(req.body);

      const sidRow = await getSidRowForWrite({ adapter, siteId, sidId });
      if (!sidRow) {
        return res.status(404).json({ success: false, error: 'SID not found' } as ApiResponse);
      }

      if (isDeletedSidStatus(sidRow.status)) {
        return sidReadOnlyResponse(res);
      }

      let existingIps: string[] = [];
      try {
        const existingRows = await adapter.query(
          'SELECT ip_address FROM sid_ip_addresses WHERE sid_id = ? ORDER BY ip_address ASC',
          [sidId]
        );
        existingIps = (existingRows ?? [])
          .map((r: any) => String(r?.ip_address ?? '').trim())
          .filter((ip: string) => ip !== '');
      } catch (error) {
        if (!isNoSuchTableError(error)) throw error;
      }

      const cleaned = Array.from(
        new Set(
          (body.ip_addresses ?? [])
            .map((ip) => String(ip ?? '').trim())
            .filter((ip) => ip !== '')
        )
      ).slice(0, 200);

      await adapter.beginTransaction();
      try {
        await adapter.execute('DELETE FROM sid_ip_addresses WHERE sid_id = ?', [sidId]);
        for (const ip of cleaned) {
          try {
            await adapter.execute('INSERT INTO sid_ip_addresses (sid_id, ip_address) VALUES (?, ?)', [sidId, ip]);
          } catch (error) {
            if (isDuplicateKeyError(error)) continue;
            throw error;
          }
        }
        await adapter.commit();
      } catch (error) {
        await adapter.rollback();
        if (isNoSuchTableError(error)) {
          // Migration not applied yet; return success with no-op.
          return res.json({ success: true, data: { ip_addresses: cleaned } } as ApiResponse);
        }
        throw error;
      }

      try {
        const beforeSet = new Set(existingIps);
        const afterSet = new Set(cleaned);
        const removedIps = existingIps.filter((ip) => !afterSet.has(ip));
        const addedIps = cleaned.filter((ip) => !beforeSet.has(ip));
        const getIpOrdinalMap = (values: string[]): Map<string, number> => {
          const ordinals = new Map<string, number>();
          for (let i = 0; i < values.length; i++) {
            const ip = values[i];
            if (typeof ip !== 'string') continue;
            if (!ordinals.has(ip)) {
              ordinals.set(ip, i + 1);
            }
          }
          return ordinals;
        };

        const beforeOrdinals = getIpOrdinalMap(existingIps);
        const afterOrdinals = getIpOrdinalMap(cleaned);

        const removedChanges: Array<{ field: string; from: string; to: string }> = removedIps.map((ip) => ({
          field: `Extra IP-${beforeOrdinals.get(ip) ?? 1} Address`,
          from: ip,
          to: 'Removed',
        }));

        const addedChanges: Array<{ field: string; from: string; to: string }> = addedIps.map((ip) => ({
          field: `Extra IP-${afterOrdinals.get(ip) ?? 1} Address`,
          from: '—',
          to: ip,
        }));

        const removedSummary = `Removed extra IP addresses for SID ${sidId}${String(req.site?.name ?? '').trim() ? ` on ${String(req.site?.name ?? '').trim()}` : ''}`;
        const addedSummary = `Added extra IP addresses for SID ${sidId}${String(req.site?.name ?? '').trim() ? ` on ${String(req.site?.name ?? '').trim()}` : ''}`;

        if (removedChanges.length > 0) {
          await logSidActivity({
            actorUserId: req.user!.userId,
            siteId,
            sidId,
            action: 'SID_IPS_REPLACED',
            summary: removedSummary,
            diff: { ip_count: cleaned.length, changes: removedChanges },
          });
        }

        if (addedChanges.length > 0) {
          await logSidActivity({
            actorUserId: req.user!.userId,
            siteId,
            sidId,
            action: 'SID_IPS_REPLACED',
            summary: addedSummary,
            diff: { ip_count: cleaned.length, changes: addedChanges },
          });
        }
      } catch {
        // ignore
      }

      return res.json({ success: true, data: { ip_addresses: cleaned } } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: 'Validation failed', details: error.errors } as ApiResponse);
      }
      console.error('Replace sid ip addresses error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

// --- SID picklists (site-admin) ---
const createPicklistSchema = z.object({
  name: z.string().min(1).max(255),
  manufacturer: z.string().max(255).optional().nullable(),
  description: z.string().max(5000).optional().nullable(),
});
const updatePicklistSchema = createPicklistSchema.partial();

const switchPortCountSchema = z.preprocess(
  (v) => {
    if (v === undefined || v === null) return v;
    if (v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) return v;
    if (n === 0) return null;
    return v;
  },
  z.coerce.number().int().min(1).max(4096).optional().nullable()
);

const deviceModelRackUSchema = z.preprocess(
  (v) => {
    if (v === undefined || v === null) return v;
    if (v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) return v;
    return Math.trunc(n);
  },
  z.coerce.number().int().min(1).max(99).optional().nullable()
);

const deviceModelSchemaShape = {
  name: z.string().min(1).max(255),
  manufacturer: z.string().max(255).optional().nullable(),
  description: z.string().max(5000).optional().nullable(),
  rack_u: deviceModelRackUSchema,
  is_switch: z.boolean().optional(),
  default_switch_port_count: switchPortCountSchema,
  is_patch_panel: z.boolean().optional(),
  default_patch_panel_port_count: switchPortCountSchema,
};

const validatePatchPanelPortCount = (data: any, ctx: z.RefinementCtx) => {
  if (data.is_switch === true && data.is_patch_panel === true) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['is_patch_panel'],
      message: 'Device model cannot be both Switch and Patch Panel',
    });
  }
  if (data.is_patch_panel === true) {
    const ports = data.default_patch_panel_port_count;
    if (!Number.isFinite(Number(ports)) || Number(ports) <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['default_patch_panel_port_count'],
        message: 'Patch panel port count is required when Patch Panel is enabled',
      });
    }
  }
};

const createDeviceModelSchema = z.object(deviceModelSchemaShape).superRefine(validatePatchPanelPortCount);
const updateDeviceModelSchema = z.object(deviceModelSchemaShape).partial().superRefine(validatePatchPanelPortCount);

const createCpuModelSchema = z.object({
  name: z.string().min(1).max(255),
  manufacturer: z.string().max(255).optional().nullable(),
  description: z.string().max(5000).optional().nullable(),
  cpu_cores: z.coerce.number().int().min(1).max(1024),
  cpu_threads: z.coerce.number().int().min(1).max(2048),
});
const updateCpuModelSchema = createCpuModelSchema.partial();

const createPlatformSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(5000).optional().nullable(),
});
const updatePlatformSchema = createPlatformSchema.partial();

const createSidStatusSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(5000).optional().nullable(),
});
const updateSidStatusSchema = createSidStatusSchema.partial();

const createSidPasswordTypeSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(5000).optional().nullable(),
});
const updateSidPasswordTypeSchema = createSidPasswordTypeSchema.partial();

const createSidNicTypeSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(5000).optional().nullable(),
});
const updateSidNicTypeSchema = createSidNicTypeSchema.partial();

const createSidNicSpeedSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(5000).optional().nullable(),
});
const updateSidNicSpeedSchema = createSidNicSpeedSchema.partial();

const createVlanSchema = z.object({
  vlan_id: z.coerce.number().int().min(1).max(4094),
  name: z.string().min(1).max(255),
  description: z.string().max(5000).optional().nullable(),
});
const updateVlanSchema = createVlanSchema.partial();

router.get(
  '/:id/sid/types',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  async (req, res) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const rows = await getAdapter().query('SELECT * FROM sid_types WHERE site_id = ? ORDER BY name ASC', [siteId]);
      return res.json({ success: true, data: { sid_types: rows } } as ApiResponse);
    } catch (error) {
      console.error('Get sid types error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

router.post(
  '/:id/sid/types',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req, res) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const body = createPicklistSchema.parse(req.body);
      try {
        const insert = await getAdapter().execute(
          'INSERT INTO sid_types (site_id, name, description) VALUES (?, ?, ?)',
          [siteId, body.name.trim(), body.description ?? null]
        );
        const id = Number(insert.insertId ?? getAdapter().getLastInsertId());
        const rows = await getAdapter().query('SELECT * FROM sid_types WHERE id = ?', [id]);
        return res.status(201).json({ success: true, data: { sid_type: rows[0] } } as ApiResponse);
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          return res.status(409).json({ success: false, error: 'Duplicate name' } as ApiResponse);
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: 'Validation failed', details: error.errors } as ApiResponse);
      }
      console.error('Create sid type error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

router.put(
  '/:id/sid/types/:rowId',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req, res) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const rowId = Number(req.params.rowId);
      const body = updatePicklistSchema.parse(req.body);
      await assertPicklistRowBelongsToSite({ adapter: getAdapter(), table: 'sid_types', rowId, siteId });

      const fields: string[] = [];
      const params: any[] = [];
      if (body.name !== undefined) {
        fields.push('name = ?');
        params.push(body.name.trim());
      }
      if (body.description !== undefined) {
        fields.push('description = ?');
        params.push(body.description ?? null);
      }
      if (!fields.length) {
        const rows = await getAdapter().query('SELECT * FROM sid_types WHERE id = ?', [rowId]);
        return res.json({ success: true, data: { sid_type: rows[0] } } as ApiResponse);
      }

      try {
        await getAdapter().execute(`UPDATE sid_types SET ${fields.join(', ')} WHERE id = ? AND site_id = ?`, [...params, rowId, siteId]);
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          return res.status(409).json({ success: false, error: 'Duplicate name' } as ApiResponse);
        }
        throw error;
      }
      const rows = await getAdapter().query('SELECT * FROM sid_types WHERE id = ?', [rowId]);
      return res.json({ success: true, data: { sid_type: rows[0] } } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: 'Validation failed', details: error.errors } as ApiResponse);
      }
      if (error instanceof Error && error.message === 'Not found') {
        return res.status(404).json({ success: false, error: 'Not found' } as ApiResponse);
      }
      console.error('Update sid type error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

router.delete(
  '/:id/sid/types/:rowId',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req, res) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const rowId = Number(req.params.rowId);
      await assertPicklistRowBelongsToSite({ adapter: getAdapter(), table: 'sid_types', rowId, siteId });
      await getAdapter().execute('DELETE FROM sid_types WHERE id = ? AND site_id = ?', [rowId, siteId]);
      return res.json({ success: true, data: { deleted: true } } as ApiResponse);
    } catch (error) {
      if (error instanceof Error && error.message === 'Not found') {
        return res.status(404).json({ success: false, error: 'Not found' } as ApiResponse);
      }
      console.error('Delete sid type error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

// Device models
router.get(
  '/:id/sid/device-models',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  async (req, res) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const rows = await getAdapter().query('SELECT * FROM sid_device_models WHERE site_id = ? ORDER BY name ASC', [siteId]);
      return res.json({ success: true, data: { device_models: rows } } as ApiResponse);
    } catch (error) {
      console.error('Get device models error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

router.post(
  '/:id/sid/device-models',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req, res) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const body = createDeviceModelSchema.parse(req.body);
      const isSwitch = body.is_switch === true;
      const defaultSwitchPortCount = isSwitch ? (body.default_switch_port_count ?? null) : null;
      const isPatchPanel = body.is_patch_panel === true;
      const defaultPatchPanelPortCount = isPatchPanel ? (body.default_patch_panel_port_count ?? null) : null;
      try {
        const insert = await getAdapter().execute(
          `INSERT INTO sid_device_models (
             site_id,
             manufacturer,
             name,
             description,
             rack_u,
             is_switch,
             default_switch_port_count,
             is_patch_panel,
             default_patch_panel_port_count
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            siteId,
            body.manufacturer ?? null,
            body.name.trim(),
            body.description ?? null,
            body.rack_u ?? null,
            isSwitch,
            defaultSwitchPortCount,
            isPatchPanel,
            defaultPatchPanelPortCount,
          ]
        );
        const id = Number(insert.insertId ?? getAdapter().getLastInsertId());
        const rows = await getAdapter().query('SELECT * FROM sid_device_models WHERE id = ?', [id]);
        return res.status(201).json({ success: true, data: { device_model: rows[0] } } as ApiResponse);
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          return res.status(409).json({ success: false, error: 'Duplicate name' } as ApiResponse);
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: 'Validation failed', details: error.errors } as ApiResponse);
      }
      console.error('Create device model error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

router.put(
  '/:id/sid/device-models/:rowId',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req, res) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const rowId = Number(req.params.rowId);
      const body = updateDeviceModelSchema.parse(req.body);
      await assertPicklistRowBelongsToSite({ adapter: getAdapter(), table: 'sid_device_models', rowId, siteId });

      const fields: string[] = [];
      const params: any[] = [];
      if (body.manufacturer !== undefined) {
        fields.push('manufacturer = ?');
        params.push(body.manufacturer ?? null);
      }
      if (body.name !== undefined) {
        fields.push('name = ?');
        params.push(body.name.trim());
      }
      if (body.description !== undefined) {
        fields.push('description = ?');
        params.push(body.description ?? null);
      }
      if (body.rack_u !== undefined) {
        fields.push('rack_u = ?');
        params.push(body.rack_u ?? null);
      }
      if (body.is_switch !== undefined) {
        fields.push('is_switch = ?');
        params.push(body.is_switch === true);
        if (body.is_switch !== true) {
          fields.push('default_switch_port_count = ?');
          params.push(null);
        } else if (body.is_patch_panel === undefined) {
          fields.push('is_patch_panel = ?');
          params.push(false);
          fields.push('default_patch_panel_port_count = ?');
          params.push(null);
        }
      }
      if (body.default_switch_port_count !== undefined) {
        fields.push('default_switch_port_count = ?');
        params.push(body.default_switch_port_count ?? null);
      }
      if (body.is_patch_panel !== undefined) {
        fields.push('is_patch_panel = ?');
        params.push(body.is_patch_panel === true);
        if (body.is_patch_panel !== true) {
          fields.push('default_patch_panel_port_count = ?');
          params.push(null);
        } else if (body.is_switch === undefined) {
          fields.push('is_switch = ?');
          params.push(false);
          fields.push('default_switch_port_count = ?');
          params.push(null);
        }
      }
      if (body.default_patch_panel_port_count !== undefined) {
        fields.push('default_patch_panel_port_count = ?');
        params.push(body.default_patch_panel_port_count ?? null);
      }
      if (!fields.length) {
        const rows = await getAdapter().query('SELECT * FROM sid_device_models WHERE id = ?', [rowId]);
        return res.json({ success: true, data: { device_model: rows[0] } } as ApiResponse);
      }

      try {
        await getAdapter().execute(
          `UPDATE sid_device_models SET ${fields.join(', ')} WHERE id = ? AND site_id = ?`,
          [...params, rowId, siteId]
        );
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          return res.status(409).json({ success: false, error: 'Duplicate name' } as ApiResponse);
        }
        throw error;
      }
      const rows = await getAdapter().query('SELECT * FROM sid_device_models WHERE id = ?', [rowId]);
      return res.json({ success: true, data: { device_model: rows[0] } } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: 'Validation failed', details: error.errors } as ApiResponse);
      }
      if (error instanceof Error && error.message === 'Not found') {
        return res.status(404).json({ success: false, error: 'Not found' } as ApiResponse);
      }
      console.error('Update device model error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

router.delete(
  '/:id/sid/device-models/:rowId',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req, res) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const rowId = Number(req.params.rowId);
      await assertPicklistRowBelongsToSite({ adapter: getAdapter(), table: 'sid_device_models', rowId, siteId });
      await getAdapter().execute('DELETE FROM sid_device_models WHERE id = ? AND site_id = ?', [rowId, siteId]);
      return res.json({ success: true, data: { deleted: true } } as ApiResponse);
    } catch (error) {
      if (error instanceof Error && error.message === 'Not found') {
        return res.status(404).json({ success: false, error: 'Not found' } as ApiResponse);
      }
      console.error('Delete device model error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

// CPU models
router.get(
  '/:id/sid/cpu-models',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  async (req, res) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const rows = await getAdapter().query('SELECT * FROM sid_cpu_models WHERE site_id = ? ORDER BY name ASC', [siteId]);
      return res.json({ success: true, data: { cpu_models: rows } } as ApiResponse);
    } catch (error) {
      console.error('Get cpu models error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

router.post(
  '/:id/sid/cpu-models',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req, res) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const body = createCpuModelSchema.parse(req.body);
      try {
        const insert = await getAdapter().execute(
          'INSERT INTO sid_cpu_models (site_id, manufacturer, name, description, cpu_cores, cpu_threads) VALUES (?, ?, ?, ?, ?, ?)',
          [siteId, body.manufacturer ?? null, body.name.trim(), body.description ?? null, body.cpu_cores, body.cpu_threads]
        );
        const id = Number(insert.insertId ?? getAdapter().getLastInsertId());
        const rows = await getAdapter().query('SELECT * FROM sid_cpu_models WHERE id = ?', [id]);
        return res.status(201).json({ success: true, data: { cpu_model: rows[0] } } as ApiResponse);
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          return res.status(409).json({ success: false, error: 'Duplicate name' } as ApiResponse);
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: 'Validation failed', details: error.errors } as ApiResponse);
      }
      console.error('Create cpu model error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

router.put(
  '/:id/sid/cpu-models/:rowId',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req, res) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const rowId = Number(req.params.rowId);
      const body = updateCpuModelSchema.parse(req.body);
      await assertPicklistRowBelongsToSite({ adapter: getAdapter(), table: 'sid_cpu_models', rowId, siteId });

      const fields: string[] = [];
      const params: any[] = [];
      if (body.manufacturer !== undefined) {
        fields.push('manufacturer = ?');
        params.push(body.manufacturer ?? null);
      }
      if (body.name !== undefined) {
        fields.push('name = ?');
        params.push(body.name.trim());
      }
      if (body.description !== undefined) {
        fields.push('description = ?');
        params.push(body.description ?? null);
      }
      if (body.cpu_cores !== undefined) {
        fields.push('cpu_cores = ?');
        params.push(body.cpu_cores ?? null);
      }
      if (body.cpu_threads !== undefined) {
        fields.push('cpu_threads = ?');
        params.push(body.cpu_threads ?? null);
      }
      if (!fields.length) {
        const rows = await getAdapter().query('SELECT * FROM sid_cpu_models WHERE id = ?', [rowId]);
        return res.json({ success: true, data: { cpu_model: rows[0] } } as ApiResponse);
      }

      try {
        await getAdapter().execute(
          `UPDATE sid_cpu_models SET ${fields.join(', ')} WHERE id = ? AND site_id = ?`,
          [...params, rowId, siteId]
        );
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          return res.status(409).json({ success: false, error: 'Duplicate name' } as ApiResponse);
        }
        throw error;
      }
      const rows = await getAdapter().query('SELECT * FROM sid_cpu_models WHERE id = ?', [rowId]);
      return res.json({ success: true, data: { cpu_model: rows[0] } } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: 'Validation failed', details: error.errors } as ApiResponse);
      }
      if (error instanceof Error && error.message === 'Not found') {
        return res.status(404).json({ success: false, error: 'Not found' } as ApiResponse);
      }
      console.error('Update cpu model error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

router.delete(
  '/:id/sid/cpu-models/:rowId',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req, res) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const rowId = Number(req.params.rowId);
      await assertPicklistRowBelongsToSite({ adapter: getAdapter(), table: 'sid_cpu_models', rowId, siteId });
      await getAdapter().execute('DELETE FROM sid_cpu_models WHERE id = ? AND site_id = ?', [rowId, siteId]);
      return res.json({ success: true, data: { deleted: true } } as ApiResponse);
    } catch (error) {
      if (error instanceof Error && error.message === 'Not found') {
        return res.status(404).json({ success: false, error: 'Not found' } as ApiResponse);
      }
      console.error('Delete cpu model error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

// Platforms
router.get(
  '/:id/sid/platforms',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  async (req, res) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const rows = await getAdapter().query('SELECT * FROM sid_platforms WHERE site_id = ? ORDER BY name ASC', [siteId]);
      return res.json({ success: true, data: { platforms: rows } } as ApiResponse);
    } catch (error) {
      console.error('Get platforms error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

router.post(
  '/:id/sid/platforms',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req, res) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const body = createPlatformSchema.parse(req.body);
      try {
        const insert = await getAdapter().execute(
          'INSERT INTO sid_platforms (site_id, name, description) VALUES (?, ?, ?)',
          [siteId, body.name.trim(), body.description ?? null]
        );
        const id = Number(insert.insertId ?? getAdapter().getLastInsertId());
        const rows = await getAdapter().query('SELECT * FROM sid_platforms WHERE id = ?', [id]);
        return res.status(201).json({ success: true, data: { platform: rows[0] } } as ApiResponse);
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          return res.status(409).json({ success: false, error: 'Duplicate name' } as ApiResponse);
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: 'Validation failed', details: error.errors } as ApiResponse);
      }
      console.error('Create platform error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

router.put(
  '/:id/sid/platforms/:rowId',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req, res) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const rowId = Number(req.params.rowId);
      const body = updatePlatformSchema.parse(req.body);
      await assertPicklistRowBelongsToSite({ adapter: getAdapter(), table: 'sid_platforms', rowId, siteId });

      const fields: string[] = [];
      const params: any[] = [];
      if (body.name !== undefined) {
        fields.push('name = ?');
        params.push(body.name.trim());
      }
      if (body.description !== undefined) {
        fields.push('description = ?');
        params.push(body.description ?? null);
      }
      if (!fields.length) {
        const rows = await getAdapter().query('SELECT * FROM sid_platforms WHERE id = ?', [rowId]);
        return res.json({ success: true, data: { platform: rows[0] } } as ApiResponse);
      }

      try {
        await getAdapter().execute(`UPDATE sid_platforms SET ${fields.join(', ')} WHERE id = ? AND site_id = ?`, [...params, rowId, siteId]);
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          return res.status(409).json({ success: false, error: 'Duplicate name' } as ApiResponse);
        }
        throw error;
      }
      const rows = await getAdapter().query('SELECT * FROM sid_platforms WHERE id = ?', [rowId]);
      return res.json({ success: true, data: { platform: rows[0] } } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: 'Validation failed', details: error.errors } as ApiResponse);
      }
      if (error instanceof Error && error.message === 'Not found') {
        return res.status(404).json({ success: false, error: 'Not found' } as ApiResponse);
      }
      console.error('Update platform error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

router.delete(
  '/:id/sid/platforms/:rowId',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req, res) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const rowId = Number(req.params.rowId);
      await assertPicklistRowBelongsToSite({ adapter: getAdapter(), table: 'sid_platforms', rowId, siteId });
      await getAdapter().execute('DELETE FROM sid_platforms WHERE id = ? AND site_id = ?', [rowId, siteId]);
      return res.json({ success: true, data: { deleted: true } } as ApiResponse);
    } catch (error) {
      if (error instanceof Error && error.message === 'Not found') {
        return res.status(404).json({ success: false, error: 'Not found' } as ApiResponse);
      }
      console.error('Delete platform error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

// Statuses
router.get(
  '/:id/sid/statuses',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  async (req, res) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const rows = await getAdapter().query('SELECT * FROM sid_statuses WHERE site_id = ? ORDER BY name ASC', [siteId]);
      return res.json({ success: true, data: { statuses: rows } } as ApiResponse);
    } catch (error) {
      console.error('Get statuses error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

// Password types
router.get(
  '/:id/sid/password-types',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  async (req, res) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const rows = await getAdapter().query('SELECT * FROM sid_password_types WHERE site_id = ? ORDER BY name ASC', [siteId]);
      return res.json({ success: true, data: { password_types: rows } } as ApiResponse);
    } catch (error) {
      console.error('Get password types error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

router.post(
  '/:id/sid/password-types',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req, res) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const body = createSidPasswordTypeSchema.parse(req.body);
      try {
        const insert = await getAdapter().execute(
          'INSERT INTO sid_password_types (site_id, name, description) VALUES (?, ?, ?)',
          [siteId, body.name.trim(), body.description ?? null]
        );
        const id = Number(insert.insertId ?? getAdapter().getLastInsertId());
        const rows = await getAdapter().query('SELECT * FROM sid_password_types WHERE id = ?', [id]);
        return res.status(201).json({ success: true, data: { password_type: rows[0] } } as ApiResponse);
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          return res.status(409).json({ success: false, error: 'Duplicate name' } as ApiResponse);
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: 'Validation failed', details: error.errors } as ApiResponse);
      }
      console.error('Create password type error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

router.put(
  '/:id/sid/password-types/:rowId',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req, res) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const rowId = Number(req.params.rowId);
      const body = updateSidPasswordTypeSchema.parse(req.body);
      await assertPicklistRowBelongsToSite({ adapter: getAdapter(), table: 'sid_password_types', rowId, siteId });

      const fields: string[] = [];
      const params: any[] = [];
      if (body.name !== undefined) {
        fields.push('name = ?');
        params.push(body.name.trim());
      }
      if (body.description !== undefined) {
        fields.push('description = ?');
        params.push(body.description ?? null);
      }
      if (!fields.length) {
        const rows = await getAdapter().query('SELECT * FROM sid_password_types WHERE id = ?', [rowId]);
        return res.json({ success: true, data: { password_type: rows[0] } } as ApiResponse);
      }

      try {
        await getAdapter().execute(
          `UPDATE sid_password_types SET ${fields.join(', ')} WHERE id = ? AND site_id = ?`,
          [...params, rowId, siteId]
        );
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          return res.status(409).json({ success: false, error: 'Duplicate name' } as ApiResponse);
        }
        throw error;
      }

      const rows = await getAdapter().query('SELECT * FROM sid_password_types WHERE id = ?', [rowId]);
      return res.json({ success: true, data: { password_type: rows[0] } } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: 'Validation failed', details: error.errors } as ApiResponse);
      }
      if (error instanceof Error && error.message === 'Not found') {
        return res.status(404).json({ success: false, error: 'Not found' } as ApiResponse);
      }
      console.error('Update password type error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

router.delete(
  '/:id/sid/password-types/:rowId',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req, res) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const rowId = Number(req.params.rowId);
      await assertPicklistRowBelongsToSite({ adapter: getAdapter(), table: 'sid_password_types', rowId, siteId });
      await getAdapter().execute('DELETE FROM sid_password_types WHERE id = ? AND site_id = ?', [rowId, siteId]);
      return res.json({ success: true, data: { deleted: true } } as ApiResponse);
    } catch (error) {
      if (error instanceof Error && error.message === 'Not found') {
        return res.status(404).json({ success: false, error: 'Not found' } as ApiResponse);
      }
      console.error('Delete password type error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

router.post(
  '/:id/sid/statuses',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req, res) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const body = createSidStatusSchema.parse(req.body);
      try {
        const insert = await getAdapter().execute(
          'INSERT INTO sid_statuses (site_id, name, description) VALUES (?, ?, ?)',
          [siteId, body.name.trim(), body.description ?? null]
        );
        const id = Number(insert.insertId ?? getAdapter().getLastInsertId());
        const rows = await getAdapter().query('SELECT * FROM sid_statuses WHERE id = ?', [id]);
        return res.status(201).json({ success: true, data: { status: rows[0] } } as ApiResponse);
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          return res.status(409).json({ success: false, error: 'Duplicate name' } as ApiResponse);
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: 'Validation failed', details: error.errors } as ApiResponse);
      }
      console.error('Create status error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

router.put(
  '/:id/sid/statuses/:rowId',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req, res) => {
    try {
      const adapter = getAdapter();
      const { id: siteId } = siteIdSchema.parse(req.params);
      const rowId = Number(req.params.rowId);
      const body = updateSidStatusSchema.parse(req.body);
      await assertPicklistRowBelongsToSite({ adapter, table: 'sid_statuses', rowId, siteId });

      const fields: string[] = [];
      const params: any[] = [];
      if (body.name !== undefined) {
        fields.push('name = ?');
        params.push(body.name.trim());
      }
      if (body.description !== undefined) {
        fields.push('description = ?');
        params.push(body.description ?? null);
      }
      if (!fields.length) {
        const rows = await adapter.query('SELECT * FROM sid_statuses WHERE id = ?', [rowId]);
        return res.json({ success: true, data: { status: rows[0] } } as ApiResponse);
      }

      let previousName: string | null = null;
      const nextName = body.name !== undefined ? body.name.trim() : null;
      if (nextName !== null) {
        const rows = await adapter.query('SELECT name FROM sid_statuses WHERE id = ?', [rowId]);
        previousName = rows?.[0]?.name ?? null;
      }

      try {
        await adapter.beginTransaction();
        await adapter.execute(`UPDATE sid_statuses SET ${fields.join(', ')} WHERE id = ? AND site_id = ?`, [
          ...params,
          rowId,
          siteId,
        ]);

        // SIDs store status as a string (not a FK). If the picklist status name changes,
        // update any SIDs currently using the previous value.
        if (nextName !== null && previousName !== null && nextName !== previousName) {
          await adapter.execute('UPDATE sids SET status = ? WHERE site_id = ? AND status = ?', [nextName, siteId, previousName]);
        }

        await adapter.commit();
      } catch (error) {
        try {
          await adapter.rollback();
        } catch {
          // ignore
        }
        if (isDuplicateKeyError(error)) {
          return res.status(409).json({ success: false, error: 'Duplicate name' } as ApiResponse);
        }
        throw error;
      }

      const rows = await adapter.query('SELECT * FROM sid_statuses WHERE id = ?', [rowId]);
      return res.json({ success: true, data: { status: rows[0] } } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: 'Validation failed', details: error.errors } as ApiResponse);
      }
      if (error instanceof Error && error.message === 'Not found') {
        return res.status(404).json({ success: false, error: 'Not found' } as ApiResponse);
      }
      console.error('Update status error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

router.delete(
  '/:id/sid/statuses/:rowId',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req, res) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const rowId = Number(req.params.rowId);
      await assertPicklistRowBelongsToSite({ adapter: getAdapter(), table: 'sid_statuses', rowId, siteId });
      await getAdapter().execute('DELETE FROM sid_statuses WHERE id = ? AND site_id = ?', [rowId, siteId]);
      return res.json({ success: true, data: { deleted: true } } as ApiResponse);
    } catch (error) {
      if (error instanceof Error && error.message === 'Not found') {
        return res.status(404).json({ success: false, error: 'Not found' } as ApiResponse);
      }
      console.error('Delete status error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

// NIC Types
router.get(
  '/:id/sid/nic-types',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  async (req, res) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      try {
        const rows = await getAdapter().query('SELECT * FROM sid_nic_types WHERE site_id = ? ORDER BY name ASC', [siteId]);
        return res.json({ success: true, data: { nic_types: rows } } as ApiResponse);
      } catch (error) {
        if (isNoSuchTableError(error)) {
          return res.json({ success: true, data: { nic_types: [] } } as ApiResponse);
        }
        throw error;
      }
    } catch (error) {
      console.error('Get NIC Types error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

router.post(
  '/:id/sid/nic-types',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req, res) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const body = createSidNicTypeSchema.parse(req.body);
      try {
        const insert = await getAdapter().execute(
          'INSERT INTO sid_nic_types (site_id, name, description) VALUES (?, ?, ?)',
          [siteId, body.name.trim(), body.description ?? null]
        );
        const id = Number(insert.insertId ?? getAdapter().getLastInsertId());
        const rows = await getAdapter().query('SELECT * FROM sid_nic_types WHERE id = ?', [id]);
        return res.status(201).json({ success: true, data: { nic_type: rows[0] } } as ApiResponse);
      } catch (error) {
        if (isNoSuchTableError(error)) {
          return res.status(400).json({ success: false, error: 'NIC Types not available (database not migrated)' } as ApiResponse);
        }
        if (isDuplicateKeyError(error)) {
          return res.status(409).json({ success: false, error: 'Duplicate name' } as ApiResponse);
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: 'Validation failed', details: error.errors } as ApiResponse);
      }
      console.error('Create NIC Type error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

router.put(
  '/:id/sid/nic-types/:rowId',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req, res) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const rowId = Number(req.params.rowId);
      const body = updateSidNicTypeSchema.parse(req.body);
      await assertPicklistRowBelongsToSite({ adapter: getAdapter(), table: 'sid_nic_types', rowId, siteId });

      const fields: string[] = [];
      const params: any[] = [];
      if (body.name !== undefined) {
        fields.push('name = ?');
        params.push(body.name.trim());
      }
      if (body.description !== undefined) {
        fields.push('description = ?');
        params.push(body.description ?? null);
      }
      if (!fields.length) {
        const rows = await getAdapter().query('SELECT * FROM sid_nic_types WHERE id = ?', [rowId]);
        return res.json({ success: true, data: { nic_type: rows[0] } } as ApiResponse);
      }

      try {
        await getAdapter().execute(`UPDATE sid_nic_types SET ${fields.join(', ')} WHERE id = ? AND site_id = ?`, [
          ...params,
          rowId,
          siteId,
        ]);
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          return res.status(409).json({ success: false, error: 'Duplicate name' } as ApiResponse);
        }
        throw error;
      }

      const rows = await getAdapter().query('SELECT * FROM sid_nic_types WHERE id = ?', [rowId]);
      return res.json({ success: true, data: { nic_type: rows[0] } } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: 'Validation failed', details: error.errors } as ApiResponse);
      }
      if (error instanceof Error && error.message === 'Not found') {
        return res.status(404).json({ success: false, error: 'Not found' } as ApiResponse);
      }
      console.error('Update NIC Type error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

router.delete(
  '/:id/sid/nic-types/:rowId',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req, res) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const rowId = Number(req.params.rowId);
      await assertPicklistRowBelongsToSite({ adapter: getAdapter(), table: 'sid_nic_types', rowId, siteId });
      await getAdapter().execute('DELETE FROM sid_nic_types WHERE id = ? AND site_id = ?', [rowId, siteId]);
      return res.json({ success: true, data: { deleted: true } } as ApiResponse);
    } catch (error) {
      if (error instanceof Error && error.message === 'Not found') {
        return res.status(404).json({ success: false, error: 'Not found' } as ApiResponse);
      }
      console.error('Delete NIC Type error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

// NIC Speeds
router.get(
  '/:id/sid/nic-speeds',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  async (req, res) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      try {
        const rows = await getAdapter().query('SELECT * FROM sid_nic_speeds WHERE site_id = ? ORDER BY name ASC', [siteId]);
        return res.json({ success: true, data: { nic_speeds: rows } } as ApiResponse);
      } catch (error) {
        if (isNoSuchTableError(error)) {
          return res.json({ success: true, data: { nic_speeds: [] } } as ApiResponse);
        }
        throw error;
      }
    } catch (error) {
      console.error('Get NIC Speeds error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

router.post(
  '/:id/sid/nic-speeds',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req, res) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const body = createSidNicSpeedSchema.parse(req.body);
      try {
        const insert = await getAdapter().execute(
          'INSERT INTO sid_nic_speeds (site_id, name, description) VALUES (?, ?, ?)',
          [siteId, body.name.trim(), body.description ?? null]
        );
        const id = Number(insert.insertId ?? getAdapter().getLastInsertId());
        const rows = await getAdapter().query('SELECT * FROM sid_nic_speeds WHERE id = ?', [id]);
        return res.status(201).json({ success: true, data: { nic_speed: rows[0] } } as ApiResponse);
      } catch (error) {
        if (isNoSuchTableError(error)) {
          return res.status(400).json({ success: false, error: 'NIC Speeds not available (database not migrated)' } as ApiResponse);
        }
        if (isDuplicateKeyError(error)) {
          return res.status(409).json({ success: false, error: 'Duplicate name' } as ApiResponse);
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: 'Validation failed', details: error.errors } as ApiResponse);
      }
      console.error('Create NIC Speed error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

router.put(
  '/:id/sid/nic-speeds/:rowId',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req, res) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const rowId = Number(req.params.rowId);
      const body = updateSidNicSpeedSchema.parse(req.body);
      await assertPicklistRowBelongsToSite({ adapter: getAdapter(), table: 'sid_nic_speeds', rowId, siteId });

      const fields: string[] = [];
      const params: any[] = [];
      if (body.name !== undefined) {
        fields.push('name = ?');
        params.push(body.name.trim());
      }
      if (body.description !== undefined) {
        fields.push('description = ?');
        params.push(body.description ?? null);
      }
      if (!fields.length) {
        const rows = await getAdapter().query('SELECT * FROM sid_nic_speeds WHERE id = ?', [rowId]);
        return res.json({ success: true, data: { nic_speed: rows[0] } } as ApiResponse);
      }

      try {
        await getAdapter().execute(`UPDATE sid_nic_speeds SET ${fields.join(', ')} WHERE id = ? AND site_id = ?`, [
          ...params,
          rowId,
          siteId,
        ]);
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          return res.status(409).json({ success: false, error: 'Duplicate name' } as ApiResponse);
        }
        throw error;
      }

      const rows = await getAdapter().query('SELECT * FROM sid_nic_speeds WHERE id = ?', [rowId]);
      return res.json({ success: true, data: { nic_speed: rows[0] } } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: 'Validation failed', details: error.errors } as ApiResponse);
      }
      if (error instanceof Error && error.message === 'Not found') {
        return res.status(404).json({ success: false, error: 'Not found' } as ApiResponse);
      }
      console.error('Update NIC Speed error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

router.delete(
  '/:id/sid/nic-speeds/:rowId',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req, res) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const rowId = Number(req.params.rowId);
      await assertPicklistRowBelongsToSite({ adapter: getAdapter(), table: 'sid_nic_speeds', rowId, siteId });
      await getAdapter().execute('DELETE FROM sid_nic_speeds WHERE id = ? AND site_id = ?', [rowId, siteId]);
      return res.json({ success: true, data: { deleted: true } } as ApiResponse);
    } catch (error) {
      if (error instanceof Error && error.message === 'Not found') {
        return res.status(404).json({ success: false, error: 'Not found' } as ApiResponse);
      }
      console.error('Delete NIC Speed error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

// VLANs
router.get(
  '/:id/sid/vlans',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  async (req, res) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const rows = await getAdapter().query('SELECT * FROM site_vlans WHERE site_id = ? ORDER BY vlan_id ASC', [siteId]);
      return res.json({ success: true, data: { vlans: rows } } as ApiResponse);
    } catch (error) {
      console.error('Get VLANs error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

router.post(
  '/:id/sid/vlans',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req, res) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const body = createVlanSchema.parse(req.body);
      try {
        const insert = await getAdapter().execute(
          'INSERT INTO site_vlans (site_id, vlan_id, name, description) VALUES (?, ?, ?, ?)',
          [siteId, body.vlan_id, body.name.trim(), body.description ?? null]
        );
        const id = Number(insert.insertId ?? getAdapter().getLastInsertId());
        const rows = await getAdapter().query('SELECT * FROM site_vlans WHERE id = ?', [id]);
        return res.status(201).json({ success: true, data: { vlan: rows[0] } } as ApiResponse);
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          return res.status(409).json({ success: false, error: 'Duplicate VLAN ID' } as ApiResponse);
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: 'Validation failed', details: error.errors } as ApiResponse);
      }
      console.error('Create VLAN error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

router.put(
  '/:id/sid/vlans/:rowId',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req, res) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const rowId = Number(req.params.rowId);
      const body = updateVlanSchema.parse(req.body);
      await assertPicklistRowBelongsToSite({ adapter: getAdapter(), table: 'site_vlans', rowId, siteId });

      const fields: string[] = [];
      const params: any[] = [];
      if (body.vlan_id !== undefined) {
        fields.push('vlan_id = ?');
        params.push(body.vlan_id);
      }
      if (body.name !== undefined) {
        fields.push('name = ?');
        params.push(body.name.trim());
      }
      if (body.description !== undefined) {
        fields.push('description = ?');
        params.push(body.description ?? null);
      }
      if (!fields.length) {
        const rows = await getAdapter().query('SELECT * FROM site_vlans WHERE id = ?', [rowId]);
        return res.json({ success: true, data: { vlan: rows[0] } } as ApiResponse);
      }

      try {
        await getAdapter().execute(`UPDATE site_vlans SET ${fields.join(', ')} WHERE id = ? AND site_id = ?`, [
          ...params,
          rowId,
          siteId,
        ]);
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          return res.status(409).json({ success: false, error: 'Duplicate VLAN ID' } as ApiResponse);
        }
        throw error;
      }
      const rows = await getAdapter().query('SELECT * FROM site_vlans WHERE id = ?', [rowId]);
      return res.json({ success: true, data: { vlan: rows[0] } } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: 'Validation failed', details: error.errors } as ApiResponse);
      }
      if (error instanceof Error && error.message === 'Not found') {
        return res.status(404).json({ success: false, error: 'Not found' } as ApiResponse);
      }
      console.error('Update VLAN error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

router.delete(
  '/:id/sid/vlans/:rowId',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req, res) => {
    try {
      const { id: siteId } = siteIdSchema.parse(req.params);
      const rowId = Number(req.params.rowId);
      await assertPicklistRowBelongsToSite({ adapter: getAdapter(), table: 'site_vlans', rowId, siteId });
      await getAdapter().execute('DELETE FROM site_vlans WHERE id = ? AND site_id = ?', [rowId, siteId]);
      return res.json({ success: true, data: { deleted: true } } as ApiResponse);
    } catch (error) {
      if (error instanceof Error && error.message === 'Not found') {
        return res.status(404).json({ success: false, error: 'Not found' } as ApiResponse);
      }
      console.error('Delete VLAN error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

// --- SID picklist usage counts (site-admin) ---
router.get(
  '/:id/sid/types/:rowId/usage',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req, res) => {
    try {
      const adapter = getAdapter();
      const { id: siteId } = siteIdSchema.parse(req.params);
      const rowId = Number(req.params.rowId);
      await assertPicklistRowBelongsToSite({ adapter, table: 'sid_types', rowId, siteId });
      const rows = await adapter.query('SELECT COUNT(*) AS count FROM sids WHERE site_id = ? AND sid_type_id = ?', [siteId, rowId]);
      const sidsUsing = Number(rows?.[0]?.count ?? 0);
      return res.json({ success: true, data: { sids_using: sidsUsing } } as ApiResponse);
    } catch (error) {
      if (error instanceof Error && error.message === 'Not found') {
        return res.status(404).json({ success: false, error: 'Not found' } as ApiResponse);
      }
      console.error('Get sid type usage error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

router.get(
  '/:id/sid/device-models/:rowId/usage',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req, res) => {
    try {
      const adapter = getAdapter();
      const { id: siteId } = siteIdSchema.parse(req.params);
      const rowId = Number(req.params.rowId);
      await assertPicklistRowBelongsToSite({ adapter, table: 'sid_device_models', rowId, siteId });
      const rows = await adapter.query('SELECT COUNT(*) AS count FROM sids WHERE site_id = ? AND device_model_id = ?', [siteId, rowId]);
      const sidsUsing = Number(rows?.[0]?.count ?? 0);
      return res.json({ success: true, data: { sids_using: sidsUsing } } as ApiResponse);
    } catch (error) {
      if (error instanceof Error && error.message === 'Not found') {
        return res.status(404).json({ success: false, error: 'Not found' } as ApiResponse);
      }
      console.error('Get device model usage error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

router.get(
  '/:id/sid/cpu-models/:rowId/usage',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req, res) => {
    try {
      const adapter = getAdapter();
      const { id: siteId } = siteIdSchema.parse(req.params);
      const rowId = Number(req.params.rowId);
      await assertPicklistRowBelongsToSite({ adapter, table: 'sid_cpu_models', rowId, siteId });
      const rows = await adapter.query('SELECT COUNT(*) AS count FROM sids WHERE site_id = ? AND cpu_model_id = ?', [siteId, rowId]);
      const sidsUsing = Number(rows?.[0]?.count ?? 0);
      return res.json({ success: true, data: { sids_using: sidsUsing } } as ApiResponse);
    } catch (error) {
      if (error instanceof Error && error.message === 'Not found') {
        return res.status(404).json({ success: false, error: 'Not found' } as ApiResponse);
      }
      console.error('Get cpu model usage error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

router.get(
  '/:id/sid/platforms/:rowId/usage',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req, res) => {
    try {
      const adapter = getAdapter();
      const { id: siteId } = siteIdSchema.parse(req.params);
      const rowId = Number(req.params.rowId);
      await assertPicklistRowBelongsToSite({ adapter, table: 'sid_platforms', rowId, siteId });
      const rows = await adapter.query('SELECT COUNT(*) AS count FROM sids WHERE site_id = ? AND platform_id = ?', [siteId, rowId]);
      const sidsUsing = Number(rows?.[0]?.count ?? 0);
      return res.json({ success: true, data: { sids_using: sidsUsing } } as ApiResponse);
    } catch (error) {
      if (error instanceof Error && error.message === 'Not found') {
        return res.status(404).json({ success: false, error: 'Not found' } as ApiResponse);
      }
      console.error('Get platform usage error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

router.get(
  '/:id/sid/statuses/:rowId/usage',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req, res) => {
    try {
      const adapter = getAdapter();
      const { id: siteId } = siteIdSchema.parse(req.params);
      const rowId = Number(req.params.rowId);
      await assertPicklistRowBelongsToSite({ adapter, table: 'sid_statuses', rowId, siteId });
      const statusRows = await adapter.query('SELECT name FROM sid_statuses WHERE id = ?', [rowId]);
      const statusName = String(statusRows?.[0]?.name ?? '').trim();
      if (!statusName) {
        return res.json({ success: true, data: { sids_using: 0 } } as ApiResponse);
      }
      const rows = await adapter.query('SELECT COUNT(*) AS count FROM sids WHERE site_id = ? AND TRIM(status) = ?', [siteId, statusName]);
      const sidsUsing = Number(rows?.[0]?.count ?? 0);
      return res.json({ success: true, data: { sids_using: sidsUsing } } as ApiResponse);
    } catch (error) {
      if (error instanceof Error && error.message === 'Not found') {
        return res.status(404).json({ success: false, error: 'Not found' } as ApiResponse);
      }
      console.error('Get status usage error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

router.get(
  '/:id/sid/password-types/:rowId/usage',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req, res) => {
    try {
      const adapter = getAdapter();
      const { id: siteId } = siteIdSchema.parse(req.params);
      const rowId = Number(req.params.rowId);
      await assertPicklistRowBelongsToSite({ adapter, table: 'sid_password_types', rowId, siteId });
      const rows = await adapter.query(
        `SELECT COUNT(DISTINCT s.id) AS count
         FROM sid_passwords p
         JOIN sids s ON s.id = p.sid_id
         WHERE s.site_id = ? AND p.password_type_id = ?`,
        [siteId, rowId]
      );
      const sidsUsing = Number(rows?.[0]?.count ?? 0);
      return res.json({ success: true, data: { sids_using: sidsUsing } } as ApiResponse);
    } catch (error) {
      if (error instanceof Error && error.message === 'Not found') {
        return res.status(404).json({ success: false, error: 'Not found' } as ApiResponse);
      }
      console.error('Get password type usage error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

router.get(
  '/:id/sid/vlans/:rowId/usage',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req, res) => {
    try {
      const adapter = getAdapter();
      const { id: siteId } = siteIdSchema.parse(req.params);
      const rowId = Number(req.params.rowId);
      await assertPicklistRowBelongsToSite({ adapter, table: 'site_vlans', rowId, siteId });
      const rows = await adapter.query(
        `SELECT COUNT(DISTINCT s.id) AS count
         FROM sid_nics n
         JOIN sids s ON s.id = n.sid_id
         WHERE s.site_id = ? AND n.site_vlan_id = ?`,
        [siteId, rowId]
      );
      const sidsUsing = Number(rows?.[0]?.count ?? 0);
      return res.json({ success: true, data: { sids_using: sidsUsing } } as ApiResponse);
    } catch (error) {
      if (error instanceof Error && error.message === 'Not found') {
        return res.status(404).json({ success: false, error: 'Not found' } as ApiResponse);
      }
      console.error('Get VLAN usage error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

router.get(
  '/:id/sid/nic-types/:rowId/usage',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req, res) => {
    try {
      const adapter = getAdapter();
      const { id: siteId } = siteIdSchema.parse(req.params);
      const rowId = Number(req.params.rowId);

      await assertPicklistRowBelongsToSite({ adapter, table: 'sid_nic_types', rowId, siteId });

      const rows = await adapter.query(
        `SELECT COUNT(DISTINCT s.id) AS count
         FROM sid_nics n
         JOIN sids s ON s.id = n.sid_id
         WHERE s.site_id = ? AND n.nic_type_id = ?`,
        [siteId, rowId]
      );
      const sidsUsing = Number(rows?.[0]?.count ?? 0);
      return res.json({ success: true, data: { sids_using: sidsUsing } } as ApiResponse);
    } catch (error) {
      if (error instanceof Error && error.message === 'Not found') {
        return res.status(404).json({ success: false, error: 'Not found' } as ApiResponse);
      }
      console.error('Get NIC type usage error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

router.get(
  '/:id/sid/nic-speeds/:rowId/usage',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req, res) => {
    try {
      const adapter = getAdapter();
      const { id: siteId } = siteIdSchema.parse(req.params);
      const rowId = Number(req.params.rowId);

      await assertPicklistRowBelongsToSite({ adapter, table: 'sid_nic_speeds', rowId, siteId });

      const rows = await adapter.query(
        `SELECT COUNT(DISTINCT s.id) AS count
         FROM sid_nics n
         JOIN sids s ON s.id = n.sid_id
         WHERE s.site_id = ? AND n.nic_speed_id = ?`,
        [siteId, rowId]
      );
      const sidsUsing = Number(rows?.[0]?.count ?? 0);
      return res.json({ success: true, data: { sids_using: sidsUsing } } as ApiResponse);
    } catch (error) {
      if (error instanceof Error && error.message === 'Not found') {
        return res.status(404).json({ success: false, error: 'Not found' } as ApiResponse);
      }
      console.error('Get NIC speed usage error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse);
    }
  }
);

/**
 * POST /api/sites
 * Create a new site
 */
router.post('/', authenticateToken, requireGlobalRole('GLOBAL_ADMIN'), async (req: Request, res: Response) => {
  try {
    // Validate request body
    const siteDataParsed = createSiteSchema.parse(req.body);
    const code = siteDataParsed.code.toUpperCase().trim();
    const siteData = {
      name: siteDataParsed.name,
      code,
      ...(siteDataParsed.location ? { location: siteDataParsed.location } : {}),
      ...(siteDataParsed.description ? { description: siteDataParsed.description } : {}),
    };

    // Create site
    const site = await siteModel.create({
      ...siteData,
      created_by: req.user!.userId,
    });

    try {
      await logActivity({
        actorUserId: req.user!.userId,
        action: 'SITE_CREATED',
        summary: `Created site ${site.name} (${site.code})`,
        siteId: Number(site.id),
        metadata: {
          site_id: Number(site.id),
          name: site.name,
          code: site.code,
        },
      });
    } catch (error) {
      console.warn('⚠️ Failed to log site create activity:', error);
    }

    res.status(201).json({
      success: true,
      data: { site },
      message: 'Site created successfully',
    } as ApiResponse);

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: error.errors,
      } as ApiResponse);
    }

    console.error('Create site error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    } as ApiResponse);
  }
});


/**
 * PUT /api/sites/:id
 * Update an existing site
 */
router.put('/:id', authenticateToken, resolveSiteAccess(req => Number(req.params.id)), requireSiteRole('SITE_ADMIN'), async (req: Request, res: Response) => {
  try {
    // Validate site ID and request body
    const { id } = siteIdSchema.parse(req.params);
    const siteDataParsed = updateSiteSchema.parse(req.body);
    const siteData = {
      ...(siteDataParsed.name !== undefined ? { name: siteDataParsed.name } : {}),
      ...(siteDataParsed.code !== undefined ? { code: siteDataParsed.code.toUpperCase() } : {}),
      ...(siteDataParsed.location !== undefined ? { location: siteDataParsed.location } : {}),
      ...(siteDataParsed.description !== undefined ? { description: siteDataParsed.description } : {}),
    };

    // Update site
    const site = await siteModel.update(id, req.user!.userId, siteData);

    if (!site) {
      return res.status(404).json({
        success: false,
        error: 'Site not found or no changes made',
      } as ApiResponse);
    }

    try {
      await logActivity({
        actorUserId: req.user!.userId,
        action: 'SITE_UPDATED',
        summary: `Updated site ${site.name} (${String(site.code || '').toUpperCase()})`,
        siteId: id,
        metadata: {
          site_id: id,
          changes: siteData,
        },
      });
    } catch (error) {
      console.warn('⚠️ Failed to log site update activity:', error);
    }

    res.json({
      success: true,
      data: { site },
      message: 'Site updated successfully',
    } as ApiResponse);

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: error.errors,
      } as ApiResponse);
    }

    console.error('Update site error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    } as ApiResponse);
  }
});

/**
 * GET /api/sites/:id/locations
 * List all structured locations for a site
 */
router.get('/:id/locations', authenticateToken, resolveSiteAccess(req => Number(req.params.id)), async (req: Request, res: Response) => {
  try {
    const { id } = siteIdSchema.parse(req.params);
    const locations = await siteLocationModel.listBySiteId(id);

    res.json({
      success: true,
      data: { locations },
    } as ApiResponse);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: error.errors,
      } as ApiResponse);
    }

    console.error('List site locations error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    } as ApiResponse);
  }
});

/**
 * POST /api/sites/:id/locations
 * Create a structured location for a site (site admins only)
 */
router.post('/:id/locations', authenticateToken, resolveSiteAccess(req => Number(req.params.id)), requireSiteRole('SITE_ADMIN'), async (req: Request, res: Response) => {
  try {
    const { id } = siteIdSchema.parse(req.params);
    const dataParsed = createLocationSchema.parse(req.body);

    const site = await siteModel.findById(id);
    if (!site) {
      return res.status(404).json({
        success: false,
        error: 'Site not found',
      } as ApiResponse);
    }

    const labelTrimmed = (dataParsed.label ?? '').toString().trim();
    const label = labelTrimmed !== '' ? labelTrimmed : null;

    const template_type = (dataParsed.template_type ?? 'DATACENTRE') as 'DATACENTRE' | 'DOMESTIC';

    const baseCreate = {
      site_id: id,
      template_type,
      floor: dataParsed.floor,
      ...(label !== null ? { label } : {}),
    };

    const location = await siteLocationModel.create(
      template_type === 'DOMESTIC'
        ? {
          ...baseCreate,
          area: (dataParsed.area ?? '').toString().trim(),
        }
        : {
          ...baseCreate,
          suite: (dataParsed.suite ?? '').toString().trim(),
          row: (dataParsed.row ?? '').toString().trim(),
          rack: (dataParsed.rack ?? '').toString().trim(),
          rack_size_u: Number(dataParsed.rack_size_u),
        }
    );

    try {
      const displayLabel = (location as any).effective_label ?? (location as any).label ?? site.code;
      await logActivity({
        actorUserId: req.user!.userId,
        siteId: id,
        action: 'LOCATION_CREATED',
        summary: `Created location ${displayLabel} on site ${site.name}`,
        metadata: {
          site_id: id,
          location_id: location.id,
          effective_label: (location as any).effective_label,
          label: (location as any).label,
          floor: (location as any).floor,
          suite: (location as any).suite,
          row: (location as any).row,
          rack: (location as any).rack,
          rack_size_u: (location as any).rack_size_u,
          area: (location as any).area,
          template_type: (location as any).template_type,
        },
      });
    } catch (error) {
      console.warn('⚠️ Failed to log location create activity:', error);
    }

    res.status(201).json({
      success: true,
      data: { location },
      message: 'Location created successfully',
    } as ApiResponse);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: error.errors,
      } as ApiResponse);
    }

    if (error instanceof DuplicateSiteLocationCoordsError) {
      const existing = error.existing;
      const extra = existing?.id
        ? ` (existing ID ${existing.id}${existing.effective_label ? `, Label ${existing.effective_label}` : ''})`
        : '';

      return res.status(409).json({
        success: false,
        error: `A location with the same Floor/Suite/Row/Rack already exists for this site${extra}. Update the existing location instead of creating a duplicate.`,
        data: existing ? { existing } : undefined,
      } as ApiResponse);
    }

    if (error instanceof Error) {
      return res.status(400).json({
        success: false,
        error: error.message,
      } as ApiResponse);
    }

    console.error('Create site location error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    } as ApiResponse);
  }
});

/**
 * PUT /api/sites/:id/locations/:locationId
 * Update a structured location (site admins only)
 */
router.put('/:id/locations/:locationId', authenticateToken, resolveSiteAccess(req => Number(req.params.id)), requireSiteRole('SITE_ADMIN'), async (req: Request, res: Response) => {
  try {
    const { id } = siteIdSchema.parse(req.params);
    const { locationId } = locationIdSchema.parse(req.params);
    const dataParsed = updateLocationSchema.parse(req.body);

    let labelUpdate: string | null | undefined;
    if (dataParsed.label !== undefined) {
      const labelTrimmed = (dataParsed.label ?? '').toString().trim();
      labelUpdate = labelTrimmed !== '' ? labelTrimmed : null;
    }

    let areaUpdate: string | null | undefined;
    if (dataParsed.area !== undefined) {
      const areaTrimmed = (dataParsed.area ?? '').toString().trim();
      areaUpdate = areaTrimmed !== '' ? areaTrimmed : null;
    }

    let suiteUpdate: string | null | undefined;
    if (dataParsed.suite !== undefined) {
      const suiteTrimmed = (dataParsed.suite ?? '').toString().trim();
      suiteUpdate = suiteTrimmed !== '' ? suiteTrimmed : null;
    }

    let rowUpdate: string | null | undefined;
    if (dataParsed.row !== undefined) {
      const rowTrimmed = (dataParsed.row ?? '').toString().trim();
      rowUpdate = rowTrimmed !== '' ? rowTrimmed : null;
    }

    let rackUpdate: string | null | undefined;
    if (dataParsed.rack !== undefined) {
      const rackTrimmed = (dataParsed.rack ?? '').toString().trim();
      rackUpdate = rackTrimmed !== '' ? rackTrimmed : null;
    }

    let rackSizeUUpdate: number | null | undefined;
    if (dataParsed.rack_size_u !== undefined) {
      const raw = dataParsed.rack_size_u;
      if (raw === '') {
        rackSizeUUpdate = null;
      } else {
        const parsed = Number(raw);
        rackSizeUUpdate = Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
      }
    }

    const location = await siteLocationModel.update(locationId, id, {
      ...(dataParsed.template_type !== undefined ? { template_type: dataParsed.template_type } : {}),
      ...(dataParsed.floor !== undefined ? { floor: dataParsed.floor } : {}),
      ...(suiteUpdate !== undefined ? { suite: suiteUpdate } : {}),
      ...(rowUpdate !== undefined ? { row: rowUpdate } : {}),
      ...(rackUpdate !== undefined ? { rack: rackUpdate } : {}),
      ...(rackSizeUUpdate !== undefined ? { rack_size_u: rackSizeUUpdate } : {}),
      ...(areaUpdate !== undefined ? { area: areaUpdate } : {}),
      ...(labelUpdate !== undefined ? { label: labelUpdate } : {}),
    });

    if (!location) {
      return res.status(404).json({
        success: false,
        error: 'Location not found',
      } as ApiResponse);
    }

    res.json({
      success: true,
      data: { location },
      message: 'Location updated successfully',
    } as ApiResponse);

    try {
      const displayLabel = (location as any).effective_label ?? (location as any).label ?? req.site?.code ?? id;
      await logActivity({
        actorUserId: req.user!.userId,
        siteId: id,
        action: 'LOCATION_UPDATED',
        summary: `Updated location ${displayLabel} on site ${req.site?.name ?? id}`,
        metadata: {
          site_id: id,
          location_id: location.id,
          effective_label: (location as any).effective_label,
          label: (location as any).label,
        },
      });
    } catch (error) {
      console.warn('⚠️ Failed to log location update activity:', error);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: error.errors,
      } as ApiResponse);
    }

    if (error instanceof Error) {
      return res.status(400).json({
        success: false,
        error: error.message,
      } as ApiResponse);
    }

    console.error('Update site location error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    } as ApiResponse);
  }
});

/**
 * GET /api/sites/:id/locations/:locationId/usage
 * Return label usage counts for a location (site admins only)
 */
router.get(
  '/:id/locations/:locationId/usage',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req: Request, res: Response) => {
    try {
      const { id } = siteIdSchema.parse(req.params);
      const { locationId } = locationIdSchema.parse(req.params);

      const usage = await siteLocationModel.getLabelUsageCounts(id, locationId);
      return res.json({
        success: true,
        data: {
          usage: {
            source_count: usage.source,
            destination_count: usage.destination,
            total_in_use: usage.source + usage.destination,
          },
        },
      } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: error.errors,
        } as ApiResponse);
      }

      console.error('Get site location usage error:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
      } as ApiResponse);
    }
  }
);

/**
 * DELETE /api/sites/:id/locations/:locationId
 * Delete a structured location (site admins only)
 */
router.delete('/:id/locations/:locationId', authenticateToken, resolveSiteAccess(req => Number(req.params.id)), requireSiteRole('SITE_ADMIN'), async (req: Request, res: Response) => {
  try {
    const { id } = siteIdSchema.parse(req.params);
    const { locationId } = locationIdSchema.parse(req.params);

    let locationForLog: any = null;
    try {
      locationForLog = await siteLocationModel.findById(locationId, id);
    } catch {
      // ignore
    }

    const queryValidation = deleteLocationQuerySchema.safeParse(req.query);
    if (!queryValidation.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid query parameters',
        details: queryValidation.error.errors,
      } as ApiResponse);
    }

    const { strategy: strategyParam, cascade, target_location_id } = queryValidation.data;
    const legacyCascade = String(cascade || '').toLowerCase() === 'true';

    const strategy = legacyCascade
      ? 'cascade'
      : strategyParam === 'reassign'
        ? 'reassign'
        : strategyParam === 'cascade'
          ? 'cascade'
          : 'auto';

    const result = await siteLocationModel.deleteWithStrategy(locationId, id, {
      strategy,
      ...(target_location_id !== undefined ? { target_location_id } : {}),
    });

    if (!result.deleted) {
      return res.status(404).json({
        success: false,
        error: 'Location not found',
      } as ApiResponse);
    }

    res.json({
      success: true,
      data: {
        strategy: result.strategyUsed === 'none' ? 'auto' : result.strategyUsed,
        usage: {
          source_count: result.usage.source,
          destination_count: result.usage.destination,
          total_in_use: result.usage.source + result.usage.destination,
        },
        labels_deleted: result.labelsDeleted,
        labels_reassigned_source: result.labelsReassignedSource,
        labels_reassigned_destination: result.labelsReassignedDestination,
      },
      message: 'Location deleted successfully',
    } as ApiResponse);

    try {
      const displayLabel = locationForLog?.effective_label ?? locationForLog?.label ?? req.site?.code ?? id;
      await logActivity({
        actorUserId: req.user!.userId,
        siteId: id,
        action: 'LOCATION_DELETED',
        summary: `Deleted location ${displayLabel} on site ${req.site?.name ?? id}`,
        metadata: {
          site_id: id,
          location_id: locationId,
          effective_label: locationForLog?.effective_label,
          label: locationForLog?.label,
          strategy: result.strategyUsed,
          labels_deleted: result.labelsDeleted,
          labels_reassigned_source: result.labelsReassignedSource,
          labels_reassigned_destination: result.labelsReassignedDestination,
        },
      });
    } catch (error) {
      console.warn('⚠️ Failed to log location delete activity:', error);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: error.errors,
      } as ApiResponse);
    }

    if (error instanceof SiteLocationInUseError) {
      return res.status(409).json({
        success: false,
        error: error.message,
        data: {
          usage: {
            source_count: error.usage.source,
            destination_count: error.usage.destination,
            total_in_use: error.usage.source + error.usage.destination,
          },
        },
      } as ApiResponse);
    }

    if (error instanceof Error) {
      return res.status(400).json({
        success: false,
        error: error.message,
      } as ApiResponse);
    }

    console.error('Delete site location error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    } as ApiResponse);
  }
});

/**
 * POST /api/sites/:id/locations/:locationId/reassign-and-delete
 * Reassign all labels referencing this location (as source or destination) to another location, then delete it.
 */
router.post(
  '/:id/locations/:locationId/reassign-and-delete',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req: Request, res: Response) => {
    try {
      const { id } = siteIdSchema.parse(req.params);
      const { locationId } = locationIdSchema.parse(req.params);
      const body = reassignAndDeleteSchema.parse(req.body);

      let fromLocationLabel: string | null = null;
      let toLocationLabel: string | null = null;
      try {
        const [fromLocation, toLocation] = await Promise.all([
          siteLocationModel.findById(locationId, id),
          siteLocationModel.findById(body.reassign_to_location_id, id),
        ]);
        fromLocationLabel = fromLocation ? String((fromLocation as any).effective_label ?? (fromLocation as any).label ?? fromLocation.id) : null;
        toLocationLabel = toLocation ? String((toLocation as any).effective_label ?? (toLocation as any).label ?? toLocation.id) : null;
      } catch {
        // Best-effort only
      }

      const result = await siteLocationModel.deleteWithStrategy(locationId, id, {
        strategy: 'reassign',
        target_location_id: body.reassign_to_location_id,
      });

      if (!result.deleted) {
        return res.status(404).json({
          success: false,
          error: 'Location not found',
        } as ApiResponse);
      }

      try {
        const fromText = fromLocationLabel ? fromLocationLabel : `#${locationId}`;
        const toText = toLocationLabel ? toLocationLabel : `#${body.reassign_to_location_id}`;
        await logActivity({
          actorUserId: req.user!.userId,
          action: 'LOCATION_REASSIGNED_AND_DELETED',
          summary: `Reassigned labels from ${fromText} to ${toText} and deleted ${fromText}`,
          siteId: id,
          metadata: {
            from_location_id: locationId,
            to_location_id: body.reassign_to_location_id,
            usage: result.usage,
            labels_reassigned_source: result.labelsReassignedSource,
            labels_reassigned_destination: result.labelsReassignedDestination,
          },
        });
      } catch (error) {
        console.warn('⚠️ Failed to log location reassign+delete activity:', error);
      }

      return res.json({
        success: true,
        data: {
          usage: result.usage,
          labels_reassigned_source: result.labelsReassignedSource,
          labels_reassigned_destination: result.labelsReassignedDestination,
        },
        message: 'Location reassigned and deleted successfully',
      } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: error.errors,
        } as ApiResponse);
      }

      if (error instanceof SiteLocationInUseError) {
        return res.status(409).json({
          success: false,
          error: error.message,
          data: {
            usage: {
              source_count: error.usage.source,
              destination_count: error.usage.destination,
              total_in_use: error.usage.source + error.usage.destination,
            },
          },
        } as ApiResponse);
      }

      if (error instanceof Error) {
        return res.status(400).json({
          success: false,
          error: error.message,
        } as ApiResponse);
      }

      console.error('Reassign and delete site location error:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
      } as ApiResponse);
    }
  }
);

/**
 * GET /api/sites/:id/cable-types
 * List cable types for a site
 */
router.get(
  '/:id/cable-types',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  async (req: Request, res: Response) => {
    try {
      const { id } = siteIdSchema.parse(req.params);
      const cable_types = await cableTypeModel.listBySiteId(id);

      return res.json({
        success: true,
        data: { cable_types },
      } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: error.errors,
        } as ApiResponse);
      }

      console.error('List cable types error:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
      } as ApiResponse);
    }
  }
);

/**
 * GET /api/sites/:id/cable-types/:cableTypeId/usage
 * Return usage count for a cable type (site admins only)
 */
router.get(
  '/:id/cable-types/:cableTypeId/usage',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req: Request, res: Response) => {
    try {
      const { id } = siteIdSchema.parse(req.params);
      const { cableTypeId } = cableTypeIdSchema.parse(req.params);

      const cableType = await cableTypeModel.findById(cableTypeId, id);
      if (!cableType) {
        return res.status(404).json({
          success: false,
          error: 'Cable type not found',
        } as ApiResponse);
      }

      const inUseCount = await cableTypeModel.countLabelsUsingType(id, cableTypeId);
      return res.json({
        success: true,
        data: {
          usage: {
            cables_using_type: inUseCount,
          },
        },
      } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: error.errors,
        } as ApiResponse);
      }

      console.error('Cable type usage error:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
      } as ApiResponse);
    }
  }
);

/**
 * GET /api/sites/:id/cable-report
 * Download a Word document containing a printable cable report for the site.
 */
router.get(
  '/:id/cable-report',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  async (req: Request, res: Response) => {
    try {
      const { id } = siteIdSchema.parse(req.params);

      const siteName = String(req.site?.name ?? '').trim();
      const siteCode = String(req.site?.code ?? '').trim().toUpperCase();
      const siteLocation = String((req.site as any)?.location ?? '').trim();
      const siteDescription = String(req.site?.description ?? '').trim();
      if (!siteName || !siteCode) {
        return res.status(500).json({
          success: false,
          error: 'Failed to resolve site details',
        } as ApiResponse);
      }

      const createdAt = new Date();

      const [locationsRaw, cableTypesRaw, runsRaw] = await Promise.all([
        siteLocationModel.listBySiteId(id),
        cableTypeModel.listBySiteId(id),
        getAdapter().query(
          `SELECT
             l.ref_number,
             l.created_at,
             l.payload_json,
             u.username AS created_by_username,
             u.email AS created_by_email,
             ct.name AS cable_type_name,
             COALESCE(NULLIF(TRIM(sls.label), ''), s.code) AS source_name,
             sls.template_type AS source_template_type,
             sls.floor AS source_floor,
             sls.suite AS source_suite,
             sls.\`row\` AS source_row,
             sls.rack AS source_rack,
             sls.area AS source_area,
             COALESCE(NULLIF(TRIM(sld.label), ''), s.code) AS dest_name,
             sld.template_type AS dest_template_type,
             sld.floor AS dest_floor,
             sld.suite AS dest_suite,
             sld.\`row\` AS dest_row,
             sld.rack AS dest_rack
             , sld.area AS dest_area
           FROM labels l
           JOIN sites s ON s.id = l.site_id
           LEFT JOIN users u ON u.id = l.created_by
           LEFT JOIN cable_types ct ON ct.id = l.cable_type_id
           LEFT JOIN site_locations sls ON sls.id = l.source_location_id
           LEFT JOIN site_locations sld ON sld.id = l.destination_location_id
           WHERE l.site_id = ?
            AND (l.type IS NULL OR l.type = 'cable')
           ORDER BY l.ref_number ASC, l.id ASC`,
          [id]
        ),
      ]);

      const locations: CableReportLocation[] = (locationsRaw as any[]).map((l) => ({
        name: String((l as any).label ?? '').trim() || siteCode,
        label: siteCode,
        floor: String((l as any).floor ?? ''),
        ...((l as any).template_type != null ? { template_type: String((l as any).template_type) } : {}),
        ...((l as any).area != null ? { area: String((l as any).area) } : {}),
        ...((l as any).suite != null ? { suite: String((l as any).suite) } : {}),
        ...((l as any).row != null ? { row: String((l as any).row) } : {}),
        ...((l as any).rack != null ? { rack: String((l as any).rack) } : {}),
      }));

      const runs: CableReportRun[] = (runsRaw as any[]).map((r) => {
        const sourceHasFloor = r.source_floor != null;
        const destHasFloor = r.dest_floor != null;

        const source = sourceHasFloor
          ? {
              label: String(r.source_name ?? siteCode),
              floor: String(r.source_floor ?? ''),
              ...(r.source_template_type != null ? { template_type: String(r.source_template_type) } : {}),
              ...(r.source_suite != null ? { suite: String(r.source_suite) } : {}),
              ...(r.source_row != null ? { row: String(r.source_row) } : {}),
              ...(r.source_rack != null ? { rack: String(r.source_rack) } : {}),
              ...(r.source_area != null ? { area: String(r.source_area) } : {}),
            }
          : null;

        const destination = destHasFloor
          ? {
              label: String(r.dest_name ?? siteCode),
              floor: String(r.dest_floor ?? ''),
              ...(r.dest_template_type != null ? { template_type: String(r.dest_template_type) } : {}),
              ...(r.dest_suite != null ? { suite: String(r.dest_suite) } : {}),
              ...(r.dest_row != null ? { row: String(r.dest_row) } : {}),
              ...(r.dest_rack != null ? { rack: String(r.dest_rack) } : {}),
              ...(r.dest_area != null ? { area: String(r.dest_area) } : {}),
            }
          : null;

        const username = String(r.created_by_username ?? '').trim();
        const email = String(r.created_by_email ?? '').trim();
        const createdByDisplay = username || email || 'Unknown';

        let description: string | null = null;
        if (r.payload_json != null && String(r.payload_json).trim() !== '') {
          try {
            const parsed = JSON.parse(String(r.payload_json));
            const notes = (parsed as any)?.notes;
            if (typeof notes === 'string' && notes.trim() !== '') {
              description = notes.trim();
            }
          } catch {
            // ignore invalid payload_json
          }
        }

        return {
          ref_number: Number(r.ref_number),
          source,
          destination,
          cable_type_name: r.cable_type_name != null ? String(r.cable_type_name) : null,
          description,
          created_at: new Date(r.created_at),
          created_by_display: createdByDisplay,
        };
      });

      const buffer = await buildCableReportDocxBuffer({
        siteName,
        siteCode,
        ...(siteLocation ? { siteLocation } : {}),
        ...(siteDescription ? { siteDescription } : {}),
        createdAt,
        locations,
        cableTypes: (cableTypesRaw as any[]).map((ct) => ({ name: String((ct as any).name ?? '').trim() })),
        runs,
      });

      const ts = formatTimestampYYYYMMDD_HHMMSS(createdAt);
      const filename = `${siteCode}_cable_report_${ts}.docx`;

      try {
        await logActivity({
          actorUserId: req.user!.userId,
          action: 'CABLE_REPORT_DOWNLOADED',
          summary: `Downloaded cable report for ${siteName} (${siteCode})`,
          siteId: id,
          metadata: {
            filename,
            created_at: createdAt.toISOString(),
          },
        });
      } catch (error) {
        console.warn('⚠️ Failed to log cable report download activity:', error);
      }

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Report-Created-On', formatPrintedDateDDMonYYYY_HHMM(createdAt));
      return res.status(200).send(buffer);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: error.errors,
        } as ApiResponse);
      }

      console.error('Cable report generation error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to generate cable report',
      } as ApiResponse);
    }
  }
);

/**
 * POST /api/sites/:id/cable-types
 * Create a cable type for a site (site admins only)
 */
router.post(
  '/:id/cable-types',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req: Request, res: Response) => {
    try {
      const { id } = siteIdSchema.parse(req.params);
      const dataParsed = createCableTypeSchema.parse(req.body);

      const cable_type = await cableTypeModel.create({
        site_id: id,
        name: dataParsed.name,
        ...(dataParsed.description !== undefined ? { description: dataParsed.description } : {}),
      });

      try {
        await logActivity({
          actorUserId: req.user!.userId,
          action: 'CABLE_TYPE_CREATED',
          summary: `Created cable type ${cable_type.name}`,
          siteId: id,
          metadata: {
            cable_type_id: Number((cable_type as any).id),
            name: cable_type.name,
          },
        });
      } catch (error) {
        console.warn('⚠️ Failed to log cable type create activity:', error);
      }

      return res.status(201).json({
        success: true,
        data: { cable_type },
        message: 'Cable type created successfully',
      } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: error.errors,
        } as ApiResponse);
      }

      if (error instanceof Error) {
        const msg = error.message || '';
        if (/unique|UNIQUE|duplicate/i.test(msg)) {
          return res.status(409).json({
            success: false,
            error: 'Cable type name must be unique per site',
          } as ApiResponse);
        }

        return res.status(400).json({
          success: false,
          error: msg,
        } as ApiResponse);
      }

      console.error('Create cable type error:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
      } as ApiResponse);
    }
  }
);

/**
 * PUT /api/sites/:id/cable-types/:cableTypeId
 * Update a cable type (site admins only)
 */
router.put(
  '/:id/cable-types/:cableTypeId',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req: Request, res: Response) => {
    try {
      const { id } = siteIdSchema.parse(req.params);
      const { cableTypeId } = cableTypeIdSchema.parse(req.params);
      const dataParsed = updateCableTypeSchema.parse(req.body);

      const cable_type = await cableTypeModel.update(cableTypeId, id, {
        ...(dataParsed.name !== undefined ? { name: dataParsed.name } : {}),
        ...(dataParsed.description !== undefined ? { description: dataParsed.description ? dataParsed.description : null } : {}),
      });

      if (!cable_type) {
        return res.status(404).json({
          success: false,
          error: 'Cable type not found',
        } as ApiResponse);
      }

      try {
        await logActivity({
          actorUserId: req.user!.userId,
          action: 'CABLE_TYPE_UPDATED',
          summary: `Updated cable type ${cable_type.name}`,
          siteId: id,
          metadata: {
            cable_type_id: cableTypeId,
            changes: {
              ...(dataParsed.name !== undefined ? { name: dataParsed.name } : {}),
              ...(dataParsed.description !== undefined ? { description: dataParsed.description } : {}),
            },
          },
        });
      } catch (error) {
        console.warn('⚠️ Failed to log cable type update activity:', error);
      }

      return res.json({
        success: true,
        data: { cable_type },
        message: 'Cable type updated successfully',
      } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: error.errors,
        } as ApiResponse);
      }

      if (error instanceof Error) {
        const msg = error.message || '';
        if (/unique|UNIQUE|duplicate/i.test(msg)) {
          return res.status(409).json({
            success: false,
            error: 'Cable type name must be unique per site',
          } as ApiResponse);
        }

        return res.status(400).json({
          success: false,
          error: msg,
        } as ApiResponse);
      }

      console.error('Update cable type error:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
      } as ApiResponse);
    }
  }
);

/**
 * DELETE /api/sites/:id/cable-types/:cableTypeId
 * Delete a cable type (blocked if used by labels)
 */
router.delete(
  '/:id/cable-types/:cableTypeId',
  authenticateToken,
  resolveSiteAccess(req => Number(req.params.id)),
  requireSiteRole('SITE_ADMIN'),
  async (req: Request, res: Response) => {
    try {
      const { id } = siteIdSchema.parse(req.params);
      const { cableTypeId } = cableTypeIdSchema.parse(req.params);

      let cableTypeName: string | null = null;
      try {
        const rows = await getAdapter().query(
          'SELECT name FROM cable_types WHERE id = ? AND site_id = ? LIMIT 1',
          [cableTypeId, id]
        );
        cableTypeName = rows.length ? String((rows as any[])[0]?.name ?? '') : null;
      } catch {
        // Best-effort only
      }

      const inUseCount = await cableTypeModel.countLabelsUsingType(id, cableTypeId);
      if (inUseCount > 0) {
        return res.status(409).json({
          success: false,
          error: 'Cannot delete cable type that is in use',
          data: { labels_using_type: inUseCount },
        } as ApiResponse);
      }

      const deleted = await cableTypeModel.delete(cableTypeId, id);
      if (!deleted) {
        return res.status(404).json({
          success: false,
          error: 'Cable type not found',
        } as ApiResponse);
      }

      try {
        await logActivity({
          actorUserId: req.user!.userId,
          action: 'CABLE_TYPE_DELETED',
          summary: `Deleted cable type ${cableTypeName ? cableTypeName : `#${cableTypeId}`}`,
          siteId: id,
          metadata: {
            cable_type_id: cableTypeId,
            name: cableTypeName,
          },
        });
      } catch (error) {
        console.warn('⚠️ Failed to log cable type delete activity:', error);
      }

      return res.json({
        success: true,
        message: 'Cable type deleted successfully',
      } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: error.errors,
        } as ApiResponse);
      }

      if (error instanceof Error) {
        return res.status(400).json({
          success: false,
          error: error.message,
        } as ApiResponse);
      }

      console.error('Delete cable type error:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
      } as ApiResponse);
    }
  }
);

/**
 * DELETE /api/sites/:id
 * Delete a site
 *
 * By default, deletion is blocked if the site has labels.
 * To delete the site and all associated labels, pass `?cascade=true`.
 */
router.delete('/:id', authenticateToken, requireGlobalRole('GLOBAL_ADMIN'), async (req: Request, res: Response) => {
  try {
    // Validate site ID
    const { id } = siteIdSchema.parse(req.params);

    const cascade = String(req.query.cascade || '').toLowerCase() === 'true';

    let siteName: string | null = null;
    let siteCode: string | null = null;
    try {
      const existing = await siteModel.findById(id);
      if (existing) {
        siteName = String((existing as any).name ?? '').trim() || null;
        siteCode = String((existing as any).code ?? '').trim() || null;
      }
    } catch {
      // Best-effort only
    }

    // Attempt to delete site
    const deleted = await siteModel.delete(id, req.user!.userId, { cascade });

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Site not found',
      } as ApiResponse);
    }

    try {
      const label = siteName
        ? `${siteName}${siteCode ? ` (${String(siteCode).toUpperCase()})` : ''}`
        : `#${id}`;
      await logActivity({
        actorUserId: req.user!.userId,
        action: 'SITE_DELETED',
        summary: `Deleted site ${label}${cascade ? ' (cascade)' : ''}`,
        // Site has been deleted; avoid FK constraint on activity_log.site_id
        siteId: null,
        metadata: {
          site_id: id,
          name: siteName,
          code: siteCode,
          cascade,
        },
      });
    } catch (error) {
      console.warn('⚠️ Failed to log site delete activity:', error);
    }

    res.json({
      success: true,
      message: 'Site deleted successfully',
    } as ApiResponse);

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: error.errors,
      } as ApiResponse);
    }

    // Handle specific error for sites with labels
    if (error instanceof Error && error.message === 'Cannot delete site with existing labels') {
      return res.status(409).json({
        success: false,
        error: 'Cannot delete site with existing labels',
      } as ApiResponse);
    }

    console.error('Delete site error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    } as ApiResponse);
  }
});

export default router;