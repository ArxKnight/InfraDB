import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import LabelModel from '../models/Label.js';
import SiteModel from '../models/Site.js';
import SiteLocationModel from '../models/SiteLocation.js';
import CableTypeModel from '../models/CableType.js';
import UserModel from '../models/User.js';
import { setupTestDatabase, cleanupTestDatabase } from './setup.js';

describe('Label Model', () => {
  let labelModel: LabelModel;
  let siteModel: SiteModel;
  let siteLocationModel: SiteLocationModel;
  let cableTypeModel: CableTypeModel;
  let userModel: UserModel;

  let testUser: any;
  let testSite: any;
  let sourceLoc: any;
  let destinationLoc: any;
  let cableType: any;

  beforeEach(async () => {
    await setupTestDatabase({ runMigrations: true, seedData: false });

    labelModel = new LabelModel();
    siteModel = new SiteModel();
    siteLocationModel = new SiteLocationModel();
    cableTypeModel = new CableTypeModel();
    userModel = new UserModel();

    testUser = await userModel.create({
      email: 'test@example.com',
      username: 'Test User',
      password: 'TestPassword123!',
      role: 'USER',
    });

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

  describe('create', () => {
    it('creates a label with a padded reference number and formatted locations', async () => {
      const label = await labelModel.create({
        site_id: testSite.id,
        created_by: testUser.id,
        source_location_id: sourceLoc.id,
        destination_location_id: destinationLoc.id,
        cable_type_id: cableType.id,
        notes: 'Test cable',
      });

      expect(label.id).toBeTypeOf('number');
      expect(label.site_id).toBe(testSite.id);
      expect(label.created_by).toBe(testUser.id);
      expect(label.reference_number).toBe('0001');
      expect(label.ref_string).toBe('0001');
      expect(label.cable_type_id).toBe(cableType.id);
      expect(label.source_location_id).toBe(sourceLoc.id);
      expect(label.destination_location_id).toBe(destinationLoc.id);
      expect(label.notes).toBe('Test cable');
      expect(label.source).toContain('SRC');
      expect(label.source).toContain('Label: TS');
      expect(label.destination).toContain('DST');
      expect(label.destination).toContain('Label: TS');
    });

    it('auto-increments reference numbers within the same site', async () => {
      const label1 = await labelModel.create({
        site_id: testSite.id,
        created_by: testUser.id,
        source_location_id: sourceLoc.id,
        destination_location_id: destinationLoc.id,
        cable_type_id: cableType.id,
      });
      const label2 = await labelModel.create({
        site_id: testSite.id,
        created_by: testUser.id,
        source_location_id: sourceLoc.id,
        destination_location_id: destinationLoc.id,
        cable_type_id: cableType.id,
      });

      expect(label1.reference_number).toBe('0001');
      expect(label2.reference_number).toBe('0002');
    });

    it('validates required fields', async () => {
      await expect(
        labelModel.create({
          site_id: testSite.id,
          created_by: testUser.id,
          source_location_id: 0,
          destination_location_id: destinationLoc.id,
          cable_type_id: cableType.id,
        })
      ).rejects.toThrow('Source location is required');

      await expect(
        labelModel.create({
          site_id: testSite.id,
          created_by: testUser.id,
          source_location_id: sourceLoc.id,
          destination_location_id: 0,
          cable_type_id: cableType.id,
        })
      ).rejects.toThrow('Destination location is required');

      await expect(
        labelModel.create({
          site_id: testSite.id,
          created_by: testUser.id,
          source_location_id: sourceLoc.id,
          destination_location_id: destinationLoc.id,
          cable_type_id: 0,
        })
      ).rejects.toThrow('Cable type is required');
    });

    it('rejects locations and cable types that do not belong to the site', async () => {
      const otherSite = await siteModel.create({
        name: 'Other Site',
        code: 'OS',
        created_by: testUser.id,
      });
      const otherLocation = await siteLocationModel.create({
        site_id: otherSite.id,
        floor: '9',
        suite: 'Z',
        row: 'R9',
        rack: '99',
        rack_size_u: 42,
        label: 'OTHER',
      });
      const otherCableType = await cableTypeModel.create({
        site_id: otherSite.id,
        name: 'FIBER',
      });

      await expect(
        labelModel.create({
          site_id: testSite.id,
          created_by: testUser.id,
          source_location_id: otherLocation.id,
          destination_location_id: destinationLoc.id,
          cable_type_id: cableType.id,
        })
      ).rejects.toThrow('Invalid site location');

      await expect(
        labelModel.create({
          site_id: testSite.id,
          created_by: testUser.id,
          source_location_id: sourceLoc.id,
          destination_location_id: destinationLoc.id,
          cable_type_id: otherCableType.id,
        })
      ).rejects.toThrow('Invalid cable type');
    });
  });

  describe('createMany', () => {
    it('creates multiple labels and returns them in a contiguous reference range', async () => {
      const created = await labelModel.createMany(
        {
          site_id: testSite.id,
          created_by: testUser.id,
          source_location_id: sourceLoc.id,
          destination_location_id: destinationLoc.id,
          cable_type_id: cableType.id,
        },
        3
      );

      expect(created).toHaveLength(3);
      expect(created[0]?.reference_number).toBe('0001');
      expect(created[1]?.reference_number).toBe('0002');
      expect(created[2]?.reference_number).toBe('0003');
    });

    it('enforces quantity bounds', async () => {
      await expect(
        labelModel.createMany(
          {
            site_id: testSite.id,
            created_by: testUser.id,
            source_location_id: sourceLoc.id,
            destination_location_id: destinationLoc.id,
            cable_type_id: cableType.id,
          },
          0
        )
      ).rejects.toThrow('Quantity must be at least 1');

      await expect(
        labelModel.createMany(
          {
            site_id: testSite.id,
            created_by: testUser.id,
            source_location_id: sourceLoc.id,
            destination_location_id: destinationLoc.id,
            cable_type_id: cableType.id,
          },
          501
        )
      ).rejects.toThrow('Quantity cannot exceed 500');
    });
  });

  describe('findById / update / delete', () => {
    it('finds, updates, and deletes a label within a site', async () => {
      const created = await labelModel.create({
        site_id: testSite.id,
        created_by: testUser.id,
        source_location_id: sourceLoc.id,
        destination_location_id: destinationLoc.id,
        cable_type_id: cableType.id,
        notes: 'Original',
      });

      const found = await labelModel.findById(created.id, testSite.id);
      expect(found?.id).toBe(created.id);
      expect(found?.notes).toBe('Original');

      const newLoc = await siteLocationModel.create({
        site_id: testSite.id,
        floor: '2',
        suite: 'B',
        row: 'R2',
        rack: '03',
        rack_size_u: 42,
        label: 'NEW',
      });

      const updated = await labelModel.update(created.id, testSite.id, {
        source_location_id: newLoc.id,
        notes: 'Updated',
      });
      expect(updated?.source_location_id).toBe(newLoc.id);
      expect(updated?.notes).toBe('Updated');

      const deleted = await labelModel.delete(created.id, testSite.id);
      expect(deleted).toBe(true);
      const afterDelete = await labelModel.findById(created.id, testSite.id);
      expect(afterDelete).toBeNull();
    });
  });

  describe('countBySiteId / getStatsBySiteId', () => {
    it('counts and returns stats scoped to a site', async () => {
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

      const total = await labelModel.countBySiteId(testSite.id);
      expect(Number(total)).toBe(2);

      const stats = await labelModel.getStatsBySiteId(testSite.id);
      expect(stats.total_labels).toBe(2);
      expect(stats.labels_this_month).toBeGreaterThanOrEqual(0);
      expect(stats.labels_today).toBeGreaterThanOrEqual(0);
    });
  });
});
