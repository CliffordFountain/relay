import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { ActiveNowPanel } from './ActiveNowPanel';
import { relationshipsSlice, RelationshipType } from '../../stores/relationshipsSlice';
import { presenceSlice } from '../../stores/presenceSlice';
import { uiSlice } from '../../stores/uiSlice';
import type { UserPresence } from '../../stores/presenceSlice';

function createTestStore(
  relationships: Record<string, unknown> = {},
  presences: Record<string, UserPresence> = {},
) {
  const store = configureStore({
    reducer: {
      relationships: relationshipsSlice.reducer,
      presence: presenceSlice.reducer,
      ui: uiSlice.reducer,
    },
  });
  // Set initial state via dispatch
  if (Object.keys(relationships).length > 0) {
    store.dispatch(
      relationshipsSlice.actions.setRelationships(
        Object.values(relationships) as Array<{ id: string; type: number; user: { id: string; username: string; avatar: string | null; display_name?: string } }>,
      ),
    );
  }
  if (Object.keys(presences).length > 0) {
    store.dispatch(
      presenceSlice.actions.bulkSetPresences(Object.values(presences)),
    );
  }
  return store;
}

describe('ActiveNowPanel', () => {
  it('renders without crashing', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ActiveNowPanel />
      </Provider>,
    );
    expect(screen.getByText('Active Now')).toBeInTheDocument();
  });

  it('shows empty state when no friends are active', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ActiveNowPanel />
      </Provider>,
    );
    expect(screen.getByText("Nothing happening yet")).toBeInTheDocument();
    expect(screen.getByText(/When people you know start a game/)).toBeInTheDocument();
  });

  it('has correct aria-label', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ActiveNowPanel />
      </Provider>,
    );
    expect(screen.getByRole('complementary', { name: 'Active Now' })).toBeInTheDocument();
  });

  it('shows active friends with activities', () => {
    const relationships = {
      '200': {
        id: '100',
        type: RelationshipType.FRIEND,
        user: { id: '200', username: 'GamerFriend', avatar: null, display_name: 'Gamer Friend' },
      },
    };
    const presences: Record<string, UserPresence> = {
      '200': {
        userId: '200',
        status: 'online',
        clientStatus: { desktop: 'online' },
        activities: [
          { name: 'Valorant', type: 0 },
        ],
      },
    };
    const store = createTestStore(relationships, presences);
    render(
      <Provider store={store}>
        <ActiveNowPanel />
      </Provider>,
    );
    expect(screen.getByText('Gamer Friend')).toBeInTheDocument();
    expect(screen.getByText('Playing Valorant')).toBeInTheDocument();
  });

  it('does not show offline friends', () => {
    const relationships = {
      '200': {
        id: '100',
        type: RelationshipType.FRIEND,
        user: { id: '200', username: 'OfflineFriend', avatar: null },
      },
    };
    const presences: Record<string, UserPresence> = {};
    const store = createTestStore(relationships, presences);
    render(
      <Provider store={store}>
        <ActiveNowPanel />
      </Provider>,
    );
    expect(screen.queryByText('OfflineFriend')).not.toBeInTheDocument();
    expect(screen.getByText("Nothing happening yet")).toBeInTheDocument();
  });

  it('does not show non-friend users even if they have activities', () => {
    const relationships = {
      '200': {
        id: '100',
        type: RelationshipType.BLOCKED,
        user: { id: '200', username: 'BlockedUser', avatar: null },
      },
    };
    const presences: Record<string, UserPresence> = {
      '200': {
        userId: '200',
        status: 'online',
        clientStatus: { desktop: 'online' },
        activities: [{ name: 'Gaming', type: 0 }],
      },
    };
    const store = createTestStore(relationships, presences);
    render(
      <Provider store={store}>
        <ActiveNowPanel />
      </Provider>,
    );
    expect(screen.queryByText('BlockedUser')).not.toBeInTheDocument();
  });

  it('shows listening activity correctly', () => {
    const relationships = {
      '200': {
        id: '100',
        type: RelationshipType.FRIEND,
        user: { id: '200', username: 'MusicFan', avatar: null },
      },
    };
    const presences: Record<string, UserPresence> = {
      '200': {
        userId: '200',
        status: 'online',
        clientStatus: { desktop: 'online' },
        activities: [{ name: 'Spotify', type: 2 }],
      },
    };
    const store = createTestStore(relationships, presences);
    render(
      <Provider store={store}>
        <ActiveNowPanel />
      </Provider>,
    );
    expect(screen.getByText('Listening to Spotify')).toBeInTheDocument();
  });
});
