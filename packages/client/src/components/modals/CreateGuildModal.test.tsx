import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { CreateGuildModal } from './CreateGuildModal';
import { guildsSlice } from '../../stores/guildsSlice';
import { uiSlice } from '../../stores/uiSlice';
import { channelsSlice } from '../../stores/channelsSlice';

const mockCreateGuild = vi.fn();

vi.mock('../../api/rest', () => ({
  api: {
    createGuild: (...args: unknown[]) => mockCreateGuild(...args),
  },
}));

function createTestStore() {
  return configureStore({
    reducer: {
      guilds: guildsSlice.reducer,
      ui: uiSlice.reducer,
      channels: channelsSlice.reducer,
    },
  });
}

function renderModal() {
  const store = createTestStore();
  store.dispatch(uiSlice.actions.openModal({ modal: 'createGuild' }));
  const utils = render(
    <Provider store={store}>
      <CreateGuildModal />
    </Provider>,
  );
  return { store, ...utils };
}

describe('CreateGuildModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const { container } = renderModal();
    expect(container).toBeTruthy();
  });

  it('renders the create-server name form directly (no template step)', () => {
    renderModal();
    expect(screen.getByText('Create a server')).toBeInTheDocument();
    expect(screen.getByText(/A server is your own place/)).toBeInTheDocument();
    expect(screen.getByLabelText('SERVER NAME')).toBeInTheDocument();
    // KISS: the template chooser is gone.
    expect(screen.queryByText('Create My Own')).not.toBeInTheDocument();
    expect(screen.queryByText('START FROM A TEMPLATE')).not.toBeInTheDocument();
  });

  it('disables the Create button when name is empty', () => {
    renderModal();
    const createBtn = screen.getByRole('button', { name: /^Create$/i });
    expect(createBtn).toBeDisabled();
  });

  it('enables the Create button when name is entered', () => {
    renderModal();
    fireEvent.change(screen.getByLabelText('SERVER NAME'), { target: { value: 'My Server' } });
    expect(screen.getByRole('button', { name: /^Create$/i })).not.toBeDisabled();
  });

  it('shows initials in the icon preview when name is typed', () => {
    renderModal();
    fireEvent.change(screen.getByLabelText('SERVER NAME'), { target: { value: 'My Server' } });
    expect(screen.getByLabelText('Server icon preview')).toHaveTextContent('MS');
  });

  it('calls api.createGuild on submit and dispatches addGuild', async () => {
    const mockGuild = { id: '123', name: 'My Server', icon: null, owner_id: '1', member_count: 1 };
    mockCreateGuild.mockResolvedValue(mockGuild);
    const { store } = renderModal();

    const input = screen.getByLabelText('SERVER NAME');
    fireEvent.change(input, { target: { value: 'My Server' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(mockCreateGuild).toHaveBeenCalledWith({ name: 'My Server' });
    });
    await waitFor(() => {
      expect(store.getState().guilds.guilds['123']).toBeTruthy();
    });
  });

  it('closes the modal when Cancel is clicked', () => {
    const { store } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(store.getState().ui.activeModal).toBeNull();
  });

  it('closes modal when Escape is pressed', () => {
    const { store } = renderModal();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(store.getState().ui.activeModal).toBeNull();
  });

  it('closes modal when backdrop is clicked', () => {
    const { store } = renderModal();
    fireEvent.click(screen.getByRole('dialog'));
    expect(store.getState().ui.activeModal).toBeNull();
  });

  it('shows error message on API failure', async () => {
    mockCreateGuild.mockRejectedValue({ message: 'Server name already taken' });
    renderModal();

    const input = screen.getByLabelText('SERVER NAME');
    fireEvent.change(input, { target: { value: 'My Server' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(screen.getByText('Server name already taken')).toBeInTheDocument();
    });
  });
});
