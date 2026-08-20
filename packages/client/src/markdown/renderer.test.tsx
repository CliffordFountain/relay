import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MarkdownContent, _parseInline, _parseMarkdown, _formatTimestamp } from './renderer';
import { authSlice } from '../stores/authSlice';
import { guildsSlice } from '../stores/guildsSlice';
import { channelsSlice } from '../stores/channelsSlice';
import { messagesSlice } from '../stores/messagesSlice';
import { voiceSlice } from '../stores/voiceSlice';
import { membersSlice } from '../stores/membersSlice';
import { uiSlice } from '../stores/uiSlice';
import { rolesSlice } from '../stores/rolesSlice';

function createTestStore(preloadedState?: Record<string, unknown>) {
  return configureStore({
    reducer: {
      auth: authSlice.reducer,
      guilds: guildsSlice.reducer,
      channels: channelsSlice.reducer,
      messages: messagesSlice.reducer,
      voice: voiceSlice.reducer,
      members: membersSlice.reducer,
      ui: uiSlice.reducer,
      roles: rolesSlice.reducer,
    },
    preloadedState: preloadedState as Record<string, never>,
  });
}

function renderWithStore(ui: React.ReactElement, preloadedState?: Record<string, unknown>) {
  const store = createTestStore(preloadedState);
  return {
    ...render(<Provider store={store}>{ui}</Provider>),
    store,
  };
}

describe('MarkdownContent', () => {
  it('renders plain text', () => {
    renderWithStore(<MarkdownContent content="hello world" />);
    expect(screen.getByText('hello world')).toBeInTheDocument();
  });

  it('renders bold text', () => {
    renderWithStore(<MarkdownContent content="**bold text**" />);
    const bold = screen.getByText('bold text');
    expect(bold.tagName).toBe('STRONG');
  });

  it('renders italic text', () => {
    renderWithStore(<MarkdownContent content="*italic text*" />);
    const italic = screen.getByText('italic text');
    expect(italic.tagName).toBe('EM');
  });

  it('renders inline code', () => {
    renderWithStore(<MarkdownContent content="`code`" />);
    const code = screen.getByText('code');
    expect(code.tagName).toBe('CODE');
  });

  it('renders code blocks', () => {
    renderWithStore(<MarkdownContent content="```\nsome code\n```" />);
    const preEl = document.querySelector('pre');
    expect(preEl).toBeInTheDocument();
    const codeEl = document.querySelector('code');
    expect(codeEl).toBeInTheDocument();
    expect(codeEl?.textContent).toContain('some code');
  });

  it('renders code blocks with language header', () => {
    renderWithStore(<MarkdownContent content="```js\nconsole.log()\n```" />);
    expect(screen.getByText('js')).toBeInTheDocument();
    const codeEl = document.querySelector('code');
    expect(codeEl).toBeInTheDocument();
    expect(codeEl?.textContent).toContain('console.log()');
  });

  it('applies syntax highlighting to code blocks with a recognized language', () => {
    renderWithStore(<MarkdownContent content={'```javascript\nconst x = 42;\n```'} />);
    const codeEl = document.querySelector('code');
    expect(codeEl).toBeInTheDocument();
    // Syntax-highlighted code should contain hljs class and spans
    expect(codeEl?.classList.contains('hljs')).toBe(true);
    expect(codeEl?.innerHTML).toContain('<span');
  });

  it('renders a copy button in code blocks with a language', () => {
    renderWithStore(<MarkdownContent content="```python\nprint('hello')\n```" />);
    const copyBtn = screen.getByLabelText('Copy code');
    expect(copyBtn).toBeInTheDocument();
  });

  it('renders masked links', () => {
    renderWithStore(<MarkdownContent content="[click me](https://example.com)" />);
    const link = screen.getByText('click me');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', 'https://example.com');
  });

  it('renders blockquotes', () => {
    renderWithStore(<MarkdownContent content="> quoted text" />);
    const bq = screen.getByText('quoted text');
    expect(bq.closest('blockquote')).toBeInTheDocument();
  });

  it('renders spoiler text', () => {
    renderWithStore(<MarkdownContent content="||spoiler||" />);
    expect(screen.getByText('spoiler')).toBeInTheDocument();
  });
});

describe('Heading parsing', () => {
  it('renders h1 from # syntax', () => {
    renderWithStore(<MarkdownContent content="# Big heading" />);
    const heading = screen.getByText('Big heading');
    expect(heading.closest('h1')).toBeInTheDocument();
  });

  it('renders h2 from ## syntax', () => {
    renderWithStore(<MarkdownContent content="## Medium heading" />);
    const heading = screen.getByText('Medium heading');
    expect(heading.closest('h2')).toBeInTheDocument();
  });

  it('renders h3 from ### syntax', () => {
    renderWithStore(<MarkdownContent content="### Small heading" />);
    const heading = screen.getByText('Small heading');
    expect(heading.closest('h3')).toBeInTheDocument();
  });

  it('does not render heading without space after #', () => {
    renderWithStore(<MarkdownContent content="#noheading" />);
    expect(screen.queryByRole('heading')).toBeNull();
  });
});

describe('Mention parsing', () => {
  it('parses user mention tokens', () => {
    const tokens = _parseInline('<@123456>');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toEqual({ type: 'userMention', userId: '123456' });
  });

  it('parses nickname mention tokens', () => {
    const tokens = _parseInline('<@!789>');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toEqual({ type: 'userMention', userId: '789' });
  });

  it('parses role mention tokens', () => {
    const tokens = _parseInline('<@&111>');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toEqual({ type: 'roleMention', roleId: '111' });
  });

  it('parses channel mention tokens', () => {
    const tokens = _parseInline('<#222>');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toEqual({ type: 'channelMention', channelId: '222' });
  });

  it('renders user mention as pill with @Unknown User when member not found', () => {
    renderWithStore(<MarkdownContent content="Hello <@99999>" />, {
      guilds: { guilds: {}, selectedGuildId: 'g1' },
      members: { membersByGuild: { g1: [] }, isLoading: false },
    });
    expect(screen.getByText('@Unknown User')).toBeInTheDocument();
  });

  it('renders channel mention with channel name', () => {
    renderWithStore(<MarkdownContent content="See <#ch1>" />, {
      channels: {
        channels: { ch1: { id: 'ch1', guild_id: 'g1', type: 0, name: 'general', topic: null, position: 0, parent_id: null } },
        selectedChannelId: null,
      },
    });
    expect(screen.getByText('general')).toBeInTheDocument();
  });
});

describe('Timestamp parsing', () => {
  it('parses timestamp tokens', () => {
    const tokens = _parseInline('<t:1616025600>');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toEqual({ type: 'timestamp', unix: 1616025600, style: 'f' });
  });

  it('parses timestamp tokens with style', () => {
    const tokens = _parseInline('<t:1616025600:R>');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toEqual({ type: 'timestamp', unix: 1616025600, style: 'R' });
  });

  it('renders timestamp as formatted text', () => {
    renderWithStore(<MarkdownContent content="<t:1616025600:d>" />);
    // Should render a date string - the exact format depends on locale
    const timestampEl = screen.getByTitle(/2021/);
    expect(timestampEl).toBeInTheDocument();
  });
});

describe('Auto-linking', () => {
  it('parses bare URLs as autoLink tokens', () => {
    const tokens = _parseInline('Visit https://example.com today');
    expect(tokens).toHaveLength(3);
    expect(tokens[0]).toEqual({ type: 'text', content: 'Visit ' });
    expect(tokens[1]).toEqual({ type: 'autoLink', href: 'https://example.com' });
    expect(tokens[2]).toEqual({ type: 'text', content: ' today' });
  });

  it('renders bare URLs as clickable links', () => {
    renderWithStore(<MarkdownContent content="Check https://example.com" />);
    const link = screen.getByText('https://example.com');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveAttribute('target', '_blank');
  });
});

describe('formatTimestamp', () => {
  it('formats relative timestamps', () => {
    const now = Math.floor(Date.now() / 1000);
    const result = _formatTimestamp(now - 120, 'R');
    expect(result).toBe('2 minutes ago');
  });

  it('formats short time', () => {
    const result = _formatTimestamp(1616025600, 't');
    // This will vary by locale, just check it returns a string
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
