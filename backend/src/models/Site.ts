import connection from '../database/connection.js';
import { DatabaseAdapter } from '../database/adapters/base.js';
import { Site, SiteRole } from '../types/index.js';

export type SiteWithRole = Site & { site_role: SiteRole };
export type SiteWithLabelCountAndRole = Site & {
  label_count: number;
  sid_count: number;
  site_role: SiteRole | null;
};
export type SiteWithLabelCountsAndRole = Site & { label_count: number; sid_count: number; site_role: SiteRole };

export interface CreateSiteData {
  name: string;
  code: string;
  created_by: number;
  location?: string;
  description?: string;
}

export interface UpdateSiteData {
  name?: string;
  code?: string;
  location?: string;
  description?: string;
}

export class SiteModel {
  private get adapter(): DatabaseAdapter {
    return connection.getAdapter();
  }

  /**
   * Create a new site
   */
  async create(siteData: CreateSiteData): Promise<Site> {
    const { name, code, location, description, created_by } = siteData;

    await this.adapter.beginTransaction();
    try {
      const result = await this.adapter.execute(
        `INSERT INTO sites (name, code, created_by, location, description)
         VALUES (?, ?, ?, ?, ?)`
        ,[name, code, created_by, location || null, description || null]
      );

      if (!result.insertId) {
        throw new Error('Failed to create site');
      }

      const siteId = Number(result.insertId);

      await this.adapter.execute(
        `INSERT INTO site_memberships (site_id, user_id, site_role)
         VALUES (?, ?, 'SITE_ADMIN')`,
        [siteId, created_by]
      );

      // Seed default SID Types so the SID Index has useful options immediately.
      // These can be removed later by a Site Admin or Global Admin.
      const defaultSidTypeNames = ['Server', 'Switch', 'Patch Panel'] as const;
      for (const sidTypeName of defaultSidTypeNames) {
        await this.adapter.execute(
          `INSERT INTO sid_types (site_id, name, description)
           VALUES (?, ?, NULL)
           ON DUPLICATE KEY UPDATE name = name`,
          [siteId, sidTypeName]
        );
      }

      // Seed default SID Statuses so the SID Index has useful options immediately.
      // These can be removed later by a Site Admin or Global Admin.
      const defaultSidStatusNames = ['New SID', 'Active', 'Awaiting Decommision', 'Decommisioned'] as const;
      for (const statusName of defaultSidStatusNames) {
        await this.adapter.execute(
          `INSERT INTO sid_statuses (site_id, name, description)
           VALUES (?, ?, NULL)
           ON DUPLICATE KEY UPDATE name = name`,
          [siteId, statusName]
        );
      }

      await this.adapter.commit();
      return (await this.findById(siteId))!;
    } catch (error) {
      await this.adapter.rollback();
      throw error;
    }
  }

  /**
   * Find site by ID
   */
  async findById(id: number): Promise<Site | null> {
    const rows = await this.adapter.query(
      `SELECT id, name, code, created_by, location, description, is_active, created_at, updated_at
       FROM sites 
       WHERE id = ? AND is_active = 1`,
      [id]
    );
    
    return rows.length > 0 ? (rows[0] as Site) : null;
  }

  /**
   * Find sites by user ID with optional filtering
   */
  async findByUserId(userId: number, options: {
    search?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<Site[]> {
    const { search, limit = 50, offset = 0 } = options;
    const safeLimit = parseInt(String(limit), 10) || 50;
    const safeOffset = parseInt(String(offset), 10) || 0;
    const finalLimit = Math.max(0, safeLimit);
    const finalOffset = Math.max(0, safeOffset);
    
    let query = `
      SELECT s.id, s.name, s.code, s.created_by, s.location, s.description, s.is_active, s.created_at, s.updated_at,
             sm.site_role as site_role
      FROM sites s
      JOIN site_memberships sm ON sm.site_id = s.id
      WHERE sm.user_id = ? AND s.is_active = 1
    `;

    const params: any[] = [userId];
    
    if (search) {
      query += ` AND (s.name LIKE ? OR s.location LIKE ? OR s.description LIKE ? OR s.code LIKE ?)`;
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }
    
    query += ` ORDER BY name ASC LIMIT ${finalLimit} OFFSET ${finalOffset}`;
    
    const rows = await this.adapter.query(query, params);
    return rows as SiteWithRole[];
  }

  /**
   * Find all sites (global admin)
   */
  async findAll(options: {
    search?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<Site[]> {
    const { search, limit = 50, offset = 0 } = options;
    const safeLimit = parseInt(String(limit), 10) || 50;
    const safeOffset = parseInt(String(offset), 10) || 0;
    const finalLimit = Math.max(0, safeLimit);
    const finalOffset = Math.max(0, safeOffset);

    let query = `
      SELECT id, name, code, created_by, location, description, is_active, created_at, updated_at
      FROM sites
      WHERE is_active = 1
    `;

    const params: any[] = [];

    if (search) {
      query += ` AND (name LIKE ? OR location LIKE ? OR description LIKE ? OR code LIKE ?)`;
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }

    query += ` ORDER BY name ASC LIMIT ${finalLimit} OFFSET ${finalOffset}`;

    const rows = await this.adapter.query(query, params);
    return rows as Site[];
  }

  /**
   * Find all sites with label counts (global admin)
   */
  async findAllWithLabelCounts(options: {
    search?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<(Site & { label_count: number; sid_count: number })[]> {
    const { search, limit = 50, offset = 0 } = options;
    const safeLimit = parseInt(String(limit), 10) || 50;
    const safeOffset = parseInt(String(offset), 10) || 0;
    const finalLimit = Math.max(0, safeLimit);
    const finalOffset = Math.max(0, safeOffset);

    let query = `
      SELECT 
        s.id, s.name, s.code, s.created_by, s.location, s.description, s.is_active, s.created_at, s.updated_at,
        COALESCE(lc.label_count, 0) as label_count,
        COALESCE(sc.sid_count, 0) as sid_count
      FROM sites s
      LEFT JOIN (
        SELECT site_id, COUNT(*) as label_count
        FROM labels
        GROUP BY site_id
      ) lc ON lc.site_id = s.id
      LEFT JOIN (
        SELECT site_id, COUNT(*) as sid_count
        FROM sids
        GROUP BY site_id
      ) sc ON sc.site_id = s.id
      WHERE s.is_active = 1
    `;

    const params: any[] = [];

    if (search) {
      query += ` AND (s.name LIKE ? OR s.location LIKE ? OR s.description LIKE ? OR s.code LIKE ?)`;
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }

    query += ` ORDER BY s.name ASC LIMIT ${finalLimit} OFFSET ${finalOffset}`;

    const rows = await this.adapter.query(query, params);
    return rows as (Site & { label_count: number; sid_count: number })[];
  }

  /**
   * Update site
   */
  async update(id: number, userId: number, siteData: UpdateSiteData): Promise<Site | null> {
    const updates: string[] = [];
    const values: any[] = [];

    if (siteData.name !== undefined) {
      updates.push('name = ?');
      values.push(siteData.name);
    }

    if (siteData.code !== undefined) {
      updates.push('code = ?');
      values.push(siteData.code);
    }

    if (siteData.location !== undefined) {
      updates.push('location = ?');
      values.push(siteData.location);
    }

    if (siteData.description !== undefined) {
      updates.push('description = ?');
      values.push(siteData.description);
    }

    if (updates.length === 0) {
      return this.findById(id);
    }

    values.push(id);

    const result = await this.adapter.execute(
      `UPDATE sites 
       SET ${updates.join(', ')}
       WHERE id = ? AND is_active = 1`,
      values
    );
    
    if (result.affectedRows === 0) {
      return null;
    }

    return this.findById(id);
  }

  /**
   * Delete site
   * Only allows deletion if no labels are associated with the site unless cascade=true
   */
  async delete(id: number, userId: number, options: { cascade?: boolean } = {}): Promise<boolean> {
    // First check if site has any labels
    const labelRows = await this.adapter.query(
      `SELECT COUNT(*) as count 
       FROM labels 
       WHERE site_id = ?`,
      [id]
    );
    
    const labelCount = labelRows[0].count;
    
    if (labelCount > 0 && !options.cascade) {
      throw new Error('Cannot delete site with existing labels');
    }

    // Hard delete the site. Foreign keys are defined with ON DELETE CASCADE.
    const result = await this.adapter.execute(
      `DELETE FROM sites WHERE id = ? AND is_active = 1`,
      [id]
    );
    
    return result.affectedRows > 0;
  }

  /**
   * Check if site exists and belongs to user
   */
  async existsForUser(id: number, userId: number): Promise<boolean> {
    const rows = await this.adapter.query(
      `SELECT 1 FROM site_memberships sm
       JOIN sites s ON s.id = sm.site_id
       WHERE sm.site_id = ? AND sm.user_id = ? AND s.is_active = 1`,
      [id, userId]
    );
    
    return rows.length > 0;
  }

  /**
   * Count sites for user
   */
  async countByUserId(userId: number, search?: string): Promise<number> {
    let query = `
      SELECT COUNT(*) as count 
      FROM sites s
      JOIN site_memberships sm ON sm.site_id = s.id
      WHERE sm.user_id = ? AND s.is_active = 1
    `;
    
    const params: any[] = [userId];
    
    if (search) {
      query += ` AND (s.name LIKE ? OR s.location LIKE ? OR s.description LIKE ? OR s.code LIKE ?)`;
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }
    
    const rows = await this.adapter.query(query, params);
    return rows[0].count;
  }

  /**
   * Count all sites (global admin)
   */
  async countAll(search?: string): Promise<number> {
    let query = `
      SELECT COUNT(*) as count
      FROM sites
      WHERE is_active = 1
    `;

    const params: any[] = [];

    if (search) {
      query += ` AND (name LIKE ? OR location LIKE ? OR description LIKE ? OR code LIKE ?)`;
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }

    const rows = await this.adapter.query(query, params);
    return rows[0].count;
  }

  /**
   * Get site with label count
   */
  async findByIdWithLabelCount(id: number, userId: number): Promise<SiteWithLabelCountAndRole | null> {
    const rows = await this.adapter.query(
      `SELECT 
        s.id, s.name, s.code, s.created_by, s.location, s.description, s.is_active, s.created_at, s.updated_at,
        COALESCE(lc.label_count, 0) as label_count,
        COALESCE(sc.sid_count, 0) as sid_count,
        sm.site_role as site_role
      FROM sites s
      LEFT JOIN site_memberships sm ON sm.site_id = s.id AND sm.user_id = ?
      LEFT JOIN (
        SELECT site_id, COUNT(*) as label_count
        FROM labels
        GROUP BY site_id
      ) lc ON lc.site_id = s.id
      LEFT JOIN (
        SELECT site_id, COUNT(*) as sid_count
        FROM sids
        GROUP BY site_id
      ) sc ON sc.site_id = s.id
      WHERE s.id = ? AND s.is_active = 1
      `,
      [userId, id]
    );
    
    return rows.length > 0 ? (rows[0] as SiteWithLabelCountAndRole) : null;
  }

  /**
   * Get all sites for user with label counts
   */
  async findByUserIdWithLabelCounts(userId: number, options: {
    search?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<SiteWithLabelCountsAndRole[]> {
    const { search, limit = 50, offset = 0 } = options;
    
    // Ensure limit and offset are integers for MySQL prepared statements
    const safeLimit = parseInt(String(limit), 10) || 50;
    const safeOffset = parseInt(String(offset), 10) || 0;
    const finalLimit = Math.max(0, safeLimit);
    const finalOffset = Math.max(0, safeOffset);
    
    let query = `
      SELECT 
        s.id, s.name, s.code, s.created_by, s.location, s.description, s.is_active, s.created_at, s.updated_at,
        COALESCE(lc.label_count, 0) as label_count,
        COALESCE(sc.sid_count, 0) as sid_count,
        sm.site_role as site_role
      FROM sites s
      JOIN site_memberships sm ON sm.site_id = s.id
      LEFT JOIN (
        SELECT site_id, COUNT(*) as label_count
        FROM labels
        GROUP BY site_id
      ) lc ON lc.site_id = s.id
      LEFT JOIN (
        SELECT site_id, COUNT(*) as sid_count
        FROM sids
        GROUP BY site_id
      ) sc ON sc.site_id = s.id
      WHERE sm.user_id = ? AND s.is_active = 1
    `;
    
    const params: any[] = [userId];
    
    if (search) {
      query += ` AND (s.name LIKE ? OR s.location LIKE ? OR s.description LIKE ? OR s.code LIKE ?)`;
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }
    
    query += ` ORDER BY s.name ASC LIMIT ${finalLimit} OFFSET ${finalOffset}`;
    
    const rows = await this.adapter.query(query, params);
    return rows as SiteWithLabelCountsAndRole[];
  }
}

export default SiteModel;