import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { ErrorBanner, LoadingIndicator, PageError, SuccessBanner } from '../components/AsyncState.jsx';

const INPUT_CLASS =
  'mt-1 w-full rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500';
const LABEL_CLASS = 'block text-sm font-medium text-slate-700';
const HINT_CLASS = 'mt-1 text-xs text-slate-400';

/**
 * Per-user AI provider configuration.
 *
 * The API key field always renders empty, because GET /api/me/ai-config never returns the key --
 * only `hasApiKey`. So "leave it blank to keep the saved one" is not a convenience, it is the only
 * possible contract, and the UI has to say so plainly or it reads as though the key was lost.
 */
export default function AiSettingsPage() {
  const [config, setConfig] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const [provider, setProvider] = useState('mock');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);
  // Distinguishes "left blank, keep the saved key" from "explicitly remove the saved key", which
  // the backend tells apart by an absent vs empty-string apiKey.
  const [clearKey, setClearKey] = useState(false);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [savedNotice, setSavedNotice] = useState(null);
  const [error, setError] = useState(null);

  const applyConfig = useCallback((data) => {
    setConfig(data);
    setProvider(data.provider);
    setBaseUrl(data.baseUrl ?? '');
    setModel(data.model ?? '');
    setHasApiKey(data.hasApiKey);
    setApiKey('');
    setClearKey(false);
  }, []);

  useEffect(() => {
    apiFetch('/me/ai-config').then(applyConfig).catch((err) => setLoadError(err.message));
  }, [applyConfig]);

  // Any edit invalidates both banners: they describe what is saved on the server, and the form no
  // longer matches it.
  const touched = () => {
    setSavedNotice(null);
    setTestResult(null);
    setError(null);
  };

  const isMock = provider === 'mock';

  const requestBody = () => ({
    provider,
    ...(isMock ? {} : { baseUrl: baseUrl.trim() || undefined, model: model.trim() || undefined }),
    // undefined -> keep stored, '' -> clear, string -> replace.
    ...(apiKey ? { apiKey } : clearKey ? { apiKey: '' } : {}),
  });

  const handleSave = async (event) => {
    event.preventDefault();
    setError(null);
    setSavedNotice(null);
    setSaving(true);
    try {
      const data = await apiFetch('/me/ai-config', { method: 'PUT', body: requestBody() });
      // Re-seeding from the response also clears apiKey out of React state, so the plaintext does
      // not sit in memory any longer than the request needed it.
      applyConfig(data);
      setSavedNotice('AI settings saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setError(null);
    setTestResult(null);
    setTesting(true);
    try {
      // Sends whatever is currently typed, so a key can be verified before it is saved. An omitted
      // apiKey means "test the one already stored".
      const result = await apiFetch('/me/ai-config/test', {
        method: 'POST',
        body: {
          provider,
          ...(isMock ? {} : { baseUrl: baseUrl.trim() || undefined, model: model.trim() || undefined }),
          ...(apiKey ? { apiKey } : {}),
        },
      });
      setTestResult(result);
    } catch (err) {
      // A 4xx here is our own validation rejecting the endpoint or a missing key -- that message is
      // already written for a human, so it belongs in the test slot rather than the save slot.
      setTestResult({ ok: false, detail: err.message });
    } finally {
      setTesting(false);
    }
  };

  const handleRemoveKey = () => {
    touched();
    setApiKey('');
    setClearKey(true);
  };

  if (loadError) return <PageError message={loadError} />;
  if (!config) return <LoadingIndicator label="Loading your AI settings..." fullPage />;

  const placeholder = config.defaults?.[provider] ?? {};

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <form onSubmit={handleSave} className="space-y-5 rounded-lg bg-white p-5 shadow sm:p-8">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">AI settings</h1>
          <p className="mt-1 text-sm text-slate-500">
            Quizzes are generated with your own AI account. Your key is encrypted on the server and is never
            shown again after you save it.
          </p>
        </div>

        {savedNotice && <SuccessBanner message={savedNotice} />}
        {error && <ErrorBanner message={error} />}

        <div>
          <label className={LABEL_CLASS} htmlFor="ai-provider">
            Provider
          </label>
          <select
            id="ai-provider"
            value={provider}
            onChange={(e) => {
              touched();
              setProvider(e.target.value);
            }}
            className={INPUT_CLASS}
          >
            {config.providers.map((name) => (
              <option key={name} value={name}>
                {config.defaults?.[name]?.label ?? name}
              </option>
            ))}
          </select>
        </div>

        {isMock ? (
          <p className="rounded bg-slate-50 px-3 py-2 text-sm text-slate-600">
            The mock provider makes no network calls and needs no API key. Use it to try the app out, or when
            you have run out of quota.
          </p>
        ) : (
          <>
            <div>
              <label className={LABEL_CLASS} htmlFor="ai-base-url">
                API endpoint
              </label>
              <input
                id="ai-base-url"
                type="url"
                value={baseUrl}
                onChange={(e) => {
                  touched();
                  setBaseUrl(e.target.value);
                }}
                placeholder={placeholder.baseUrl ?? ''}
                className={INPUT_CLASS}
              />
              <p className={HINT_CLASS}>
                Must be https. Leave blank to use the provider&apos;s own default endpoint.
              </p>
            </div>

            <div>
              <label className={LABEL_CLASS} htmlFor="ai-model">
                Model
              </label>
              <input
                id="ai-model"
                type="text"
                value={model}
                onChange={(e) => {
                  touched();
                  setModel(e.target.value);
                }}
                placeholder={placeholder.model ?? ''}
                className={INPUT_CLASS}
              />
              <p className={HINT_CLASS}>
                Leave blank to use {placeholder.model ?? 'the provider default'}.
              </p>
            </div>

            <div>
              <label className={LABEL_CLASS} htmlFor="ai-key">
                API key
              </label>
              <input
                id="ai-key"
                type="password"
                autoComplete="new-password"
                value={apiKey}
                onChange={(e) => {
                  touched();
                  setClearKey(false);
                  setApiKey(e.target.value);
                }}
                placeholder={hasApiKey && !clearKey ? '••••••••  (saved)' : ''}
                className={INPUT_CLASS}
              />
              {clearKey ? (
                <p className="mt-1 text-xs text-amber-600">
                  The saved key will be removed when you save.
                </p>
              ) : hasApiKey ? (
                <p className={HINT_CLASS}>
                  A key is saved. Leave this blank to keep it, or type a new one to replace it.{' '}
                  <button
                    type="button"
                    onClick={handleRemoveKey}
                    className="underline hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-500"
                  >
                    Remove saved key
                  </button>
                </p>
              ) : (
                <p className={HINT_CLASS}>No key saved yet.</p>
              )}
            </div>
          </>
        )}

        {testResult &&
          (testResult.ok ? (
            <SuccessBanner message={testResult.detail} />
          ) : (
            <ErrorBanner message={testResult.detail} />
          ))}

        {config.lastTestedAt && !testResult && (
          <p className="text-xs text-slate-400">
            Last tested {new Date(config.lastTestedAt).toLocaleString()} &mdash;{' '}
            {config.lastTestStatus === 'OK' ? 'connected' : 'failed'}
          </p>
        )}

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || saving}
            className="rounded border border-slate-300 px-4 py-2 text-slate-700 hover:bg-slate-50 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-slate-500"
          >
            {testing ? 'Testing...' : 'Test connection'}
          </button>
          <button
            type="submit"
            disabled={saving || testing}
            className="flex-1 rounded bg-slate-800 px-4 py-2 text-white hover:bg-slate-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-slate-500"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>

        {config.envFallbackEnabled && (
          <p className={HINT_CLASS}>
            This server is running with a development fallback enabled, so generation may work even without a
            saved key. That is off in production.
          </p>
        )}
      </form>
    </div>
  );
}
