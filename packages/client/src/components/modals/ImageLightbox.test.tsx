import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { ImageLightbox } from './ImageLightbox';
import { uiSlice, openLightbox } from '../../stores/uiSlice';
import { authSlice } from '../../stores/authSlice';
import { guildsSlice } from '../../stores/guildsSlice';
import { channelsSlice } from '../../stores/channelsSlice';
import { messagesSlice } from '../../stores/messagesSlice';
import { voiceSlice } from '../../stores/voiceSlice';
import { membersSlice } from '../../stores/membersSlice';

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

describe('ImageLightbox', () => {
  it('renders nothing when no lightbox image is set', () => {
    const store = createTestStore();
    const { container } = render(
      <Provider store={store}><ImageLightbox /></Provider>
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the lightbox when an image URL is set', () => {
    const store = createTestStore();
    store.dispatch(openLightbox('https://cdn.example.com/image.png'));
    render(
      <Provider store={store}><ImageLightbox /></Provider>
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByAltText('Full size preview')).toHaveAttribute('src', 'https://cdn.example.com/image.png');
  });

  it('closes lightbox when close button is clicked', () => {
    const store = createTestStore();
    store.dispatch(openLightbox('https://cdn.example.com/image.png'));
    render(
      <Provider store={store}><ImageLightbox /></Provider>
    );
    fireEvent.click(screen.getByLabelText('Close lightbox'));
    expect(store.getState().ui.lightboxImage).toBeNull();
  });

  it('closes lightbox when backdrop is clicked', () => {
    const store = createTestStore();
    store.dispatch(openLightbox('https://cdn.example.com/image.png'));
    render(
      <Provider store={store}><ImageLightbox /></Provider>
    );
    fireEvent.click(screen.getByRole('dialog'));
    expect(store.getState().ui.lightboxImage).toBeNull();
  });

  it('has an "Open original" link pointing to the image URL', () => {
    const store = createTestStore();
    store.dispatch(openLightbox('https://cdn.example.com/image.png'));
    render(
      <Provider store={store}><ImageLightbox /></Provider>
    );
    const link = screen.getByText('Open original');
    expect(link).toHaveAttribute('href', 'https://cdn.example.com/image.png');
    expect(link).toHaveAttribute('target', '_blank');
  });
});
