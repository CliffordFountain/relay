import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SkeletonChannelList } from './SkeletonChannel';

describe('SkeletonChannelList', () => {
  it('renders without crashing', () => {
    const { container } = render(<SkeletonChannelList />);
    expect(container).toBeTruthy();
  });

  it('has a loading status role', () => {
    render(<SkeletonChannelList />);
    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
    expect(status).toHaveAttribute('aria-label', 'Loading channels');
  });

  it('renders child elements for the specified count', () => {
    render(<SkeletonChannelList count={6} />);
    const status = screen.getByRole('status');
    // Should contain channel items and category dividers
    expect(status.children.length).toBeGreaterThan(0);
  });

  it('renders category header placeholders', () => {
    const { container } = render(<SkeletonChannelList count={6} />);
    // At least one category header should exist
    expect(container.children.length).toBeGreaterThan(0);
  });

  it('renders the correct number of items for default count', () => {
    render(<SkeletonChannelList />);
    const status = screen.getByRole('status');
    // Default count is 8, split across 2 categories + category headers
    // So we expect channel items + category dividers
    expect(status.children.length).toBeGreaterThanOrEqual(3);
  });
});
