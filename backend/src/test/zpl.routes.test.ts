import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { setupTestDatabase, cleanupTestDatabase } from './setup.js';
import LabelModel from '../models/Label.js';
import CableTypeModel from '../models/CableType.js';
import SiteModel from '../models/Site.js';
import SiteLocationModel from '../models/SiteLocation.js';
import UserModel from '../models/User.js';
import { generateToken } from '../utils/jwt.js';

describe('ZPL Routes', () => {
  let testUserId: number;
  let testSiteId: number;
  let testLabelId: number;
  let authToken: string;
  let testLabelRefString: string;
  let testCableTypeId: number;

  beforeEach(async () => {
    await setupTestDatabase();

    // Create test user
    const userModel = new UserModel();
    const user = await userModel.create({
      email: 'test@example.com',
      password: 'password123',
      username: 'Test User',
      role: 'USER',
    });
    testUserId = user.id;
    authToken = generateToken(user);

    // Create test site
    const siteModel = new SiteModel();
    const site = await siteModel.create({
      name: 'TestSite',
      code: 'TS',
      location: 'Test Location',
      description: 'Test site for ZPL tests',
      created_by: testUserId,
    });
    testSiteId = site.id;

    const cableTypeModel = new CableTypeModel();
    const cableType = await cableTypeModel.create({ site_id: testSiteId, name: 'CAT6' });
    testCableTypeId = cableType.id;

    // Create test locations
    const siteLocationModel = new SiteLocationModel();
    const locA = await siteLocationModel.create({
      site_id: testSiteId,
      floor: '1',
      suite: 'A',
      row: 'R1',
      rack: '01',
      rack_size_u: 42,
      label: 'Loft',
    });
    const locB = await siteLocationModel.create({
      site_id: testSiteId,
      floor: '1',
      suite: 'A',
      row: 'R1',
      rack: '02',
      rack_size_u: 42,
      label: 'Garage',
    });

    // Create test label
    const labelModel = new LabelModel();
    const label = await labelModel.create({
      site_id: testSiteId,
      created_by: testUserId,
      source_location_id: locA.id,
      destination_location_id: locB.id,
      cable_type_id: testCableTypeId,
      notes: 'Test label',
    });
    testLabelId = label.id;
    testLabelRefString = label.ref_string;
  });

  afterEach(async () => {
    await cleanupTestDatabase();
  });

  describe('GET /api/labels/:id/zpl', () => {
    it('should generate and download ZPL for existing label', async () => {
      const response = await request(app)
        .get(`/api/labels/${testLabelId}/zpl?site_id=${testSiteId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.headers['content-type']).toBe('text/plain; charset=utf-8');
      expect(response.headers['content-disposition']).toContain('attachment');
      expect(response.headers['content-disposition']).toContain(`${testLabelRefString}.txt`);
      expect(response.text).toContain('^XA');
      expect(response.text).toContain('^XZ');
      expect(response.text).toContain(`#${testLabelRefString}`);
      expect(response.text).toContain('Loft/1/A/R1/01');
      expect(response.text).toContain('Garage/1/A/R1/02');

      // Canonical cable label structure: ^FD line followed by standalone ^FS.
      expect(response.text).not.toMatch(/\^FD[^\n]*\^FS/);
      expect(response.text.match(/\^FD[^\n]*\n\^FS/g) || []).toHaveLength(2);
    });

    it('should return 404 for non-existent label', async () => {
      const response = await request(app)
        .get(`/api/labels/99999/zpl?site_id=${testSiteId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Label not found');
    });

    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .get(`/api/labels/${testLabelId}/zpl?site_id=${testSiteId}`)
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Access denied. No token provided.');
    });

    it('should return 400 for invalid label ID', async () => {
      const response = await request(app)
        .get(`/api/labels/invalid/zpl?site_id=${testSiteId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation failed');
    });
  });

  describe('POST /api/labels/bulk-zpl', () => {
    it('should generate bulk ZPL for multiple labels', async () => {
      // Create another test label
      const labelModel = new LabelModel();
      const siteLocationModel = new SiteLocationModel();
      const locC = await siteLocationModel.create({
        site_id: testSiteId,
        floor: '1',
        suite: 'A',
        row: 'R1',
        rack: '03',
        rack_size_u: 42,
      });
      const locD = await siteLocationModel.create({
        site_id: testSiteId,
        floor: '1',
        suite: 'A',
        row: 'R1',
        rack: '04',
        rack_size_u: 42,
      });

      const label2 = await labelModel.create({
        site_id: testSiteId,
        created_by: testUserId,
        source_location_id: locC.id,
        destination_location_id: locD.id,
        cable_type_id: testCableTypeId,
      });

      const response = await request(app)
        .post('/api/labels/bulk-zpl')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ site_id: testSiteId, ids: [testLabelId, label2.id] })
        .expect(200);

      expect(response.headers['content-type']).toBe('text/plain; charset=utf-8');
      const contentDisposition = response.headers['content-disposition'];
      expect(contentDisposition).toContain('attachment');
      expect(contentDisposition).toMatch(/filename="crossrackref_\d{8}_\d{6}\.txt"/);
      expect(response.text).toContain(`#${testLabelRefString}`);
      expect(response.text).toContain(`#${label2.ref_string}`);

      // Two labels => two complete blocks, joined as ^XZ\n^XA.
      expect((response.text.match(/\^XA/g) || []).length).toBe(2);
      expect((response.text.match(/\^XZ/g) || []).length).toBe(2);
      expect(response.text).toContain('^XZ\n^XA');

      // Each label prints the payload twice, each with ^FD line then standalone ^FS line.
      expect(response.text).not.toMatch(/\^FD[^\n]*\^FS/);
      expect(response.text.match(/\^FD[^\n]*\n\^FS/g) || []).toHaveLength(4);
    });

    it('should return 404 when no valid labels found', async () => {
      const response = await request(app)
        .post('/api/labels/bulk-zpl')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ site_id: testSiteId, ids: [99999, 99998] })
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('No valid labels found');
    });

    it('should return 400 for empty IDs array', async () => {
      const response = await request(app)
        .post('/api/labels/bulk-zpl')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ site_id: testSiteId, ids: [] })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation failed');
    });

    it('should return 400 for too many IDs', async () => {
      const manyIds = Array.from({ length: 101 }, (_, i) => i + 1);
      
      const response = await request(app)
        .post('/api/labels/bulk-zpl')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ site_id: testSiteId, ids: manyIds })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation failed');
    });
  });

  describe('POST /api/labels/port-labels/zpl', () => {
    it('should generate ZPL for port labels', async () => {
      const response = await request(app)
        .post('/api/labels/port-labels/zpl')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          sid: 'SW01',
          fromPort: 1,
          toPort: 3
        })
        .expect(200);

      expect(response.headers['content-type']).toBe('text/plain; charset=utf-8');
      expect(response.headers['content-disposition']).toContain('attachment');
      expect(response.headers['content-disposition']).toContain('port-labels-SW01-1-3.txt');
      expect(response.text).toContain('^XA');
      expect(response.text).toContain('^XZ');
      expect(response.text).toContain('SW01/1');
      expect(response.text).toContain('SW01/2');
      expect(response.text).toContain('SW01/3');
    });

    it('should return 400 for missing SID', async () => {
      const response = await request(app)
        .post('/api/labels/port-labels/zpl')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          sid: '',
          fromPort: 1,
          toPort: 3
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation failed');
    });

    it('should return 400 for invalid port range', async () => {
      const response = await request(app)
        .post('/api/labels/port-labels/zpl')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          sid: 'SW01',
          fromPort: 5,
          toPort: 3
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation failed');
    });

    it('should return 400 for too many ports', async () => {
      const response = await request(app)
        .post('/api/labels/port-labels/zpl')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          sid: 'SW01',
          fromPort: 1,
          toPort: 102
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Port range cannot exceed 100 ports');
    });

    it('should return 400 for invalid characters in SID', async () => {
      const response = await request(app)
        .post('/api/labels/port-labels/zpl')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          sid: 'SW^01',
          fromPort: 1,
          toPort: 3
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('SID cannot contain ^ or ~ characters');
    });
  });

  describe('POST /api/labels/pdu-labels/zpl', () => {
    it('should generate ZPL for PDU labels', async () => {
      const response = await request(app)
        .post('/api/labels/pdu-labels/zpl')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          pduSid: 'PDU-A1',
          fromPort: 1,
          toPort: 3
        })
        .expect(200);

      expect(response.headers['content-type']).toBe('text/plain; charset=utf-8');
      expect(response.headers['content-disposition']).toContain('attachment');
      expect(response.headers['content-disposition']).toContain('pdu-labels-PDU-A1-1-3.txt');
      expect(response.text).toContain('^XA');
      expect(response.text).toContain('^XZ');
      expect(response.text).toContain('PDU-A1/1');
      expect(response.text).toContain('PDU-A1/2');
      expect(response.text).toContain('PDU-A1/3');
    });

    it('should return 400 for missing PDU SID', async () => {
      const response = await request(app)
        .post('/api/labels/pdu-labels/zpl')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          pduSid: '',
          fromPort: 1,
          toPort: 3
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation failed');
    });

    it('should return 400 for too many PDU ports', async () => {
      const response = await request(app)
        .post('/api/labels/pdu-labels/zpl')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          pduSid: 'PDU-A1',
          fromPort: 1,
          toPort: 50
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('PDU port range cannot exceed 48 ports');
    });

    it('should return 400 for invalid characters in PDU SID', async () => {
      const response = await request(app)
        .post('/api/labels/pdu-labels/zpl')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          pduSid: 'PDU~A1',
          fromPort: 1,
          toPort: 3
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('PDU SID cannot contain ^ or ~ characters');
    });

    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .post('/api/labels/pdu-labels/zpl')
        .send({
          pduSid: 'PDU-A1',
          fromPort: 1,
          toPort: 3
        })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Access denied. No token provided.');
    });
  });
});