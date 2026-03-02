import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import UserModel from '../models/User.js';
import SiteModel from '../models/Site.js';
import SiteLocationModel from '../models/SiteLocation.js';
import LabelModel from '../models/Label.js';
import CableTypeModel from '../models/CableType.js';
import AdmZip from 'adm-zip';
import { generateTokens } from '../utils/jwt.js';
import { setupTestDatabase, cleanupTestDatabase } from './setup.js';

function parseBinaryResponse(res: any, callback: (err: Error | null, data: Buffer) => void) {
  res.setEncoding('binary');
  let data = '';
  res.on('data', (chunk: string) => {
    data += chunk;
  });
  res.on('end', () => {
    callback(null, Buffer.from(data, 'binary'));
  });
}

describe('Site Routes', () => {
  let userModel: UserModel;
  let siteModel: SiteModel;
  let siteLocationModel: SiteLocationModel;
  let labelModel: LabelModel;
  let cableTypeModel: CableTypeModel;
  let db: any;
  let testUser: any;
  let globalAdminUser: any;
  let authToken: string;
  let globalAdminToken: string;

  beforeEach(async () => {
    db = await setupTestDatabase({ runMigrations: true, seedData: false });
    userModel = new UserModel();
    siteModel = new SiteModel();
    siteLocationModel = new SiteLocationModel();
    labelModel = new LabelModel();
    cableTypeModel = new CableTypeModel();

    // Create test users and get auth tokens
    testUser = await userModel.create({
      email: 'test@example.com',
      username: 'Test User',
      password: 'TestPassword123!',
      role: 'USER',
    });

    globalAdminUser = await userModel.create({
      email: 'admin@example.com',
      username: 'Global Admin',
      password: 'AdminPassword123!',
      role: 'GLOBAL_ADMIN',
    });

    authToken = generateTokens(testUser).accessToken;
    globalAdminToken = generateTokens(globalAdminUser).accessToken;
  });

  afterEach(async () => {
    await cleanupTestDatabase();
  });

  describe('GET /api/sites', () => {
    it('should get user sites', async () => {
      // Create test sites
      await siteModel.create({ name: 'Site 1', code: 'S1', location: 'Location 1', created_by: testUser.id });
      await siteModel.create({ name: 'Site 2', code: 'S2', location: 'Location 2', created_by: testUser.id });

      const response = await request(app)
        .get('/api/sites')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.sites).toHaveLength(2);
      expect(response.body.data.pagination).toBeDefined();
      expect(response.body.data.pagination.total).toBe(2);
    });

    it('should get sites with label and sid counts', async () => {
      const site = await siteModel.create({
        name: 'Test Site',
        code: 'TS',
        created_by: testUser.id,
      });

      const cableType = await cableTypeModel.create({ site_id: site.id, name: 'CAT6' });

      const locA = await siteLocationModel.create({
        site_id: site.id,
        floor: '1',
        suite: 'A',
        row: 'R1',
        rack: '01',
        rack_size_u: 42,
      });
      const locB = await siteLocationModel.create({
        site_id: site.id,
        floor: '1',
        suite: 'A',
        row: 'R1',
        rack: '02',
        rack_size_u: 42,
      });

      await labelModel.create({
        site_id: site.id,
        created_by: testUser.id,
        source_location_id: locA.id,
        destination_location_id: locB.id,
        cable_type_id: cableType.id,
        notes: 'Test label',
      });

      await db.execute(
        `INSERT INTO sids (site_id, sid_number, status)
         VALUES (?, ?, ?)`
        , [site.id, '1', 'Active']
      );

      const response = await request(app)
        .get('/api/sites?include_counts=true')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.sites).toHaveLength(1);
      expect(response.body.data.sites[0].label_count).toBe(1);
      expect(Number(response.body.data.sites[0].sid_count)).toBe(1);
    });

    it('should filter sites by search term', async () => {
      await siteModel.create({ name: 'Office Site', code: 'OFF', location: 'New York', created_by: testUser.id });
      await siteModel.create({ name: 'Warehouse Site', code: 'WH', location: 'California', created_by: testUser.id });

      const response = await request(app)
        .get('/api/sites?search=Office')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.sites).toHaveLength(1);
      expect(response.body.data.sites[0].name).toBe('Office Site');
    });

    it('should require authentication', async () => {
      await request(app)
        .get('/api/sites')
        .expect(401);
    });

    it('should handle pagination parameters', async () => {
      // Create multiple sites
      for (let i = 1; i <= 5; i++) {
        await siteModel.create({ name: `Site ${i}`, code: `S${i}`, created_by: testUser.id });
      }

      const response = await request(app)
        .get('/api/sites?limit=2&offset=1')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.sites).toHaveLength(2);
      expect(response.body.data.pagination.limit).toBe(2);
      expect(response.body.data.pagination.offset).toBe(1);
      expect(response.body.data.pagination.has_more).toBe(true);
    });
  });

  describe('GET /api/sites/:id', () => {
    it('should get specific site', async () => {
      const site = await siteModel.create({
        name: 'Test Site',
        code: 'TS',
        location: 'Test Location',
        description: 'Test Description',
        created_by: testUser.id,
      });

      const response = await request(app)
        .get(`/api/sites/${site.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.site.name).toBe('Test Site');
      expect(response.body.data.site.location).toBe('Test Location');
      expect(response.body.data.site.description).toBe('Test Description');
      expect(response.body.data.site.label_count).toBe(0);
    });

    it('should return 404 for non-existent site', async () => {
      await request(app)
        .get('/api/sites/999')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('should require authentication', async () => {
      await request(app)
        .get('/api/sites/1')
        .expect(401);
    });

    it('should not allow access to other users sites', async () => {
      // Create another user
      const otherUser = await userModel.create({
        email: 'other@example.com',
        username: 'Other User',
        password: 'TestPassword123!',
        role: 'USER',
      });

      const site = await siteModel.create({ name: 'Other User Site', code: 'O1', created_by: otherUser.id });

      await request(app)
        .get(`/api/sites/${site.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(403);
    });
  });

  describe('GET /api/sites/:id/sids', () => {
    it('returns primary switch hostname from On-Board NIC1 via sid_connections', async () => {
      const site = await siteModel.create({ name: 'SID Site', code: 'SS', created_by: testUser.id });

      await db.execute(
        `INSERT INTO sids (site_id, sid_number, status, hostname)
         VALUES (?, ?, ?, ?)`
        , [site.id, '10', 'Active', 'switch-alpha']
      );

      const switchRows = await db.query('SELECT id FROM sids WHERE site_id = ? AND sid_number = ? LIMIT 1', [site.id, '10']);
      const switchSidId = Number((switchRows?.[0] as any)?.id);

      await db.execute(
        `INSERT INTO sids (site_id, sid_number, status, hostname)
         VALUES (?, ?, ?, ?)`
        , [site.id, '11', 'Active', 'target-host']
      );

      const targetRows = await db.query('SELECT id FROM sids WHERE site_id = ? AND sid_number = ? LIMIT 1', [site.id, '11']);
      const targetSidId = Number((targetRows?.[0] as any)?.id);

      await db.execute(
        `INSERT INTO sid_nics (sid_id, card_name, name)
         VALUES (?, ?, ?)`
        , [targetSidId, null, 'NIC1']
      );

      const nicRows = await db.query('SELECT id FROM sid_nics WHERE sid_id = ? AND name = ? ORDER BY id DESC LIMIT 1', [targetSidId, 'NIC1']);
      const nicId = Number((nicRows?.[0] as any)?.id);

      await db.execute(
        `INSERT INTO sid_connections (site_id, sid_id, nic_id, switch_sid_id, switch_port)
         VALUES (?, ?, ?, ?, ?)`
        , [site.id, targetSidId, nicId, switchSidId, '1']
      );

      const response = await request(app)
        .get(`/api/sites/${site.id}/sids?search_field=sid&limit=200`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      const target = (response.body.data.sids ?? []).find((s: any) => Number(s.id) === targetSidId);
      expect(target).toBeTruthy();
      expect(target.primary_switch_hostname).toBe('switch-alpha');
    });

    it('supports filtering by switch_name against On-Board NIC1 switch hostname', async () => {
      const site = await siteModel.create({ name: 'Filter Site', code: 'FS', created_by: testUser.id });

      await db.execute(
        `INSERT INTO sids (site_id, sid_number, status, hostname)
         VALUES (?, ?, ?, ?), (?, ?, ?, ?)`
        , [
          site.id, '20', 'Active', 'switch-beta',
          site.id, '21', 'Active', 'switch-gamma',
        ]
      );

      const switchRows = await db.query(
        'SELECT id, sid_number, hostname FROM sids WHERE site_id = ? AND sid_number IN (?, ?) ORDER BY sid_number ASC',
        [site.id, '20', '21']
      );
      const switchBySidNumber = new Map<string, any>();
      for (const row of switchRows as any[]) {
        switchBySidNumber.set(String(row.sid_number), row);
      }

      await db.execute(
        `INSERT INTO sids (site_id, sid_number, status, hostname)
         VALUES (?, ?, ?, ?), (?, ?, ?, ?)`
        , [
          site.id, '22', 'Active', 'target-beta',
          site.id, '23', 'Active', 'target-gamma',
        ]
      );

      const targetRows = await db.query(
        'SELECT id, sid_number FROM sids WHERE site_id = ? AND sid_number IN (?, ?) ORDER BY sid_number ASC',
        [site.id, '22', '23']
      );

      for (const row of targetRows as any[]) {
        const sidNumber = String(row.sid_number);
        const switchRow = sidNumber === '22' ? switchBySidNumber.get('20') : switchBySidNumber.get('21');

        await db.execute(
          `INSERT INTO sid_nics (sid_id, card_name, name)
           VALUES (?, ?, ?)`
          , [Number(row.id), null, 'NIC1']
        );

        const nicRows = await db.query('SELECT id FROM sid_nics WHERE sid_id = ? AND name = ? ORDER BY id DESC LIMIT 1', [Number(row.id), 'NIC1']);
        const nicId = Number((nicRows?.[0] as any)?.id);

        await db.execute(
          `INSERT INTO sid_connections (site_id, sid_id, nic_id, switch_sid_id, switch_port)
           VALUES (?, ?, ?, ?, ?)`
          , [site.id, Number(row.id), nicId, Number(switchRow.id), '1']
        );
      }

      const response = await request(app)
        .get(`/api/sites/${site.id}/sids?search=switch-beta&search_field=switch_name&limit=200`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      const sidNumbers = (response.body.data.sids ?? []).map((s: any) => String(s.sid_number));
      expect(sidNumbers).toContain('22');
      expect(sidNumbers).not.toContain('23');
    });
  });

  describe('POST /api/sites/:id/sids', () => {
    it('rejects create when CPU Count and RAM (GB) are missing', async () => {
      const site = await siteModel.create({ name: 'SID Create Site', code: 'SCS', created_by: testUser.id });

      await db.execute(
        `INSERT INTO sid_types (site_id, name)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE name = name`
        , [site.id, 'Server']
      );
      await db.execute(
        `INSERT INTO sid_statuses (site_id, name)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE name = name`
        , [site.id, 'New SID']
      );
      await db.execute(
        `INSERT INTO sid_platforms (site_id, name)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE name = name`
        , [site.id, 'Linux']
      );
      await db.execute(
        `INSERT INTO sid_device_models (site_id, manufacturer, name)
         VALUES (?, ?, ?)`
        , [site.id, 'Dell', 'R740']
      );
      await db.execute(
        `INSERT INTO sid_cpu_models (site_id, name)
         VALUES (?, ?)`
        , [site.id, 'Xeon Gold']
      );
      await db.execute(
        `INSERT INTO sid_password_types (site_id, name)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE name = name`
        , [site.id, 'OS Credentials']
      );
      await db.execute(
        `INSERT INTO site_vlans (site_id, vlan_id, name)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name)`
        , [site.id, 10, 'Servers']
      );
      await db.execute(
        `INSERT INTO sid_nic_types (site_id, name)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE name = name`
        , [site.id, 'RJ45']
      );
      await db.execute(
        `INSERT INTO sid_nic_speeds (site_id, name)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE name = name`
        , [site.id, '1G']
      );

      const location = await siteLocationModel.create({
        site_id: site.id,
        floor: '1',
        suite: 'A',
        row: 'R1',
        rack: '01',
        rack_size_u: 42,
      });

      const sidTypes = await db.query('SELECT id FROM sid_types WHERE site_id = ? ORDER BY id ASC LIMIT 1', [site.id]);
      const sidTypeId = Number((sidTypes?.[0] as any)?.id);

      const response = await request(app)
        .post(`/api/sites/${site.id}/sids`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          sid_type_id: sidTypeId,
          serial_number: 'SN-REQ-001',
          location_id: location.id,
          status: 'New SID',
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Missing required fields');
      expect(response.body.error).toContain('CPU Count');
      expect(response.body.error).toContain('RAM (GB)');
      expect(response.body.details?.missing_required_fields).toEqual(['CPU Count', 'RAM (GB)']);
    });

    it('allows Patch Panel create without Serial Number, CPU Count, or RAM (GB)', async () => {
      const site = await siteModel.create({ name: 'Patch Panel Site', code: 'PPS', created_by: testUser.id });

      await db.execute(
        `INSERT INTO sid_types (site_id, name)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE name = name`,
        [site.id, 'Patch Panel']
      );
      await db.execute(
        `INSERT INTO sid_statuses (site_id, name)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE name = name`,
        [site.id, 'New SID']
      );
      await db.execute(
        `INSERT INTO sid_platforms (site_id, name)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE name = name`,
        [site.id, 'Linux']
      );
      await db.execute(
        `INSERT INTO sid_device_models (site_id, manufacturer, name)
         VALUES (?, ?, ?)`,
        [site.id, 'Generic', 'Patch Panel 24']
      );
      await db.execute(
        `INSERT INTO sid_cpu_models (site_id, name)
         VALUES (?, ?)`,
        [site.id, 'N/A']
      );
      await db.execute(
        `INSERT INTO sid_password_types (site_id, name)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE name = name`,
        [site.id, 'OS Credentials']
      );
      await db.execute(
        `INSERT INTO site_vlans (site_id, vlan_id, name)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name)`,
        [site.id, 10, 'Servers']
      );
      await db.execute(
        `INSERT INTO sid_nic_types (site_id, name)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE name = name`,
        [site.id, 'RJ45']
      );
      await db.execute(
        `INSERT INTO sid_nic_speeds (site_id, name)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE name = name`,
        [site.id, '1G']
      );

      const location = await siteLocationModel.create({
        site_id: site.id,
        floor: '1',
        suite: 'A',
        row: 'R1',
        rack: '02',
        rack_size_u: 42,
      });

      const sidTypes = await db.query('SELECT id FROM sid_types WHERE site_id = ? AND name = ? LIMIT 1', [
        site.id,
        'Patch Panel',
      ]);
      const sidTypeId = Number((sidTypes?.[0] as any)?.id);

      const response = await request(app)
        .post(`/api/sites/${site.id}/sids`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          sid_type_id: sidTypeId,
          serial_number: '',
          location_id: location.id,
          status: 'New SID',
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data?.sid?.id).toBeGreaterThan(0);

      const createdSidRows = await db.query('SELECT sid_type_id, serial_number, cpu_count, ram_gb FROM sids WHERE id = ?', [
        Number(response.body.data?.sid?.id),
      ]);
      const createdSid = (createdSidRows?.[0] as any) ?? null;
      expect(Number(createdSid?.sid_type_id ?? 0)).toBe(sidTypeId);
      expect(createdSid?.serial_number ?? null).toBeNull();
      expect(createdSid?.cpu_count ?? null).toBeNull();
      expect(createdSid?.ram_gb ?? null).toBeNull();
    });
  });

  describe('POST /api/sites', () => {
    it('should create new site', async () => {
      const siteData = {
        name: 'New Site',
        code: 'NS',
        location: 'New Location',
        description: 'New Description',
      };

      const response = await request(app)
        .post('/api/sites')
        .set('Authorization', `Bearer ${globalAdminToken}`)
        .send(siteData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.site.name).toBe(siteData.name);
      expect(response.body.data.site.code).toBe('NS');
      expect(response.body.data.site.location).toBe(siteData.location);
      expect(response.body.data.site.description).toBe(siteData.description);
      expect(response.body.data.site.created_by).toBe(globalAdminUser.id);
    });

    it('should create site with minimal data', async () => {
      const siteData = {
        name: 'Minimal Site',
        code: 'MS',
      };

      const response = await request(app)
        .post('/api/sites')
        .set('Authorization', `Bearer ${globalAdminToken}`)
        .send(siteData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.site.name).toBe(siteData.name);
      expect(response.body.data.site.code).toBe('MS');
      expect(response.body.data.site.location).toBeNull();
      expect(response.body.data.site.description).toBeNull();
    });

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/sites')
        .set('Authorization', `Bearer ${globalAdminToken}`)
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation failed');
    });

    it('should validate field lengths', async () => {
      const siteData = {
        name: 'x'.repeat(101), // Exceeds 100 character limit
        code: 'TS',
        location: 'x'.repeat(201), // Exceeds 200 character limit
        description: 'x'.repeat(501), // Exceeds 500 character limit
      };

      const response = await request(app)
        .post('/api/sites')
        .set('Authorization', `Bearer ${globalAdminToken}`)
        .send(siteData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation failed');
    });

    it('should require authentication', async () => {
      await request(app)
        .post('/api/sites')
        .send({ name: 'Test Site' })
        .expect(401);
    });
  });

  describe('PUT /api/sites/:id', () => {
    it('should update existing site', async () => {
      const site = await siteModel.create({ name: 'Original Site', code: 'OS', location: 'Original Location', created_by: testUser.id });

      const updateData = {
        name: 'Updated Site',
        location: 'Updated Location',
        description: 'Updated Description',
      };

      const response = await request(app)
        .put(`/api/sites/${site.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.site.name).toBe(updateData.name);
      expect(response.body.data.site.location).toBe(updateData.location);
      expect(response.body.data.site.description).toBe(updateData.description);
    });

    it('should update partial site data', async () => {
      const site = await siteModel.create({
        name: 'Original Site',
        code: 'OS',
        location: 'Original Location',
        description: 'Original Description',
        created_by: testUser.id,
      });

      const updateData = {
        name: 'Updated Site',
      };

      const response = await request(app)
        .put(`/api/sites/${site.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.site.name).toBe(updateData.name);
      expect(response.body.data.site.location).toBe('Original Location');
      expect(response.body.data.site.description).toBe('Original Description');
    });

    it('should return 404 for non-existent site', async () => {
      await request(app)
        .put('/api/sites/999')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Updated Site' })
        .expect(404);
    });

    it('should not allow updating other users sites', async () => {
      // Create another user
      const otherUser = await userModel.create({
        email: 'other@example.com',
        username: 'Other User',
        password: 'TestPassword123!',
        role: 'USER',
      });

      const site = await siteModel.create({ name: 'Other User Site', code: 'OU', created_by: otherUser.id });

      await request(app)
        .put(`/api/sites/${site.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Updated Site' })
        .expect(403);
    });

    it('should require authentication', async () => {
      await request(app)
        .put('/api/sites/1')
        .send({ name: 'Updated Site' })
        .expect(401);
    });
  });

  describe('DELETE /api/sites/:id', () => {
    it('should delete site', async () => {
      const site = await siteModel.create({ name: 'Test Site', code: 'TS', created_by: testUser.id });

      const response = await request(app)
        .delete(`/api/sites/${site.id}`)
        .set('Authorization', `Bearer ${globalAdminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Site deleted successfully');

      // Verify site is deleted
      const deletedSite = await siteModel.findById(site.id);
      expect(deletedSite).toBeNull();
    });

    it('should prevent deletion when site has labels', async () => {
      const site = await siteModel.create({ name: 'Test Site', code: 'TS', created_by: testUser.id });

      const locA = await siteLocationModel.create({ site_id: site.id, floor: '1', suite: 'A', row: 'R1', rack: '01', rack_size_u: 42 });
      const locB = await siteLocationModel.create({ site_id: site.id, floor: '1', suite: 'A', row: 'R1', rack: '02', rack_size_u: 42 });
      const cableType = await cableTypeModel.create({ site_id: site.id, name: 'CAT6' });
      await labelModel.create({ site_id: site.id, created_by: testUser.id, source_location_id: locA.id, destination_location_id: locB.id, cable_type_id: cableType.id });

      const response = await request(app)
        .delete(`/api/sites/${site.id}`)
        .set('Authorization', `Bearer ${globalAdminToken}`)
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Cannot delete site with existing labels');
    });

    it('should return 404 for non-existent site', async () => {
      await request(app)
        .delete('/api/sites/999')
        .set('Authorization', `Bearer ${globalAdminToken}`)
        .expect(404);
    });

    it('should not allow deleting other users sites', async () => {
      // Create another user
      const otherUser = await userModel.create({
        email: 'other@example.com',
        username: 'Other User',
        password: 'TestPassword123!',
        role: 'USER',
      });

      const site = await siteModel.create({ name: 'Other User Site', code: 'OU', created_by: otherUser.id });

      await request(app)
        .delete(`/api/sites/${site.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(403);
    });

    it('should require authentication', async () => {
      await request(app)
        .delete('/api/sites/1')
        .expect(401);
    });
  });

  describe('MapIndex endpoints', () => {
    it('GET /api/sites/:id/racks should list site racks and support query filtering', async () => {
      const site = await siteModel.create({
        name: 'Map Site',
        code: 'MAP',
        created_by: testUser.id,
      });

      const rackA = await siteLocationModel.create({
        site_id: site.id,
        template_type: 'DATACENTRE',
        floor: '0',
        suite: '1',
        row: 'A',
        rack: '1',
        rack_size_u: 42,
        label: 'WAL',
      });

      await siteLocationModel.create({
        site_id: site.id,
        template_type: 'DATACENTRE',
        floor: '0',
        suite: '1',
        row: 'A',
        rack: '2',
        rack_size_u: 48,
        label: 'WAL',
      });

      const responseAll = await request(app)
        .get(`/api/sites/${site.id}/racks`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(responseAll.body.success).toBe(true);
      expect(Array.isArray(responseAll.body.data?.racks)).toBe(true);
      expect(responseAll.body.data.racks.length).toBeGreaterThanOrEqual(2);
      expect(responseAll.body.data.racks.some((r: any) => Number(r.id) === rackA.id)).toBe(true);

      const responseFiltered = await request(app)
        .get(`/api/sites/${site.id}/racks?query=R1`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(responseFiltered.body.success).toBe(true);
      expect(responseFiltered.body.data.racks.length).toBeGreaterThanOrEqual(1);
      expect(responseFiltered.body.data.racks.every((r: any) => String(r.rackLocation).includes('R1'))).toBe(true);
    });

    it('GET /api/sites/:id/racks/elevation should return occupants by U for selected racks', async () => {
      const site = await siteModel.create({
        name: 'Elevation Site',
        code: 'ELV',
        created_by: testUser.id,
      });

      const rack = await siteLocationModel.create({
        site_id: site.id,
        template_type: 'DATACENTRE',
        floor: '1',
        suite: 'A',
        row: 'R1',
        rack: '01',
        rack_size_u: 42,
        label: 'WAL',
      });

      await db.execute(
        `INSERT INTO sids (site_id, sid_number, hostname, status, location_id, rack_u)
         VALUES (?, ?, ?, ?, ?, ?)`
        , [site.id, '1', 'WAL-SW1', 'Active', rack.id, '22']
      );

      await db.execute(
        `INSERT INTO sids (site_id, sid_number, hostname, status, location_id, rack_u)
         VALUES (?, ?, ?, ?, ?, ?)`
        , [site.id, '6', 'WAL-PDU', 'Active', rack.id, '1']
      );

      const response = await request(app)
        .get(`/api/sites/${site.id}/racks/elevation?rackIds=${rack.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.racks).toHaveLength(1);
      expect(response.body.data.racks[0].rackId).toBe(rack.id);
      expect(response.body.data.racks[0].rackSizeU).toBe(42);

      const occupants = response.body.data.racks[0].occupants as any[];
      expect(occupants.some((o) => Number(o.uPosition) === 22 && String(o.hostname) === 'WAL-SW1')).toBe(true);
      expect(occupants.some((o) => Number(o.uPosition) === 1 && String(o.hostname) === 'WAL-PDU')).toBe(true);
    });

    it('GET /api/sites/:id/cables/:cableRef/trace should resolve cable trace hops', async () => {
      const site = await siteModel.create({
        name: 'Trace Site',
        code: 'TRC',
        created_by: testUser.id,
      });

      const sourceLocation = await siteLocationModel.create({
        site_id: site.id,
        template_type: 'DATACENTRE',
        floor: '0',
        suite: '1',
        row: 'A',
        rack: '1',
        rack_size_u: 42,
        label: 'WAL',
      });

      const destinationLocation = await siteLocationModel.create({
        site_id: site.id,
        template_type: 'DATACENTRE',
        floor: '0',
        suite: '1',
        row: 'A',
        rack: '2',
        rack_size_u: 42,
        label: 'WAL',
      });

      const cableType = await cableTypeModel.create({ site_id: site.id, name: 'CAT6' });

      await db.execute(
        `INSERT INTO sid_device_models (site_id, manufacturer, name, is_patch_panel, default_patch_panel_port_count)
         VALUES (?, ?, ?, ?, ?)`
        , [site.id, 'Molex', 'PowerCat', 1, 24]
      );
      const modelRows = await db.query(
        'SELECT id FROM sid_device_models WHERE site_id = ? AND name = ? ORDER BY id DESC LIMIT 1',
        [site.id, 'PowerCat']
      );
      const patchPanelModelId = Number((modelRows?.[0] as any)?.id);

      await db.execute(
        `INSERT INTO sids (site_id, sid_number, hostname, status, location_id, rack_u)
         VALUES (?, ?, ?, ?, ?, ?)`
        , [site.id, '10', 'WAL-SW1', 'Active', sourceLocation.id, '22']
      );
      await db.execute(
        `INSERT INTO sids (site_id, sid_number, hostname, status, location_id, rack_u, device_model_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
        , [site.id, '3', 'WAL-PP1', 'Active', sourceLocation.id, '21', patchPanelModelId]
      );
      await db.execute(
        `INSERT INTO sids (site_id, sid_number, hostname, status, location_id, rack_u)
         VALUES (?, ?, ?, ?, ?, ?)`
        , [site.id, '4', 'WAL-SW2', 'Active', destinationLocation.id, '22']
      );

      const sidRows = await db.query(
        'SELECT id, sid_number FROM sids WHERE site_id = ? AND sid_number IN (?, ?, ?) ORDER BY sid_number ASC',
        [site.id, '10', '3', '4']
      );
      const sidByNumber = new Map<string, number>();
      for (const row of sidRows as any[]) {
        sidByNumber.set(String(row.sid_number), Number(row.id));
      }

      await db.execute(
        `INSERT INTO sid_nic_types (site_id, name)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE name = name`
        , [site.id, 'RJ45']
      );
      const nicTypeRows = await db.query(
        'SELECT id FROM sid_nic_types WHERE site_id = ? AND name = ? ORDER BY id DESC LIMIT 1',
        [site.id, 'RJ45']
      );
      const nicTypeId = Number((nicTypeRows?.[0] as any)?.id);

      await db.execute(
        `INSERT INTO sid_nics (sid_id, name, nic_type_id) VALUES (?, ?, ?)`
        , [sidByNumber.get('10'), 'NIC1', nicTypeId]
      );
      const nicRows = await db.query(
        'SELECT id FROM sid_nics WHERE sid_id = ? AND name = ? ORDER BY id DESC LIMIT 1',
        [sidByNumber.get('10'), 'NIC1']
      );
      const sourceNicId = Number((nicRows?.[0] as any)?.id);

      await db.execute(
        `INSERT INTO sid_connections (site_id, sid_id, nic_id, switch_sid_id, switch_port)
         VALUES (?, ?, ?, ?, ?)`
        , [site.id, sidByNumber.get('10'), sourceNicId, sidByNumber.get('3'), '3']
      );

      await labelModel.create({
        site_id: site.id,
        created_by: testUser.id,
        source_location_id: sourceLocation.id,
        destination_location_id: destinationLocation.id,
        cable_type_id: cableType.id,
        via_patch_panel: true,
        patch_panel_sid_id: sidByNumber.get('3') ?? null,
        patch_panel_port: 3,
      });

      const response = await request(app)
        .get(`/api/sites/${site.id}/cables/0001/trace`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.cableRef).toBe('#0001');
      expect(Array.isArray(response.body.data.hops)).toBe(true);
      expect(response.body.data.hops.length).toBeGreaterThanOrEqual(2);

      const hopHostnames = (response.body.data.hops as any[]).map((h) => String(h.hostname));
      expect(hopHostnames).toContain('WAL-SW1');
      expect(hopHostnames).toContain('WAL-PP1');
    });

    it('GET /api/sites/:id/cables/:cableRef/trace should return 404 for unknown cable ref', async () => {
      const site = await siteModel.create({
        name: 'Missing Trace Site',
        code: 'MTS',
        created_by: testUser.id,
      });

      await request(app)
        .get(`/api/sites/${site.id}/cables/9999/trace`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });
  });

  describe('GET /api/sites/:id/cable-report', () => {
    it('should download a DOCX cable report for a site member', async () => {
      const site = await siteModel.create({
        name: 'Test Site',
        code: 'TS',
        location: 'Test Location',
        created_by: testUser.id,
      });

      const cableType = await cableTypeModel.create({ site_id: site.id, name: 'CAT6' });
      const locA = await siteLocationModel.create({
        site_id: site.id,
        floor: '1',
        suite: 'A',
        row: 'R1',
        rack: '01',
        label: 'Loft',
        rack_size_u: 42,
      });
      const locB = await siteLocationModel.create({
        site_id: site.id,
        floor: '1',
        suite: 'A',
        row: 'R1',
        rack: '02',
        label: 'Garage',
        rack_size_u: 42,
      });

      await labelModel.create({
        site_id: site.id,
        created_by: testUser.id,
        source_location_id: locA.id,
        destination_location_id: locB.id,
        cable_type_id: cableType.id,
        notes: 'Test label',
      });

      const response = await request(app)
        .get(`/api/sites/${site.id}/cable-report`)
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true)
        .parse(parseBinaryResponse)
        .expect(200);

      expect(response.headers['content-type']).toContain(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );

      const contentDisposition = response.headers['content-disposition'];
      expect(contentDisposition).toContain('attachment');
      expect(contentDisposition).toMatch(/filename="TS_cable_report_\d{8}_\d{6}\.docx"/);

      expect(Buffer.isBuffer(response.body)).toBe(true);
      expect(response.body.subarray(0, 2).toString('utf8')).toBe('PK');

      const zip = new AdmZip(response.body);
      const documentXml = zip.readAsText('word/document.xml');
      expect(documentXml).toContain('InfraDB – Site Cable Report');
      expect(documentXml).toContain('Test Site');
      expect(documentXml).toContain('TS');
      expect(documentXml).toContain('Site Location');
      expect(documentXml).toContain('Test Location');
      expect(documentXml).toContain('Known Locations');
      expect(documentXml).toContain('Loft');
      expect(documentXml).toContain('Garage');
      expect(documentXml).toContain('CAT6');
      expect(documentXml).toContain('testuser');

      // Structured run locations
      expect(documentXml).toContain('Label: Loft | Floor: 1 | Suite: A | Row: R1 | Rack: 01');
      expect(documentXml).toContain('Label: Garage | Floor: 1 | Suite: A | Row: R1 | Rack: 02');
    });

    it('should deny access to non-members', async () => {
      const otherUser = await userModel.create({
        email: 'other2@example.com',
        username: 'Other User',
        password: 'TestPassword123!',
        role: 'USER',
      });

      const site = await siteModel.create({
        name: 'Other User Site',
        code: 'OU',
        created_by: otherUser.id,
      });

      await request(app)
        .get(`/api/sites/${site.id}/cable-report`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(403);
    });
  });
});