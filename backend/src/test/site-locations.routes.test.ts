import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import UserModel from '../models/User.js';
import SiteModel from '../models/Site.js';
import SiteLocationModel from '../models/SiteLocation.js';
import LabelModel from '../models/Label.js';
import CableTypeModel from '../models/CableType.js';
import { generateTokens } from '../utils/jwt.js';
import connection from '../database/connection.js';
import { setupTestDatabase, cleanupTestDatabase } from './setup.js';

describe('Site Location Routes', () => {
  let userModel: UserModel;
  let siteModel: SiteModel;
  let siteLocationModel: SiteLocationModel;
  let labelModel: LabelModel;
  let cableTypeModel: CableTypeModel;
  let db: any;
  let testUser: any;
  let authToken: string;

  beforeEach(async () => {
    db = await setupTestDatabase({ runMigrations: true, seedData: false });
    userModel = new UserModel();
    siteModel = new SiteModel();
    siteLocationModel = new SiteLocationModel();
    labelModel = new LabelModel();
    cableTypeModel = new CableTypeModel();

    testUser = await userModel.create({
      email: 'test@example.com',
      username: 'Test User',
      password: 'TestPassword123!',
    });

    const tokens = generateTokens(testUser);
    authToken = tokens.accessToken;
  });

  afterEach(async () => {
    await cleanupTestDatabase();
  });

  it('allows the same coordinates to exist unlabeled and labeled', async () => {
    const site = await siteModel.create({ name: 'Test Site', code: 'TS', created_by: testUser.id });

    await request(app)
      .post(`/api/sites/${site.id}/locations`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ floor: '1', suite: '1', row: 'A', rack: '1', rack_size_u: 42 })
      .expect(201);

    await request(app)
      .post(`/api/sites/${site.id}/locations`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ floor: '1', suite: '1', row: 'A', rack: '1', rack_size_u: 42, label: 'LOFT' })
      .expect(201);
  });

  it('returns 409 when creating a duplicate location with the same coordinates and same label', async () => {
    const site = await siteModel.create({ name: 'Test Site', code: 'TS', created_by: testUser.id });

    await request(app)
      .post(`/api/sites/${site.id}/locations`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ floor: '1', suite: '1', row: 'A', rack: '1', rack_size_u: 42, label: 'LOFT' })
      .expect(201);

    const response = await request(app)
      .post(`/api/sites/${site.id}/locations`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ floor: '1', suite: '1', row: 'A', rack: '1', rack_size_u: 42, label: 'LOFT' })
      .expect(409);

    expect(response.body.success).toBe(false);
    expect((response.body.error ?? '').toString()).toMatch(/already exists/i);
    expect(response.body.data?.existing?.id).toBeTruthy();
  });

  it('returns 409 when creating a second unlabeled location with the same coordinates', async () => {
    const site = await siteModel.create({ name: 'Test Site', code: 'TS', created_by: testUser.id });

    await request(app)
      .post(`/api/sites/${site.id}/locations`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ floor: '1', suite: '1', row: 'A', rack: '1', rack_size_u: 42 })
      .expect(201);

    const response = await request(app)
      .post(`/api/sites/${site.id}/locations`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ floor: '1', suite: '1', row: 'A', rack: '1', rack_size_u: 42 })
      .expect(409);

    expect(response.body.success).toBe(false);
    expect((response.body.error ?? '').toString()).toMatch(/already exists/i);
  });

  it('deletes an unused location with default behavior', async () => {
    const site = await siteModel.create({ name: 'Test Site', code: 'TS', created_by: testUser.id });
    const loc = await siteLocationModel.create({ site_id: site.id, floor: '1', suite: 'A', row: 'R1', rack: '1', rack_size_u: 42, label: 'SRC' });

    const response = await request(app)
      .delete(`/api/sites/${site.id}/locations/${loc.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);

    const remaining = await siteLocationModel.findById(loc.id, site.id);
    expect(remaining).toBeNull();
  });

  it('blocks deleting a location that is in use (409) unless a strategy is provided', async () => {
    const site = await siteModel.create({ name: 'Test Site', code: 'TS', created_by: testUser.id });
    const src = await siteLocationModel.create({ site_id: site.id, floor: '1', suite: 'A', row: 'R1', rack: '1', rack_size_u: 42, label: 'SRC' });
    const dst = await siteLocationModel.create({ site_id: site.id, floor: '2', suite: 'B', row: 'R2', rack: '2', rack_size_u: 42, label: 'DST' });

    const cableType = await cableTypeModel.create({ site_id: site.id, name: 'CAT6' });

    await labelModel.create({
      site_id: site.id,
      created_by: testUser.id,
      source_location_id: src.id,
      destination_location_id: dst.id,
      cable_type_id: cableType.id,
      type: 'cable',
    });

    const response = await request(app)
      .delete(`/api/sites/${site.id}/locations/${src.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(409);

    expect(response.body.success).toBe(false);
    expect(response.body.data?.usage?.source_count).toBe(1);
    expect(response.body.data?.usage?.destination_count).toBe(0);
    expect(response.body.data?.usage?.total_in_use).toBe(1);
  });

  it('counts destination references when blocking delete (409)', async () => {
    const site = await siteModel.create({ name: 'Test Site', code: 'TS', created_by: testUser.id });
    const src = await siteLocationModel.create({ site_id: site.id, floor: '1', suite: 'A', row: 'R1', rack: '1', rack_size_u: 42, label: 'SRC' });
    const dst = await siteLocationModel.create({ site_id: site.id, floor: '2', suite: 'B', row: 'R2', rack: '2', rack_size_u: 42, label: 'DST' });

    const cableType = await cableTypeModel.create({ site_id: site.id, name: 'CAT6' });

    await labelModel.create({
      site_id: site.id,
      created_by: testUser.id,
      source_location_id: src.id,
      destination_location_id: dst.id,
      cable_type_id: cableType.id,
      type: 'cable',
    });

    const response = await request(app)
      .delete(`/api/sites/${site.id}/locations/${dst.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(409);

    expect(response.body.success).toBe(false);
    expect(response.body.data?.usage?.source_count).toBe(0);
    expect(response.body.data?.usage?.destination_count).toBe(1);
    expect(response.body.data?.usage?.total_in_use).toBe(1);
  });

  it('reassigns labels then deletes the location when strategy=reassign', async () => {
    const site = await siteModel.create({ name: 'Test Site', code: 'TS', created_by: testUser.id });
    const src = await siteLocationModel.create({ site_id: site.id, floor: '1', suite: 'A', row: 'R1', rack: '1', rack_size_u: 42, label: 'SRC' });
    const dst = await siteLocationModel.create({ site_id: site.id, floor: '2', suite: 'B', row: 'R2', rack: '2', rack_size_u: 42, label: 'DST' });

    const cableType = await cableTypeModel.create({ site_id: site.id, name: 'CAT6' });

    const created = await labelModel.create({
      site_id: site.id,
      created_by: testUser.id,
      source_location_id: src.id,
      destination_location_id: dst.id,
      cable_type_id: cableType.id,
      type: 'cable',
    });

    const response = await request(app)
      .delete(`/api/sites/${site.id}/locations/${src.id}?strategy=reassign&target_location_id=${dst.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data?.strategy).toBe('reassign');

    const updated = await labelModel.findById(created.id, site.id);
    expect(updated?.source_location_id).toBe(dst.id);

    const remaining = await siteLocationModel.findById(src.id, site.id);
    expect(remaining).toBeNull();
  });

  it('cascades label deletion then deletes the location when strategy=cascade', async () => {
    const site = await siteModel.create({ name: 'Test Site', code: 'TS', created_by: testUser.id });
    const src = await siteLocationModel.create({ site_id: site.id, floor: '1', suite: 'A', row: 'R1', rack: '1', rack_size_u: 42, label: 'SRC' });
    const dst = await siteLocationModel.create({ site_id: site.id, floor: '2', suite: 'B', row: 'R2', rack: '2', rack_size_u: 42, label: 'DST' });

    const cableType = await cableTypeModel.create({ site_id: site.id, name: 'CAT6' });

    await labelModel.create({
      site_id: site.id,
      created_by: testUser.id,
      source_location_id: src.id,
      destination_location_id: dst.id,
      cable_type_id: cableType.id,
      type: 'cable',
    });

    const response = await request(app)
      .delete(`/api/sites/${site.id}/locations/${src.id}?strategy=cascade`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data?.strategy).toBe('cascade');
    expect(response.body.data?.labels_deleted).toBe(1);

    const labelCountRows = await connection.getAdapter().query(
      'SELECT COUNT(*) as count FROM labels WHERE site_id = ?',
      [site.id]
    );
    expect(Number((labelCountRows?.[0] as any)?.count ?? 0)).toBe(0);

    const remaining = await siteLocationModel.findById(src.id, site.id);
    expect(remaining).toBeNull();
  });
});
