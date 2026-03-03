import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../../App';

vi.mock('../../components/locations/LocationHierarchyDropdown', () => {
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

vi.mock('../../components/labels', async () => {
  const actual = await vi.importActual('../../components/labels');
  return {
    ...(actual as object),
    LabelForm: ({ onSubmit, isLoading }: any) => (
      <button
        type="button"
        disabled={isLoading}
        onClick={() => onSubmit({ source_location_id: 101, destination_location_id: 102, cable_type_id: 201, site_id: 1 })}
      >
        Create Label
      </button>
    ),
  };
});

// Mock the API client
vi.mock('../../lib/api', () => {
  const client = {
    getCurrentUser: vi.fn(),
    login: vi.fn(),
    getSites: vi.fn(),
    createSite: vi.fn(),
    getSite: vi.fn(),
    getSiteLocations: vi.fn(),
    getSiteCableTypes: vi.fn(),
    getSiteSids: vi.fn(),
    getSiteSidDeviceModels: vi.fn(),
    getLabels: vi.fn(),
    createLabel: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  };

  return {
    default: client,
    apiClient: client,
  };
});

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
  Toaster: () => null,
}));

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

const renderApp = () => {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  );
};

describe('User Workflow Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    // Default to unauthenticated; individual tests can override.
    const current = (globalThis as any).__TEST_AUTH__;
    (globalThis as any).__TEST_AUTH__ = {
      ...current,
      user: null,
      tokens: null,
      isAuthenticated: false,
      isLoading: false,
      login: vi.fn(),
    };

    window.history.pushState({}, '', '/');
  });

  it('should redirect unauthenticated users to login', async () => {
    const rendered = renderApp();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    });
  });

  it('should complete login flow and land on sites', async () => {
    const { apiClient } = await import('../../lib/api');
    const user = userEvent.setup();

    const loginMock = vi.fn(async () => {
      const current = (globalThis as any).__TEST_AUTH__;
      (globalThis as any).__TEST_AUTH__ = {
        ...current,
        user: {
          id: 1,
          email: 'test@example.com',
          full_name: 'Test User',
          role: 'USER',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
        tokens: {
          accessToken: 'mock-access-token',
          refreshToken: 'mock-refresh-token',
          expiresIn: 3600,
        },
        isAuthenticated: true,
        isLoading: false,
        login: loginMock,
      };
    });

    (globalThis as any).__TEST_AUTH__ = {
      ...(globalThis as any).__TEST_AUTH__,
      login: loginMock,
    };

    // Mock successful login
    vi.mocked(apiClient.login).mockResolvedValue({
      success: true,
      data: {
        user: {
          id: 1,
          email: 'test@example.com',
          username: 'Test User',
          role: 'user',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresIn: 3600,
      },
    });

    // Mock sites data
    vi.mocked(apiClient.getSites).mockResolvedValue({
      success: true,
      data: { sites: [], pagination: { total: 0 } },
    });

    const rendered = renderApp();

    // Wait for login form
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    });

    // Fill in login form
    const emailInput = screen.getByLabelText(/email/i);
    const passwordInput = screen.getByLabelText(/^password$/i);
    const loginButton = screen.getByRole('button', { name: /sign in/i });

    await user.type(emailInput, 'test@example.com');
    await user.type(passwordInput, 'password123');
    await user.click(loginButton);

    expect(loginMock).toHaveBeenCalledWith({
      email: 'test@example.com',
      password: 'password123',
    });

    // Re-render so the mocked AuthContext value is re-read.
    rendered.unmount();
    renderApp();

    // Should land on sites
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Sites' })).toBeInTheDocument();
    });
  });

  it('should allow GLOBAL_ADMIN users to create a site', async () => {
    const { apiClient } = await import('../../lib/api');
    const user = userEvent.setup();

    (globalThis as any).__TEST_AUTH__ = {
      ...(globalThis as any).__TEST_AUTH__,
      user: {
        id: 1,
        email: 'test@example.com',
        username: 'Test User',
        role: 'GLOBAL_ADMIN',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
      memberships: [],
      tokens: {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresIn: 3600,
      },
      isAuthenticated: true,
      isLoading: false,
    };

    // Mock authenticated user
    vi.mocked(apiClient.getCurrentUser).mockResolvedValue({
      success: true,
      data: {
        user: {
          id: 1,
          email: 'test@example.com',
          full_name: 'Test User',
          role: 'GLOBAL_ADMIN',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      },
    });

    // Mock sites data
    vi.mocked(apiClient.getSites).mockResolvedValue({
      success: true,
      data: { sites: [], pagination: { total: 0 } },
    });

    vi.mocked(apiClient.createSite).mockResolvedValue({
      success: true,
      data: {
        site: {
          id: 1,
          name: 'Test Site',
          code: 'TEST',
          location: 'Test Location',
          description: 'Test Description',
          user_id: 1,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      },
    });

    renderApp();

    // Wait for sites page to load
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Sites' })).toBeInTheDocument();
    });

    // Click create site button
    const createButton = screen.getByRole('button', { name: /create site/i });
    await user.click(createButton);

    await screen.findByText('Create New Site');

    // Fill in site form
    const nameInput = screen.getByLabelText(/site name/i);
    const codeInput = screen.getByLabelText(/abbreviation/i);
    const locationInput = screen.getByLabelText(/location/i);
    const descriptionInput = screen.getByLabelText(/description/i);

    await user.type(nameInput, 'Test Site');
    await user.type(codeInput, 'TEST');
    await user.type(locationInput, 'Test Location');
    await user.type(descriptionInput, 'Test Description');

    // Submit form
    const submitButton = screen
      .getAllByRole('button', { name: /^create site$/i })
      .find((btn) => btn.getAttribute('type') === 'submit');

    if (!submitButton) {
      throw new Error('Expected to find a submit button for "Create Site"');
    }
    await user.click(submitButton);

    // Verify API was called
    expect(apiClient.createSite).toHaveBeenCalledWith({
      name: 'Test Site',
      code: 'TEST',
      location: 'Test Location',
      description: 'Test Description',
    });
  });

  it('should allow users to create labels', async () => {
    const { apiClient } = await import('../../lib/api');
    const user = userEvent.setup();

    (globalThis as any).__TEST_AUTH__ = {
      ...(globalThis as any).__TEST_AUTH__,
      user: {
        id: 1,
        email: 'test@example.com',
        full_name: 'Test User',
        role: 'USER',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
      tokens: {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresIn: 3600,
      },
      isAuthenticated: true,
      isLoading: false,
    };

    // Mock authenticated user
    vi.mocked(apiClient.getCurrentUser).mockResolvedValue({
      success: true,
      data: {
        user: {
          id: 1,
          email: 'test@example.com',
          full_name: 'Test User',
          role: 'user',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      },
    });

    // Mock sites data
    const mockSite = {
      id: 1,
      name: 'Test Site',
      code: 'TS',
      location: 'Test Location',
      description: 'Test Description',
      user_id: 1,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      label_count: 0,
    };

    vi.mocked(apiClient.getSites).mockResolvedValue({
      success: true,
      data: { sites: [mockSite], pagination: { total: 1 } },
    });

    vi.mocked(apiClient.getSite).mockResolvedValue({
      success: true,
      data: { site: mockSite },
    });

    vi.mocked(apiClient.getLabels).mockResolvedValue({
      success: true,
      data: { labels: [], pagination: { total: 0, has_more: false } },
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

    vi.mocked(apiClient.getSiteSids).mockResolvedValue({
      success: true,
      data: { sids: [] },
    } as any);

    vi.mocked(apiClient.getSiteSidDeviceModels).mockResolvedValue({
      success: true,
      data: { device_models: [] },
    } as any);

    vi.mocked(apiClient.createLabel).mockResolvedValue({
      success: true,
      data: {
        label: {
          id: 1,
          reference_number: 'TEST-001',
          source: 'TS/1/A/R1/1',
          destination: 'TS/2/B/R2/2',
          site_id: 1,
          user_id: 1,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      },
    });

    renderApp();

    // Wait for sites page to load
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Sites' })).toBeInTheDocument();
    });

    // Open site details
    await user.click(screen.getByText('Test Site'));

    // Wait for site details
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Test Site' })).toBeInTheDocument();
    });

    // Go to Cable Index (label creation lives there)
    await user.click(await screen.findByAltText('Cable Index'));

    await waitFor(() => {
      expect(screen.getByText('Bulk Operations')).toBeInTheDocument();
    });

    // Click create label button (site-scoped)
    const createButton = await screen.findByRole('button', { name: /open label creation dialog/i });
    await user.click(createButton);

    // Fill in label form
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /create label/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /create label/i }));

    // Verify API was called
    await waitFor(() => {
      expect(apiClient.createLabel).toHaveBeenCalledWith(
        expect.objectContaining({
          source_location_id: 101,
          destination_location_id: 102,
          cable_type_id: 201,
          site_id: 1,
        })
      );
    });
  });
});