import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { InviteModal } from './InviteModal';
import { channelsSlice } from '../../stores/channelsSlice';
import { relationshipsSlice } from '../../stores/relationshipsSlice';
import { guildsSlice } from '../../stores/guildsSlice';
import { membersSlice } from '../../stores/membersSlice';

const mockCreateInvite = vi.fn();

vi.mock('../../api/rest', () => ({
  api: {
    createInvite: (...args: unknown[]) => mockCreateInvite(...args),
    getRelationships: () => Promise.resolve([]),
  },
}));

// InviteModal reads the channels/relationships/guilds/members slices via
// useAppSelector, so it must render inside a Redux <Provider>.
function createTestStore() {
  return configureStore({
    reducer: {
      channels: channelsSlice.reducer,
      relationships: relationshipsSlice.reducer,
      guilds: guildsSlice.reducer,
      members: membersSlice.reducer,
    },
  });
}

describe('InviteModal', () => {
  const defaultProps = {
    channelId: 'ch-123',
    serverName: 'Test Server',
    onClose: vi.fn(),
  };

  const renderModal = () =>
    render(
      <Provider store={createTestStore()}>
        <InviteModal {...defaultProps} />
      </Provider>,
    );

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateInvite.mockResolvedValue({
      code: 'abc123',
      max_age: 86400,
      max_uses: 0,
      uses: 0,
    });
  });

  it('renders without crashing', () => {
    const { container } = renderModal();
    expect(container).toBeTruthy();
  });

  it('renders the title with server name', () => {
    renderModal();
    expect(screen.getByText('Invite friends to Test Server')).toBeInTheDocument();
  });

  it('calls createInvite on mount', async () => {
    renderModal();
    await waitFor(() => {
      expect(mockCreateInvite).toHaveBeenCalledWith('ch-123', {
        max_age: 604800,
        max_uses: 0,
      });
    });
  });

  it('displays the generated invite link', async () => {
    renderModal();
    await waitFor(() => {
      const linkInput = screen.getByLabelText('Invite link') as HTMLInputElement;
      // Relay uses short invite links ({origin}/{code}, no /invite/ path — matches the /:code route)
      expect(linkInput.value).toMatch(/^https?:\/\/[^/]+\/abc123$/);
      expect(linkInput.value).not.toContain('/invite/');
    });
  });

  it('renders copy button', async () => {
    renderModal();
    await waitFor(() => {
      expect(screen.getByText('Copy')).toBeInTheDocument();
    });
  });

  it('renders expiry and max uses dropdowns', async () => {
    renderModal();
    // Dropdowns live behind the "Edit invite link." toggle, shown once the invite loads
    fireEvent.click(await screen.findByText('Edit invite link.'));
    expect(screen.getByLabelText('EXPIRE AFTER')).toBeInTheDocument();
    expect(screen.getByLabelText('MAX NUMBER OF USES')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    renderModal();
    fireEvent.click(screen.getByLabelText('Close'));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('calls onClose when Escape is pressed', () => {
    renderModal();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('calls onClose when backdrop is clicked', () => {
    renderModal();
    fireEvent.click(screen.getByRole('dialog'));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('shows error when createInvite fails', async () => {
    mockCreateInvite.mockRejectedValue(new Error('Failed'));
    renderModal();
    await waitFor(() => {
      expect(screen.getByText('Failed to create invite link.')).toBeInTheDocument();
    });
  });
});
