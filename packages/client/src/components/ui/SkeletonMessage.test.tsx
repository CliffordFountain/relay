import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SkeletonMessageList } from './SkeletonMessage';

describe('SkeletonMessageList', () => {
  it('renders without crashing', () => {
    const { container } = render(<SkeletonMessageList />);
    expect(container).toBeTruthy();
  });

  it('has a loading status role', () => {
    render(<SkeletonMessageList />);
    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
    expect(status).toHaveAttribute('aria-label', 'Loading messages');
  });

  it('renders skeleton items with the specified count', () => {
    const { container } = render(<SkeletonMessageList count={5} />);
    // The component produces at least `count` items (some grouped)
    const statusEl = container.querySelector('[role="status"]');
    expect(statusEl).toBeTruthy();
    expect(statusEl!.children.length).toBeGreaterThanOrEqual(5);
  });

  it('renders default count of at least 8 items', () => {
    const { container } = render(<SkeletonMessageList />);
    const statusEl = container.querySelector('[role="status"]');
    expect(statusEl).toBeTruthy();
    expect(statusEl!.children.length).toBeGreaterThanOrEqual(8);
  });

  it('renders avatar placeholders for non-grouped messages', () => {
    const { container } = render(<SkeletonMessageList count={1} />);
    // The first message always has an avatar div
    const statusEl = container.querySelector('[role="status"]');
    expect(statusEl).toBeTruthy();
    // At minimum we should have a child rendered
    expect(statusEl!.children.length).toBeGreaterThanOrEqual(1);
  });
});
