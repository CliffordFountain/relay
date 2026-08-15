import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SlashCommandPalette, BUILT_IN_COMMANDS } from './SlashCommandPalette';
import type { SlashCommand } from './SlashCommandPalette';

describe('SlashCommandPalette', () => {
  const defaultProps = {
    query: '',
    selectedIndex: 0,
    onSelect: vi.fn(),
    onHover: vi.fn(),
  };

  it('renders without crashing', () => {
    render(<SlashCommandPalette {...defaultProps} />);
    expect(screen.getByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument();
  });

  it('shows all built-in commands when query is empty', () => {
    render(<SlashCommandPalette {...defaultProps} />);
    for (const cmd of BUILT_IN_COMMANDS) {
      expect(screen.getByText(`/${cmd.name}`)).toBeInTheDocument();
    }
  });

  it('filters commands based on query', () => {
    render(<SlashCommandPalette {...defaultProps} query="sh" />);
    expect(screen.getByText('/shrug')).toBeInTheDocument();
    expect(screen.queryByText('/giphy')).not.toBeInTheDocument();
    expect(screen.queryByText('/tableflip')).not.toBeInTheDocument();
  });

  it('returns null when no commands match query', () => {
    const { container } = render(<SlashCommandPalette {...defaultProps} query="zzzzz" />);
    expect(container.firstChild).toBeNull();
  });

  it('highlights the selected item', () => {
    render(<SlashCommandPalette {...defaultProps} selectedIndex={1} />);
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'false');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('calls onSelect when a command is clicked', () => {
    const onSelect = vi.fn();
    render(<SlashCommandPalette {...defaultProps} onSelect={onSelect} />);
    const shrugOption = screen.getByText('/shrug').closest('button');
    expect(shrugOption).toBeTruthy();
    fireEvent.click(shrugOption!);
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'shrug' }) as SlashCommand
    );
  });

  it('calls onHover when mouse enters a command item', () => {
    const onHover = vi.fn();
    render(<SlashCommandPalette {...defaultProps} onHover={onHover} />);
    const options = screen.getAllByRole('option');
    fireEvent.mouseEnter(options[2]!);
    expect(onHover).toHaveBeenCalledWith(2);
  });

  it('shows the Commands header', () => {
    render(<SlashCommandPalette {...defaultProps} />);
    expect(screen.getByText('Commands')).toBeInTheDocument();
  });

  it('shows command descriptions', () => {
    render(<SlashCommandPalette {...defaultProps} />);
    for (const cmd of BUILT_IN_COMMANDS) {
      expect(screen.getByText(cmd.description)).toBeInTheDocument();
    }
  });

  it('shows parameter labels for commands that have them', () => {
    render(<SlashCommandPalette {...defaultProps} query="giphy" />);
    expect(screen.getByText('[query]')).toBeInTheDocument();
  });

  it('filters to multiple results when query partially matches', () => {
    // "s" matches shrug, spoiler
    render(<SlashCommandPalette {...defaultProps} query="s" />);
    expect(screen.getByText('/shrug')).toBeInTheDocument();
    expect(screen.getByText('/spoiler')).toBeInTheDocument();
    expect(screen.queryByText('/giphy')).not.toBeInTheDocument();
  });
});
