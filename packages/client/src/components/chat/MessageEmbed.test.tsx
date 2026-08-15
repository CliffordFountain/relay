import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MessageEmbed } from './MessageEmbed';
import type { Embed } from '../../stores/messagesSlice';

describe('MessageEmbed', () => {
  it('renders without crashing with minimal embed data', () => {
    const embed: Embed = { title: 'Test Embed' };
    render(<MessageEmbed embed={embed} />);
    expect(screen.getByText('Test Embed')).toBeInTheDocument();
  });

  it('renders title as a link when url is provided', () => {
    const embed: Embed = {
      title: 'Click Me',
      url: 'https://example.com',
    };
    render(<MessageEmbed embed={embed} />);
    const link = screen.getByText('Click Me');
    expect(link.closest('a')).toHaveAttribute('href', 'https://example.com');
  });

  it('renders description text', () => {
    const embed: Embed = {
      title: 'Title',
      description: 'A description of the embed.',
    };
    render(<MessageEmbed embed={embed} />);
    expect(screen.getByText('A description of the embed.')).toBeInTheDocument();
  });

  it('renders provider name', () => {
    const embed: Embed = {
      title: 'Title',
      provider: { name: 'GitHub' },
    };
    render(<MessageEmbed embed={embed} />);
    expect(screen.getByText('GitHub')).toBeInTheDocument();
  });

  it('renders colored left border when color is provided', () => {
    const embed: Embed = {
      title: 'Colored',
      color: 0x3B82F6,
    };
    const { container } = render(<MessageEmbed embed={embed} />);
    const colorBar = container.querySelector('[class*="colorBar"]');
    expect(colorBar).toBeTruthy();
  });

  it('renders embed fields', () => {
    const embed: Embed = {
      title: 'Fields',
      fields: [
        { name: 'Field 1', value: 'Value 1' },
        { name: 'Field 2', value: 'Value 2', inline: true },
      ],
    };
    render(<MessageEmbed embed={embed} />);
    expect(screen.getByText('Field 1')).toBeInTheDocument();
    expect(screen.getByText('Value 1')).toBeInTheDocument();
    expect(screen.getByText('Field 2')).toBeInTheDocument();
  });

  it('renders footer text', () => {
    const embed: Embed = {
      title: 'With Footer',
      footer: { text: 'Footer text here' },
    };
    render(<MessageEmbed embed={embed} />);
    expect(screen.getByText('Footer text here')).toBeInTheDocument();
  });

  it('returns null for empty embed', () => {
    const embed: Embed = {};
    const { container } = render(<MessageEmbed embed={embed} />);
    expect(container.firstChild).toBeNull();
  });

  it('has correct aria-label', () => {
    const embed: Embed = { title: 'Accessible' };
    render(<MessageEmbed embed={embed} />);
    expect(screen.getByLabelText('Embed')).toBeInTheDocument();
  });
});
