import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ResetPasswordPage } from './ResetPasswordPage';

const mockResetPassword = vi.fn();

vi.mock('../../api/rest', () => ({
  api: {
    resetPassword: (...args: unknown[]) => mockResetPassword(...args),
  },
}));

describe('ResetPasswordPage', () => {
  const mockNavigateToLogin = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders reset password form', () => {
    render(
      <ResetPasswordPage token="abc123" onNavigateToLogin={mockNavigateToLogin} />
    );

    expect(screen.getByText('Reset your password')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change Password' })).toBeInTheDocument();
  });

  it('shows error when passwords do not match', async () => {
    render(
      <ResetPasswordPage token="abc123" onNavigateToLogin={mockNavigateToLogin} />
    );

    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'password123' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'differentpassword' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));

    await waitFor(() => {
      expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
    });
  });

  it('shows success message after successful password reset', async () => {
    mockResetPassword.mockResolvedValueOnce({ message: 'Password reset successfully' });
    render(
      <ResetPasswordPage token="abc123" onNavigateToLogin={mockNavigateToLogin} />
    );

    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'newpassword123' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'newpassword123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));

    await waitFor(() => {
      expect(screen.getByText('Password changed')).toBeInTheDocument();
    });
  });

  it('shows error on invalid/expired token', async () => {
    mockResetPassword.mockRejectedValueOnce({
      detail: { message: 'Invalid or expired reset token' },
    });
    render(
      <ResetPasswordPage token="expired-token" onNavigateToLogin={mockNavigateToLogin} />
    );

    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'newpassword123' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'newpassword123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));

    await waitFor(() => {
      expect(screen.getByText('Invalid or expired reset token')).toBeInTheDocument();
    });
  });
});
