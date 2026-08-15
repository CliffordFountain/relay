import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { GuildEventsModal } from './GuildEventsModal';
import { authSlice } from '../../stores/authSlice';
import type { GuildScheduledEvent } from '../../api/rest';

const mockGetGuildScheduledEvents = vi.fn();
const mockGetScheduledEventInterested = vi.fn();
const mockRsvpScheduledEvent = vi.fn();
const mockUnrsvpScheduledEvent = vi.fn();
const mockDeleteGuildScheduledEvent = vi.fn();

vi.mock('../../api/rest', () => ({
  api: {
    getGuildScheduledEvents: (...args: unknown[]) => mockGetGuildScheduledEvents(...args),
    getScheduledEventInterested: (...args: unknown[]) => mockGetScheduledEventInterested(...args),
    rsvpScheduledEvent: (...args: unknown[]) => mockRsvpScheduledEvent(...args),
    unrsvpScheduledEvent: (...args: unknown[]) => mockUnrsvpScheduledEvent(...args),
    deleteGuildScheduledEvent: (...args: unknown[]) => mockDeleteGuildScheduledEvent(...args),
  },
}));

function makeEvent(overrides: Partial<GuildScheduledEvent> = {}): GuildScheduledEvent {
  return {
    id: 'event-1',
    guild_id: 'guild-1',
    channel_id: null,
    creator_id: 'creator-1',
    name: 'Community Game Night',
    description: null,
    scheduled_start_time: '2026-10-01T18:00:00.000Z',
    scheduled_end_time: null,
    entity_type: 3,
    entity_metadata: {},
    status: 1,
    privacy_level: 2,
    interested_count: 0,
    ...overrides,
  };
}

function createTestStore(currentUserId = 'me-1') {
  return configureStore({
    reducer: {
      auth: authSlice.reducer,
    },
    preloadedState: {
      auth: {
        token: 'test-token',
        user: {
          id: currentUserId,
          username: 'tester',
          avatar: null,
          email: 'tester@example.com',
        },
        isAuthenticated: true,
        status: 'online' as const,
        customStatus: null,
        customStatusEmoji: null,
        customStatusClearAt: null,
      },
    },
  });
}

describe('GuildEventsModal - RSVP / Interested', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetScheduledEventInterested.mockResolvedValue({ user_ids: [], count: 0 });
  });

  it('shows the interested count and an Interested button for each event', async () => {
    mockGetGuildScheduledEvents.mockResolvedValue([makeEvent({ interested_count: 2 })]);
    mockGetScheduledEventInterested.mockResolvedValue({ user_ids: ['someone-else'], count: 2 });

    const store = createTestStore();
    render(
      <Provider store={store}>
        <GuildEventsModal guildId="guild-1" onClose={() => {}} />
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('interest-count')).toHaveTextContent('2 interested');
    });
    expect(screen.getByRole('button', { name: /Mark interested in Community Game Night/i })).toHaveTextContent('Interested');
  });

  it('marks the event as interested when the current user is in user_ids', async () => {
    mockGetGuildScheduledEvents.mockResolvedValue([makeEvent({ interested_count: 1 })]);
    mockGetScheduledEventInterested.mockResolvedValue({ user_ids: ['me-1'], count: 1 });

    const store = createTestStore('me-1');
    render(
      <Provider store={store}>
        <GuildEventsModal guildId="guild-1" onClose={() => {}} />
      </Provider>,
    );

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /Remove interest from Community Game Night/i });
      expect(btn).toHaveTextContent('✓ Interested');
      expect(btn).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('toggles from not-interested to interested optimistically and calls rsvpScheduledEvent', async () => {
    mockGetGuildScheduledEvents.mockResolvedValue([makeEvent({ interested_count: 0 })]);
    mockGetScheduledEventInterested.mockResolvedValue({ user_ids: [], count: 0 });
    mockRsvpScheduledEvent.mockResolvedValue(undefined);

    const store = createTestStore('me-1');
    render(
      <Provider store={store}>
        <GuildEventsModal guildId="guild-1" onClose={() => {}} />
      </Provider>,
    );

    const btn = await screen.findByRole('button', { name: /Mark interested in Community Game Night/i });
    fireEvent.click(btn);

    // optimistic update happens synchronously with the click
    expect(screen.getByTestId('interest-count')).toHaveTextContent('1 interested');
    expect(screen.getByRole('button', { name: /Remove interest from Community Game Night/i })).toHaveTextContent('✓ Interested');

    await waitFor(() => {
      expect(mockRsvpScheduledEvent).toHaveBeenCalledWith('guild-1', 'event-1');
    });
  });

  it('toggles from interested to not-interested and calls unrsvpScheduledEvent', async () => {
    mockGetGuildScheduledEvents.mockResolvedValue([makeEvent({ interested_count: 3 })]);
    mockGetScheduledEventInterested.mockResolvedValue({ user_ids: ['me-1'], count: 3 });
    mockUnrsvpScheduledEvent.mockResolvedValue(undefined);

    const store = createTestStore('me-1');
    render(
      <Provider store={store}>
        <GuildEventsModal guildId="guild-1" onClose={() => {}} />
      </Provider>,
    );

    const btn = await screen.findByRole('button', { name: /Remove interest from Community Game Night/i });
    fireEvent.click(btn);

    expect(screen.getByTestId('interest-count')).toHaveTextContent('2 interested');

    await waitFor(() => {
      expect(mockUnrsvpScheduledEvent).toHaveBeenCalledWith('guild-1', 'event-1');
    });
  });

  it('reverts the optimistic update if the RSVP request fails', async () => {
    mockGetGuildScheduledEvents.mockResolvedValue([makeEvent({ interested_count: 0 })]);
    mockGetScheduledEventInterested.mockResolvedValue({ user_ids: [], count: 0 });
    mockRsvpScheduledEvent.mockRejectedValue(new Error('network error'));

    const store = createTestStore('me-1');
    render(
      <Provider store={store}>
        <GuildEventsModal guildId="guild-1" onClose={() => {}} />
      </Provider>,
    );

    const btn = await screen.findByRole('button', { name: /Mark interested in Community Game Night/i });
    fireEvent.click(btn);

    expect(screen.getByTestId('interest-count')).toHaveTextContent('1 interested');

    await waitFor(() => {
      expect(screen.getByTestId('interest-count')).toHaveTextContent('0 interested');
    });
    expect(screen.getByRole('button', { name: /Mark interested in Community Game Night/i })).toHaveTextContent('Interested');
  });

  it('tolerates a failed per-event interested lookup without crashing the list', async () => {
    mockGetGuildScheduledEvents.mockResolvedValue([makeEvent({ interested_count: 5 })]);
    mockGetScheduledEventInterested.mockRejectedValue(new Error('boom'));

    const store = createTestStore('me-1');
    render(
      <Provider store={store}>
        <GuildEventsModal guildId="guild-1" onClose={() => {}} />
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('event-item')).toBeInTheDocument();
    });
    // Falls back to the seeded count from the event payload since the lookup failed.
    expect(screen.getByTestId('interest-count')).toHaveTextContent('5 interested');
    expect(screen.getByRole('button', { name: /Mark interested in Community Game Night/i })).toBeInTheDocument();
  });
});
