import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import CableTraceView from '../../../components/mapindex/CableTraceView';

const routerFuture = {
  v7_startTransition: true,
  v7_relativeSplatPath: true,
};

const copyTextToClipboardMock = vi.fn();

vi.mock('../../../lib/clipboard', () => ({
  copyTextToClipboard: (...args: unknown[]) => copyTextToClipboardMock(...args),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('CableTraceView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    copyTextToClipboardMock.mockResolvedValue(true);
  });

  it('includes Source and Destination markers in copied trace text', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter future={routerFuture}>
        <CableTraceView
          siteId={1}
          cableRef="#0001"
          hops={[
            {
              hostname: 'SRC-SW1',
              sidId: 1,
              manufacturer: 'Ubiquiti',
              modelName: 'USW',
              rackLocation: 'A/1',
              rackUText: '22',
              portLabel: 'Port 1',
              nicType: 'RJ45',
            } as any,
            {
              hostname: 'DST-SW1',
              sidId: 2,
              manufacturer: 'Ubiquiti',
              modelName: 'USW',
              rackLocation: 'B/1',
              rackUText: '21',
              portLabel: 'Port 2',
              nicType: 'RJ45',
            } as any,
          ]}
        />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: 'Copy trace' }));

    expect(copyTextToClipboardMock).toHaveBeenCalledTimes(1);
    const copied = String(copyTextToClipboardMock.mock.calls[0]?.[0] ?? '');
    expect(copied).toContain('Cable Trace Ref #0001');
    expect(copied).toContain('Source');
    expect(copied).toContain('Destination');
  });
});
