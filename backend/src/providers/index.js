import * as mockProvider from './mockProvider.js';
import * as claudeProvider from './claudeProvider.js';
import * as openaiProvider from './openaiProvider.js';
import { REQUIRED_PROVIDER_METHODS, OPTIONAL_PROVIDER_METHODS } from './aiProvider.interface.js';
import { UnsupportedProviderError } from '../lib/errors.js';
import { env } from '../config/env.js';

// constants/enums.js#AI_PROVIDERS documents the full set the app knows about; this map
// is what's actually callable. claude/openai only construct their SDK clients lazily
// inside generateQuiz/gradeShortAnswer, so registering them here has no effect (no
// eager network calls, no key-presence checks) unless AI_PROVIDER actually selects one.
//
const providers = {
  mock: mockProvider,
  claude: claudeProvider,
  openai: openaiProvider,
};

function assertImplementsInterface(name, providerModule) {
  const missing = REQUIRED_PROVIDER_METHODS.filter((method) => typeof providerModule[method] !== 'function');
  if (missing.length > 0) {
    throw new Error(`Provider "${name}" is missing required method(s): ${missing.join(', ')}`);
  }
}

/**
 * Resolve a provider, with the credentials it should use already bound to it.
 *
 * `runtime` is the per-user configuration from services/aiConfigService.js, or null for `mock`.
 * Binding it into the returned object -- rather than threading it through every layer -- is what
 * let credentials become per-user without a single downstream call site changing shape:
 * batchRunner.js:25, quizScoringService.js:104/120 and attempts.controller.js still call
 * `provider.generateQuiz(params)` and have no idea credentials exist.
 *
 * @param {string} [override] provider name; falls back to AI_PROVIDER, then 'mock'
 * @param {object|null} [runtime] resolved AI runtime config
 */
export function getProvider(override, runtime = null) {
  const name = override || env.aiProvider || 'mock';
  const providerModule = providers[name];

  if (!providerModule) {
    throw new UnsupportedProviderError(name);
  }

  assertImplementsInterface(name, providerModule);

  const bound = {};
  for (const method of [...REQUIRED_PROVIDER_METHODS, ...OPTIONAL_PROVIDER_METHODS]) {
    if (typeof providerModule[method] !== 'function') continue;
    bound[method] = (params) => providerModule[method](params, runtime);
  }

  // `runtime` itself is deliberately NOT spread onto the result. This object is passed around the
  // generation layer and appears in diagnostics, and it must never be one console.log away from
  // printing an API key. Only the model name is exposed, because the worker needs it for
  // QuizGeneration.model -- which is what replaced the old env-reading modelNameFor().
  return { name, ...providerModule, ...bound, modelName: runtime?.model ?? null };
}
