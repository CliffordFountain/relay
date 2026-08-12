import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoadingScreen } from './LoadingScreen';

describe('LoadingScreen', () => {
  it('renders without crashing', () => {
    const { container } = render(<LoadingScreen />);
    expect(container).toBeTruthy();
  });

  it('has a loading status role', () => {
    render(<LoadingScreen />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders a message when provided', () => {
    render(<LoadingScreen message="Loading your servers..." />);
    expect(screen.getByText('Loading your servers...')).toBeInTheDocument();
  });

  it('does not render a message when not provided', () => {
    render(<LoadingScreen />);
    // The tip paragraph is always present, but no message paragraph should render
    expect(screen.queryByText('Loading your servers...')).not.toBeInTheDocument();
  });

  it('displays a rotating tip', () => {
    render(<LoadingScreen />);
    expect(screen.getByText('DID YOU KNOW')).toBeInTheDocument();
  });
});
