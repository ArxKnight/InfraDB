import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import UserModel from '../models/User.js';
import SiteModel from '../models/Site.js';
import SiteLocationModel from '../models/SiteLocation.js';
import CableTypeModel from '../models/CableType.js';
import LabelModel from '../models/Label.js';
import { generateTokens } from '../utils/jwt.js';
import { setupTestDatabase, cleanupTestDatabase } from './setup.js';

describe('Label Routes', () => {
  let userModel: UserModel;
  let siteModel: SiteModel;
  let siteLocationModel: SiteLocationModel;
  let cableTypeModel: CableTypeModel;
  let labelModel: LabelModel;

  let testUser: any;
  let authToken: string;
  let testSite: any;
  let sourceLoc: any;
  let destinationLoc: any;
  let cableType: any;

  beforeEach(async () => {
    await setupTestDatabase({ runMigrations: true, seedData: false });

    userModel = new UserModel();
    siteModel = new SiteModel();
    siteLocationModel = new SiteLocationModel();
    cableTypeModel = new CableTypeModel();
    labelModel = new LabelModel();

    testUser = await userModel.create({
      email: 'test@example.com',
      username: 'Test User',
      password: 'TestPassword123!',
      role: 'USER',
    });

    const tokens = generateTokens(testUser);
    authToken = tokens.accessToken;

    testSite = await siteModel.create({
      name: 'Test Site',
      code: 'TS',
      created_by: testUser.id,
    });

    sourceLoc = await siteLocationModel.create({
      site_id: testSite.id,
      floor: '1',
      suite: 'A',
      row: 'R1',
      rack: '01',
      rack_size_u: 42,
      label: 'SRC',
    });

    destinationLoc = await siteLocationModel.create({
      site_id: testSite.id,
      floor: '1',
      suite: 'A',
      row: 'R1',
      rack: '02',
      rack_size_u: 42,
      label: 'DST',
    });

    cableType = await cableTypeModel.create({
      site_id: testSite.id,
      name: 'CAT6',
    });
  });

  afterEach(async () => {
    await cleanupTestDatabase();
  });

  describe('GET /api/labels', () => {
    it('requires authentication', async () => {
      await request(app)
        .get(`/api/labels?site_id=${testSite.id}`)
        .expect(401);
    });

    it('lists labels for a site with pagination metadata', async () => {
      await labelModel.create({
        site_id: testSite.id,
        created_by: testUser.id,
        source_location_id: sourceLoc.id,
        destination_location_id: destinationLoc.id,
        cable_type_id: cableType.id,
        notes: 'A',
      });
      await labelModel.create({
        site_id: testSite.id,
        created_by: testUser.id,
        source_location_id: sourceLoc.id,
        destination_location_id: destinationLoc.id,
        cable_type_id: cableType.id,
        notes: 'B',
      });

      const response = await request(app)
        .get(`/api/labels?site_id=${testSite.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.labels).toHaveLength(2);
      expect(response.body.data.pagination.total).toBe(2);
    });

    it('filters by reference_number', async () => {
      await labelModel.create({
        site_id: testSite.id,
        created_by: testUser.id,
        source_location_id: sourceLoc.id,
        destination_location_id: destinationLoc.id,
        cable_type_id: cableType.id,
      });
      await labelModel.create({
        site_id: testSite.id,
        created_by: testUser.id,
        source_location_id: sourceLoc.id,
        destination_location_id: destinationLoc.id,
        cable_type_id: cableType.id,
      });

      const response = await request(app)
        .get(`/api/labels?site_id=${testSite.id}&reference_number=0002`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.labels).toHaveLength(1);
      expect(response.body.data.labels[0].reference_number).toBe('0002');
    });

    it('denies access to a site without membership (403)', async () => {
      const otherUser = await userModel.create({
        email: 'other@example.com',
        username: 'Other User',
        password: 'TestPassword123!',
        role: 'USER',
      });
      const otherTokens = generateTokens(otherUser);

      await request(app)
        .get(`/api/labels?site_id=${testSite.id}`)
        .set('Authorization', `Bearer ${otherTokens.accessToken}`)
        .expect(403);
    });

    it('supports filtering by location fields, cable type, and created by', async () => {
      const ivyUser = await userModel.create({
        email: 'ivy@example.com',
        username: 'ivy',
        password: 'TestPassword123!',
        role: 'USER',
      });

      const ivyLoc = await siteLocationModel.create({
        site_id: testSite.id,
        floor: '1',
        suite: 'A',
        row: 'R1',
        rack: '03',
        rack_size_u: 42,
        label: 'IVY',
      });

      const otherLocA = await siteLocationModel.create({
        site_id: testSite.id,
        floor: '2',
        suite: 'B',
        row: 'R2',
        rack: '04',
        rack_size_u: 42,
        label: 'OAK',
      });

      const otherLocB = await siteLocationModel.create({
        site_id: testSite.id,
        floor: '2',
        suite: 'B',
        row: 'R2',
        rack: '05',
        rack_size_u: 42,
        label: 'PINE',
      });

      const fiberType = await cableTypeModel.create({
        site_id: testSite.id,
        name: 'FIBER',
      });

      const ivyLabel = await labelModel.create({
        site_id: testSite.id,
        created_by: ivyUser.id,
        source_location_id: ivyLoc.id,
        destination_location_id: otherLocB.id,
        cable_type_id: fiberType.id,
      });

      await labelModel.create({
        site_id: testSite.id,
        created_by: testUser.id,
        source_location_id: otherLocA.id,
        destination_location_id: otherLocB.id,
        cable_type_id: cableType.id,
      });

      const response = await request(app)
        .get('/api/labels')
        .query({
          site_id: testSite.id,
          location_label: 'IVY',
          floor: '1',
          suite: 'A',
          row: 'R1',
          rack: '03',
          cable_type: 'FIB',
          created_by: 'ivy',
        })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.labels).toHaveLength(1);
      expect(response.body.data.labels[0].id).toBe(ivyLabel.id);
      expect(response.body.data.pagination.total).toBe(1);
    });

    it('filters by source_location_id', async () => {
      const otherLoc = await siteLocationModel.create({
        site_id: testSite.id,
        floor: '9',
        suite: 'Z',
        row: 'R9',
        rack: '99',
        rack_size_u: 42,
        label: 'OTHER',
      });

      const a = await labelModel.create({
        site_id: testSite.id,
        created_by: testUser.id,
        source_location_id: sourceLoc.id,
        destination_location_id: destinationLoc.id,
        cable_type_id: cableType.id,
      });

      await labelModel.create({
        site_id: testSite.id,
        created_by: testUser.id,
        source_location_id: otherLoc.id,
        destination_location_id: destinationLoc.id,
        cable_type_id: cableType.id,
      });

      const response = await request(app)
        .get('/api/labels')
        .query({ site_id: testSite.id, source_location_id: sourceLoc.id })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.labels).toHaveLength(1);
      expect(response.body.data.labels[0].id).toBe(a.id);
      expect(response.body.data.pagination.total).toBe(1);
    });

    it('filters by destination_location_id', async () => {
      const otherLoc = await siteLocationModel.create({
        site_id: testSite.id,
        floor: '8',
        suite: 'Y',
        row: 'R8',
        rack: '88',
        rack_size_u: 42,
        label: 'OTHER',
      });

      const a = await labelModel.create({
        site_id: testSite.id,
        created_by: testUser.id,
        source_location_id: sourceLoc.id,
        destination_location_id: destinationLoc.id,
        cable_type_id: cableType.id,
      });

      await labelModel.create({
        site_id: testSite.id,
        created_by: testUser.id,
        source_location_id: sourceLoc.id,
        destination_location_id: otherLoc.id,
        cable_type_id: cableType.id,
      });

      const response = await request(app)
        .get('/api/labels')
        .query({ site_id: testSite.id, destination_location_id: destinationLoc.id })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.labels).toHaveLength(1);
      expect(response.body.data.labels[0].id).toBe(a.id);
      expect(response.body.data.pagination.total).toBe(1);
    });

    it('supports filtering source rack to destination floor (side-specific)', async () => {
      const srcRack = await siteLocationModel.create({
        site_id: testSite.id,
        floor: '1',
        suite: 'A',
        row: 'R1',
        rack: '99',
        rack_size_u: 42,
        label: 'SRC',
      });

      const dstFloor2a = await siteLocationModel.create({
        site_id: testSite.id,
        floor: '2',
        suite: 'A',
        row: 'R1',
        rack: '01',
        rack_size_u: 42,
        label: 'DST',
      });

      const dstFloor3 = await siteLocationModel.create({
        site_id: testSite.id,
        floor: '3',
        suite: 'A',
        row: 'R1',
        rack: '01',
        rack_size_u: 42,
        label: 'DST',
      });

      const match = await labelModel.create({
        site_id: testSite.id,
        created_by: testUser.id,
        source_location_id: srcRack.id,
        destination_location_id: dstFloor2a.id,
        cable_type_id: cableType.id,
      });

      await labelModel.create({
        site_id: testSite.id,
        created_by: testUser.id,
        source_location_id: srcRack.id,
        destination_location_id: dstFloor3.id,
        cable_type_id: cableType.id,
      });

      const response = await request(app)
        .get('/api/labels')
        .query({
          site_id: testSite.id,
          source_rack: '99',
          destination_floor: '2',
        })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.labels).toHaveLength(1);
      expect(response.body.data.labels[0].id).toBe(match.id);
      expect(response.body.data.pagination.total).toBe(1);
    });

    it('search matches location fields like "Floor 1" and location labels like "IVY"', async () => {
      const ivyLoc = await siteLocationModel.create({
        site_id: testSite.id,
        floor: '1',
        suite: 'A',
        row: 'R1',
        rack: '06',
        rack_size_u: 42,
        label: 'IVY',
      });

      const otherLoc = await siteLocationModel.create({
        site_id: testSite.id,
        floor: '2',
        suite: 'B',
        row: 'R2',
        rack: '07',
        rack_size_u: 42,
        label: 'OAK',
      });

      const ivyLabel = await labelModel.create({
        site_id: testSite.id,
        created_by: testUser.id,
        source_location_id: ivyLoc.id,
        destination_location_id: otherLoc.id,
        cable_type_id: cableType.id,
      });

      const byFloor = await request(app)
        .get('/api/labels')
        .query({ site_id: testSite.id, search: 'Floor 1' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(byFloor.body.success).toBe(true);
      expect(byFloor.body.data.labels.map((l: any) => l.id)).toContain(ivyLabel.id);

      const byLabel = await request(app)
        .get('/api/labels')
        .query({ site_id: testSite.id, search: 'IVY' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(byLabel.body.success).toBe(true);
      expect(byLabel.body.data.labels.map((l: any) => l.id)).toContain(ivyLabel.id);
    });
  });

  describe('GET /api/labels/:id', () => {
    it('returns a label by id (site-scoped)', async () => {
      const created = await labelModel.create({
        site_id: testSite.id,
        created_by: testUser.id,
        source_location_id: sourceLoc.id,
        destination_location_id: destinationLoc.id,
        cable_type_id: cableType.id,
      });

      const response = await request(app)
        .get(`/api/labels/${created.id}?site_id=${testSite.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.label.id).toBe(created.id);
      expect(response.body.data.label.site_id).toBe(testSite.id);
    });

    it('returns 404 for missing label', async () => {
      await request(app)
        .get(`/api/labels/99999?site_id=${testSite.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });
  });

  describe('POST /api/labels', () => {
    it('creates a single label', async () => {
      const response = await request(app)
        .post('/api/labels')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          site_id: testSite.id,
          source_location_id: sourceLoc.id,
          destination_location_id: destinationLoc.id,
          cable_type_id: cableType.id,
          notes: 'Hello',
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.label.reference_number).toBe('0001');
      expect(response.body.data.created_count).toBe(1);
      expect(response.body.data.first_ref_number).toBe(1);
      expect(response.body.data.last_ref_number).toBe(1);
    });

    it('creates multiple labels when quantity > 1', async () => {
      const response = await request(app)
        .post('/api/labels')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          site_id: testSite.id,
          source_location_id: sourceLoc.id,
          destination_location_id: destinationLoc.id,
          cable_type_id: cableType.id,
          quantity: 3,
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.labels).toHaveLength(3);
      expect(response.body.data.labels[0].reference_number).toBe('0001');
      expect(response.body.data.labels[2].reference_number).toBe('0003');
      expect(response.body.data.created_count).toBe(3);
      expect(response.body.data.first_ref_number).toBe(1);
      expect(response.body.data.last_ref_number).toBe(3);
    });
  });

  describe('PUT /api/labels/:id', () => {
    it('updates a label', async () => {
      const created = await labelModel.create({
        site_id: testSite.id,
        created_by: testUser.id,
        source_location_id: sourceLoc.id,
        destination_location_id: destinationLoc.id,
        cable_type_id: cableType.id,
        notes: 'Original',
      });

      const newLoc = await siteLocationModel.create({
        site_id: testSite.id,
        floor: '2',
        suite: 'B',
        row: 'R2',
        rack: '03',
        rack_size_u: 42,
        label: 'NEW',
      });

      const response = await request(app)
        .put(`/api/labels/${created.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          site_id: testSite.id,
          source_location_id: newLoc.id,
          notes: 'Updated',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.label.notes).toBe('Updated');
      expect(response.body.data.label.source_location_id).toBe(newLoc.id);
    });
  });

  describe('DELETE /api/labels/:id', () => {
    it('deletes a label', async () => {
      const created = await labelModel.create({
        site_id: testSite.id,
        created_by: testUser.id,
        source_location_id: sourceLoc.id,
        destination_location_id: destinationLoc.id,
        cable_type_id: cableType.id,
      });

      await request(app)
        .delete(`/api/labels/${created.id}?site_id=${testSite.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const remaining = await labelModel.findById(created.id, testSite.id);
      expect(remaining).toBeNull();
    });
  });

  describe('POST /api/labels/bulk-delete', () => {
    it('deletes multiple labels', async () => {
      const a = await labelModel.create({
        site_id: testSite.id,
        created_by: testUser.id,
        source_location_id: sourceLoc.id,
        destination_location_id: destinationLoc.id,
        cable_type_id: cableType.id,
      });
      const b = await labelModel.create({
        site_id: testSite.id,
        created_by: testUser.id,
        source_location_id: sourceLoc.id,
        destination_location_id: destinationLoc.id,
        cable_type_id: cableType.id,
      });

      const response = await request(app)
        .post('/api/labels/bulk-delete')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          site_id: testSite.id,
          ids: [a.id, b.id],
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.deleted_count).toBe(2);
    });
  });

  describe('GET /api/labels/stats', () => {
    it('returns stats for a site', async () => {
      await labelModel.create({
        site_id: testSite.id,
        created_by: testUser.id,
        source_location_id: sourceLoc.id,
        destination_location_id: destinationLoc.id,
        cable_type_id: cableType.id,
      });

      const response = await request(app)
        .get(`/api/labels/stats?site_id=${testSite.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.stats.total_labels).toBe(1);
    });
  });

  describe('GET /api/labels/recent', () => {
    it('returns recent labels (limited)', async () => {
      for (let i = 0; i < 3; i++) {
        await labelModel.create({
          site_id: testSite.id,
          created_by: testUser.id,
          source_location_id: sourceLoc.id,
          destination_location_id: destinationLoc.id,
          cable_type_id: cableType.id,
        });
      }

      const response = await request(app)
        .get(`/api/labels/recent?site_id=${testSite.id}&limit=2`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.labels.length).toBeLessThanOrEqual(2);
    });
  });
});
