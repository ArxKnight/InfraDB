import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProfileForm from '../../../components/profile/ProfileForm';
import apiClient from '../../../lib/api';

// Mock the API client
vi.mock('../../../lib/api', () => ({
  default: {
    updateProfile: vi.fn(),
  },
}));

// Mock the auth context
const mockUpdateUser = vi.fn();
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    updateUser: mockUpdateUser,
  }),
}));

const mockUser = {
  id: 1,
  email: 'test@example.com',
  username: 'John Doe',
  role: 'USER' as const,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const mockProps = {
  user: mockUser,
  onSuccess: vi.fn(),
};

describe('ProfileForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render form with user data pre-filled', () => {
    render(<ProfileForm {...mockProps} />);

    expect(screen.getByDisplayValue('John Doe')).toBeInTheDocument();
    expect(screen.getByDisplayValue('test@example.com')).toBeInTheDocument();
    expect(screen.getByText('Edit Profile')).toBeInTheDocument();
  });

  it('should render username as read-only', () => {
    render(<ProfileForm {...mockProps} />);

    const usernameInput = screen.getByLabelText(/username/i);
    expect(usernameInput).toBeDisabled();
  });

  it('should validate email format', async () => {
    const user = userEvent.setup();
    render(<ProfileForm {...mockProps} />);

    const emailInput = screen.getByLabelText(/email address/i);
    await user.clear(emailInput);
    await user.type(emailInput, 'invalid-email');

    const submitButton = screen.getByRole('button', { name: 'Save Changes' });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Invalid email format')).toBeInTheDocument();
    });
  });

  it('should submit only changed fields', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.updateProfile).mockResolvedValue({
      success: true,
      data: { user: { ...mockUser, email: 'jane@example.com' } },
    });

    render(<ProfileForm {...mockProps} />);

    const emailInput = screen.getByLabelText(/email address/i);
    await user.clear(emailInput);
    await user.type(emailInput, 'jane@example.com');

    const submitButton = screen.getByRole('button', { name: 'Save Changes' });
    await user.click(submitButton);

    await waitFor(() => {
      expect(apiClient.updateProfile).toHaveBeenCalledWith({
        email: 'jane@example.com',
      });
    });
  });

  it('should show success message on successful update', async () => {
    const user = userEvent.setup();
    const updatedUser = { ...mockUser, email: 'jane@example.com' };
    vi.mocked(apiClient.updateProfile).mockResolvedValue({
      success: true,
      data: { user: updatedUser },
    });

    render(<ProfileForm {...mockProps} />);

    const emailInput = screen.getByLabelText(/email address/i);
    await user.clear(emailInput);
    await user.type(emailInput, 'jane@example.com');

    const submitButton = screen.getByRole('button', { name: 'Save Changes' });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Profile updated successfully')).toBeInTheDocument();
    });

    expect(mockUpdateUser).toHaveBeenCalledWith(updatedUser);
    expect(mockProps.onSuccess).toHaveBeenCalledWith(updatedUser);
  });

  it('should show error message on API failure', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.updateProfile).mockResolvedValue({
      success: false,
      error: 'Email already exists',
    });

    render(<ProfileForm {...mockProps} />);

    const emailInput = screen.getByLabelText(/email address/i);
    await user.clear(emailInput);
    await user.type(emailInput, 'existing@example.com');

    const submitButton = screen.getByRole('button', { name: 'Save Changes' });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Email already exists')).toBeInTheDocument();
    });
  });

  it('should handle network errors', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.updateProfile).mockRejectedValue(new Error('Network error'));

    render(<ProfileForm {...mockProps} />);

    const emailInput = screen.getByLabelText(/email address/i);
    await user.clear(emailInput);
    await user.type(emailInput, 'jane@example.com');

    const submitButton = screen.getByRole('button', { name: 'Save Changes' });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('should reset form when cancel is clicked', async () => {
    const user = userEvent.setup();
    render(<ProfileForm {...mockProps} />);

    const emailInput = screen.getByLabelText(/email address/i);
    await user.clear(emailInput);
    await user.type(emailInput, 'changed@example.com');

    const cancelButton = screen.getByText('Cancel');
    await user.click(cancelButton);

    expect(screen.getByDisplayValue('test@example.com')).toBeInTheDocument();
  });

  it('should disable form during submission', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.updateProfile).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    render(<ProfileForm {...mockProps} />);

    const emailInput = screen.getByLabelText(/email address/i);
    await user.clear(emailInput);
    await user.type(emailInput, 'jane@example.com');

    const submitButton = screen.getByRole('button', { name: 'Save Changes' });
    await user.click(submitButton);

    await waitFor(() => {
      expect(emailInput).toBeDisabled();
      expect(submitButton).toBeDisabled();
    });
  });

  it('should disable save button when no changes made', () => {
    render(<ProfileForm {...mockProps} />);

    const submitButton = screen.getByRole('button', { name: 'No New Changes' });
    expect(submitButton).toBeDisabled();
  });

  it('should enable save button when changes are made', async () => {
    const user = userEvent.setup();
    render(<ProfileForm {...mockProps} />);

    const emailInput = screen.getByLabelText(/email address/i);
    await user.clear(emailInput);
    await user.type(emailInput, 'updated@example.com');

    const submitButton = screen.getByRole('button', { name: 'Save Changes' });
    expect(submitButton).toBeEnabled();
  });
});