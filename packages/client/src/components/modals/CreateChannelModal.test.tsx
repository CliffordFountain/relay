import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { CreateChannelModal } from './CreateChannelModal';
import { guildsSlice } from '../../stores/guildsSlice';
import { channelsSlice } from '../../stores/channelsSlice';
import { uiSlice } from '../../stores/uiSlice';

const mockCreateChannel = vi.fn();

vi.mock('../../api/rest', () => ({
  api: {
    createChannel: (...args: unknown[]) => mockCreateChannel(...args),
  },
}));

function createTestStore(options?: {
  selectedGuildId?: string;
  channels?: Array<{ id: string; guild_id: string | null; type: number; name: string | null; topic: string | null; position: number; parent_id: string | null }>;
}) {
  return configureStore({
    reducer: {
      guilds: guildsSlice.reducer,
      channels: channelsSlice.reducer,
      ui: uiSlice.reducer,
    },
    preloadedState: {
      guilds: {
        guilds: {
          'guild-1': { id: 'guild-1', name: 'Test Guild', icon: null, owner_id: '1', member_count: 1 },
        },
        selectedGuildId: options?.selectedGuildId ?? 'guild-1',
      },
      channels: {
        channels: Object.fromEntries(
          (options?.channels ?? []).map(c => [c.id, c]),
        ),
        selectedChannelId: null,
      },
      ui: {
        activeModal: 'createChannel',
        modalProps: {},
        memberSidebarOpen: true,
        channelSidebarWidth: 240,
        sidebarCollapsed: false,
        activePopoverUserId: null,
        activePopoverPosition: null,
        activePopoverGuildId: null,
        replyingToMessageId: null,
        editingMessageId: null,
        appLoading: false,
      },
    },
  });
}

describe('CreateChannelModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const store = createTestStore();
    const { container } = render(
      <Provider store={store}>
        <CreateChannelModal />
      </Provider>,
    );
    expect(container).toBeTruthy();
  });

  it('renders the title', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <CreateChannelModal />
      </Provider>,
    );
    expect(screen.getByRole('heading', { name: 'Create Channel' })).toBeInTheDocument();
  });

  it('renders channel type selector with Text and Voice options', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <CreateChannelModal />
      </Provider>,
    );
    expect(screen.getByText('Text')).toBeInTheDocument();
    expect(screen.getByText('Voice')).toBeInTheDocument();
  });

  it('auto-lowercases and replaces spaces with hyphens in channel name', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <CreateChannelModal />
      </Provider>,
    );
    const input = screen.getByLabelText('CHANNEL NAME');
    fireEvent.change(input, { target: { value: 'My Cool Channel' } });
    expect(input).toHaveValue('my-cool-channel');
  });

  it('disables create button when name is empty', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <CreateChannelModal />
      </Provider>,
    );
    const createBtn = screen.getByRole('button', { name: /Create Channel/i });
    expect(createBtn).toBeDisabled();
  });

  it('enables create button when name is entered', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <CreateChannelModal />
      </Provider>,
    );
    const input = screen.getByLabelText('CHANNEL NAME');
    fireEvent.change(input, { target: { value: 'general' } });
    const createBtn = screen.getByRole('button', { name: /Create Channel/i });
    expect(createBtn).not.toBeDisabled();
  });

  it('calls api.createChannel on form submit', async () => {
    const mockChannel = { id: 'ch-1', guild_id: 'guild-1', type: 0, name: 'general', topic: null, position: 0, parent_id: null };
    mockCreateChannel.mockResolvedValue(mockChannel);
    const store = createTestStore();

    render(
      <Provider store={store}>
        <CreateChannelModal />
      </Provider>,
    );

    const input = screen.getByLabelText('CHANNEL NAME');
    fireEvent.change(input, { target: { value: 'general' } });

    const form = input.closest('form');
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(mockCreateChannel).toHaveBeenCalledWith('guild-1', { name: 'general', type: 0 });
    });

    await waitFor(() => {
      expect(store.getState().channels.channels['ch-1']).toBeTruthy();
    });
  });

  it('closes modal when Escape is pressed', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <CreateChannelModal />
      </Provider>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(store.getState().ui.activeModal).toBeNull();
  });

  it('closes modal when backdrop is clicked', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <CreateChannelModal />
      </Provider>,
    );
    const overlay = screen.getByRole('dialog');
    fireEvent.click(overlay);
    expect(store.getState().ui.activeModal).toBeNull();
  });

  it('shows category dropdown when categories exist', () => {
    const store = createTestStore({
      channels: [
        { id: 'cat-1', guild_id: 'guild-1', type: 4, name: 'Text Channels', topic: null, position: 0, parent_id: null },
      ],
    });
    render(
      <Provider store={store}>
        <CreateChannelModal />
      </Provider>,
    );
    expect(screen.getByLabelText('CATEGORY')).toBeInTheDocument();
    expect(screen.getByText('Text Channels')).toBeInTheDocument();
  });

  it('does not show category dropdown when no categories exist', () => {
    const store = createTestStore({ channels: [] });
    render(
      <Provider store={store}>
        <CreateChannelModal />
      </Provider>,
    );
    expect(screen.queryByLabelText('CATEGORY')).not.toBeInTheDocument();
  });

  it('can switch to voice channel type', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <CreateChannelModal />
      </Provider>,
    );
    const voiceBtn = screen.getByText('Voice').closest('button');
    fireEvent.click(voiceBtn!);
    // The voice radio should now be selected (has inner circle)
    expect(voiceBtn).toHaveClass('typeSelected', { exact: false });
  });

  it('shows error on API failure', async () => {
    mockCreateChannel.mockRejectedValue({ message: 'Channel limit reached' });
    const store = createTestStore();

    render(
      <Provider store={store}>
        <CreateChannelModal />
      </Provider>,
    );

    const input = screen.getByLabelText('CHANNEL NAME');
    fireEvent.change(input, { target: { value: 'general' } });

    const form = input.closest('form');
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(screen.getByText('Channel limit reached')).toBeInTheDocument();
    });
  });
});
