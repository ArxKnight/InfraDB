import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LabelDetailsDialog from '../../../components/labels/LabelDetailsDialog';
import { apiClient } from '../../../lib/api';

vi.mock('../../../components/labels/LabelForm', () => ({
  default: ({ onSubmit }: any) => (
    <button
      type="button"
      onClick={() =>
        onSubmit({
          source_location_id: 101,
          destination_location_id: 102,
          cable_type_id: 201,
          notes: 'updated note',
          via_patch_panel: true,
          patch_panel_sid_id: 33,
          patch_panel_port: 8,
          source_connected_sid_id: 10,
          source_connected_port: '2',
          destination_connected_sid_id: 11,
          destination_connected_port: '5',
        })
      }
    >
      Save Mock Label
    </button>
  ),
}));

describe('LabelDetailsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.updateLabel as any).mockResolvedValue({
      success: true,
      data: { label: { id: 1 } },
    });
  });

  it('forwards connected endpoint fields when updating a label', async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <LabelDetailsDialog
        open
        onOpenChange={onOpenChange}
        label={{
          id: 1,
          site_id: 1,
          created_by: 1,
          ref_number: 4,
          ref_string: '0004',
          type: 'cable',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          site_name: 'Test Site',
        } as any}
        siteId={1}
        siteCode="TS"
        onChanged={onChanged}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Save Mock Label' }));

    await waitFor(() => {
      expect(apiClient.updateLabel).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          site_id: 1,
          source_connected_sid_id: 10,
          source_connected_port: '2',
          destination_connected_sid_id: 11,
          destination_connected_port: '5',
        })
      );
    });
  });
});
