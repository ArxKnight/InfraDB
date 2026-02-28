import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import SiteModel from '../models/Site.js';
import UserModel from '../models/User.js';
import { setupTestDatabase, cleanupTestDatabase } from './setup.js';

describe('Site Model', () => {
  let siteModel: SiteModel;
  let userModel: UserModel;
  let db: any;
  let testUserId: number;

  beforeEach(async () => {
    db = await setupTestDatabase({ runMigrations: true, seedData: false });
    siteModel = new SiteModel();
    userModel = new UserModel();

    const testUser = await userModel.create({
      email: 'test@example.com',
      username: 'Test User',
      password: 'TestPassword123!',
      role: 'USER',
    });
    testUserId = testUser.id;
  });

  afterEach(async () => {
    await cleanupTestDatabase();
  });

  describe('create', () => {
    it('creates a new site and membership', async () => {
      const site = await siteModel.create({
        name: 'Test Site',
        code: 'TS',
        location: 'Test Location',
        description: 'Test Description',
        created_by: testUserId,
      });

      expect(site.id).toBeDefined();
      expect(site.name).toBe('Test Site');
      expect(site.code).toBe('TS');
      expect(site.location).toBe('Test Location');
      expect(site.description).toBe('Test Description');
      expect(site.created_by).toBe(testUserId);
    });

    it('creates site with minimal data', async () => {
      const site = await siteModel.create({
        name: 'Minimal Site',
        code: 'MS',
        created_by: testUserId,
      });

      expect(site.name).toBe('Minimal Site');
      expect(site.code).toBe('MS');
      expect(site.location ?? null).toBeNull();
      expect(site.description ?? null).toBeNull();
    });

    it('seeds default NIC speeds for a new site', async () => {
      const site = await siteModel.create({
        name: 'NIC Speed Site',
        code: 'NSS',
        created_by: testUserId,
      });

      const rows = await db.query(
        'SELECT name FROM sid_nic_speeds WHERE site_id = ? ORDER BY name ASC',
        [site.id]
      );
      const names = (rows as any[]).map((r: any) => String(r.name));

      expect(names).toHaveLength(6);
      expect(new Set(names)).toEqual(new Set(['100Mbps', '1Gbps', '2.5Gbps', '10Gbps', '25Gbps', '100Gbps']));
    });

    it('seeds default NIC types for a new site', async () => {
      const site = await siteModel.create({
        name: 'NIC Type Site',
        code: 'NTS',
        created_by: testUserId,
      });

      const rows = await db.query(
        'SELECT name FROM sid_nic_types WHERE site_id = ? ORDER BY name ASC',
        [site.id]
      );
      const names = (rows as any[]).map((r: any) => String(r.name));

      expect(names).toHaveLength(6);
      expect(new Set(names)).toEqual(new Set(['RJ11', 'RJ45', 'SFP', 'SFP+', 'DAC', 'SFP28']));
    });

    it('seeds default platforms for a new site', async () => {
      const site = await siteModel.create({
        name: 'Platform Site',
        code: 'PLT',
        created_by: testUserId,
      });

      const rows = await db.query(
        'SELECT name FROM sid_platforms WHERE site_id = ? ORDER BY name ASC',
        [site.id]
      );
      const names = (rows as any[]).map((r: any) => String(r.name));

      expect(names).toEqual(['Linux', 'Windows']);
    });
  });

  describe('findById', () => {
    it('finds site by ID', async () => {
      const createdSite = await siteModel.create({
        name: 'Test Site',
        code: 'TS',
        location: 'Test Location',
        created_by: testUserId,
      });

      const foundSite = await siteModel.findById(createdSite.id);
      expect(foundSite).toBeDefined();
      expect(foundSite!.id).toBe(createdSite.id);
      expect(foundSite!.name).toBe('Test Site');
      expect(foundSite!.code).toBe('TS');
    });

    it('returns null for non-existent ID', async () => {
      const site = await siteModel.findById(999);
      expect(site).toBeNull();
    });

    it('does not return inactive sites', async () => {
      const createdSite = await siteModel.create({
        name: 'Inactive Site',
        code: 'IS',
        created_by: testUserId,
      });

      await db.execute(`UPDATE sites SET is_active = 0 WHERE id = ?`, [createdSite.id]);
      const foundSite = await siteModel.findById(createdSite.id);
      expect(foundSite).toBeNull();
    });
  });

  describe('findByUserId', () => {
    it('lists sites for a user ordered by name', async () => {
      await siteModel.create({ name: 'Site 1', code: 'S1', created_by: testUserId });
      await siteModel.create({ name: 'Site 2', code: 'S2', created_by: testUserId });

      const sites = await siteModel.findByUserId(testUserId);
      expect(sites).toHaveLength(2);
      expect(sites[0]?.name).toBe('Site 1');
      expect(sites[1]?.name).toBe('Site 2');
    });

    it('filters by search term', async () => {
      await siteModel.create({ name: 'Office Site', code: 'OFF', location: 'New York', created_by: testUserId });
      await siteModel.create({ name: 'Warehouse Site', code: 'WH', location: 'California', created_by: testUserId });

      const sites = await siteModel.findByUserId(testUserId, { search: 'Office' });
      expect(sites).toHaveLength(1);
      expect(sites[0]?.name).toBe('Office Site');
    });

    it('respects limit and offset', async () => {
      for (let i = 1; i <= 5; i++) {
        await siteModel.create({ name: `Site ${i}`, code: `S${i}`, created_by: testUserId });
      }

      const sites = await siteModel.findByUserId(testUserId, { limit: 2, offset: 1 });
      expect(sites).toHaveLength(2);
      expect(sites[0]?.name).toBe('Site 2');
      expect(sites[1]?.name).toBe('Site 3');
    });
  });

  describe('label counts', () => {
    it('findByIdWithLabelCount returns label_count and site_role', async () => {
      const createdSite = await siteModel.create({
        name: 'Count Site',
        code: 'CS',
        created_by: testUserId,
      });

      await db.execute(
        `INSERT INTO labels (site_id, ref_number, ref_string, type, created_by)
         VALUES (?, ?, ?, ?, ?)`
        , [createdSite.id, 1, 'CS-0001', 'cable', testUserId]
      );

      await db.execute(
        `INSERT INTO labels (site_id, ref_number, ref_string, type, created_by)
         VALUES (?, ?, ?, ?, ?)`
        , [createdSite.id, 2, 'CS-0002', 'cable', testUserId]
      );

      await db.execute(
        `INSERT INTO sids (site_id, sid_number, status)
         VALUES (?, ?, ?)`
        , [createdSite.id, '1', 'Active']
      );

      const siteWithCount = await siteModel.findByIdWithLabelCount(createdSite.id, testUserId);
      expect(siteWithCount).toBeDefined();
      expect(siteWithCount!.id).toBe(createdSite.id);
      expect(Number(siteWithCount!.label_count)).toBe(2);
      expect(Number(siteWithCount!.sid_count)).toBe(1);
      expect(siteWithCount!.site_role).toBe('SITE_ADMIN');
    });

    it('findByUserIdWithLabelCounts returns correct label_count per site', async () => {
      const siteA = await siteModel.create({ name: 'Site A', code: 'SA', created_by: testUserId });
      const siteB = await siteModel.create({ name: 'Site B', code: 'SB', created_by: testUserId });

      await db.execute(
        `INSERT INTO labels (site_id, ref_number, ref_string, type, created_by)
         VALUES (?, ?, ?, ?, ?)`
        , [siteA.id, 1, 'SA-0001', 'cable', testUserId]
      );

      await db.execute(
        `INSERT INTO sids (site_id, sid_number, status)
         VALUES (?, ?, ?)`
        , [siteA.id, '1', 'Active']
      );

      const sites = await siteModel.findByUserIdWithLabelCounts(testUserId, { limit: 50, offset: 0 });
      const byId = new Map(sites.map(s => [s.id, s]));

      expect(byId.get(siteA.id)).toBeDefined();
      expect(Number(byId.get(siteA.id)!.label_count)).toBe(1);
      expect(Number(byId.get(siteA.id)!.sid_count)).toBe(1);
      expect(byId.get(siteA.id)!.site_role).toBe('SITE_ADMIN');

      expect(byId.get(siteB.id)).toBeDefined();
      expect(Number(byId.get(siteB.id)!.label_count)).toBe(0);
      expect(Number(byId.get(siteB.id)!.sid_count)).toBe(0);
      expect(byId.get(siteB.id)!.site_role).toBe('SITE_ADMIN');
    });
  });

  describe('update', () => {
    it('updates site data', async () => {
      const site = await siteModel.create({
        name: 'Original Site',
        code: 'OS',
        location: 'Original Location',
        description: 'Original Description',
        created_by: testUserId,
      });

      const updatedSite = await siteModel.update(site.id, testUserId, {
        name: 'Updated Site',
        location: 'Updated Location',
      });

      expect(updatedSite).toBeDefined();
      expect(updatedSite!.name).toBe('Updated Site');
      expect(updatedSite!.location).toBe('Updated Location');
      expect(updatedSite!.description ?? null).toBe('Original Description');
    });

    it('returns null for non-existent site', async () => {
      const updatedSite = await siteModel.update(999, testUserId, { name: 'Updated Site' });
      expect(updatedSite).toBeNull();
    });
  });

  describe('existsForUser', () => {
    it('returns true if user is a member of the site', async () => {
      const site = await siteModel.create({ name: 'Member Site', code: 'MB', created_by: testUserId });
      const exists = await siteModel.existsForUser(site.id, testUserId);
      expect(exists).toBe(true);
    });
  });

  describe('delete', () => {
    it('deletes a site without labels', async () => {
      const site = await siteModel.create({ name: 'Delete Site', code: 'DEL', created_by: testUserId });
      const success = await siteModel.delete(site.id, testUserId);
      expect(success).toBe(true);

      const found = await siteModel.findById(site.id);
      expect(found).toBeNull();
    });
  });
});

