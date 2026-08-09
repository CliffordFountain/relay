import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { VerifyEmailPage } from './VerifyEmailPage';

const mockVerifyEmail = vi.fn();

vi.mock('../../api/rest', () => ({
  api: {
    verifyEmail: (...args: unknown[]) => mockVerifyEmail(...args),
  },
}));

describe('VerifyEmailPage', () => {
  const mockNavigateToLogin = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows verifying state initially', () => {
    mockVerifyEmail.mockReturnValue(new Promise(() => { /* never resolves */ }));
    render(
      <VerifyEmailPage token="abc123" onNavigateToLogin={mockNavigateToLogin} />
    );

    expect(screen.getByText('Verifying your email...')).toBeInTheDocument();
  });

  it('shows success message after successful verification', async () => {
    mockVerifyEmail.mockResolvedValueOnce({ message: 'Email verified successfully' });
    render(
      <VerifyEmailPage token="valid-token" onNavigateToLogin={mockNavigateToLogin} />
    );

    await waitFor(() => {
      expect(screen.getByText('Email verified!')).toBeInTheDocument();
    });
  });

  it('shows error on invalid token', async () => {
    mockVerifyEmail.mockRejectedValueOnce({
      detail: { message: 'Invalid or expired verification token' },
    });
    render(
      <VerifyEmailPage token="invalid-token" onNavigateToLogin={mockNavigateToLogin} />
    );

    await waitFor(() => {
      expect(screen.getByText('Verification failed')).toBeInTheDocument();
      expect(screen.getByText('Invalid or expired verification token')).toBeInTheDocument();
    });
  });

  it('calls verifyEmail API with the token', async () => {
    mockVerifyEmail.mockResolvedValueOnce({ message: 'OK' });
    render(
      <VerifyEmailPage token="test-token-123" onNavigateToLogin={mockNavigateToLogin} />
    );

    await waitFor(() => {
      expect(mockVerifyEmail).toHaveBeenCalledWith('test-token-123');
    });
  });
});
