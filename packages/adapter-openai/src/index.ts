// @vibesboard/adapter-openai — wraps the OpenAI Responses API + a legacy
// chat-completions shim used by widget and embedding code paths.
//
// The current code talks to OpenAI via direct fetch (no SDK dep). When a
// future phase wires this through the IAIProvider port in @vibesboard/contracts,
// the implementation here is what backs the OpenAI variant of that port.
//
// Phase 4 keeps the existing API surface (completeText, streamText,
// chatCompletion, createEmbedding, OPENAI_MODEL, ...) verbatim.

export * from './openai.ts'
export * from './openai-compat.ts'
