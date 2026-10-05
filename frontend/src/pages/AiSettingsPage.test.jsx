import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AiSettingsPage from './AiSettingsPage.jsx';
import { apiFetch } from '../api/client.js';

vi.mock('../api/client.js', () => ({ apiFetch: vi.fn() }));

const SAVED = {
  provider: 'claude',
  baseUrl: 'https://api.example.com/ica',
  model: 'claude-sonnet-5',
  hasApiKey: true,
  lastTestedAt: null,
  lastTestStatus: null,
  updatedAt: '2026-10-01T00:00:00.000Z',
  providers: ['mock', 'claude', 'openai'],
  defaults: {
    mock: { baseUrl: null, model: null, label: 'Mock (no API key needed)' },
    claude: { baseUrl: 'https://api.example.com/ica', model: 'claude-sonnet-5', label: 'Anthropic / Claude-compatible' },
    openai: { baseUrl: 'https://api.example.com/ica/v1', model: 'gpt-x', label: 'OpenAI-compatible' },
  },
  envFallbackEnabled: false,
};

const EMPTY = { ...SAVED, provider: 'mock', baseUrl: null, model: null, hasApiKey: false, updatedAt: null };

beforeEach(() => {
  apiFetch.mockReset();
});

describe('AiSettingsPage', () => {
  it('loads the saved configuration into the form', async () => {
    apiFetch.mockResolvedValueOnce(SAVED);
    render(<AiSettingsPage />);

    expect(await screen.findByDisplayValue('https://api.example.com/ica')).toBeInTheDocument();
    expect(screen.getByDisplayValue('claude-sonnet-5')).toBeInTheDocument();
  });

  it('never prefills the API key, and says a key is saved instead', async () => {
    apiFetch.mockResolvedValueOnce(SAVED);
    render(<AiSettingsPage />);

    const keyInput = await screen.findByLabelText('API key');
    // GET never returns the key, so there is nothing to prefill -- the UI has to say so or it reads
    // as though the saved key was lost.
    expect(keyInput).toHaveValue('');
    expect(keyInput).toHaveAttribute('type', 'password');
    expect(screen.getByText(/A key is saved/i)).toBeInTheDocument();
  });

  it('says so when no key is saved yet', async () => {
    apiFetch.mockResolvedValueOnce({ ...EMPTY, provider: 'claude' });
    render(<AiSettingsPage />);

    expect(await screen.findByText(/No key saved yet/i)).toBeInTheDocument();
  });

  it('omits apiKey from the save when the field is untouched, so the stored key is kept', async () => {
    apiFetch.mockResolvedValueOnce(SAVED); // initial load
    apiFetch.mockResolvedValueOnce(SAVED); // the PUT
    render(<AiSettingsPage />);

    await screen.findByDisplayValue('claude-sonnet-5');
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    const [path, options] = apiFetch.mock.calls[1];
    expect(path).toBe('/me/ai-config');
    expect(options.method).toBe('PUT');
    expect('apiKey' in options.body).toBe(false);
  });

  it('sends a typed key and confirms the save', async () => {
    apiFetch.mockResolvedValueOnce(SAVED);
    apiFetch.mockResolvedValueOnce(SAVED);
    render(<AiSettingsPage />);

    await userEvent.type(await screen.findByLabelText('API key'), 'sk-new-key');
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    expect(apiFetch.mock.calls[1][1].body.apiKey).toBe('sk-new-key');
    expect(await screen.findByText('AI settings saved.')).toBeInTheDocument();
  });

  it('hides the endpoint, model and key for the mock provider and explains why', async () => {
    apiFetch.mockResolvedValueOnce(EMPTY);
    render(<AiSettingsPage />);

    expect(await screen.findByText(/makes no network calls and needs no API key/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('API key')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('API endpoint')).not.toBeInTheDocument();
  });

  it('shows a test failure without treating it as a save failure', async () => {
    apiFetch.mockResolvedValueOnce(SAVED);
    apiFetch.mockResolvedValueOnce({
      ok: false,
      detail: 'The provider rejected this key (HTTP 401).',
      failureCategory: 'PROVIDER_4XX',
    });
    render(<AiSettingsPage />);

    await screen.findByDisplayValue('claude-sonnet-5');
    await userEvent.click(screen.getByRole('button', { name: /Test connection/i }));

    expect(await screen.findByText(/rejected this key/i)).toBeInTheDocument();
    // A failed test must not look like a failed save, and must not have saved anything.
    expect(screen.queryByText('AI settings saved.')).not.toBeInTheDocument();
    expect(apiFetch.mock.calls[1][0]).toBe('/me/ai-config/test');
  });

  it('reports a successful test with its latency', async () => {
    apiFetch.mockResolvedValueOnce(SAVED);
    apiFetch.mockResolvedValueOnce({ ok: true, detail: 'Connected. The provider answered in 812 ms.' });
    render(<AiSettingsPage />);

    await screen.findByDisplayValue('claude-sonnet-5');
    await userEvent.click(screen.getByRole('button', { name: /Test connection/i }));

    expect(await screen.findByText(/answered in 812 ms/i)).toBeInTheDocument();
  });

  it('surfaces a load failure as a page error rather than an empty form', async () => {
    apiFetch.mockRejectedValueOnce(new Error('Network down'));
    render(<AiSettingsPage />);

    expect(await screen.findByText('Network down')).toBeInTheDocument();
  });
});
