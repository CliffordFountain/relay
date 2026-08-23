import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StickerPicker } from './StickerPicker';

describe('StickerPicker', () => {
  it('renders without crashing', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<StickerPicker onSelect={onSelect} onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'Sticker picker' })).toBeInTheDocument();
  });

  it('shows header title', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<StickerPicker onSelect={onSelect} onClose={onClose} />);
    expect(screen.getByText('Stickers')).toBeInTheDocument();
  });

  it('renders category tabs', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<StickerPicker onSelect={onSelect} onClose={onClose} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBe(3);
  });

  it('defaults to first category', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<StickerPicker onSelect={onSelect} onClose={onClose} />);
    expect(screen.getByText('Relay Originals')).toBeInTheDocument();
  });

  it('switches category on tab click', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<StickerPicker onSelect={onSelect} onClose={onClose} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Expressions' }));
    expect(screen.getByText('Expressions')).toBeInTheDocument();
  });

  it('renders sticker items in grid', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<StickerPicker onSelect={onSelect} onClose={onClose} />);
    const options = screen.getAllByRole('option');
    expect(options.length).toBe(12); // 12 stickers per category
  });

  it('calls onSelect when a sticker is clicked', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<StickerPicker onSelect={onSelect} onClose={onClose} />);
    const options = screen.getAllByRole('option');
    const firstSticker = options[0];
    if (!firstSticker) throw new Error('No sticker options found');
    fireEvent.click(firstSticker);
    expect(onSelect).toHaveBeenCalledTimes(1);
    // The first sticker is the wave emoji
    expect(onSelect).toHaveBeenCalledWith(expect.any(String));
  });

  it('calls onClose on Escape key', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<StickerPicker onSelect={onSelect} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows sticker names as tooltips', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<StickerPicker onSelect={onSelect} onClose={onClose} />);
    const waveSticker = screen.getByTitle('Wave');
    expect(waveSticker).toBeInTheDocument();
  });
});
