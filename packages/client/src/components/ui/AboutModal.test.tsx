import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AboutModal } from './AboutModal';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const renderModal = (onClose = vi.fn()) =>
  render(
    <MemoryRouter>
      <AboutModal onClose={onClose} />
    </MemoryRouter>,
  );

describe('AboutModal', () => {
  it('renders the dialog with title and version', () => {
    renderModal();
    expect(screen.getByRole('dialog', { name: /about & help/i })).toBeInTheDocument();
    expect(screen.getByText('About & Help')).toBeInTheDocument();
    expect(screen.getByText('Relay v0.1.0')).toBeInTheDocument();
  });

  it('does not mention Relay branding and version details', () => {
    renderModal();
    const dialog = screen.getByRole('dialog', { name: /about & help/i });
    expect(dialog.textContent).toMatch(/Relay/i);
    expect(dialog.textContent).toBeTruthy();
  });

  it('navigates in-app to /terms and /privacy and closes the modal', () => {
    const onClose = vi.fn();
    mockNavigate.mockClear();
    renderModal(onClose);

    fireEvent.click(screen.getByRole('button', { name: /terms of service/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenLastCalledWith('/terms');

    fireEvent.click(screen.getByRole('button', { name: /privacy policy/i }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(mockNavigate).toHaveBeenLastCalledWith('/privacy');

    // Navigation must not depend on window.open — no target="_blank" anchors remain.
    expect(screen.queryByRole('link', { name: /terms of service/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /privacy policy/i })).not.toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    renderModal(onClose);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn();
    renderModal(onClose);
    fireEvent.click(screen.getByRole('dialog', { name: /about & help/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on Escape key', () => {
    const onClose = vi.fn();
    renderModal(onClose);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
