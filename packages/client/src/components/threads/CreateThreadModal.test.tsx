import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { CreateThreadModal } from './CreateThreadModal';
import { threadsSlice } from '../../stores/threadsSlice';

const mockCreateThreadFromMessage = vi.fn();
const mockCreateThread = vi.fn();

vi.mock('../../api/rest', () => ({
  api: {
    createThread: (...args: unknown[]) => mockCreateThread(...args),
    createThreadFromMessage: (...args: unknown[]) => mockCreateThreadFromMessage(...args),
  },
}));

function createTestStore() {
  return configureStore({
    reducer: {
      threads: threadsSlice.reducer,
    },
    preloadedState: {
      threads: {
        entities: {},
        threadsByParent: {},
        activeThreadsByGuild: {},
        selectedThreadId: null,
        threadsPanelOpen: false,
      },
    },
  });
}

describe('CreateThreadModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <CreateThreadModal channelId="100" onClose={() => {}} />
      </Provider>,
    );
    // Both heading and button contain "Create Thread" text
    expect(screen.getAllByText('Create Thread').length).toBeGreaterThanOrEqual(1);
  });

  it('shows thread name input', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <CreateThreadModal channelId="100" onClose={() => {}} />
      </Provider>,
    );
    expect(screen.getByLabelText('Thread Name')).toBeInTheDocument();
  });

  it('shows auto-archive dropdown', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <CreateThreadModal channelId="100" onClose={() => {}} />
      </Provider>,
    );
    expect(screen.getByLabelText('Auto-Archive After')).toBeInTheDocument();
  });

  it('disables create button when name is empty', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <CreateThreadModal channelId="100" onClose={() => {}} />
      </Provider>,
    );
    const createBtns = screen.getAllByText('Create Thread');
    // The button is the second one (first is the heading)
    const createBtn = createBtns.find(el => el.tagName === 'BUTTON');
    expect(createBtn).toBeDisabled();
  });

  it('enables create button when name is entered', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <CreateThreadModal channelId="100" onClose={() => {}} />
      </Provider>,
    );
    const input = screen.getByLabelText('Thread Name');
    fireEvent.change(input, { target: { value: 'My Thread' } });
    const createBtns = screen.getAllByText('Create Thread');
    const createBtn = createBtns.find(el => el.tagName === 'BUTTON');
    expect(createBtn).not.toBeDisabled();
  });

  it('calls createThreadFromMessage when messageId is provided', async () => {
    mockCreateThreadFromMessage.mockResolvedValue({
      id: '2001',
      guild_id: '500',
      type: 11,
      name: 'My Thread',
      parent_id: '100',
      owner_id: '200',
      last_message_id: null,
      thread_metadata: null,
      message_count: 0,
      member_count: 1,
    });

    const onClose = vi.fn();
    const store = createTestStore();
    render(
      <Provider store={store}>
        <CreateThreadModal channelId="100" messageId="msg-1" onClose={onClose} />
      </Provider>,
    );

    fireEvent.change(screen.getByLabelText('Thread Name'), { target: { value: 'My Thread' } });
    const createBtns = screen.getAllByText('Create Thread');
    const createBtn = createBtns.find(el => el.tagName === 'BUTTON')!;
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(mockCreateThreadFromMessage).toHaveBeenCalledWith('100', 'msg-1', {
        name: 'My Thread',
        auto_archive_duration: 1440,
        type: 11,
      });
    });
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    const store = createTestStore();
    render(
      <Provider store={store}>
        <CreateThreadModal channelId="100" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('toggles private thread switch', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <CreateThreadModal channelId="100" onClose={() => {}} />
      </Provider>,
    );
    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  it('shows subtitle about message when messageId is provided', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <CreateThreadModal channelId="100" messageId="msg-1" onClose={() => {}} />
      </Provider>,
    );
    expect(screen.getByText('Start a thread from this message')).toBeInTheDocument();
  });
});
