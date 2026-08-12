import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { WindowControls } from './WindowControls';

type WindowWithElectron = Window & { electronAPI?: unknown };

describe('WindowControls', () => {
  afterEach(() => {
    delete (window as WindowWithElectron).electronAPI;
  });

  it('renders nothing in a browser (no electronAPI)', () => {
    const { container } = render(<WindowControls />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders minimize/maximize/close and wires each to the Electron bridge', () => {
    const api = { minimize: vi.fn(), maximize: vi.fn(), close: vi.fn() };
    (window as WindowWithElectron).electronAPI = api;

    render(<WindowControls />);

    const minimize = screen.getByLabelText('Minimize');
    const maximize = screen.getByLabelText('Maximize');
    const close = screen.getByLabelText('Close');
    expect(minimize).toBeInTheDocument();
    expect(maximize).toBeInTheDocument();
    expect(close).toBeInTheDocument();

    fireEvent.click(minimize);
    expect(api.minimize).toHaveBeenCalledTimes(1);
    fireEvent.click(maximize);
    expect(api.maximize).toHaveBeenCalledTimes(1);
    fireEvent.click(close);
    expect(api.close).toHaveBeenCalledTimes(1);
  });
});
