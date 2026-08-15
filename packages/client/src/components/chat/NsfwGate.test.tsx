import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NsfwGate, isNsfwAccepted } from './NsfwGate';

describe('NsfwGate', () => {
  const onAccept = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders without crashing', () => {
    const { container } = render(
      <NsfwGate channelId="ch1" channelName="nsfw-channel" onAccept={onAccept} />,
    );
    expect(container).toBeTruthy();
  });

  it('renders the warning title', () => {
    render(
      <NsfwGate channelId="ch1" channelName="nsfw-channel" onAccept={onAccept} />,
    );
    expect(screen.getByText('This is an NSFW channel')).toBeInTheDocument();
  });

  it('renders the age requirement description', () => {
    render(
      <NsfwGate channelId="ch1" channelName="nsfw-channel" onAccept={onAccept} />,
    );
    expect(screen.getByText(/at least 18 years old/)).toBeInTheDocument();
  });

  it('renders the channel name', () => {
    render(
      <NsfwGate channelId="ch1" channelName="nsfw-channel" onAccept={onAccept} />,
    );
    expect(screen.getByText('#nsfw-channel')).toBeInTheDocument();
  });

  it('renders the accept button', () => {
    render(
      <NsfwGate channelId="ch1" channelName="nsfw-channel" onAccept={onAccept} />,
    );
    expect(screen.getByText('I agree and wish to enter')).toBeInTheDocument();
  });

  it('calls onAccept when accept button is clicked', () => {
    render(
      <NsfwGate channelId="ch1" channelName="nsfw-channel" onAccept={onAccept} />,
    );
    fireEvent.click(screen.getByText('I agree and wish to enter'));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it('stores accepted channel in localStorage', () => {
    render(
      <NsfwGate channelId="ch1" channelName="nsfw-channel" onAccept={onAccept} />,
    );
    fireEvent.click(screen.getByText('I agree and wish to enter'));
    expect(isNsfwAccepted('ch1')).toBe(true);
  });

  it('does not mark unaccepted channels as accepted', () => {
    expect(isNsfwAccepted('ch2')).toBe(false);
  });

  it('persists acceptance across calls', () => {
    render(
      <NsfwGate channelId="ch1" channelName="nsfw-channel" onAccept={onAccept} />,
    );
    fireEvent.click(screen.getByText('I agree and wish to enter'));
    expect(isNsfwAccepted('ch1')).toBe(true);
    expect(isNsfwAccepted('ch2')).toBe(false);
  });
});
