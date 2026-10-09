/** Covers local checkbox tokens and production Turnstile rendering, expiry, failure, and reset cleanup. */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HumanVerification } from './HumanVerification';
import {
  clearTurnstileBrowserDiagnostics,
  readTurnstileBrowserDiagnostics,
} from './turnstileBrowserDiagnostics';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  cleanup();
  clearTurnstileBrowserDiagnostics();
  vi.restoreAllMocks();
  delete window.turnstile;
});

describe('HumanVerification', () => {
  it('uses an explicit no-network local checkbox and clears it on reset', () => {
    const onToken = vi.fn();
    const view = render(
      <HumanVerification
        action="registration"
        development
        disabled={false}
        onToken={onToken}
        resetKey={0}
      />,
    );
    fireEvent.click(screen.getByLabelText('I am not a robot'));
    expect(onToken).toHaveBeenLastCalledWith('development-human-verification');

    view.rerender(
      <HumanVerification
        action="registration"
        development
        disabled={false}
        onToken={onToken}
        resetKey={1}
      />,
    );
    expect(onToken).toHaveBeenLastCalledWith(null);
    expect(screen.getByLabelText('I am not a robot')).not.toBeChecked();
  });

  it('renders production Turnstile with exact action/site key and removes it on reset', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        humanVerification: {
          provider: 'turnstile',
          siteKey: 'public-site-key',
        },
      }),
    );
    const remove = vi.fn();
    const renderWidget = vi.fn((_container, options) => {
      options.callback('turnstile-token');
      return 'widget-id';
    });
    window.turnstile = { remove, render: renderWidget };
    const onToken = vi.fn();
    const view = render(
      <HumanVerification
        action="password-reset"
        development={false}
        disabled={false}
        onToken={onToken}
        resetKey={0}
      />,
    );

    await vi.waitFor(() => expect(renderWidget).toHaveBeenCalledOnce());
    expect(renderWidget).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        action: 'password-reset',
        sitekey: 'public-site-key',
        theme: 'auto',
      }),
    );
    expect(onToken).toHaveBeenLastCalledWith('turnstile-token');
    expect(
      readTurnstileBrowserDiagnostics().map((record) => record.stage),
    ).toEqual(['script-loaded', 'completed', 'rendered']);

    view.rerender(
      <HumanVerification
        action="password-reset"
        development={false}
        disabled={false}
        onToken={onToken}
        resetKey={1}
      />,
    );
    await vi.waitFor(() => expect(remove).toHaveBeenCalledWith('widget-id'));
    expect(onToken).toHaveBeenCalledWith(null);
  });

  it('retries script loading after an earlier network failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      jsonResponse({
        humanVerification: {
          provider: 'turnstile',
          siteKey: 'public-site-key',
        },
      }),
    );
    const onToken = vi.fn();
    render(
      <HumanVerification
        action="registration"
        development={false}
        disabled={false}
        onToken={onToken}
        resetKey={0}
      />,
    );
    const failedScript = await vi.waitFor(() => {
      const script = document.getElementById('chalkboard-turnstile-script');
      expect(script).toBeInstanceOf(HTMLScriptElement);
      return script as HTMLScriptElement;
    });
    fireEvent.error(failedScript);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Human verification is unavailable',
    );
    expect(readTurnstileBrowserDiagnostics()).toEqual([
      expect.objectContaining({
        action: 'registration',
        attempt: 1,
        outcome: 'failure',
        stage: 'script-error',
      }),
    ]);

    const renderWidget = vi.fn((_container, options) => {
      options.callback('recovered-token');
      return 'recovered-widget';
    });
    window.turnstile = { remove: vi.fn(), render: renderWidget };
    fireEvent.click(
      screen.getByRole('button', { name: 'Retry human verification' }),
    );

    await vi.waitFor(() => expect(renderWidget).toHaveBeenCalledOnce());
    expect(onToken).toHaveBeenLastCalledWith('recovered-token');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('times out and records a stalled provider script load', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({
          humanVerification: {
            provider: 'turnstile',
            siteKey: 'private-public-site-key',
          },
        }),
      );
      render(
        <HumanVerification
          action="registration"
          development={false}
          disabled={false}
          onToken={vi.fn()}
          resetKey={0}
        />,
      );
      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(10_000);
        await Promise.resolve();
      });
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Human verification is unavailable',
      );
      expect(
        document.getElementById('chalkboard-turnstile-script'),
      ).not.toBeInTheDocument();
      const diagnostics = readTurnstileBrowserDiagnostics();
      expect(diagnostics).toEqual([
        expect.objectContaining({
          action: 'registration',
          attempt: 1,
          outcome: 'failure',
          stage: 'script-timeout',
        }),
      ]);
      expect(JSON.stringify(diagnostics)).not.toContain(
        'private-public-site-key',
      );
      expect(JSON.stringify(diagnostics)).not.toContain('render=explicit');
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the token on production expiry or widget failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        humanVerification: {
          provider: 'turnstile',
          siteKey: 'public-site-key',
        },
      }),
    );
    let expire = () => undefined;
    let fail = () => undefined;
    window.turnstile = {
      remove: vi.fn(),
      render: vi.fn((_container, options) => {
        expire = options['expired-callback'];
        fail = options['error-callback'];
        options.callback('initial-token');
        return 'widget-id';
      }),
    };
    const onToken = vi.fn();
    render(
      <HumanVerification
        action="registration"
        development={false}
        disabled={false}
        onToken={onToken}
        resetKey={0}
      />,
    );
    await vi.waitFor(() =>
      expect(onToken).toHaveBeenCalledWith('initial-token'),
    );

    expire();
    expect(onToken).toHaveBeenLastCalledWith(null);
    fail();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Human verification failed to load',
    );
    expect(onToken).toHaveBeenLastCalledWith(null);
    expect(
      readTurnstileBrowserDiagnostics().map((record) => record.stage),
    ).toEqual([
      'script-loaded',
      'completed',
      'rendered',
      'expired',
      'provider-error',
    ]);
  });

  it('records provider timeout and invalid callback tokens without private values', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        humanVerification: {
          provider: 'turnstile',
          siteKey: 'private-public-site-key',
        },
      }),
    );
    const privateToken = 'private-provider-token';
    let timeout = () => undefined;
    window.turnstile = {
      remove: vi.fn(),
      render: vi.fn((_container, options) => {
        timeout = options['timeout-callback'];
        options.callback('');
        options.callback(privateToken);
        return 'private-widget-id';
      }),
    };
    const onToken = vi.fn();
    render(
      <HumanVerification
        action="registration"
        development={false}
        disabled={false}
        onToken={onToken}
        resetKey={0}
      />,
    );
    await vi.waitFor(() => expect(onToken).toHaveBeenCalledWith(privateToken));
    timeout();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Human verification failed to load',
    );
    const diagnostics = readTurnstileBrowserDiagnostics();
    expect(diagnostics.map((record) => record.stage)).toEqual([
      'script-loaded',
      'invalid-token',
      'completed',
      'rendered',
      'provider-timeout',
    ]);
    const serialized = JSON.stringify(diagnostics);
    expect(serialized).not.toContain(privateToken);
    expect(serialized).not.toContain('private-public-site-key');
    expect(serialized).not.toContain('private-widget-id');
  });

  it('records render and widget-removal exceptions without private error prose', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      jsonResponse({
        humanVerification: {
          provider: 'turnstile',
          siteKey: 'public-site-key',
        },
      }),
    );
    const renderPrivate = 'private render failure';
    window.turnstile = {
      remove: vi.fn(),
      render: vi.fn(() => {
        throw new Error(renderPrivate);
      }),
    };
    const first = render(
      <HumanVerification
        action="registration"
        development={false}
        disabled={false}
        onToken={vi.fn()}
        resetKey={0}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Human verification is unavailable',
    );
    expect(readTurnstileBrowserDiagnostics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operationalError: expect.objectContaining({
            messageSummary: 'External provider operational failure',
          }),
          stage: 'render',
        }),
      ]),
    );
    expect(JSON.stringify(readTurnstileBrowserDiagnostics())).not.toContain(
      renderPrivate,
    );
    first.unmount();

    clearTurnstileBrowserDiagnostics();
    const removalPrivate = 'private removal failure';
    window.turnstile = {
      remove: vi.fn(() => {
        throw new Error(removalPrivate);
      }),
      render: vi.fn(() => 'widget-id'),
    };
    const second = render(
      <HumanVerification
        action="password-reset"
        development={false}
        disabled={false}
        onToken={vi.fn()}
        resetKey={0}
      />,
    );
    await vi.waitFor(() =>
      expect(window.turnstile?.render).toHaveBeenCalledOnce(),
    );
    second.unmount();
    expect(readTurnstileBrowserDiagnostics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operationalError: expect.objectContaining({
            messageSummary: 'External provider operational failure',
          }),
          stage: 'removal',
        }),
      ]),
    );
    expect(JSON.stringify(readTurnstileBrowserDiagnostics())).not.toContain(
      removalPrivate,
    );
  });
});
