import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MicTest } from './MicTest';

// MicTest reads the store singleton lazily (only when a test is started) and never uses
// getUserMedia on mount, so these UI tests need no Provider or media mocks.

describe('MicTest', () => {
  it('renders the test control and level meter', () => {
    render(<MicTest />);
    expect(screen.getByTestId('mic-test-toggle')).toBeInTheDocument();
    expect(screen.getByRole('meter')).toBeInTheDocument();
  });

  it('has a "Hear myself" monitor toggle that flips on click', () => {
    render(<MicTest />);
    const toggle = screen.getByTestId('mic-monitor-toggle');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('shows the headphones warning only while monitoring is enabled', () => {
    render(<MicTest />);
    expect(screen.queryByText(/use headphones to avoid an echo/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mic-monitor-toggle'));
    expect(screen.getByText(/use headphones to avoid an echo/i)).toBeInTheDocument();
  });

  it('renders the hidden playback sink for monitoring', () => {
    const { container } = render(<MicTest />);
    expect(container.querySelector('audio')).toBeInTheDocument();
  });
});
