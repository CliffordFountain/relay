import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ForgotPasswordPage } from './ForgotPasswordPage';

const mockForgotPassword = vi.fn();

vi.mock('../../api/rest', () => ({
  api: {
    forgotPassword: (...args: unknown[]) => mockForgotPassword(...args),
  },
}));

describe('ForgotPasswordPage', () => {
  const mockNavigateToLogin = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders forgot password form', () => {
    render(<ForgotPasswordPage onNavigateToLogin={mockNavigateToLogin} />);

    expect(screen.getByText('Forgot your password?')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send Reset Link' })).toBeInTheDocument();
  });

  it('shows success message after submitting email', async () => {
    mockForgotPassword.mockResolvedValueOnce(undefined);
    render(<ForgotPasswordPage onNavigateToLogin={mockNavigateToLogin} />);

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send Reset Link' }));

    await waitFor(() => {
      expect(screen.getByText('Request received')).toBeInTheDocument();
      expect(screen.getByText(/test@example.com/)).toBeInTheDocument();
    });
  });

  it('shows success even on API error (prevents email enumeration)', async () => {
    mockForgotPassword.mockRejectedValueOnce(new Error('Server error'));
    render(<ForgotPasswordPage onNavigateToLogin={mockNavigateToLogin} />);

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'nonexistent@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send Reset Link' }));

    await waitFor(() => {
      expect(screen.getByText('Request received')).toBeInTheDocument();
    });
  });

  it('shows "Back to Login" link', () => {
    render(<ForgotPasswordPage onNavigateToLogin={mockNavigateToLogin} />);

    const loginLink = screen.getByText('Back to Login');
    fireEvent.click(loginLink);
    expect(mockNavigateToLogin).toHaveBeenCalledTimes(1);
  });
});
