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
      });
      const locB = await siteLocationModel.create({
        site_id: site.id,
        floor: '1',
        suite: 'A',
        row: 'R1',
        rack: '02',
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

      const locA = await siteLocationModel.create({ site_id: site.id, floor: '1', suite: 'A', row: 'R1', rack: '01' });
      const locB = await siteLocationModel.create({ site_id: site.id, floor: '1', suite: 'A', row: 'R1', rack: '02' });
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
      });
      const locB = await siteLocationModel.create({
        site_id: site.id,
        floor: '1',
        suite: 'A',
        row: 'R1',
        rack: '02',
        label: 'Garage',
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