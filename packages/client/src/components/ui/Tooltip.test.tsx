import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Tooltip } from './Tooltip';

describe('Tooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders children without crashing', () => {
    render(
      <Tooltip text="Hello">
        <button>Hover me</button>
      </Tooltip>
    );
    expect(screen.getByText('Hover me')).toBeInTheDocument();
  });

  it('does not show tooltip initially', () => {
    render(
      <Tooltip text="Tooltip text">
        <button>Hover me</button>
      </Tooltip>
    );
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows tooltip after delay on mouse enter', () => {
    render(
      <Tooltip text="Tooltip text" delay={300}>
        <button>Hover me</button>
      </Tooltip>
    );

    const trigger = screen.getByText('Hover me').parentElement;
    expect(trigger).toBeTruthy();

    act(() => {
      fireEvent.mouseEnter(trigger!);
    });

    // Should not show immediately
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    // Advance timer past the delay
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    expect(screen.getByText('Tooltip text')).toBeInTheDocument();
  });

  it('hides tooltip on mouse leave', () => {
    render(
      <Tooltip text="Tooltip text" delay={300}>
        <button>Hover me</button>
      </Tooltip>
    );

    const trigger = screen.getByText('Hover me').parentElement;

    act(() => {
      fireEvent.mouseEnter(trigger!);
      vi.advanceTimersByTime(300);
    });

    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    act(() => {
      fireEvent.mouseLeave(trigger!);
    });

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('cancels tooltip if mouse leaves before delay', () => {
    render(
      <Tooltip text="Tooltip text" delay={300}>
        <button>Hover me</button>
      </Tooltip>
    );

    const trigger = screen.getByText('Hover me').parentElement;

    act(() => {
      fireEvent.mouseEnter(trigger!);
      vi.advanceTimersByTime(100);
      fireEvent.mouseLeave(trigger!);
      vi.advanceTimersByTime(300);
    });

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('renders with correct tooltip text', () => {
    render(
      <Tooltip text="Server Name" delay={0}>
        <button>Icon</button>
      </Tooltip>
    );

    const trigger = screen.getByText('Icon').parentElement;

    act(() => {
      fireEvent.mouseEnter(trigger!);
      vi.advanceTimersByTime(0);
    });

    expect(screen.getByText('Server Name')).toBeInTheDocument();
  });

  it('applies correct position class', () => {
    render(
      <Tooltip text="Right tooltip" position="right" delay={0}>
        <button>Icon</button>
      </Tooltip>
    );

    const trigger = screen.getByText('Icon').parentElement;

    act(() => {
      fireEvent.mouseEnter(trigger!);
      vi.advanceTimersByTime(0);
    });

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.className).toContain('right');
  });
});
