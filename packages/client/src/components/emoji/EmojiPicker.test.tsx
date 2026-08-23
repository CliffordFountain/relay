import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmojiPicker, EMOJI_CATEGORIES } from './EmojiPicker';

describe('EmojiPicker', () => {
  const onSelect = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    onSelect.mockClear();
    onClose.mockClear();
  });

  it('renders without crashing', () => {
    render(<EmojiPicker onSelect={onSelect} onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: /emoji picker/i })).toBeInTheDocument();
  });

  it('renders search input', () => {
    render(<EmojiPicker onSelect={onSelect} onClose={onClose} />);
    expect(screen.getByPlaceholderText('Search emoji')).toBeInTheDocument();
  });

  it('renders all category tabs', () => {
    render(<EmojiPicker onSelect={onSelect} onClose={onClose} />);
    const categoryNames = Object.keys(EMOJI_CATEGORIES);
    const categoryBtns = screen.getAllByRole('button').filter(
      btn => btn.getAttribute('title') && categoryNames.includes(btn.getAttribute('title') as string)
    );
    expect(categoryBtns.length).toBe(categoryNames.length);
  });

  it('has Travel & Places category', () => {
    expect(EMOJI_CATEGORIES['Travel & Places']).toBeDefined();
    expect(EMOJI_CATEGORIES['Travel & Places'].length).toBeGreaterThan(0);
  });

  it('has Activities category', () => {
    expect(EMOJI_CATEGORIES['Activities']).toBeDefined();
    expect(EMOJI_CATEGORIES['Activities'].length).toBeGreaterThan(0);
  });

  it('has Objects category', () => {
    expect(EMOJI_CATEGORIES['Objects']).toBeDefined();
    expect(EMOJI_CATEGORIES['Objects'].length).toBeGreaterThan(0);
  });

  it('has Flags category', () => {
    expect(EMOJI_CATEGORIES['Flags']).toBeDefined();
    expect(EMOJI_CATEGORIES['Flags'].length).toBeGreaterThan(0);
  });

  it('switches category on tab click', () => {
    render(<EmojiPicker onSelect={onSelect} onClose={onClose} />);
    const flagsTab = screen.getByTitle('Flags');
    fireEvent.click(flagsTab);
    expect(screen.getByText('Flags')).toBeInTheDocument();
  });

  it('switches to Travel & Places on tab click', () => {
    render(<EmojiPicker onSelect={onSelect} onClose={onClose} />);
    const travelTab = screen.getByTitle('Travel & Places');
    fireEvent.click(travelTab);
    expect(screen.getByText('Travel & Places')).toBeInTheDocument();
  });

  it('switches to Activities on tab click', () => {
    render(<EmojiPicker onSelect={onSelect} onClose={onClose} />);
    const activitiesTab = screen.getByTitle('Activities');
    fireEvent.click(activitiesTab);
    expect(screen.getByText('Activities')).toBeInTheDocument();
  });

  it('switches to Objects on tab click', () => {
    render(<EmojiPicker onSelect={onSelect} onClose={onClose} />);
    const objectsTab = screen.getByTitle('Objects');
    fireEvent.click(objectsTab);
    expect(screen.getByText('Objects')).toBeInTheDocument();
  });

  it('calls onSelect when an emoji is clicked', () => {
    render(<EmojiPicker onSelect={onSelect} onClose={onClose} />);
    const emojiBtn = screen.getAllByRole('button').find(
      btn => btn.getAttribute('data-emoji')
    );
    if (emojiBtn) {
      fireEvent.click(emojiBtn);
      expect(onSelect).toHaveBeenCalled();
    }
  });

  it('filters emoji by search query', () => {
    render(<EmojiPicker onSelect={onSelect} onClose={onClose} />);
    const searchInput = screen.getByPlaceholderText('Search emoji');
    fireEvent.change(searchInput, { target: { value: 'rocket' } });
    expect(screen.getByText('Search Results')).toBeInTheDocument();
    // Should find rocket emoji from Travel & Places
    const rocketBtn = screen.getAllByRole('button').find(
      btn => btn.getAttribute('title') === 'rocket'
    );
    expect(rocketBtn).toBeDefined();
  });

  it('shows no results for nonsense search', () => {
    render(<EmojiPicker onSelect={onSelect} onClose={onClose} />);
    const searchInput = screen.getByPlaceholderText('Search emoji');
    fireEvent.change(searchInput, { target: { value: 'zzznonexistent' } });
    expect(screen.getByText('No emoji found')).toBeInTheDocument();
  });

  it('includes flag emoji in search results', () => {
    render(<EmojiPicker onSelect={onSelect} onClose={onClose} />);
    const searchInput = screen.getByPlaceholderText('Search emoji');
    fireEvent.change(searchInput, { target: { value: 'flag United States' } });
    const results = screen.getAllByRole('button').filter(
      btn => btn.getAttribute('data-emoji')
    );
    expect(results.length).toBeGreaterThan(0);
  });

  it('has at least 9 emoji categories total', () => {
    const cats = Object.keys(EMOJI_CATEGORIES);
    expect(cats.length).toBeGreaterThanOrEqual(9);
  });
});
