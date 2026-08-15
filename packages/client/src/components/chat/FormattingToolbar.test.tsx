import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FormattingToolbar } from './FormattingToolbar';
import type { FormatAction } from './FormattingToolbar';

describe('FormattingToolbar', () => {
  const defaultProps = {
    position: { top: 100, left: 200 },
    onFormat: vi.fn(),
  };

  it('renders without crashing', () => {
    render(<FormattingToolbar {...defaultProps} />);
    expect(screen.getByRole('toolbar', { name: 'Text formatting' })).toBeInTheDocument();
  });

  it('renders all formatting buttons', () => {
    render(<FormattingToolbar {...defaultProps} />);
    expect(screen.getByLabelText('Bold')).toBeInTheDocument();
    expect(screen.getByLabelText('Italic')).toBeInTheDocument();
    expect(screen.getByLabelText('Underline')).toBeInTheDocument();
    expect(screen.getByLabelText('Strikethrough')).toBeInTheDocument();
    expect(screen.getByLabelText('Code')).toBeInTheDocument();
    expect(screen.getByLabelText('Spoiler')).toBeInTheDocument();
  });

  it('calls onFormat with correct action when Bold is clicked', () => {
    const onFormat = vi.fn();
    render(<FormattingToolbar {...defaultProps} onFormat={onFormat} />);
    fireEvent.click(screen.getByLabelText('Bold'));
    expect(onFormat).toHaveBeenCalledWith('bold' as FormatAction);
  });

  it('calls onFormat with correct action when Italic is clicked', () => {
    const onFormat = vi.fn();
    render(<FormattingToolbar {...defaultProps} onFormat={onFormat} />);
    fireEvent.click(screen.getByLabelText('Italic'));
    expect(onFormat).toHaveBeenCalledWith('italic' as FormatAction);
  });

  it('calls onFormat with correct action when Underline is clicked', () => {
    const onFormat = vi.fn();
    render(<FormattingToolbar {...defaultProps} onFormat={onFormat} />);
    fireEvent.click(screen.getByLabelText('Underline'));
    expect(onFormat).toHaveBeenCalledWith('underline' as FormatAction);
  });

  it('calls onFormat with correct action when Strikethrough is clicked', () => {
    const onFormat = vi.fn();
    render(<FormattingToolbar {...defaultProps} onFormat={onFormat} />);
    fireEvent.click(screen.getByLabelText('Strikethrough'));
    expect(onFormat).toHaveBeenCalledWith('strikethrough' as FormatAction);
  });

  it('calls onFormat with correct action when Code is clicked', () => {
    const onFormat = vi.fn();
    render(<FormattingToolbar {...defaultProps} onFormat={onFormat} />);
    fireEvent.click(screen.getByLabelText('Code'));
    expect(onFormat).toHaveBeenCalledWith('code' as FormatAction);
  });

  it('calls onFormat with correct action when Spoiler is clicked', () => {
    const onFormat = vi.fn();
    render(<FormattingToolbar {...defaultProps} onFormat={onFormat} />);
    fireEvent.click(screen.getByLabelText('Spoiler'));
    expect(onFormat).toHaveBeenCalledWith('spoiler' as FormatAction);
  });

  it('positions itself at the given coordinates', () => {
    render(<FormattingToolbar {...defaultProps} />);
    const toolbar = screen.getByRole('toolbar');
    expect(toolbar.style.top).toBe('100px');
    expect(toolbar.style.left).toBe('200px');
  });

  it('shows keyboard shortcut in title for Bold', () => {
    render(<FormattingToolbar {...defaultProps} />);
    const boldBtn = screen.getByLabelText('Bold');
    expect(boldBtn).toHaveAttribute('title', 'Bold (Ctrl+B)');
  });

  it('shows keyboard shortcut in title for Italic', () => {
    render(<FormattingToolbar {...defaultProps} />);
    const italicBtn = screen.getByLabelText('Italic');
    expect(italicBtn).toHaveAttribute('title', 'Italic (Ctrl+I)');
  });
});
