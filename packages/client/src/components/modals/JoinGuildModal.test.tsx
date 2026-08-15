import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { JoinGuildModal } from './JoinGuildModal';
import { guildsSlice } from '../../stores/guildsSlice';

const mockJoinGuild = vi.fn();

vi.mock('../../api/rest', () => ({
  api: {
    joinGuild: (...args: unknown[]) => mockJoinGuild(...args),
  },
}));

function createTestStore() {
  return configureStore({
    reducer: {
      guilds: guildsSlice.reducer,
    },
    preloadedState: {
      guilds: {
        guilds: {},
        selectedGuildId: null,
      },
    },
  });
}

describe('JoinGuildModal', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const store = createTestStore();
    const { container } = render(
      <Provider store={store}>
        <JoinGuildModal onClose={onClose} />
      </Provider>,
    );
    expect(container).toBeTruthy();
  });

  it('renders the title', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <JoinGuildModal onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByText('Join a Server')).toBeInTheDocument();
  });

  it('renders the invite link input', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <JoinGuildModal onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByLabelText('INVITE LINK')).toBeInTheDocument();
  });

  it('disables Join button when input is empty', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <JoinGuildModal onClose={onClose} />
      </Provider>,
    );
    const joinBtn = screen.getByRole('button', { name: /Join Server/i });
    expect(joinBtn).toBeDisabled();
  });

  it('enables Join button when input has text', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <JoinGuildModal onClose={onClose} />
      </Provider>,
    );
    const input = screen.getByLabelText('INVITE LINK');
    fireEvent.change(input, { target: { value: 'abc123' } });
    const joinBtn = screen.getByRole('button', { name: /Join Server/i });
    expect(joinBtn).not.toBeDisabled();
  });

  it('calls api.joinGuild with the code when Join is clicked', async () => {
    const mockGuild = { id: '999', name: 'Joined', icon: null, owner_id: '1', member_count: 5 };
    mockJoinGuild.mockResolvedValue({ guild: mockGuild });
    const store = createTestStore();

    render(
      <Provider store={store}>
        <JoinGuildModal onClose={onClose} />
      </Provider>,
    );

    const input = screen.getByLabelText('INVITE LINK');
    fireEvent.change(input, { target: { value: 'abc123' } });
    fireEvent.click(screen.getByRole('button', { name: /Join Server/i }));

    await waitFor(() => {
      expect(mockJoinGuild).toHaveBeenCalledWith('abc123');
    });

    await waitFor(() => {
      expect(store.getState().guilds.guilds['999']).toBeTruthy();
    });

    expect(onClose).toHaveBeenCalled();
  });

  it('extracts code from a full URL', async () => {
    mockJoinGuild.mockResolvedValue({ guild: { id: '1', name: 'G', icon: null, owner_id: '1', member_count: 1 } });
    const store = createTestStore();

    render(
      <Provider store={store}>
        <JoinGuildModal onClose={onClose} />
      </Provider>,
    );

    const input = screen.getByLabelText('INVITE LINK');
    fireEvent.change(input, { target: { value: 'http://localhost:5173/invite/mycode' } });
    fireEvent.click(screen.getByRole('button', { name: /Join Server/i }));

    await waitFor(() => {
      expect(mockJoinGuild).toHaveBeenCalledWith('mycode');
    });
  });

  it('shows error on API failure', async () => {
    mockJoinGuild.mockRejectedValue({ message: 'Invite expired' });
    const store = createTestStore();

    render(
      <Provider store={store}>
        <JoinGuildModal onClose={onClose} />
      </Provider>,
    );

    const input = screen.getByLabelText('INVITE LINK');
    fireEvent.change(input, { target: { value: 'badcode' } });
    fireEvent.click(screen.getByRole('button', { name: /Join Server/i }));

    await waitFor(() => {
      expect(screen.getByText('Invite expired')).toBeInTheDocument();
    });
  });

  it('calls onClose when Close button is clicked', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <JoinGuildModal onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when Escape is pressed', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <JoinGuildModal onClose={onClose} />
      </Provider>,
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
