import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MessageInput } from './MessageInput';
import { authSlice } from '../../stores/authSlice';
import { guildsSlice } from '../../stores/guildsSlice';
import { channelsSlice } from '../../stores/channelsSlice';
import { messagesSlice } from '../../stores/messagesSlice';
import { voiceSlice } from '../../stores/voiceSlice';
import { membersSlice } from '../../stores/membersSlice';
import { uiSlice } from '../../stores/uiSlice';
import { rolesSlice } from '../../stores/rolesSlice';
import { dmSlice } from '../../stores/dmSlice';
import { notificationsSlice } from '../../stores/notificationsSlice';
import { searchSlice } from '../../stores/searchSlice';
import { settingsSlice } from '../../stores/settingsSlice';
import { typingSlice } from '../../stores/typingSlice';

vi.mock('../../api/rest', () => ({
  api: {
    sendMessage: vi.fn(() => Promise.resolve({ id: '1', content: 'test' })),
    sendTyping: vi.fn(() => Promise.resolve()),
    sendMessageWithAttachments: vi.fn(() => Promise.resolve({ id: '1', content: '' })),
  },
}));

function createTestStore(overrides?: Record<string, unknown>) {
  const defaultState = {
    channels: {
      channels: {
        ch1: { id: 'ch1', guild_id: 'g1', type: 0, name: 'general', topic: null, position: 0, parent_id: null },
        ch2: { id: 'ch2', guild_id: 'g1', type: 0, name: 'random', topic: null, position: 1, parent_id: null },
        ch3: { id: 'ch3', guild_id: 'g1', type: 0, name: 'announcements', topic: null, position: 2, parent_id: null },
      },
      selectedChannelId: 'ch1',
    },
    guilds: {
      guilds: { g1: { id: 'g1', name: 'Test Guild', icon: null, owner_id: 'u1', member_count: 3 } },
      selectedGuildId: 'g1',
    },
    members: {
      membersByGuild: {
        g1: [
          { user: { id: 'u1', username: 'alice', displayName: 'Alice', avatar: null, bot: false }, roles: [], nick: null, joinedAt: '2024-01-01' },
          { user: { id: 'u2', username: 'bob', displayName: 'Bob', avatar: null, bot: false }, roles: [], nick: 'Bobby', joinedAt: '2024-01-01' },
          { user: { id: 'u3', username: 'charlie', displayName: 'Charlie', avatar: null, bot: false }, roles: [], nick: null, joinedAt: '2024-01-01' },
        ],
      },
      isLoading: false,
    },
    auth: {
      user: { id: 'u1', username: 'alice', avatar: null },
      token: 'test-token',
      isAuthenticated: true, status: 'online' as const, customStatus: null,
      isLoading: false,
      error: null,
      mfaRequired: false,
      mfaTicket: null,
    },
    ui: {
      replyingToMessageId: null,
      editingMessageId: null,
      memberSidebarOpen: true,
      channelSidebarWidth: 240,
      modals: [],
      activePopover: null,
      activeContextMenu: null,
      activeTooltip: null,
      selectedGuildId: 'g1',
      selectedChannelId: 'ch1',
      selectedDMChannelId: null,
      threadsPanelOpen: false,
      selectedThreadId: null,
      searchPanelOpen: false,
      dragState: null,
      lightboxImage: null,
    },
    messages: {
      messagesByChannel: {},
    },
    ...overrides,
  };

  return configureStore({
    reducer: {
      auth: authSlice.reducer,
      guilds: guildsSlice.reducer,
      channels: channelsSlice.reducer,
      messages: messagesSlice.reducer,
      voice: voiceSlice.reducer,
      members: membersSlice.reducer,
      ui: uiSlice.reducer,
      roles: rolesSlice.reducer,
      dm: dmSlice.reducer,
      notifications: notificationsSlice.reducer,
      search: searchSlice.reducer,
      settings: settingsSlice.reducer,
      typing: typingSlice.reducer,
    },
    preloadedState: defaultState as Record<string, never>,
  });
}

function renderWithStore(ui: React.ReactElement, overrides?: Record<string, unknown>) {
  const store = createTestStore(overrides);
  return {
    ...render(<Provider store={store}>{ui}</Provider>),
    store,
  };
}

describe('MessageInput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    renderWithStore(<MessageInput channelId="ch1" />);
    expect(screen.getByPlaceholderText('Message #general')).toBeInTheDocument();
  });

  it('renders emoji picker button', () => {
    renderWithStore(<MessageInput channelId="ch1" />);
    expect(screen.getByLabelText('Add Emoji')).toBeInTheDocument();
  });

  it('renders attach button', () => {
    renderWithStore(<MessageInput channelId="ch1" />);
    expect(screen.getByLabelText('More message options')).toBeInTheDocument();
  });
});

describe('MessageInput - Emoji Autocomplete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows emoji suggestions when typing :grin', () => {
    renderWithStore(<MessageInput channelId="ch1" />);
    const input = screen.getByPlaceholderText('Message #general');
    fireEvent.change(input, { target: { value: ':grin', selectionStart: 5 } });
    // Should show emoji autocomplete popup
    expect(screen.getByRole('listbox', { name: 'Emoji suggestions' })).toBeInTheDocument();
  });

  it('does not show emoji suggestions with less than 2 chars after :', () => {
    renderWithStore(<MessageInput channelId="ch1" />);
    const input = screen.getByPlaceholderText('Message #general');
    fireEvent.change(input, { target: { value: ':g', selectionStart: 2 } });
    expect(screen.queryByRole('listbox', { name: 'Emoji suggestions' })).not.toBeInTheDocument();
  });

  it('dismisses emoji autocomplete on Escape', () => {
    renderWithStore(<MessageInput channelId="ch1" />);
    const input = screen.getByPlaceholderText('Message #general');
    fireEvent.change(input, { target: { value: ':grin', selectionStart: 5 } });
    expect(screen.getByRole('listbox', { name: 'Emoji suggestions' })).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: 'Emoji suggestions' })).not.toBeInTheDocument();
  });
});

describe('MessageInput - Channel Autocomplete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows channel suggestions when typing #gen', () => {
    renderWithStore(<MessageInput channelId="ch1" />);
    const input = screen.getByPlaceholderText('Message #general');
    fireEvent.change(input, { target: { value: '#gen', selectionStart: 4 } });
    expect(screen.getByRole('listbox', { name: 'Channel suggestions' })).toBeInTheDocument();
  });

  it('shows channel names in channel autocomplete', () => {
    renderWithStore(<MessageInput channelId="ch1" />);
    const input = screen.getByPlaceholderText('Message #general');
    // The # at start of line triggers channel autocomplete
    fireEvent.change(input, { target: { value: ' #ran', selectionStart: 5 } });
    expect(screen.getByText('random')).toBeInTheDocument();
  });

  it('dismisses channel autocomplete on Escape', () => {
    renderWithStore(<MessageInput channelId="ch1" />);
    const input = screen.getByPlaceholderText('Message #general');
    fireEvent.change(input, { target: { value: '#gen', selectionStart: 4 } });
    expect(screen.getByRole('listbox', { name: 'Channel suggestions' })).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: 'Channel suggestions' })).not.toBeInTheDocument();
  });
});

describe('MessageInput - Mention Autocomplete with @everyone/@here', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows @everyone in mention suggestions', () => {
    renderWithStore(<MessageInput channelId="ch1" />);
    const input = screen.getByPlaceholderText('Message #general');
    fireEvent.change(input, { target: { value: '@', selectionStart: 1 } });
    expect(screen.getByText('@everyone')).toBeInTheDocument();
  });

  it('shows @here in mention suggestions', () => {
    renderWithStore(<MessageInput channelId="ch1" />);
    const input = screen.getByPlaceholderText('Message #general');
    fireEvent.change(input, { target: { value: '@', selectionStart: 1 } });
    expect(screen.getByText('@here')).toBeInTheDocument();
  });

  it('filters @everyone when typing @every', () => {
    renderWithStore(<MessageInput channelId="ch1" />);
    const input = screen.getByPlaceholderText('Message #general');
    fireEvent.change(input, { target: { value: '@every', selectionStart: 6 } });
    expect(screen.getByText('@everyone')).toBeInTheDocument();
    expect(screen.queryByText('@here')).not.toBeInTheDocument();
  });

  it('shows member results alongside special entries', () => {
    renderWithStore(<MessageInput channelId="ch1" />);
    const input = screen.getByPlaceholderText('Message #general');
    fireEvent.change(input, { target: { value: '@', selectionStart: 1 } });
    expect(screen.getByText('@everyone')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });
});

describe('MessageInput - File Upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows pending files list when a file is selected via file input', () => {
    renderWithStore(<MessageInput channelId="ch1" />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();

    const testFile = new File(['test content'], 'test.txt', { type: 'text/plain' });
    fireEvent.change(fileInput, { target: { files: [testFile] } });

    // Pending files list should appear
    expect(screen.getByRole('list', { name: 'Files to upload' })).toBeInTheDocument();
    expect(screen.getByText('test.txt')).toBeInTheDocument();
  });

  it('shows file size in pending files list', () => {
    renderWithStore(<MessageInput channelId="ch1" />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

    const testFile = new File(['hello world'], 'data.txt', { type: 'text/plain' });
    fireEvent.change(fileInput, { target: { files: [testFile] } });

    // Should show size (11 bytes)
    expect(screen.getByText('11 B')).toBeInTheDocument();
  });

  it('allows removing a pending file', () => {
    renderWithStore(<MessageInput channelId="ch1" />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

    const testFile = new File(['test'], 'removeme.txt', { type: 'text/plain' });
    fireEvent.change(fileInput, { target: { files: [testFile] } });

    expect(screen.getByText('removeme.txt')).toBeInTheDocument();

    // Click the remove button
    const removeBtn = screen.getByRole('button', { name: 'Remove removeme.txt' });
    fireEvent.click(removeBtn);

    // File should no longer be in the list
    expect(screen.queryByText('removeme.txt')).not.toBeInTheDocument();
  });

  it('calls sendMessageWithAttachments when files are pending and Enter is pressed', async () => {
    const { api: mockApi } = await import('../../api/rest');
    renderWithStore(<MessageInput channelId="ch1" />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const testFile = new File(['file data'], 'upload.txt', { type: 'text/plain' });
    fireEvent.change(fileInput, { target: { files: [testFile] } });

    const input = screen.getByPlaceholderText('Message #general');
    fireEvent.change(input, { target: { value: 'with attachment' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(mockApi.sendMessageWithAttachments).toHaveBeenCalledWith(
        'ch1',
        'with attachment',
        expect.arrayContaining([expect.any(File)]),
      );
    });
  });

  it('shows upload error on failure and allows dismissing', async () => {
    const { api: mockApi } = await import('../../api/rest');
    (mockApi.sendMessageWithAttachments as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Upload failed')
    );

    renderWithStore(<MessageInput channelId="ch1" />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const testFile = new File(['data'], 'fail.txt', { type: 'text/plain' });
    fireEvent.change(fileInput, { target: { files: [testFile] } });

    const input = screen.getByPlaceholderText('Message #general');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('Failed to upload file(s). Please try again.')).toBeInTheDocument();
    });

    // Dismiss the error
    const dismissBtn = screen.getByRole('button', { name: 'Dismiss error' });
    fireEvent.click(dismissBtn);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('accepts external files passed as props (drag-and-drop)', () => {
    // Mock URL.createObjectURL since jsdom does not implement it
    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:mock-url');

    try {
      const externalFile = new File(['dropped'], 'dropped.png', { type: 'image/png' });
      const onConsumed = vi.fn();

      renderWithStore(
        <MessageInput channelId="ch1" externalFiles={[externalFile]} onExternalFilesConsumed={onConsumed} />
      );

      expect(screen.getByText('dropped.png')).toBeInTheDocument();
      expect(onConsumed).toHaveBeenCalled();
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
    }
  });

  it('sends files without content when input is empty but files are pending', async () => {
    const { api: mockApi } = await import('../../api/rest');
    renderWithStore(<MessageInput channelId="ch1" />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const testFile = new File(['only file'], 'notext.txt', { type: 'text/plain' });
    fireEvent.change(fileInput, { target: { files: [testFile] } });

    const input = screen.getByPlaceholderText('Message #general');
    // Ensure input is empty
    expect(input).toHaveValue('');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(mockApi.sendMessageWithAttachments).toHaveBeenCalledWith(
        'ch1',
        '',
        expect.arrayContaining([expect.any(File)]),
      );
    });
  });
});

describe('MessageInput - Slash Commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows slash command palette when typing / at start of input', () => {
    renderWithStore(<MessageInput channelId="ch1" />);
    const input = screen.getByPlaceholderText('Message #general');
    fireEvent.change(input, { target: { value: '/', selectionStart: 1 } });
    expect(screen.getByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument();
  });

  it('does not show slash command palette when / is not at start', () => {
    renderWithStore(<MessageInput channelId="ch1" />);
    const input = screen.getByPlaceholderText('Message #general');
    fireEvent.change(input, { target: { value: 'hello /', selectionStart: 7 } });
    expect(screen.queryByRole('listbox', { name: 'Slash commands' })).not.toBeInTheDocument();
  });

  it('filters slash commands as user types', () => {
    renderWithStore(<MessageInput channelId="ch1" />);
    const input = screen.getByPlaceholderText('Message #general');
    fireEvent.change(input, { target: { value: '/sh', selectionStart: 3 } });
    expect(screen.getByText('/shrug')).toBeInTheDocument();
    expect(screen.queryByText('/giphy')).not.toBeInTheDocument();
  });

  it('dismisses slash command palette on Escape', () => {
    renderWithStore(<MessageInput channelId="ch1" />);
    const input = screen.getByPlaceholderText('Message #general');
    fireEvent.change(input, { target: { value: '/', selectionStart: 1 } });
    expect(screen.getByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: 'Slash commands' })).not.toBeInTheDocument();
  });

  it('shows all slash commands when just / is typed', () => {
    renderWithStore(<MessageInput channelId="ch1" />);
    const input = screen.getByPlaceholderText('Message #general');
    fireEvent.change(input, { target: { value: '/', selectionStart: 1 } });
    expect(screen.getByText('/giphy')).toBeInTheDocument();
    expect(screen.getByText('/shrug')).toBeInTheDocument();
    expect(screen.getByText('/tableflip')).toBeInTheDocument();
    expect(screen.getByText('/unflip')).toBeInTheDocument();
    expect(screen.getByText('/spoiler')).toBeInTheDocument();
    expect(screen.getByText('/me')).toBeInTheDocument();
  });

  it('navigates slash commands with ArrowDown', () => {
    renderWithStore(<MessageInput channelId="ch1" />);
    const input = screen.getByPlaceholderText('Message #general');
    fireEvent.change(input, { target: { value: '/', selectionStart: 1 } });
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    // After re-render the second option should be selected
    const updatedOptions = screen.getAllByRole('option');
    expect(updatedOptions[1]).toHaveAttribute('aria-selected', 'true');
  });
});

describe('MessageInput - Formatting Keyboard Shortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('wraps selected text in bold with Ctrl+B', () => {
    renderWithStore(<MessageInput channelId="ch1" />);
    const input = screen.getByPlaceholderText('Message #general') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'hello world', selectionStart: 0 } });
    // Simulate text selection
    input.setSelectionRange(6, 11); // select "world"
    fireEvent.keyDown(input, { key: 'b', ctrlKey: true });
    expect(input.value).toBe('hello **world**');
  });

  it('wraps selected text in italic with Ctrl+I', () => {
    renderWithStore(<MessageInput channelId="ch1" />);
    const input = screen.getByPlaceholderText('Message #general') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'hello world', selectionStart: 0 } });
    input.setSelectionRange(6, 11);
    fireEvent.keyDown(input, { key: 'i', ctrlKey: true });
    expect(input.value).toBe('hello *world*');
  });

  it('wraps selected text in underline with Ctrl+U', () => {
    renderWithStore(<MessageInput channelId="ch1" />);
    const input = screen.getByPlaceholderText('Message #general') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'hello world', selectionStart: 0 } });
    input.setSelectionRange(6, 11);
    fireEvent.keyDown(input, { key: 'u', ctrlKey: true });
    expect(input.value).toBe('hello __world__');
  });

  it('does not format when no text is selected', () => {
    renderWithStore(<MessageInput channelId="ch1" />);
    const input = screen.getByPlaceholderText('Message #general') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'hello world', selectionStart: 5 } });
    input.setSelectionRange(5, 5); // cursor, no selection
    fireEvent.keyDown(input, { key: 'b', ctrlKey: true });
    expect(input.value).toBe('hello world');
  });
});
