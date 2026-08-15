import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { UserPopover } from './UserPopover';
import { presenceSlice } from '../../stores/presenceSlice';
import type { GuildMember } from '../../stores/membersSlice';

function createTestStore() {
  return configureStore({
    reducer: {
      presence: presenceSlice.reducer,
    },
    preloadedState: {
      presence: {
        presences: {},
        selfStatus: 'online' as const,
      },
    },
  });
}

function createMockMember(overrides?: Partial<GuildMember>): GuildMember {
  return {
    user: {
      id: '1',
      username: 'testuser',
      displayName: 'Test User',
      avatar: null,
      bot: false,
    },
    roles: [],
    nick: null,
    joinedAt: '2026-01-15T10:30:00Z',
    ...overrides,
  };
}

function renderWithStore(ui: React.ReactElement) {
  const store = createTestStore();
  return render(<Provider store={store}>{ui}</Provider>);
}

describe('UserPopover', () => {
  const defaultPosition = { top: 200, left: 500 };
  const onClose = vi.fn();

  it('renders without crashing', () => {
    const member = createMockMember();
    const { container } = renderWithStore(
      <UserPopover member={member} position={defaultPosition} onClose={onClose} />
    );
    expect(container).toBeTruthy();
  });

  it('displays the display name and username', () => {
    const member = createMockMember();
    renderWithStore(
      <UserPopover member={member} position={defaultPosition} onClose={onClose} />
    );
    expect(screen.getByText('Test User')).toBeInTheDocument();
    expect(screen.getByText('testuser')).toBeInTheDocument();
  });

  it('displays nickname when available', () => {
    const member = createMockMember({ nick: 'Cool Nick' });
    renderWithStore(
      <UserPopover member={member} position={defaultPosition} onClose={onClose} />
    );
    expect(screen.getByText('Cool Nick')).toBeInTheDocument();
  });

  it('displays member since date', () => {
    const member = createMockMember();
    renderWithStore(
      <UserPopover member={member} position={defaultPosition} onClose={onClose} />
    );
    expect(screen.getByText('Member Since')).toBeInTheDocument();
    expect(screen.getByText('Jan 15, 2026')).toBeInTheDocument();
  });

  it('displays role pills when member has roles', () => {
    const member = createMockMember({ roles: ['Admin', 'Moderator'] });
    renderWithStore(
      <UserPopover member={member} position={defaultPosition} onClose={onClose} />
    );
    expect(screen.getByText('Roles')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getByText('Moderator')).toBeInTheDocument();
  });

  it('does not display roles section when no roles', () => {
    const member = createMockMember({ roles: [] });
    renderWithStore(
      <UserPopover member={member} position={defaultPosition} onClose={onClose} />
    );
    expect(screen.queryByText('Roles')).not.toBeInTheDocument();
  });

  it('has a message input with correct placeholder', () => {
    const member = createMockMember();
    renderWithStore(
      <UserPopover member={member} position={defaultPosition} onClose={onClose} />
    );
    expect(screen.getByPlaceholderText('Message @Test User')).toBeInTheDocument();
  });

  it('has correct aria-label for dialog', () => {
    const member = createMockMember();
    renderWithStore(
      <UserPopover member={member} position={defaultPosition} onClose={onClose} />
    );
    expect(screen.getByRole('dialog', { name: 'Test User profile' })).toBeInTheDocument();
  });

  it('closes on Escape key', () => {
    const member = createMockMember();
    renderWithStore(
      <UserPopover member={member} position={defaultPosition} onClose={onClose} />
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on click outside', () => {
    const member = createMockMember();
    renderWithStore(
      <UserPopover member={member} position={defaultPosition} onClose={onClose} />
    );
    fireEvent.mouseDown(document);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders avatar initials when no avatar image', () => {
    const member = createMockMember();
    renderWithStore(
      <UserPopover member={member} position={defaultPosition} onClose={onClose} />
    );
    expect(screen.getByText('T')).toBeInTheDocument();
  });
});
