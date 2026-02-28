import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import ProfilePage from '../../pages/ProfilePage';

const routerFuture = {
  v7_startTransition: true,
  v7_relativeSplatPath: true,
} as const;

// Mock the auth context
const mockUseAuth = vi.fn();

const mockUser = {
  id: 1,
  email: 'test@example.com',
  username: 'John Doe',
  role: 'USER' as const,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

// Mock the API client
vi.mock('../../lib/api', () => ({
  default: {
    updateProfile: vi.fn(),
    changePassword: vi.fn(),
  },
  apiClient: {
    updateProfile: vi.fn(),
    changePassword: vi.fn(),
  },
}));

const renderProfilePage = () => {
  return render(
    <BrowserRouter future={routerFuture}>
      <ProfilePage />
    </BrowserRouter>
  );
};

describe('ProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUseAuth.mockReturnValue({
      user: mockUser,
      updateUser: vi.fn(),
    });
  });

  it('should render profile page with user information', () => {
    renderProfilePage();

    expect(screen.getByText('Profile')).toBeInTheDocument();
    expect(screen.getByText('Manage your account information and settings.')).toBeInTheDocument();
  });

  it('should render tabs for different sections', () => {
    renderProfilePage();

    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('Edit Profile')).toBeInTheDocument();
    expect(screen.getByText('Change Password')).toBeInTheDocument();
  });

  it('should display user information in overview tab', () => {
    renderProfilePage();

    // Overview tab should be active by default
    expect(screen.getByText('Account Information')).toBeInTheDocument();
    expect(screen.getByText('Username')).toBeInTheDocument();
    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('test@example.com')).toBeInTheDocument();
    expect(screen.getByText('USER')).toBeInTheDocument();
  });

  it('should format and display member since date', () => {
    renderProfilePage();

    expect(screen.getByText('Member Since')).toBeInTheDocument();
    expect(screen.getByText('January 1, 2024')).toBeInTheDocument();
  });

  it('should display role with correct styling', () => {
    renderProfilePage();

    const roleElement = screen.getByText('USER');
    expect(roleElement).toHaveClass('text-primary', 'bg-primary/10');
  });

  it('should switch to edit profile tab when clicked', async () => {
    const user = userEvent.setup();
    renderProfilePage();

    const editTab = screen.getByText('Edit Profile');
    await user.click(editTab);

    await waitFor(() => {
      expect(screen.getByDisplayValue('John Doe')).toBeInTheDocument();
      expect(screen.getByDisplayValue('test@example.com')).toBeInTheDocument();
    });
  });

  it('should switch to change password tab when clicked', async () => {
    const user = userEvent.setup();
    renderProfilePage();

    const passwordTab = screen.getByText('Change Password');
    await user.click(passwordTab);

    await waitFor(() => {
      expect(screen.getByLabelText(/current password/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/^new password$/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/^confirm new password$/i)).toBeInTheDocument();
    });
  });

  it('should render breadcrumb navigation', () => {
    renderProfilePage();

    // Breadcrumb should be present (home icon)
    const homeIcon = document.querySelector('svg');
    expect(homeIcon).toBeInTheDocument();
  });

  it('should handle admin role styling', () => {
    const adminUser = { ...mockUser, role: 'GLOBAL_ADMIN' as const };

    mockUseAuth.mockReturnValue({
      user: adminUser,
      updateUser: vi.fn(),
    });

    renderProfilePage();

    const roleElement = screen.getByText('GLOBAL_ADMIN');
    expect(roleElement).toHaveClass('text-destructive', 'bg-destructive/10');
  });

  it('should not render when user is null', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      updateUser: vi.fn(),
    });

    const { container } = renderProfilePage();
    expect(container.firstChild).toBeNull();
  });

  it('should display all required user information fields', () => {
    renderProfilePage();

    expect(screen.getByText('Username')).toBeInTheDocument();
    expect(screen.getByText('Email Address')).toBeInTheDocument();
    expect(screen.getByText('Role')).toBeInTheDocument();
    expect(screen.getByText('Member Since')).toBeInTheDocument();
  });

  it('should have proper tab navigation structure', () => {
    renderProfilePage();

    const tabsList = screen.getByRole('tablist');
    expect(tabsList).toBeInTheDocument();

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveTextContent('Overview');
    expect(tabs[1]).toHaveTextContent('Edit Profile');
    expect(tabs[2]).toHaveTextContent('Change Password');
  });

  it('should have overview tab selected by default', () => {
    renderProfilePage();

    const overviewTab = screen.getByRole('tab', { name: /overview/i });
    expect(overviewTab).toHaveAttribute('data-state', 'active');
  });
});