import { openai } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

/**
 * AI SDK 6 routes bare string model IDs (e.g. `openai/gpt-5.5`) through the
 * Vercel AI Gateway, which requires a Vercel project. We want direct provider
 * access via OPENAI_API_KEY, so resolve the string into a concrete provider
 * model instance here.
 */
export function resolveModel(modelString: string): LanguageModel {
  if (modelString.startsWith('openai/')) {
    // @ai-sdk/openai@2.x ships LanguageModelV2; ai@6-beta.128 also accepts
    // V2/V3 but its TypeScript types come from a different copy of
    // @ai-sdk/provider in node_modules. Runtime is wire-compatible — the
    // cast just bridges the type identity.
    return openai(modelString.slice('openai/'.length)) as unknown as LanguageModel;
  }
  // Bare string falls through to AI SDK's default provider routing
  // (the gateway when configured).
  return modelString;
}
