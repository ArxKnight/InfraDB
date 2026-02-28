import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import SiteDetails from '../../../components/sites/SiteDetails';
import { apiClient } from '../../../lib/api';

const routerFuture = {
  v7_startTransition: true,
  v7_relativeSplatPath: true,
} as const;

vi.mock('../../../components/locations/LocationHierarchyDropdown', () => {
  return {
    default: ({
      locations,
      valueLocationId,
      onSelect,
      placeholder,
      disabled,
    }: any) => (
      <select
        aria-label={placeholder}
        disabled={disabled}
        value={valueLocationId ?? ''}
        onChange={(e) => onSelect(Number((e.target as HTMLSelectElement).value))}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {locations.map((l: any) => (
          <option key={l.id} value={String(l.id)}>
            {`${l.label} | Floor: ${l.floor} | Suite: ${l.suite} | Row: ${l.row} | Rack: ${l.rack}`}
          </option>
        ))}
      </select>
    ),
  };
});

const mockSite = {
  id: 1,
  name: 'Test Site',
  code: 'TS',
  location: 'Test Location',
  description: 'Test Description',
  user_id: 1,
  created_at: '2024-01-01T12:00:00Z',
  updated_at: '2024-01-02T12:00:00Z',
  label_count: 5,
};

const mockProps = {
  siteId: 1,
  onBack: vi.fn(),
};

describe('SiteDetails', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default to a non-admin user (no site admin memberships)
    (globalThis as any).__TEST_AUTH__ = {
      ...(globalThis as any).__TEST_AUTH__,
      user: {
        id: 1,
        email: 'test@example.com',
        username: 'Test User',
        role: 'USER',
      },
      memberships: [],
    };

    vi.mocked(apiClient.getSite).mockResolvedValue({
      success: true,
      data: { site: mockSite },
    });

    vi.mocked(apiClient.getSiteLocations).mockResolvedValue({
      success: true,
      data: {
        locations: [
          { id: 101, label: 'SRC', floor: '1', suite: 'A', row: 'R1', rack: '1', site_id: 1 },
        ],
      },
    } as any);

    vi.mocked(apiClient.getLabels).mockResolvedValue({
      success: true,
      data: { labels: [], pagination: { total: 0, has_more: false } },
    });

    vi.mocked(apiClient.getSiteCableTypes).mockResolvedValue({
      success: true,
      data: {
        cable_types: [
          {
            id: 201,
            site_id: 1,
            name: 'CAT6',
            description: null,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          },
        ],
      },
    } as any);

    vi.mocked(apiClient.createLabel).mockResolvedValue({
      success: true,
      data: {
        label: {
          id: 1,
          reference_number: 'TEST-0001',
          source: 'TS/1/A/R1/1',
          destination: 'TS/1/A/R1/1',
          site_id: 1,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      },
    });
  });

  it('should render site details', async () => {
    render(
      <MemoryRouter future={routerFuture}>
        <SiteDetails {...mockProps} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Test Site' })).toBeInTheDocument();
      expect(screen.getByText('Cable Index')).toBeInTheDocument();
      expect(screen.getByText('Bulk Operations')).toBeInTheDocument();
      expect(screen.getByText('Labels')).toBeInTheDocument();
    });
  });

  it('should not show Edit Site & Delete Site buttons on Cable Index', async () => {
    render(
      <MemoryRouter future={routerFuture}>
        <SiteDetails {...mockProps} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Test Site' })).toBeInTheDocument();
    });

    expect(screen.queryByText('Edit Site')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete Site')).not.toBeInTheDocument();
  });

  it('should show Cable Admin button for site admins', async () => {
    (globalThis as any).__TEST_AUTH__ = {
      ...(globalThis as any).__TEST_AUTH__,
      memberships: [{ site_id: 1, site_role: 'SITE_ADMIN' }],
    };

    render(
      <MemoryRouter future={routerFuture}>
        <SiteDetails {...mockProps} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Test Site' })).toBeInTheDocument();
    });

    expect(screen.getByText('Cable Admin')).toBeInTheDocument();
  });

  it('should not show Cable Admin button for non-admin users', async () => {
    render(
      <MemoryRouter future={routerFuture}>
        <SiteDetails {...mockProps} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Test Site' })).toBeInTheDocument();
    });

    expect(screen.queryByText('Cable Admin')).not.toBeInTheDocument();
  });

  it('should call onBack when back button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter future={routerFuture}>
        <SiteDetails {...mockProps} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Test Site' })).toBeInTheDocument();
    });

    const backButton = screen.getByText('Back to Site Hub');
    await user.click(backButton);

    expect(mockProps.onBack).toHaveBeenCalled();
  });

  it('should show loading state initially', () => {
    vi.mocked(apiClient.getSite).mockReturnValue(new Promise(() => {}) as any);
    render(
      <MemoryRouter future={routerFuture}>
        <SiteDetails {...mockProps} />
      </MemoryRouter>
    );
    expect(screen.getByText('Loading site details...')).toBeInTheDocument();
  });

  it('should handle API error', async () => {
    vi.mocked(apiClient.getSite).mockRejectedValue(new Error('API Error'));

    render(
      <MemoryRouter future={routerFuture}>
        <SiteDetails {...mockProps} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('API Error')).toBeInTheDocument();
      expect(screen.getByText('Back to Site Hub')).toBeInTheDocument();
    });
  });

  it('should handle site not found', async () => {
    vi.mocked(apiClient.getSite).mockResolvedValue({
      success: false,
      error: 'Site not found',
    });

    render(
      <MemoryRouter future={routerFuture}>
        <SiteDetails {...mockProps} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Site not found')).toBeInTheDocument();
    });
  });

  it('should show empty labels state when no labels exist', async () => {
    const siteWithoutLabels = { ...mockSite, label_count: 0 };
    vi.mocked(apiClient.getSite).mockResolvedValue({
      success: true,
      data: { site: siteWithoutLabels },
    });

    render(
      <MemoryRouter future={routerFuture}>
        <SiteDetails {...mockProps} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Label Database')).toBeInTheDocument();
      expect(screen.getByText('Create Your First Label')).toBeInTheDocument();
    });
  });

  it('should allow creating a label inside the site context', async () => {
    const user = userEvent.setup();

    const siteWithoutLabels = { ...mockSite, label_count: 0 };
    vi.mocked(apiClient.getSite).mockResolvedValue({
      success: true,
      data: { site: siteWithoutLabels },
    });

    render(
      <MemoryRouter future={routerFuture}>
        <SiteDetails {...mockProps} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Test Site' })).toBeInTheDocument();
    });

    vi.mocked(apiClient.getSiteLocations).mockResolvedValue({
      success: true,
      data: {
        locations: [
          { id: 101, label: 'SRC', floor: '1', suite: 'A', row: 'R1', rack: '1', site_id: 1 },
          { id: 102, label: 'DST', floor: '2', suite: 'B', row: 'R2', rack: '2', site_id: 1 },
        ],
      },
    } as any);

    vi.mocked(apiClient.getSiteCableTypes).mockResolvedValue({
      success: true,
      data: {
        cable_types: [
          {
            id: 201,
            site_id: 1,
            name: 'CAT6',
            description: null,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          },
        ],
      },
    } as any);

    await user.click(screen.getByText('Create Your First Label'));
    await waitFor(() => {
      expect(screen.getByLabelText('Source')).toBeInTheDocument();
      expect(screen.getByLabelText('Destination')).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText('Source'), '101');
    await user.selectOptions(screen.getByLabelText('Destination'), '102');

    // Select cable type
    await user.click(screen.getByRole('combobox', { name: /cable type/i }));
    await user.click(screen.getByRole('option', { name: 'CAT6' }));

    await user.click(screen.getByRole('button', { name: /create label/i }));

    expect(apiClient.createLabel).toHaveBeenCalledWith({
      source_location_id: 101,
      destination_location_id: 102,
      cable_type_id: 201,
      notes: undefined,
      site_id: 1,
    });
  });
});