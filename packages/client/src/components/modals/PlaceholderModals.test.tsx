import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { CreateEventModal } from './CreateEventModal';
import { EditServerProfileModal } from './EditServerProfileModal';
import { guildsSlice } from '../../stores/guildsSlice';
import { membersSlice } from '../../stores/membersSlice';
import { authSlice } from '../../stores/authSlice';

function createTestStore(guild?: { id: string; name: string }) {
  const guilds: Record<string, unknown> = {};
  if (guild) {
    guilds[guild.id] = {
      ...guild,
      icon: null,
      owner_id: '100',
      member_count: 10,
      premium_tier: 0,
      premium_subscription_count: 0,
    };
  }
  return configureStore({
    reducer: {
      guilds: guildsSlice.reducer,
      members: membersSlice.reducer,
      auth: authSlice.reducer,
    },
    preloadedState: {
      guilds: {
        guilds: guilds as Record<string, { id: string; name: string; icon: string | null; owner_id: string; member_count: number }>,
        selectedGuildId: guild?.id ?? null,
        folders: [],
      },
      members: {
        membersByGuild: guild
          ? {
              [guild.id]: [
                {
                  user: { id: '100', username: 'TestUser', displayName: 'TestUser', avatar: null, bot: false },
                  roles: [],
                  nick: null,
                  joinedAt: '2026-01-01T00:00:00Z',
                },
              ],
            }
          : {},
        isLoading: false,
      },
      auth: {
        token: 'test-token',
        user: { id: '100', username: 'TestUser', global_name: null, email: 'test@test.com', avatar: null, bio: null, accent_color: null, pronouns: '', mfa_enabled: false, locale: 'en-US', flags: 0, premium_type: 0 },
        isAuthenticated: true,
        status: 'online' as const,
        customStatus: null,
        customStatusEmoji: null,
        customStatusClearAt: null,
      },
    },
  });
}

describe('CreateEventModal', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const store = createTestStore({ id: '1', name: 'Test Server' });
    const { container } = render(
      <Provider store={store}>
        <CreateEventModal guildId="1" onClose={onClose} />
      </Provider>,
    );
    expect(container).toBeTruthy();
  });

  it('renders the title', () => {
    const store = createTestStore({ id: '1', name: 'Test Server' });
    render(
      <Provider store={store}>
        <CreateEventModal guildId="1" onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByText('Create Event', { selector: 'h2' })).toBeInTheDocument();
  });

  it('renders event location options', () => {
    const store = createTestStore({ id: '1', name: 'Test Server' });
    render(
      <Provider store={store}>
        <CreateEventModal guildId="1" onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByText('Voice Channel')).toBeInTheDocument();
    expect(screen.getByText('Stage Channel')).toBeInTheDocument();
    expect(screen.getByText('Somewhere Else')).toBeInTheDocument();
  });

  it('renders event name input', () => {
    const store = createTestStore({ id: '1', name: 'Test Server' });
    render(
      <Provider store={store}>
        <CreateEventModal guildId="1" onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByLabelText(/event name/i)).toBeInTheDocument();
  });

  it('renders Create Event button that is disabled when name is empty', () => {
    const store = createTestStore({ id: '1', name: 'Test Server' });
    render(
      <Provider store={store}>
        <CreateEventModal guildId="1" onClose={onClose} />
      </Provider>,
    );
    const createBtn = screen.getByText('Create Event', { selector: 'button' });
    expect(createBtn).toBeDisabled();
  });

  it('closes when Escape is pressed', () => {
    const store = createTestStore({ id: '1', name: 'Test Server' });
    render(
      <Provider store={store}>
        <CreateEventModal guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when backdrop is clicked', () => {
    const store = createTestStore({ id: '1', name: 'Test Server' });
    render(
      <Provider store={store}>
        <CreateEventModal guildId="1" onClose={onClose} />
      </Provider>,
    );
    const overlay = screen.getByRole('dialog');
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when Cancel is clicked', () => {
    const store = createTestStore({ id: '1', name: 'Test Server' });
    render(
      <Provider store={store}>
        <CreateEventModal guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('EditServerProfileModal', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const store = createTestStore({ id: '1', name: 'Test Server' });
    const { container } = render(
      <Provider store={store}>
        <EditServerProfileModal guildId="1" onClose={onClose} />
      </Provider>,
    );
    expect(container).toBeTruthy();
  });

  it('renders the title', () => {
    const store = createTestStore({ id: '1', name: 'Test Server' });
    render(
      <Provider store={store}>
        <EditServerProfileModal guildId="1" onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByText('Edit Server Profile')).toBeInTheDocument();
  });

  it('renders the nickname input', () => {
    const store = createTestStore({ id: '1', name: 'Test Server' });
    render(
      <Provider store={store}>
        <EditServerProfileModal guildId="1" onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByLabelText('Nickname')).toBeInTheDocument();
  });

  it('renders avatar upload area', () => {
    const store = createTestStore({ id: '1', name: 'Test Server' });
    render(
      <Provider store={store}>
        <EditServerProfileModal guildId="1" onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByLabelText('Change server avatar')).toBeInTheDocument();
  });

  it('renders Save and Cancel buttons', () => {
    const store = createTestStore({ id: '1', name: 'Test Server' });
    render(
      <Provider store={store}>
        <EditServerProfileModal guildId="1" onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByText('Save')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('closes when Escape is pressed', () => {
    const store = createTestStore({ id: '1', name: 'Test Server' });
    render(
      <Provider store={store}>
        <EditServerProfileModal guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when Cancel is clicked', () => {
    const store = createTestStore({ id: '1', name: 'Test Server' });
    render(
      <Provider store={store}>
        <EditServerProfileModal guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('allows typing a nickname', () => {
    const store = createTestStore({ id: '1', name: 'Test Server' });
    render(
      <Provider store={store}>
        <EditServerProfileModal guildId="1" onClose={onClose} />
      </Provider>,
    );
    const input = screen.getByLabelText('Nickname') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'NewNick' } });
    expect(input.value).toBe('NewNick');
  });
});
