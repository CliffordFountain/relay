import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MessageAttachments } from './MessageAttachments';
import { uiSlice } from '../../stores/uiSlice';
import { messagesSlice } from '../../stores/messagesSlice';
import { authSlice } from '../../stores/authSlice';
import { guildsSlice } from '../../stores/guildsSlice';
import { channelsSlice } from '../../stores/channelsSlice';
import { voiceSlice } from '../../stores/voiceSlice';
import { membersSlice } from '../../stores/membersSlice';
import type { Attachment } from '../../stores/messagesSlice';

function createTestStore() {
  return configureStore({
    reducer: {
      auth: authSlice.reducer,
      guilds: guildsSlice.reducer,
      channels: channelsSlice.reducer,
      messages: messagesSlice.reducer,
      voice: voiceSlice.reducer,
      members: membersSlice.reducer,
      ui: uiSlice.reducer,
    },
  });
}

function renderWithStore(ui: React.ReactElement) {
  const store = createTestStore();
  return {
    ...render(<Provider store={store}>{ui}</Provider>),
    store,
  };
}

describe('MessageAttachments', () => {
  it('renders nothing when attachments array is empty', () => {
    const { container } = renderWithStore(
      <MessageAttachments attachments={[]} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders an image attachment with correct alt text', () => {
    const attachments: Attachment[] = [{
      id: 'att1',
      filename: 'photo.png',
      size: 12345,
      url: 'https://cdn.example.com/photo.png',
      content_type: 'image/png',
      width: 800,
      height: 600,
    }];
    renderWithStore(<MessageAttachments attachments={attachments} />);
    const img = screen.getByAltText('photo.png');
    expect(img).toBeInTheDocument();
    expect(img.tagName).toBe('IMG');
  });

  it('renders image with constrained dimensions (max 400x300)', () => {
    const attachments: Attachment[] = [{
      id: 'att1',
      filename: 'large.jpg',
      size: 500000,
      url: 'https://cdn.example.com/large.jpg',
      content_type: 'image/jpeg',
      width: 1920,
      height: 1080,
    }];
    renderWithStore(<MessageAttachments attachments={attachments} />);
    const img = screen.getByAltText('large.jpg') as HTMLImageElement;
    // The image should be scaled down to fit within 400x300
    expect(parseInt(img.style.width)).toBeLessThanOrEqual(400);
    expect(parseInt(img.style.height)).toBeLessThanOrEqual(300);
  });

  it('opens lightbox when image is clicked', () => {
    const attachments: Attachment[] = [{
      id: 'att1',
      filename: 'photo.png',
      size: 12345,
      url: 'https://cdn.example.com/photo.png',
      content_type: 'image/png',
    }];
    const { store } = renderWithStore(
      <MessageAttachments attachments={attachments} />
    );
    const img = screen.getByAltText('photo.png');
    fireEvent.click(img);
    expect(store.getState().ui.lightboxImage).toBe('https://cdn.example.com/photo.png');
  });

  it('renders a video attachment with controls', () => {
    const attachments: Attachment[] = [{
      id: 'att2',
      filename: 'video.mp4',
      size: 5000000,
      url: 'https://cdn.example.com/video.mp4',
      content_type: 'video/mp4',
    }];
    renderWithStore(<MessageAttachments attachments={attachments} />);
    const video = screen.getByLabelText('video.mp4');
    expect(video).toBeInTheDocument();
    expect(video.tagName).toBe('VIDEO');
  });

  it('renders an audio attachment with controls', () => {
    const attachments: Attachment[] = [{
      id: 'att3',
      filename: 'song.mp3',
      size: 3000000,
      url: 'https://cdn.example.com/song.mp3',
      content_type: 'audio/mpeg',
    }];
    renderWithStore(<MessageAttachments attachments={attachments} />);
    const audio = screen.getByLabelText('song.mp3');
    expect(audio).toBeInTheDocument();
    expect(audio.tagName).toBe('AUDIO');
  });

  it('renders a generic file attachment with download link', () => {
    const attachments: Attachment[] = [{
      id: 'att4',
      filename: 'document.pdf',
      size: 102400,
      url: 'https://cdn.example.com/document.pdf',
      content_type: 'application/pdf',
    }];
    renderWithStore(<MessageAttachments attachments={attachments} />);
    const link = screen.getByText('document.pdf');
    expect(link).toBeInTheDocument();
    expect(link.closest('a')).toHaveAttribute('href', 'https://cdn.example.com/document.pdf');
  });

  it('formats file size correctly', () => {
    const attachments: Attachment[] = [{
      id: 'att4',
      filename: 'document.pdf',
      size: 1048576, // 1 MB
      url: 'https://cdn.example.com/document.pdf',
      content_type: 'application/pdf',
    }];
    renderWithStore(<MessageAttachments attachments={attachments} />);
    expect(screen.getByText('1.00 MB')).toBeInTheDocument();
  });

  it('renders multiple attachments', () => {
    const attachments: Attachment[] = [
      {
        id: 'att1',
        filename: 'photo.png',
        size: 12345,
        url: 'https://cdn.example.com/photo.png',
        content_type: 'image/png',
      },
      {
        id: 'att2',
        filename: 'doc.txt',
        size: 500,
        url: 'https://cdn.example.com/doc.txt',
        content_type: 'text/plain',
      },
    ];
    renderWithStore(<MessageAttachments attachments={attachments} />);
    expect(screen.getByAltText('photo.png')).toBeInTheDocument();
    expect(screen.getByText('doc.txt')).toBeInTheDocument();
  });

  it('detects image type from filename when content_type is missing', () => {
    const attachments: Attachment[] = [{
      id: 'att1',
      filename: 'screenshot.webp',
      size: 5000,
      url: 'https://cdn.example.com/screenshot.webp',
    }];
    renderWithStore(<MessageAttachments attachments={attachments} />);
    const img = screen.getByAltText('screenshot.webp');
    expect(img.tagName).toBe('IMG');
  });
});
