import connection from '../database/connection.js';
import { DatabaseAdapter } from '../database/adapters/base.js';
import { Label } from '../types/index.js';

export interface CreateLabelData {
  site_id: number;
  source_location_id: number;
  destination_location_id: number;
  cable_type_id: number;
  created_by: number;
  notes?: string;
  zpl_content?: string;
  via_patch_panel?: boolean;
  patch_panel_sid_id?: number | null;
  patch_panel_port?: number | null;
  source_connected_sid_id?: number | null;
  source_connected_hostname?: string | null;
  source_connected_port?: string | null;
  destination_connected_sid_id?: number | null;
  destination_connected_hostname?: string | null;
  destination_connected_port?: string | null;
  type?: string;
}

export interface UpdateLabelData {
  source_location_id?: number;
  destination_location_id?: number;
  cable_type_id?: number;
  notes?: string;
  zpl_content?: string;
  via_patch_panel?: boolean;
  patch_panel_sid_id?: number | null;
  patch_panel_port?: number | null;
  source_connected_sid_id?: number | null;
  source_connected_hostname?: string | null;
  source_connected_port?: string | null;
  destination_connected_sid_id?: number | null;
  destination_connected_hostname?: string | null;
  destination_connected_port?: string | null;
  type?: string;
}

export interface LabelSearchOptions {
  search?: string;
  reference_number?: string;
  source_location_id?: number;
  destination_location_id?: number;
  source_location_label?: string;
  source_floor?: string;
  source_suite?: string;
  source_row?: string;
  source_rack?: string;
  source_area?: string;
  destination_location_label?: string;
  destination_floor?: string;
  destination_suite?: string;
  destination_row?: string;
  destination_rack?: string;
  destination_area?: string;
  location_label?: string;
  floor?: string;
  suite?: string;
  row?: string;
  rack?: string;
  area?: string;
  cable_type_id?: number;
  cable_type?: string;
  created_by?: string;
  limit?: number;
  offset?: number;
  sort_by?: 'created_at' | 'ref_string';
  sort_order?: 'ASC' | 'DESC';
}

function makePayloadContainsPattern(value: string): string {
  return `%${value}%`;
}

function parseTrailingRefNumber(value: string): number | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const match = raw.match(/(\d+)\s*$/);
  if (!match) return null;
  const digits = match[1];
  if (!digits) return null;
  const num = Number.parseInt(digits, 10);
  if (!Number.isFinite(num) || num < 1) return null;
  return num;
}

export class LabelModel {
  private get adapter(): DatabaseAdapter {
    return connection.getAdapter();
  }

  private async getSiteCode(siteId: number): Promise<string> {
    const siteRows = await this.adapter.query(
      `SELECT code FROM sites WHERE id = ?`,
      [siteId]
    );

    if (!siteRows.length) {
      throw new Error('Site not found');
    }

    const siteCode = siteRows[0].code;
    if (!siteCode) {
      throw new Error('Site abbreviation is required');
    }

    return String(siteCode);
  }

  private async assertLocationBelongsToSite(siteId: number, locationId: number): Promise<void> {
    const rows = await this.adapter.query(
      `SELECT id FROM site_locations WHERE id = ? AND site_id = ?`,
      [locationId, siteId]
    );

    if (!rows.length) {
      throw new Error('Invalid site location');
    }
  }

  private async assertCableTypeBelongsToSite(siteId: number, cableTypeId: number): Promise<void> {
    const rows = await this.adapter.query(
      `SELECT id FROM cable_types WHERE id = ? AND site_id = ?`,
      [cableTypeId, siteId]
    );

    if (!rows.length) {
      throw new Error('Invalid cable type');
    }
  }

  async findByRefNumberRange(siteId: number, startRef: number, endRef: number): Promise<Label[]> {
    const safeStart = Math.max(1, Math.floor(Number(startRef)));
    const safeEnd = Math.max(1, Math.floor(Number(endRef)));

    if (safeStart > safeEnd) {
      throw new Error('Invalid reference range');
    }

    const query = `
      SELECT
        l.id,
        l.site_id,
        l.created_by,
        l.ref_number,
        l.ref_string,
        l.cable_type_id,
        l.type,
        l.payload_json,
        l.source_location_id,
        l.destination_location_id,
        l.created_at,
        l.updated_at,
        s.code as site_code,
        ct.id as ct_id,
        ct.name as ct_name,
        ct.description as ct_description,
        ct.created_at as ct_created_at,
        ct.updated_at as ct_updated_at,
        sls.id as sls_id,
        sls.template_type as sls_template_type,
        sls.floor as sls_floor,
        sls.suite as sls_suite,
        sls.\`row\` as sls_row,
        sls.rack as sls_rack,
        sls.area as sls_area,
        sls.label as sls_label,
        sld.id as sld_id,
        sld.template_type as sld_template_type,
        sld.floor as sld_floor,
        sld.suite as sld_suite,
        sld.\`row\` as sld_row,
        sld.rack as sld_rack,
        sld.area as sld_area,
        sld.label as sld_label
      FROM labels l
      JOIN sites s ON s.id = l.site_id
      LEFT JOIN cable_types ct ON ct.id = l.cable_type_id
      LEFT JOIN site_locations sls ON sls.id = l.source_location_id
      LEFT JOIN site_locations sld ON sld.id = l.destination_location_id
      WHERE l.site_id = ? AND l.ref_number BETWEEN ? AND ?
      ORDER BY l.ref_number ASC
    `;

    const params: any[] = [siteId, safeStart, safeEnd];

    // NOTE: Do NOT apply LIMIT here.
    // Range-based bulk downloads must be based on BETWEEN semantics,
    // not row counts. Missing reference numbers should simply be absent.
    // Keep ordering stable.
    const rows = await this.adapter.query(query, params);
    return (rows as any[]).map((row) => this.mapRow(row));
  }

  private async getNextRef(siteId: number): Promise<{ refNumber: number; refString: string }>{
    await this.getSiteCode(siteId);

    await this.adapter.beginTransaction();
    try {
      // Ensure a counter exists; if it's missing, seed it from existing labels.
      await this.adapter.execute(
        `INSERT INTO site_counters (site_id, next_ref)
         VALUES (?, (SELECT COALESCE(MAX(ref_number), 0) + 1 FROM labels WHERE site_id = ?))
         ON DUPLICATE KEY UPDATE next_ref = next_ref`,
        [siteId, siteId]
      );

      // Lock the counter row so concurrent creates allocate unique ranges.
      const rows = await this.adapter.query(
        `SELECT next_ref FROM site_counters WHERE site_id = ? FOR UPDATE`,
        [siteId]
      );

      const currentRef = rows[0]?.next_ref ? Number(rows[0].next_ref) : 1;
      const nextRef = currentRef + 1;

      await this.adapter.execute(
        `UPDATE site_counters SET next_ref = ? WHERE site_id = ?`,
        [nextRef, siteId]
      );

      await this.adapter.commit();

      const padded = String(currentRef).padStart(4, '0');
      return { refNumber: currentRef, refString: padded };
    } catch (error) {
      await this.adapter.rollback();
      throw error;
    }
  }

  private normalizeArea(value: unknown): string {
    const raw = (value ?? '').toString().trim();
    if (!raw) return '';
    return raw.replace(/\s+/g, ' ');
  }

  private isDomesticTemplate(location: {
    template_type?: string | null;
    area?: string | null;
    suite?: string | null;
    row?: string | null;
    rack?: string | null;
  }): boolean {
    const template = (location.template_type ?? '').toString().trim().toUpperCase();
    if (template === 'DOMESTIC') return true;
    if (template === 'DATACENTRE') return false;
    const area = this.normalizeArea(location.area);
    const hasDcFields = (location.suite ?? '').toString().trim() !== '' || (location.row ?? '').toString().trim() !== '' || (location.rack ?? '').toString().trim() !== '';
    return area !== '' && !hasDcFields;
  }

  private formatLocationDisplay(
    siteCode: string,
    location: {
      template_type?: 'DATACENTRE' | 'DOMESTIC' | string | null;
      label?: string | null;
      floor: string | null;
      suite?: string | null;
      row?: string | null;
      rack?: string | null;
      area?: string | null;
    }
  ): string {
    // UI display format (lists, admin screens, etc):
    //   <LocationLabel> — Label: <SiteAbbrev> | Floor: <Floor> | Suite: <Suite> | Row: <Row> | Rack: <Rack>
    const labelRaw = (location.label ?? '').toString().trim();
    const locationLabel = labelRaw !== '' ? labelRaw : siteCode;
    const floor = (location.floor ?? '').toString().trim();

    if (this.isDomesticTemplate(location)) {
      const area = this.normalizeArea(location.area);
      return `${locationLabel} — Label: ${siteCode} | Floor: ${floor} | Area: ${area}`;
    }

    const suite = (location.suite ?? '').toString().trim();
    const row = (location.row ?? '').toString().trim();
    const rack = (location.rack ?? '').toString().trim();
    return `${locationLabel} — Label: ${siteCode} | Floor: ${floor} | Suite: ${suite} | Row: ${row} | Rack: ${rack}`;
  }

  private mapRow(row: any): Label {
    let notes: string | undefined;
    let zpl_content: string | undefined;
    let via_patch_panel: boolean | undefined;
    let patch_panel_sid_id: number | null | undefined;
    let patch_panel_port: number | null | undefined;
    let source_connected_sid_id: number | null | undefined;
    let source_connected_hostname: string | null | undefined;
    let source_connected_port: string | null | undefined;
    let destination_connected_sid_id: number | null | undefined;
    let destination_connected_hostname: string | null | undefined;
    let destination_connected_port: string | null | undefined;

    if (row.payload_json) {
      try {
        const payload = JSON.parse(row.payload_json) as any;
        notes = payload.notes ?? undefined;
        zpl_content = payload.zpl_content ?? undefined;
        via_patch_panel = payload.via_patch_panel === true;
        patch_panel_sid_id = payload.patch_panel_sid_id == null ? null : Number(payload.patch_panel_sid_id);
        patch_panel_port = payload.patch_panel_port == null ? null : Number(payload.patch_panel_port);
        source_connected_sid_id = payload.source_connected_sid_id == null ? null : Number(payload.source_connected_sid_id);
        source_connected_hostname = payload.source_connected_hostname == null ? null : String(payload.source_connected_hostname);
        source_connected_port = payload.source_connected_port == null ? null : String(payload.source_connected_port);
        destination_connected_sid_id = payload.destination_connected_sid_id == null ? null : Number(payload.destination_connected_sid_id);
        destination_connected_hostname = payload.destination_connected_hostname == null ? null : String(payload.destination_connected_hostname);
        destination_connected_port = payload.destination_connected_port == null ? null : String(payload.destination_connected_port);
      } catch {
        // ignore
      }
    }

    const siteCode = row.site_code as string | undefined;

    const cableType = row.ct_id
      ? {
          id: Number(row.ct_id),
          site_id: Number(row.site_id),
          name: String(row.ct_name),
          description: row.ct_description ?? null,
          created_at: row.ct_created_at ?? row.created_at,
          updated_at: row.ct_updated_at ?? row.updated_at,
        }
      : null;

    const sourceLoc = row.sls_id
      ? {
          id: Number(row.sls_id),
          site_id: Number(row.site_id),
          template_type: row.sls_template_type ?? undefined,
          floor: String(row.sls_floor),
          suite: row.sls_suite == null ? null : String(row.sls_suite),
          row: row.sls_row == null ? null : String(row.sls_row),
          rack: row.sls_rack == null ? null : String(row.sls_rack),
          area: row.sls_area == null ? null : String(row.sls_area),
          label: row.sls_label ?? null,
          created_at: row.created_at,
          updated_at: row.updated_at,
        }
      : null;

    const destLoc = row.sld_id
      ? {
          id: Number(row.sld_id),
          site_id: Number(row.site_id),
          template_type: row.sld_template_type ?? undefined,
          floor: String(row.sld_floor),
          suite: row.sld_suite == null ? null : String(row.sld_suite),
          row: row.sld_row == null ? null : String(row.sld_row),
          rack: row.sld_rack == null ? null : String(row.sld_rack),
          area: row.sld_area == null ? null : String(row.sld_area),
          label: row.sld_label ?? null,
          created_at: row.created_at,
          updated_at: row.updated_at,
        }
      : null;

    const formattedSource = siteCode && sourceLoc ? this.formatLocationDisplay(siteCode, sourceLoc) : '';
    const formattedDestination = siteCode && destLoc ? this.formatLocationDisplay(siteCode, destLoc) : '';

    return {
      id: Number(row.id),
      site_id: Number(row.site_id),
      created_by: Number(row.created_by),
      created_by_name: row.created_by_name ?? null,
      created_by_email: row.created_by_email ?? null,
      ref_number: Number(row.ref_number),
      ref_string: String(row.ref_string),
      cable_type_id: row.cable_type_id ?? null,
      cable_type: cableType,
      type: String(row.type),
      payload_json: row.payload_json ?? null,
      source_location_id: row.source_location_id ?? null,
      destination_location_id: row.destination_location_id ?? null,
      source_location: sourceLoc,
      destination_location: destLoc,
      created_at: row.created_at,
      updated_at: row.updated_at,
      reference_number: String(row.ref_string),
      source: formattedSource,
      destination: formattedDestination,
      ...(notes !== undefined ? { notes } : {}),
      ...(zpl_content !== undefined ? { zpl_content } : {}),
      ...(via_patch_panel !== undefined ? { via_patch_panel } : {}),
      ...(patch_panel_sid_id !== undefined ? { patch_panel_sid_id } : {}),
      ...(patch_panel_port !== undefined ? { patch_panel_port } : {}),
      ...(source_connected_sid_id !== undefined ? { source_connected_sid_id } : {}),
      ...(source_connected_hostname !== undefined ? { source_connected_hostname } : {}),
      ...(source_connected_port !== undefined ? { source_connected_port } : {}),
      ...(destination_connected_sid_id !== undefined ? { destination_connected_sid_id } : {}),
      ...(destination_connected_hostname !== undefined ? { destination_connected_hostname } : {}),
      ...(destination_connected_port !== undefined ? { destination_connected_port } : {}),
    };
  }

  async create(labelData: CreateLabelData): Promise<Label> {
    const {
      site_id,
      created_by,
      notes,
      zpl_content,
      via_patch_panel,
      patch_panel_sid_id,
      patch_panel_port,
      source_connected_sid_id,
      source_connected_hostname,
      source_connected_port,
      destination_connected_sid_id,
      destination_connected_hostname,
      destination_connected_port,
      type = 'cable',
      source_location_id,
      destination_location_id,
      cable_type_id,
    } = labelData;

    if (!Number.isFinite(source_location_id) || source_location_id < 1) {
      throw new Error('Source location is required');
    }

    if (!Number.isFinite(destination_location_id) || destination_location_id < 1) {
      throw new Error('Destination location is required');
    }

    if (!Number.isFinite(cable_type_id) || cable_type_id < 1) {
      throw new Error('Cable type is required');
    }

    await this.assertLocationBelongsToSite(site_id, source_location_id);
    await this.assertLocationBelongsToSite(site_id, destination_location_id);
    await this.assertCableTypeBelongsToSite(site_id, cable_type_id);

    const { refNumber, refString } = await this.getNextRef(site_id);
    const payload = {
      notes: notes || null,
      zpl_content: zpl_content || null,
      via_patch_panel: via_patch_panel === true,
      patch_panel_sid_id: via_patch_panel === true ? (patch_panel_sid_id ?? null) : null,
      patch_panel_port: via_patch_panel === true ? (patch_panel_port ?? null) : null,
      source_connected_sid_id: source_connected_sid_id ?? null,
      source_connected_hostname: source_connected_hostname ? String(source_connected_hostname).trim() : null,
      source_connected_port: source_connected_port ? String(source_connected_port).trim() : null,
      destination_connected_sid_id: destination_connected_sid_id ?? null,
      destination_connected_hostname: destination_connected_hostname ? String(destination_connected_hostname).trim() : null,
      destination_connected_port: destination_connected_port ? String(destination_connected_port).trim() : null,
    };

    const result = await this.adapter.execute(
      `INSERT INTO labels (site_id, ref_number, ref_string, cable_type_id, type, payload_json, created_by, source_location_id, destination_location_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ,[site_id, refNumber, refString, cable_type_id, type, JSON.stringify(payload), created_by, source_location_id, destination_location_id]
    );

    if (!result.insertId) {
      throw new Error('Failed to create label');
    }

    const created = await this.findById(Number(result.insertId), site_id);
    if (!created) {
      throw new Error('Failed to load created label');
    }

    return created;
  }

  async createMany(labelData: CreateLabelData, quantity: number): Promise<Label[]> {
    const {
      site_id,
      created_by,
      notes,
      zpl_content,
      via_patch_panel,
      patch_panel_sid_id,
      patch_panel_port,
      source_connected_sid_id,
      source_connected_hostname,
      source_connected_port,
      destination_connected_sid_id,
      destination_connected_hostname,
      destination_connected_port,
      type = 'cable',
      source_location_id,
      destination_location_id,
      cable_type_id,
    } = labelData;

    const qty = Math.floor(Number(quantity));
    if (!Number.isFinite(qty) || qty < 1) {
      throw new Error('Quantity must be at least 1');
    }
    if (qty > 500) {
      throw new Error('Quantity cannot exceed 500');
    }

    if (!Number.isFinite(source_location_id) || source_location_id < 1) {
      throw new Error('Source location is required');
    }

    if (!Number.isFinite(destination_location_id) || destination_location_id < 1) {
      throw new Error('Destination location is required');
    }

    if (!Number.isFinite(cable_type_id) || cable_type_id < 1) {
      throw new Error('Cable type is required');
    }

    await this.assertLocationBelongsToSite(site_id, source_location_id);
    await this.assertLocationBelongsToSite(site_id, destination_location_id);
    await this.assertCableTypeBelongsToSite(site_id, cable_type_id);

    // Ensures site exists and preserves previous error messages.
    await this.getSiteCode(site_id);

    const payload = {
      notes: notes || null,
      zpl_content: zpl_content || null,
      via_patch_panel: via_patch_panel === true,
      patch_panel_sid_id: via_patch_panel === true ? (patch_panel_sid_id ?? null) : null,
      patch_panel_port: via_patch_panel === true ? (patch_panel_port ?? null) : null,
      source_connected_sid_id: source_connected_sid_id ?? null,
      source_connected_hostname: source_connected_hostname ? String(source_connected_hostname).trim() : null,
      source_connected_port: source_connected_port ? String(source_connected_port).trim() : null,
      destination_connected_sid_id: destination_connected_sid_id ?? null,
      destination_connected_hostname: destination_connected_hostname ? String(destination_connected_hostname).trim() : null,
      destination_connected_port: destination_connected_port ? String(destination_connected_port).trim() : null,
    };

    let startRef = 1;
    let endRef = 1;

    await this.adapter.beginTransaction();
    try {
      // Ensure a counter exists; if it's missing, seed it from existing labels.
      await this.adapter.execute(
        `INSERT INTO site_counters (site_id, next_ref)
         VALUES (?, (SELECT COALESCE(MAX(ref_number), 0) + 1 FROM labels WHERE site_id = ?))
         ON DUPLICATE KEY UPDATE next_ref = next_ref`,
        [site_id, site_id]
      );

      // Lock the counter row so concurrent creates allocate unique ranges.
      const counterRows = await this.adapter.query(
        `SELECT next_ref FROM site_counters WHERE site_id = ? FOR UPDATE`,
        [site_id]
      );

      startRef = counterRows[0]?.next_ref ? Number(counterRows[0].next_ref) : 1;
      endRef = startRef + qty - 1;
      const nextRefAfterBlock = endRef + 1;

      await this.adapter.execute(
        `UPDATE site_counters SET next_ref = ? WHERE site_id = ?`,
        [nextRefAfterBlock, site_id]
      );

      for (let i = 0; i < qty; i++) {
        const refNumber = startRef + i;
        const refString = String(refNumber).padStart(4, '0');

        await this.adapter.execute(
          `INSERT INTO labels (site_id, ref_number, ref_string, cable_type_id, type, payload_json, created_by, source_location_id, destination_location_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            site_id,
            refNumber,
            refString,
            cable_type_id,
            type,
            JSON.stringify(payload),
            created_by,
            source_location_id,
            destination_location_id,
          ]
        );
      }

      await this.adapter.commit();
    } catch (error) {
      await this.adapter.rollback();
      throw error;
    }

    const created = await this.findByRefNumberRange(site_id, startRef, endRef);
    if (created.length !== qty) {
      throw new Error('Failed to load created labels');
    }
    return created;
  }

  async findById(id: number, siteId: number): Promise<Label | null> {
    const rows = await this.adapter.query(
      `SELECT
        l.id,
        l.site_id,
        l.created_by,
        l.ref_number,
        l.ref_string,
        l.cable_type_id,
        l.type,
        l.payload_json,
        l.source_location_id,
        l.destination_location_id,
        l.created_at,
        l.updated_at,
        u.username as created_by_name,
        u.email as created_by_email,
        s.code as site_code,
        ct.id as ct_id, ct.name as ct_name, ct.description as ct_description, ct.created_at as ct_created_at, ct.updated_at as ct_updated_at,
        sls.id as sls_id, sls.template_type as sls_template_type, sls.floor as sls_floor, sls.suite as sls_suite, sls.\`row\` as sls_row, sls.rack as sls_rack, sls.area as sls_area, sls.label as sls_label,
        sld.id as sld_id, sld.template_type as sld_template_type, sld.floor as sld_floor, sld.suite as sld_suite, sld.\`row\` as sld_row, sld.rack as sld_rack, sld.area as sld_area, sld.label as sld_label
       FROM labels l
       JOIN sites s ON s.id = l.site_id
       LEFT JOIN users u ON u.id = l.created_by
       LEFT JOIN cable_types ct ON ct.id = l.cable_type_id
       LEFT JOIN site_locations sls ON sls.id = l.source_location_id
       LEFT JOIN site_locations sld ON sld.id = l.destination_location_id
       WHERE l.id = ? AND l.site_id = ?`,
      [id, siteId]
    );

    return rows.length > 0 ? this.mapRow(rows[0]) : null;
  }

  async findBySiteId(siteId: number, options: LabelSearchOptions = {}): Promise<Label[]> {
    const { limit = 50, offset = 0, sort_by = 'created_at', sort_order = 'DESC' } = options;
    const safeLimit = Math.max(0, parseInt(String(limit), 10) || 50);
    const safeOffset = Math.max(0, parseInt(String(offset), 10) || 0);

    let query = `
      SELECT
        l.id,
        l.site_id,
        l.created_by,
        l.ref_number,
        l.ref_string,
        l.cable_type_id,
        l.type,
        l.payload_json,
        l.source_location_id,
        l.destination_location_id,
        l.created_at,
        l.updated_at,
        u.username as created_by_name,
        u.email as created_by_email,
        s.code as site_code,
        ct.id as ct_id, ct.name as ct_name, ct.description as ct_description, ct.created_at as ct_created_at, ct.updated_at as ct_updated_at,
        sls.id as sls_id, sls.template_type as sls_template_type, sls.floor as sls_floor, sls.suite as sls_suite, sls.\`row\` as sls_row, sls.rack as sls_rack, sls.area as sls_area, sls.label as sls_label,
        sld.id as sld_id, sld.template_type as sld_template_type, sld.floor as sld_floor, sld.suite as sld_suite, sld.\`row\` as sld_row, sld.rack as sld_rack, sld.area as sld_area, sld.label as sld_label
      FROM labels l
      JOIN sites s ON s.id = l.site_id
      LEFT JOIN users u ON u.id = l.created_by
      LEFT JOIN cable_types ct ON ct.id = l.cable_type_id
      LEFT JOIN site_locations sls ON sls.id = l.source_location_id
      LEFT JOIN site_locations sld ON sld.id = l.destination_location_id
      WHERE l.site_id = ?
    `;

    const params: any[] = [siteId];

    if (options.reference_number) {
      const refNum = parseTrailingRefNumber(options.reference_number);
      if (refNum !== null) {
        query += ` AND l.ref_number = ?`;
        params.push(refNum);
      } else {
        query += ` AND l.ref_string = ?`;
        params.push(options.reference_number);
      }
    }

    if (options.source_location_id) {
      query += ` AND l.source_location_id = ?`;
      params.push(Number(options.source_location_id));
    }

    if (options.destination_location_id) {
      query += ` AND l.destination_location_id = ?`;
      params.push(Number(options.destination_location_id));
    }

    if (options.source_location_label) {
      query += ` AND (COALESCE(sls.label, s.code) LIKE ?)`;
      params.push(makePayloadContainsPattern(String(options.source_location_label)));
    }

    if (options.source_floor) {
      query += ` AND (sls.floor LIKE ?)`;
      params.push(makePayloadContainsPattern(String(options.source_floor)));
    }

    if (options.source_suite) {
      query += ` AND (sls.suite LIKE ?)`;
      params.push(makePayloadContainsPattern(String(options.source_suite)));
    }

    if (options.source_row) {
      query += ` AND (sls.\`row\` LIKE ?)`;
      params.push(makePayloadContainsPattern(String(options.source_row)));
    }

    if (options.source_rack) {
      query += ` AND (sls.rack LIKE ?)`;
      params.push(makePayloadContainsPattern(String(options.source_rack)));
    }

    if (options.source_area) {
      query += ` AND (sls.area LIKE ?)`;
      params.push(makePayloadContainsPattern(String(options.source_area)));
    }

    if (options.destination_location_label) {
      query += ` AND (COALESCE(sld.label, s.code) LIKE ?)`;
      params.push(makePayloadContainsPattern(String(options.destination_location_label)));
    }

    if (options.destination_floor) {
      query += ` AND (sld.floor LIKE ?)`;
      params.push(makePayloadContainsPattern(String(options.destination_floor)));
    }

    if (options.destination_suite) {
      query += ` AND (sld.suite LIKE ?)`;
      params.push(makePayloadContainsPattern(String(options.destination_suite)));
    }

    if (options.destination_row) {
      query += ` AND (sld.\`row\` LIKE ?)`;
      params.push(makePayloadContainsPattern(String(options.destination_row)));
    }

    if (options.destination_rack) {
      query += ` AND (sld.rack LIKE ?)`;
      params.push(makePayloadContainsPattern(String(options.destination_rack)));
    }

    if (options.destination_area) {
      query += ` AND (sld.area LIKE ?)`;
      params.push(makePayloadContainsPattern(String(options.destination_area)));
    }

    if (options.location_label) {
      query += ` AND (sls.label LIKE ? OR sld.label LIKE ?)`;
      const p = makePayloadContainsPattern(String(options.location_label));
      params.push(p, p);
    }

    if (options.floor) {
      query += ` AND (sls.floor LIKE ? OR sld.floor LIKE ?)`;
      const p = makePayloadContainsPattern(String(options.floor));
      params.push(p, p);
    }

    if (options.suite) {
      query += ` AND (sls.suite LIKE ? OR sld.suite LIKE ?)`;
      const p = makePayloadContainsPattern(String(options.suite));
      params.push(p, p);
    }

    if (options.row) {
      query += ` AND (sls.\`row\` LIKE ? OR sld.\`row\` LIKE ?)`;
      const p = makePayloadContainsPattern(String(options.row));
      params.push(p, p);
    }

    if (options.rack) {
      query += ` AND (sls.rack LIKE ? OR sld.rack LIKE ?)`;
      const p = makePayloadContainsPattern(String(options.rack));
      params.push(p, p);
    }

    if (options.area) {
      query += ` AND (sls.area LIKE ? OR sld.area LIKE ?)`;
      const p = makePayloadContainsPattern(String(options.area));
      params.push(p, p);
    }

    if (options.cable_type_id) {
      query += ` AND (l.cable_type_id = ?)`;
      params.push(Number(options.cable_type_id));
    }

    if (options.cable_type) {
      query += ` AND (ct.name LIKE ?)`;
      const p = makePayloadContainsPattern(String(options.cable_type));
      params.push(p);
    }

    if (options.created_by) {
      query += ` AND (u.username LIKE ? OR u.email LIKE ?)`;
      const p = makePayloadContainsPattern(String(options.created_by));
      params.push(p, p);
    }

    if (options.search) {
      query += ` AND (
        l.ref_string LIKE ?
        OR l.payload_json LIKE ?
        OR ct.name LIKE ?
        OR u.username LIKE ?
        OR u.email LIKE ?
        OR sls.label LIKE ?
        OR sld.label LIKE ?
        OR sls.floor LIKE ?
        OR sld.floor LIKE ?
        OR sls.suite LIKE ?
        OR sld.suite LIKE ?
        OR sls.\`row\` LIKE ?
        OR sld.\`row\` LIKE ?
        OR sls.rack LIKE ?
        OR sld.rack LIKE ?
        OR CONCAT('Floor ', IFNULL(sls.floor, '')) LIKE ?
        OR CONCAT('Floor ', IFNULL(sld.floor, '')) LIKE ?
        OR CONCAT('Suite ', IFNULL(sls.suite, '')) LIKE ?
        OR CONCAT('Suite ', IFNULL(sld.suite, '')) LIKE ?
        OR CONCAT('Row ', IFNULL(sls.\`row\`, '')) LIKE ?
        OR CONCAT('Row ', IFNULL(sld.\`row\`, '')) LIKE ?
        OR CONCAT('Rack ', IFNULL(sls.rack, '')) LIKE ?
        OR CONCAT('Rack ', IFNULL(sld.rack, '')) LIKE ?
      )`;
      const searchPattern = makePayloadContainsPattern(String(options.search));
      params.push(
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern
      );
    }

    // Use numeric ordering for reference sorting so it stays correct past 9999.
    query += ` ORDER BY ${sort_by === 'ref_string' ? 'l.ref_number' : 'l.created_at'} ${sort_order}`;

    query += ` LIMIT ${safeLimit} OFFSET ${safeOffset}`;

    const rows = await this.adapter.query(query, params);
    return (rows as any[]).map((row) => this.mapRow(row));
  }

  async update(id: number, siteId: number, labelData: UpdateLabelData): Promise<Label | null> {
    const updates: string[] = [];
    const values: any[] = [];

    if (labelData.source_location_id !== undefined) {
      await this.assertLocationBelongsToSite(siteId, labelData.source_location_id);
      updates.push('source_location_id = ?');
      values.push(labelData.source_location_id);
    }

    if (labelData.destination_location_id !== undefined) {
      await this.assertLocationBelongsToSite(siteId, labelData.destination_location_id);
      updates.push('destination_location_id = ?');
      values.push(labelData.destination_location_id);
    }

    if (labelData.cable_type_id !== undefined) {
      await this.assertCableTypeBelongsToSite(siteId, labelData.cable_type_id);
      updates.push('cable_type_id = ?');
      values.push(labelData.cable_type_id);
    }

    if (
      labelData.notes !== undefined ||
      labelData.zpl_content !== undefined ||
      labelData.via_patch_panel !== undefined ||
      labelData.patch_panel_sid_id !== undefined ||
      labelData.patch_panel_port !== undefined ||
      labelData.source_connected_sid_id !== undefined ||
      labelData.source_connected_hostname !== undefined ||
      labelData.source_connected_port !== undefined ||
      labelData.destination_connected_sid_id !== undefined ||
      labelData.destination_connected_hostname !== undefined ||
      labelData.destination_connected_port !== undefined
    ) {
      const existing = await this.findById(id, siteId);
      const existingPayload = existing?.payload_json ? (() => {
        try { return JSON.parse(existing.payload_json) as any; } catch { return {}; }
      })() : {};

      const payload: any = {
        ...existingPayload,
      };

      if (labelData.notes !== undefined) payload.notes = labelData.notes || null;
      if (labelData.zpl_content !== undefined) payload.zpl_content = labelData.zpl_content || null;
      if (labelData.via_patch_panel !== undefined) {
        payload.via_patch_panel = labelData.via_patch_panel === true;
        if (labelData.via_patch_panel !== true) {
          payload.patch_panel_sid_id = null;
          payload.patch_panel_port = null;
        }
      }
      if (labelData.patch_panel_sid_id !== undefined) payload.patch_panel_sid_id = labelData.patch_panel_sid_id ?? null;
      if (labelData.patch_panel_port !== undefined) payload.patch_panel_port = labelData.patch_panel_port ?? null;
      if (labelData.source_connected_sid_id !== undefined) payload.source_connected_sid_id = labelData.source_connected_sid_id ?? null;
      if (labelData.source_connected_hostname !== undefined) payload.source_connected_hostname = labelData.source_connected_hostname ? String(labelData.source_connected_hostname).trim() : null;
      if (labelData.source_connected_port !== undefined) payload.source_connected_port = labelData.source_connected_port ? String(labelData.source_connected_port).trim() : null;
      if (labelData.destination_connected_sid_id !== undefined) payload.destination_connected_sid_id = labelData.destination_connected_sid_id ?? null;
      if (labelData.destination_connected_hostname !== undefined) payload.destination_connected_hostname = labelData.destination_connected_hostname ? String(labelData.destination_connected_hostname).trim() : null;
      if (labelData.destination_connected_port !== undefined) payload.destination_connected_port = labelData.destination_connected_port ? String(labelData.destination_connected_port).trim() : null;

      updates.push('payload_json = ?');
      values.push(JSON.stringify(payload));
    }

    if (labelData.type !== undefined) {
      updates.push('type = ?');
      values.push(labelData.type);
    }

    if (updates.length === 0) {
      return this.findById(id, siteId);
    }

    values.push(id, siteId);

    const result = await this.adapter.execute(
      `UPDATE labels
       SET ${updates.join(', ')}
       WHERE id = ? AND site_id = ?`,
      values
    );

    if (result.affectedRows === 0) {
      return null;
    }

    return this.findById(id, siteId);
  }

  async delete(id: number, siteId: number): Promise<boolean> {
    const result = await this.adapter.execute(
      `DELETE FROM labels WHERE id = ? AND site_id = ?`,
      [id, siteId]
    );

    return result.affectedRows > 0;
  }

  async bulkDelete(ids: number[], siteId: number): Promise<number> {
    const placeholders = ids.map(() => '?').join(', ');
    const result = await this.adapter.execute(
      `DELETE FROM labels WHERE site_id = ? AND id IN (${placeholders})`,
      [siteId, ...ids]
    );

    return result.affectedRows || 0;
  }

  async countBySiteId(
    siteId: number,
    options: Pick<
      LabelSearchOptions,
      | 'search'
      | 'reference_number'
      | 'source_location_id'
      | 'destination_location_id'
      | 'source_location_label'
      | 'source_floor'
      | 'source_suite'
      | 'source_row'
      | 'source_rack'
      | 'source_area'
      | 'destination_location_label'
      | 'destination_floor'
      | 'destination_suite'
      | 'destination_row'
      | 'destination_rack'
      | 'destination_area'
      | 'location_label'
      | 'floor'
      | 'suite'
      | 'row'
      | 'rack'
      | 'area'
      | 'cable_type_id'
      | 'cable_type'
      | 'created_by'
    > = {}
  ): Promise<number> {
    let query = `
      SELECT COUNT(*) as count
      FROM labels l
      JOIN sites s ON s.id = l.site_id
      LEFT JOIN users u ON u.id = l.created_by
      LEFT JOIN cable_types ct ON ct.id = l.cable_type_id
      LEFT JOIN site_locations sls ON sls.id = l.source_location_id
      LEFT JOIN site_locations sld ON sld.id = l.destination_location_id
      WHERE l.site_id = ?
    `;
    const params: any[] = [siteId];

    if (options.reference_number) {
      const refNum = parseTrailingRefNumber(options.reference_number);
      if (refNum !== null) {
        query += ` AND l.ref_number = ?`;
        params.push(refNum);
      } else {
        query += ` AND l.ref_string = ?`;
        params.push(options.reference_number);
      }
    }

    if (options.source_location_id) {
      query += ` AND l.source_location_id = ?`;
      params.push(Number(options.source_location_id));
    }

    if (options.destination_location_id) {
      query += ` AND l.destination_location_id = ?`;
      params.push(Number(options.destination_location_id));
    }

    if (options.source_location_label) {
      query += ` AND (COALESCE(sls.label, s.code) LIKE ?)`;
      params.push(makePayloadContainsPattern(String(options.source_location_label)));
    }

    if (options.source_floor) {
      query += ` AND (sls.floor LIKE ?)`;
      params.push(makePayloadContainsPattern(String(options.source_floor)));
    }

    if (options.source_suite) {
      query += ` AND (sls.suite LIKE ?)`;
      params.push(makePayloadContainsPattern(String(options.source_suite)));
    }

    if (options.source_row) {
      query += ` AND (sls.\`row\` LIKE ?)`;
      params.push(makePayloadContainsPattern(String(options.source_row)));
    }

    if (options.source_rack) {
      query += ` AND (sls.rack LIKE ?)`;
      params.push(makePayloadContainsPattern(String(options.source_rack)));
    }

    if (options.source_area) {
      query += ` AND (sls.area LIKE ?)`;
      params.push(makePayloadContainsPattern(String(options.source_area)));
    }

    if (options.destination_location_label) {
      query += ` AND (COALESCE(sld.label, s.code) LIKE ?)`;
      params.push(makePayloadContainsPattern(String(options.destination_location_label)));
    }

    if (options.destination_floor) {
      query += ` AND (sld.floor LIKE ?)`;
      params.push(makePayloadContainsPattern(String(options.destination_floor)));
    }

    if (options.destination_suite) {
      query += ` AND (sld.suite LIKE ?)`;
      params.push(makePayloadContainsPattern(String(options.destination_suite)));
    }

    if (options.destination_row) {
      query += ` AND (sld.\`row\` LIKE ?)`;
      params.push(makePayloadContainsPattern(String(options.destination_row)));
    }

    if (options.destination_rack) {
      query += ` AND (sld.rack LIKE ?)`;
      params.push(makePayloadContainsPattern(String(options.destination_rack)));
    }

    if (options.destination_area) {
      query += ` AND (sld.area LIKE ?)`;
      params.push(makePayloadContainsPattern(String(options.destination_area)));
    }

    if (options.location_label) {
      query += ` AND (sls.label LIKE ? OR sld.label LIKE ?)`;
      const p = makePayloadContainsPattern(String(options.location_label));
      params.push(p, p);
    }

    if (options.floor) {
      query += ` AND (sls.floor LIKE ? OR sld.floor LIKE ?)`;
      const p = makePayloadContainsPattern(String(options.floor));
      params.push(p, p);
    }

    if (options.suite) {
      query += ` AND (sls.suite LIKE ? OR sld.suite LIKE ?)`;
      const p = makePayloadContainsPattern(String(options.suite));
      params.push(p, p);
    }

    if (options.row) {
      query += ` AND (sls.\`row\` LIKE ? OR sld.\`row\` LIKE ?)`;
      const p = makePayloadContainsPattern(String(options.row));
      params.push(p, p);
    }

    if (options.rack) {
      query += ` AND (sls.rack LIKE ? OR sld.rack LIKE ?)`;
      const p = makePayloadContainsPattern(String(options.rack));
      params.push(p, p);
    }

    if (options.area) {
      query += ` AND (sls.area LIKE ? OR sld.area LIKE ?)`;
      const p = makePayloadContainsPattern(String(options.area));
      params.push(p, p);
    }

    if (options.cable_type_id) {
      query += ` AND (l.cable_type_id = ?)`;
      params.push(Number(options.cable_type_id));
    }

    if (options.cable_type) {
      query += ` AND (ct.name LIKE ?)`;
      const p = makePayloadContainsPattern(String(options.cable_type));
      params.push(p);
    }

    if (options.created_by) {
      query += ` AND (u.username LIKE ? OR u.email LIKE ?)`;
      const p = makePayloadContainsPattern(String(options.created_by));
      params.push(p, p);
    }

    if (options.search) {
      query += ` AND (
        l.ref_string LIKE ?
        OR l.payload_json LIKE ?
        OR ct.name LIKE ?
        OR u.username LIKE ?
        OR u.email LIKE ?
        OR sls.label LIKE ?
        OR sld.label LIKE ?
        OR sls.floor LIKE ?
        OR sld.floor LIKE ?
        OR sls.suite LIKE ?
        OR sld.suite LIKE ?
        OR sls.\`row\` LIKE ?
        OR sld.\`row\` LIKE ?
        OR sls.rack LIKE ?
        OR sld.rack LIKE ?
        OR CONCAT('Floor ', IFNULL(sls.floor, '')) LIKE ?
        OR CONCAT('Floor ', IFNULL(sld.floor, '')) LIKE ?
        OR CONCAT('Suite ', IFNULL(sls.suite, '')) LIKE ?
        OR CONCAT('Suite ', IFNULL(sld.suite, '')) LIKE ?
        OR CONCAT('Row ', IFNULL(sls.\`row\`, '')) LIKE ?
        OR CONCAT('Row ', IFNULL(sld.\`row\`, '')) LIKE ?
        OR CONCAT('Rack ', IFNULL(sls.rack, '')) LIKE ?
        OR CONCAT('Rack ', IFNULL(sld.rack, '')) LIKE ?
      )`;
      const searchPattern = makePayloadContainsPattern(String(options.search));
      params.push(
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern
      );
    }

    const rows = await this.adapter.query(query, params);
    return rows[0]?.count || 0;
  }

  async getStatsBySiteId(siteId: number): Promise<{ total_labels: number; labels_this_month: number; labels_today: number }> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(now.getDate() - 30);
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const rows = await this.adapter.query(
      `SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN created_at >= ? THEN 1 END) as created_this_month,
        COUNT(CASE WHEN created_at >= ? THEN 1 END) as created_today
      FROM labels
      WHERE site_id = ?`,
      [thirtyDaysAgo, todayStart, siteId]
    );

    const result = rows[0] as any;
    return {
      total_labels: result.total || 0,
      labels_this_month: result.created_this_month || 0,
      labels_today: result.created_today || 0,
    };
  }

  async findRecentBySiteId(siteId: number, limit: number = 10): Promise<Label[]> {
    const safeLimit = Math.max(0, parseInt(String(limit), 10) || 10);
    const query = `SELECT
         l.id,
         l.site_id,
         l.created_by,
         l.ref_number,
         l.ref_string,
         l.cable_type_id,
         l.type,
         l.payload_json,
         l.source_location_id,
         l.destination_location_id,
         l.created_at,
         l.updated_at,
         s.code as site_code,
         ct.id as ct_id, ct.name as ct_name, ct.description as ct_description, ct.created_at as ct_created_at, ct.updated_at as ct_updated_at,
         sls.id as sls_id, sls.template_type as sls_template_type, sls.floor as sls_floor, sls.suite as sls_suite, sls.\`row\` as sls_row, sls.rack as sls_rack, sls.area as sls_area, sls.label as sls_label,
         sld.id as sld_id, sld.template_type as sld_template_type, sld.floor as sld_floor, sld.suite as sld_suite, sld.\`row\` as sld_row, sld.rack as sld_rack, sld.area as sld_area, sld.label as sld_label
        FROM labels l
        JOIN sites s ON s.id = l.site_id
        LEFT JOIN cable_types ct ON ct.id = l.cable_type_id
        LEFT JOIN site_locations sls ON sls.id = l.source_location_id
        LEFT JOIN site_locations sld ON sld.id = l.destination_location_id
        WHERE l.site_id = ?
        ORDER BY l.created_at DESC
        LIMIT ${safeLimit}`;

     const rows = await this.adapter.query(query, [siteId]);
     return (rows as any[]).map((row) => this.mapRow(row));
  }
}

export default LabelModel;
