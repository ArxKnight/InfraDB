import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Radix UI (e.g., Switch) relies on ResizeObserver; jsdom doesn't provide it.
const ResizeObserverMock = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
vi.stubGlobal('ResizeObserver', ResizeObserverMock as any);

// Radix Select relies on Pointer Capture APIs which jsdom does not implement.
// Polyfill them to avoid `target.hasPointerCapture is not a function` during tests.
if (!(Element.prototype as any).hasPointerCapture) {
  (Element.prototype as any).hasPointerCapture = () => false;
}
if (!(Element.prototype as any).setPointerCapture) {
  (Element.prototype as any).setPointerCapture = () => {};
}
if (!(Element.prototype as any).releasePointerCapture) {
  (Element.prototype as any).releasePointerCapture = () => {};
}

// Radix Select also calls `scrollIntoView` on internal option elements.
// jsdom doesn't implement it, so provide a no-op.
if (!(Element.prototype as any).scrollIntoView) {
  (Element.prototype as any).scrollIntoView = () => {};
}

// App performs a setup-status fetch on startup; make it deterministic in tests.
vi.stubGlobal(
  'fetch',
  vi.fn(async (input: any) => {
    const url = typeof input === 'string' ? input : input?.url;
    if (typeof url === 'string' && url.includes('/api/setup/status')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ setupRequired: false }),
      } as any;
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({}),
    } as any;
  })
);

const defaultAuthState = {
  user: {
    id: 1,
    email: 'test@example.com',
    username: 'Test User',
    role: 'USER',
  },
  tokens: {
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    expiresIn: 3600,
  },
  isAuthenticated: true,
  isLoading: false,
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  refreshUser: vi.fn(),
  updateUser: vi.fn(),
};

// Allow individual tests to override auth state without remocking
(globalThis as any).__TEST_AUTH__ = defaultAuthState;

// Mock API client (provide a wide surface area so component tests don't crash)
vi.mock('../lib/api', () => {
  const apiClient = {
    // Auth
    login: vi.fn(),
    register: vi.fn(),
    refreshToken: vi.fn(),
    getCurrentUser: vi.fn(),
    logout: vi.fn(),
    updateProfile: vi.fn(),
    changePassword: vi.fn(),

    // Sites
    getSites: vi.fn(),
    getSite: vi.fn(),
    createSite: vi.fn(),
    updateSite: vi.fn(),
    deleteSite: vi.fn(),

    // Site Locations
    getSiteLocations: vi.fn(),
    createSiteLocation: vi.fn(),
    updateSiteLocation: vi.fn(),
    deleteSiteLocation: vi.fn(),

    // Cable Types
    getSiteCableTypes: vi.fn(),
    createSiteCableType: vi.fn(),
    updateSiteCableType: vi.fn(),
    deleteSiteCableType: vi.fn(),

    // SIDs (used by label form endpoint options)
    getSiteSids: vi.fn(),
    getSiteSid: vi.fn(),
    getSiteSidDeviceModels: vi.fn(),

    // Labels
    getLabels: vi.fn(),
    getLabel: vi.fn(),
    createLabel: vi.fn(),
    updateLabel: vi.fn(),
    deleteLabel: vi.fn(),
    bulkDeleteLabels: vi.fn(),
    getLabelStats: vi.fn(),
    getRecentLabels: vi.fn(),

    // Admin
    getUsers: vi.fn(),
    updateUserRole: vi.fn(),
    deleteUser: vi.fn(),
    inviteUser: vi.fn(),
    getInvitations: vi.fn(),
    cancelInvitation: vi.fn(),
    getAdminStats: vi.fn(),
    getUserSites: vi.fn(),
    updateUserSites: vi.fn(),
    validateInvite: vi.fn(),
    acceptInvite: vi.fn(),
    getAppSettings: vi.fn(),
    updateAppSettings: vi.fn(),

    // Generic methods used by some components
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    downloadFile: vi.fn(),
  };

  return {
    apiClient,
    default: apiClient,
  };
});

// Mock React Router
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');

  const navigateImpl = (to: any, options?: any) => {
    if (typeof to === 'number') {
      window.history.go(to);
      window.dispatchEvent(new PopStateEvent('popstate'));
      return;
    }

    const target = typeof to === 'string'
      ? to
      : typeof to === 'object' && to !== null
        ? (to.pathname ?? '')
        : '';

    if (!target) return;

    if (options?.replace) {
      window.history.replaceState({}, '', target);
    } else {
      window.history.pushState({}, '', target);
    }
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  return {
    ...actual,
    useNavigate: () => vi.fn(navigateImpl),
  };
});

// Mock AuthContext
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => (globalThis as any).__TEST_AUTH__,
  AuthProvider: ({ children }: { children: any }) => children,
}));