import * as mockProvider from './mockProvider.js';
import * as claudeProvider from './claudeProvider.js';
import * as openaiProvider from './openaiProvider.js';
import { REQUIRED_PROVIDER_METHODS } from './aiProvider.interface.js';
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

export function getProvider(override) {
  const name = override || env.aiProvider || 'mock';
  const providerModule = providers[name];

  if (!providerModule) {
    throw new UnsupportedProviderError(name);
  }

  assertImplementsInterface(name, providerModule);
  return { name, ...providerModule };
}
