/**
 * Suggested endpoint and model per provider, shown as placeholders on the AI Settings page.
 *
 * Deliberately NOT read from config/env.js. In production the ANTHROPIC_* and OPENAI_* vars are unset
 * (per-user credentials are the only source), so sourcing placeholders from env would show every
 * user an empty form with no hint of what a valid endpoint even looks like.
 *
 * These are hints, not defaults that get used: a user who saves nothing here gets `baseUrl: null`
 * and the provider SDK's own default endpoint. The model fallback below IS used when a user saves a
 * provider but no model, so it must name a model that actually exists on the gateway.
 *
 * Keep the model values in step with config/env.js's `anthropic.model` / `openai.model` fallbacks.
 * They disagreed with backend/.env.example before this file existed, which meant the form could
 * have suggested a model name the server would never have used.
 */
export const AI_PROVIDER_DEFAULTS = {
  mock: {
    baseUrl: null,
    model: null,
    label: 'Mock (no API key needed)',
  },
  claude: {
    baseUrl: 'https://api.nextgen-beta.ica.ibm.com/ica',
    model: 'claude-sonnet-5',
    label: 'Anthropic / Claude-compatible',
  },
  openai: {
    baseUrl: 'https://api.nextgen-beta.ica.ibm.com/ica/v1',
    model: 'gpt-5.6-terra-dzus',
    label: 'OpenAI-compatible',
  },
};

/** The model to use when a user has chosen a provider but left the model field blank. */
export function defaultModelFor(provider) {
  return AI_PROVIDER_DEFAULTS[provider]?.model ?? null;
}
