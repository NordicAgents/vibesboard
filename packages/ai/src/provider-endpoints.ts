/**
 * Provider endpoint constants.
 *
 * Kept in a leaf module with no imports: both provider-registry.ts (chat models)
 * and tenant-llm-config.ts (embedders) need these, and provider-registry already
 * imports from tenant-llm-config, so defining them in either would create a
 * circular import.
 */

// NVIDIA API Catalog (build.nvidia.com) hosted endpoint — OpenAI-compatible.
// Serves /chat/completions and /embeddings; it has no /responses endpoint.
export const NVIDIA_API_BASE_URL = 'https://integrate.api.nvidia.com/v1'
