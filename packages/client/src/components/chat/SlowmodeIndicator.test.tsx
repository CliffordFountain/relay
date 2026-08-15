import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SlowmodeIndicator } from './SlowmodeIndicator';

describe('SlowmodeIndicator', () => {
  it('renders without crashing', () => {
    const { container } = render(
      <SlowmodeIndicator seconds={5} cooldown={0} />,
    );
    expect(container).toBeTruthy();
  });

  it('displays the slowmode duration in seconds', () => {
    render(
      <SlowmodeIndicator seconds={5} cooldown={0} />,
    );
    expect(screen.getByText('5s')).toBeInTheDocument();
  });

  it('displays minutes for durations >= 60 seconds', () => {
    render(
      <SlowmodeIndicator seconds={120} cooldown={0} />,
    );
    expect(screen.getByText('2m')).toBeInTheDocument();
  });

  it('displays hours for durations >= 3600 seconds', () => {
    render(
      <SlowmodeIndicator seconds={7200} cooldown={0} />,
    );
    expect(screen.getByText('2h')).toBeInTheDocument();
  });

  it('displays cooldown time when active', () => {
    render(
      <SlowmodeIndicator seconds={30} cooldown={15} />,
    );
    expect(screen.getByText('15s')).toBeInTheDocument();
  });

  it('has appropriate aria-label for idle state', () => {
    render(
      <SlowmodeIndicator seconds={10} cooldown={0} />,
    );
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Slowmode: 10 seconds');
  });

  it('has appropriate aria-label for active cooldown', () => {
    render(
      <SlowmodeIndicator seconds={10} cooldown={5} />,
    );
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Slowmode: 5 seconds remaining');
  });

  it('formats mixed minutes and seconds', () => {
    render(
      <SlowmodeIndicator seconds={90} cooldown={0} />,
    );
    expect(screen.getByText('1m 30s')).toBeInTheDocument();
  });

  it('formats mixed hours and minutes', () => {
    render(
      <SlowmodeIndicator seconds={5400} cooldown={0} />,
    );
    expect(screen.getByText('1h 30m')).toBeInTheDocument();
  });
});
