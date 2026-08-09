import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { LoginPage } from './LoginPage';
import { authSlice } from '../../stores/authSlice';
import { guildsSlice } from '../../stores/guildsSlice';
import { channelsSlice } from '../../stores/channelsSlice';

const mockLogin = vi.fn();
const mockGetMe = vi.fn();
const mockSetToken = vi.fn();
const mockGetMyGuilds = vi.fn();
const mockGetGuildChannels = vi.fn();

vi.mock('../../api/rest', () => ({
  api: {
    login: (...args: unknown[]) => mockLogin(...args),
    getMe: (...args: unknown[]) => mockGetMe(...args),
    setToken: (...args: unknown[]) => mockSetToken(...args),
    getMyGuilds: () => mockGetMyGuilds(),
    getGuildChannels: (...args: unknown[]) => mockGetGuildChannels(...args),
  },
}));

function createTestStore() {
  return configureStore({
    reducer: {
      auth: authSlice.reducer,
      guilds: guildsSlice.reducer,
      channels: channelsSlice.reducer,
    },
    preloadedState: {
      auth: {
        token: null,
        user: null,
        isAuthenticated: false, status: 'online' as const, customStatus: null,
      },
    },
  });
}

describe('LoginPage', () => {
  const mockNavigateToRegister = vi.fn();
  const mockNavigateToForgotPassword = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders login form with email and password fields', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <LoginPage
          onNavigateToRegister={mockNavigateToRegister}
          onNavigateToForgotPassword={mockNavigateToForgotPassword}
        />
      </Provider>
    );

    expect(screen.getByText('Welcome back!')).toBeInTheDocument();
    expect(screen.getByLabelText('Email or phone number')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log In' })).toBeInTheDocument();
  });

  it('shows "Forgot your password?" link that navigates to forgot password page', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <LoginPage
          onNavigateToRegister={mockNavigateToRegister}
          onNavigateToForgotPassword={mockNavigateToForgotPassword}
        />
      </Provider>
    );

    const forgotLink = screen.getByText('Forgot your password?');
    fireEvent.click(forgotLink);
    expect(mockNavigateToForgotPassword).toHaveBeenCalledTimes(1);
  });

  it('shows "Create an account" link that navigates to register page', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <LoginPage
          onNavigateToRegister={mockNavigateToRegister}
          onNavigateToForgotPassword={mockNavigateToForgotPassword}
        />
      </Provider>
    );

    const registerLink = screen.getByText('Create an account');
    fireEvent.click(registerLink);
    expect(mockNavigateToRegister).toHaveBeenCalledTimes(1);
  });

  it('shows error message on login failure', async () => {
    mockLogin.mockRejectedValueOnce({ message: 'Invalid credentials' });
    const store = createTestStore();
    render(
      <Provider store={store}>
        <LoginPage
          onNavigateToRegister={mockNavigateToRegister}
          onNavigateToForgotPassword={mockNavigateToForgotPassword}
        />
      </Provider>
    );

    fireEvent.change(screen.getByLabelText('Email or phone number'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'wrongpassword' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Log In' }));

    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
    });
  });

  it('allows submitting with a plain username (no @) and forwards it to the API', async () => {
    // Bug 1: users must be able to log in with a username, not only an email.
    mockLogin.mockResolvedValueOnce({ token: 'tok_123' });
    mockGetMe.mockResolvedValueOnce({ id: '1', username: 'alice' });
    mockGetMyGuilds.mockResolvedValueOnce([]);

    const store = createTestStore();
    render(
      <Provider store={store}>
        <LoginPage
          onNavigateToRegister={mockNavigateToRegister}
          onNavigateToForgotPassword={mockNavigateToForgotPassword}
        />
      </Provider>
    );

    const identifier = screen.getByLabelText('Email or phone number');
    // A username has no '@', so the field must accept text (not type="email",
    // which browsers refuse to submit without an '@').
    expect(identifier).toHaveAttribute('type', 'text');

    fireEvent.change(identifier, { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'TestPass123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Log In' }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith({ email: 'alice', password: 'TestPass123!' });
    });
  });
});
