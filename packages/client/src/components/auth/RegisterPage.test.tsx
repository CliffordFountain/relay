import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { RegisterPage } from './RegisterPage';
import { authSlice } from '../../stores/authSlice';

const mockRegister = vi.fn();
const mockGetMe = vi.fn();
const mockSetToken = vi.fn();

vi.mock('../../api/rest', () => ({
  api: {
    register: (...args: unknown[]) => mockRegister(...args),
    getMe: (...args: unknown[]) => mockGetMe(...args),
    setToken: (...args: unknown[]) => mockSetToken(...args),
  },
}));

function createTestStore() {
  return configureStore({
    reducer: {
      auth: authSlice.reducer,
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

describe('RegisterPage', () => {
  const mockNavigateToLogin = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders registration form with all required fields', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <RegisterPage onNavigateToLogin={mockNavigateToLogin} />
      </Provider>
    );

    expect(screen.getByText('Create an account')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Display name')).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Month')).toBeInTheDocument();
    expect(screen.getByLabelText('Day')).toBeInTheDocument();
    expect(screen.getByLabelText('Year')).toBeInTheDocument();
  });

  it('shows "Already have an account?" link that navigates to login', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <RegisterPage onNavigateToLogin={mockNavigateToLogin} />
      </Provider>
    );

    const loginLink = screen.getByText('Already have an account?');
    fireEvent.click(loginLink);
    expect(mockNavigateToLogin).toHaveBeenCalledTimes(1);
  });

  it('signs the user in after successful registration', async () => {
    mockRegister.mockResolvedValueOnce({ token: 'test-token' });
    mockGetMe.mockResolvedValueOnce({
      id: '1', username: 'testuser', email: 'test@example.com', avatar: null,
    });

    const store = createTestStore();
    render(
      <Provider store={store}>
        <RegisterPage onNavigateToLogin={mockNavigateToLogin} />
      </Provider>
    );

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2000' } });

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    // Registration signs the user straight in; there is no email-verification
    // wall. The router (not present in this unit test) redirects an authenticated
    // user from /register into the app, so here we assert the auth state landed.
    await waitFor(() => {
      expect(store.getState().auth.isAuthenticated).toBe(true);
    });
    expect(store.getState().auth.token).toBe('test-token');
  });

  it('shows error when date of birth is not filled', async () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <RegisterPage onNavigateToLogin={mockNavigateToLogin} />
      </Provider>
    );

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(screen.getByText('Please fill in your date of birth.')).toBeInTheDocument();
    });
  });
});
