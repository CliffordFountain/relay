import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { createElement, type ReactNode } from 'react';
import { useAutoIdle } from './useAutoIdle';
import { authSlice } from '../stores/authSlice';
import { presenceSlice } from '../stores/presenceSlice';

// Mock the gateway module
vi.mock('../api/gateway', () => ({
  gateway: {
    sendPresenceUpdate: vi.fn(),
  },
}));

function createTestStore(overrides?: { status?: string; isAuthenticated?: boolean }) {
  return configureStore({
    reducer: {
      auth: authSlice.reducer,
      presence: presenceSlice.reducer,
    },
    preloadedState: {
      auth: {
        token: 'test-token',
        user: { id: '1', username: 'test', avatar: null, email: 'test@test.com' },
        isAuthenticated: overrides?.isAuthenticated ?? true,
        status: (overrides?.status ?? 'online') as 'online' | 'idle' | 'dnd' | 'invisible',
        customStatus: null,
      },
      presence: {
        presences: {},
        selfStatus: (overrides?.status ?? 'online') as 'online' | 'idle' | 'dnd' | 'invisible',
      },
    },
  });
}

function createWrapper(store: ReturnType<typeof createTestStore>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(Provider, { store, children });
  };
}

describe('useAutoIdle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('should not throw when rendered', () => {
    const store = createTestStore();
    expect(() => {
      renderHook(() => useAutoIdle(), {
        wrapper: createWrapper(store),
      });
    }).not.toThrow();
  });

  it('should set status to idle after 5 minutes of inactivity', () => {
    const store = createTestStore({ status: 'online' });
    renderHook(() => useAutoIdle(), {
      wrapper: createWrapper(store),
    });

    act(() => {
      vi.advanceTimersByTime(5 * 60 * 1000);
    });

    expect(store.getState().auth.status).toBe('idle');
  });

  it('should not auto-idle when status is dnd', () => {
    const store = createTestStore({ status: 'dnd' });
    renderHook(() => useAutoIdle(), {
      wrapper: createWrapper(store),
    });

    act(() => {
      vi.advanceTimersByTime(5 * 60 * 1000);
    });

    expect(store.getState().auth.status).toBe('dnd');
  });

  it('should not auto-idle when status is invisible', () => {
    const store = createTestStore({ status: 'invisible' });
    renderHook(() => useAutoIdle(), {
      wrapper: createWrapper(store),
    });

    act(() => {
      vi.advanceTimersByTime(5 * 60 * 1000);
    });

    expect(store.getState().auth.status).toBe('invisible');
  });

  it('should not auto-idle when not authenticated', () => {
    const store = createTestStore({ isAuthenticated: false });
    renderHook(() => useAutoIdle(), {
      wrapper: createWrapper(store),
    });

    act(() => {
      vi.advanceTimersByTime(5 * 60 * 1000);
    });

    expect(store.getState().auth.status).toBe('online');
  });

  it('should restore status on activity after auto-idle', () => {
    const store = createTestStore({ status: 'online' });
    renderHook(() => useAutoIdle(), {
      wrapper: createWrapper(store),
    });

    // Trigger auto-idle
    act(() => {
      vi.advanceTimersByTime(5 * 60 * 1000);
    });
    expect(store.getState().auth.status).toBe('idle');

    // Simulate user activity
    act(() => {
      window.dispatchEvent(new Event('mousemove'));
    });

    expect(store.getState().auth.status).toBe('online');
  });
});
