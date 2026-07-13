# Bring Your Own LLM (BYO-LLM)

Vibesboard lets each workspace connect its own LLM provider and API key. Agents in that workspace then run on the tenant's credentials instead of the platform default model. Embeddings for RAG (file indexing and search) also route through the tenant's configured provider.

---

## Admin Journey — Configuring a Provider

### 1. Navigate to LLM Providers settings

**Settings → LLM Providers** (`/settings/tenant/llm-providers`)

This page lists all provider configs for the active workspace. A fresh workspace shows an empty state: _"No providers configured. Agents use the platform default model."_

---

### 2. Add a provider

Click **Add Provider**. Fill in the form:

| Field | Description |
|---|---|
| **Label** | Friendly name shown in the UI (e.g. "Our Anthropic Key") |
| **Provider** | `OpenAI`, `Anthropic`, `Google Gemini`, or `OpenAI-Compatible` (Groq, Mistral, Together, etc.) |
| **Model** | Dropdown of official model IDs for the selected provider (★ = recommended). "Custom model ID…" at the bottom for unlisted models. |
| **API Key** | Your provider API key — stored encrypted at rest, never returned by the API |
| **Base URL** | _(OpenAI-Compatible only)_ The provider's endpoint (e.g. `https://api.groq.com/openai/v1`). Private/internal addresses are rejected. |
| **Set as default** | When checked, all agents in this workspace use this config unless they have an explicit override |

Click **Save Provider**. The config is stored immediately.

---

### 3. Test the connection

Click **Test** on a saved config. The platform makes a 1-token generation call to the provider and returns either:

- ✅ _"Connection successful!"_
- ❌ A sanitised error (e.g. _"Authentication failed — check your API key"_)

Test before marking a config as default so broken credentials don't silently degrade agents.

---

### 4. Edit a config

Click the **pencil icon** on any config to update its label, model, or provider. Leave the API key field blank to keep the existing stored key; type a new one to rotate it.

---

### 5. Set a default

Click **Set default**. Only one config can be default at a time; setting a new one automatically clears the previous. All agents without an explicit `llmConfigId` will use it.

---

### 6. Enable / Disable

Toggle a config off to pause its use without deleting it. Disabled configs are skipped during model resolution — the runtime falls through to the next available config or the platform default.

---

### 7. Per-agent override _(API only, UI coming)_

Each agent has an optional `llmConfigId` field. When set, that agent always uses the specified config regardless of the workspace default. Useful for routing different agents to different models (e.g. cheap model for high-volume triage, premium model for complex tasks).

---

### 8. Re-embed files when switching provider

When you change your default provider, existing file embeddings are in a different vector space and will return poor RAG results. The Knowledge tab shows an amber warning when it detects stale embeddings. Click **Re-embed files** to re-index all files using the current provider.

---

### 9. Delete a config

Click the trash icon. The config row is removed. Any agent pointing to this config falls through to the workspace default on next inference.

---

## User Journey — Chatting with an Agent

The BYO-LLM layer is **transparent to end users**. There is no visible change to the chat interface.

### What changes under the hood

| Scenario | Model used |
|---|---|
| Workspace has no provider config | Platform default (`OPENAI_CHAT_MODEL` env var) |
| Workspace has a default config (enabled) | Tenant's configured model via tenant's API key |
| Agent has an explicit `llmConfigId` | That specific config's model, regardless of workspace default |
| Config is disabled / key is invalid | Falls through to platform default |

### Agent Builder

The Agent Builder (`/agents/create-chat`) also uses the tenant's configured provider — not the platform key. If no tenant config is set, it falls back to the platform `OPENAI_API_KEY`.

### Agent preview

When a workspace admin previews an agent using the **Live Preview** panel, the preview always uses the **platform API key** (`previewToken`), not the tenant config. This ensures preview works even if the tenant's key has quota issues.

---

## Resolution Order (runtime)

### Chat

```
runAgentStream(agent, messages)
  │
  ├─ previewToken set? ──yes──▶ platform model (OPENAI_CHAT_MODEL)
  │
  └─ no ──▶ resolveProviderSpec(agent.tenantId, agent.llmConfigId)
              │
              ├─ agent.llmConfigId set + config found + enabled?
              │     └──yes──▶ use that config's model
              │
              ├─ tenant has isDefault=true + enabled config?
              │     └──yes──▶ use that config's model
              │
              └─ no match ──▶ platform model (OPENAI_CHAT_MODEL)
```

### Embeddings (RAG + file indexing)

```
resolveEmbedder(tenantId)
  │
  ├─ tenant default config is openai/openai_compatible?
  │     └──▶ OpenAI Embeddings API with tenant key
  │
  ├─ tenant default config is google?
  │     └──▶ Google text-embedding-004 via native API
  │          (falls back to platform key if embedding model unavailable)
  │
  ├─ tenant default config is anthropic?
  │     └──▶ Anthropic has no embedding API — platform key fallback
  │
  └─ no config ──▶ platform OPENAI_API_KEY
```

**Important:** If you switch the tenant's default provider, existing file embeddings are in a different vector space. Use the **Re-embed files** button on the Knowledge tab to re-index all files.

---

## Secret Storage

API keys are **never stored in plaintext**. They are encrypted with AES (CryptoJS) using the `ENCRYPTION_KEY` environment variable before being written to `api_key_encrypted` in `tenant_llm_configs`. The same scheme is used for OAuth tokens across calendar and channel integrations.

The key is decrypted in-process at inference time via the `CredStore` interface (`seal` / `unseal` / `revoke`). The current implementation is `EncryptedDbCredStore` — swap the export in `packages/ai/src/cred-store/index.ts` to switch to AWS Secrets Manager or Vault with no other code changes.

Keys are never returned by the API — `GET /api/tenants/llm-configs` omits the `apiKeyEncrypted` column entirely.

---

## Supported Providers

| Kind | Chat | Embeddings | Notes |
|---|---|---|---|
| `openai` | ✅ | ✅ `text-embedding-3-small` | Standard OpenAI API |
| `anthropic` | ✅ | ❌ Platform fallback | Anthropic has no embedding API |
| `google` | ✅ | ✅ `text-embedding-004` | Some API keys may not have embedding access; falls back to platform key |
| `openai_compatible` | ✅ | ✅ (if endpoint supports `/embeddings`) | Groq, Mistral, Together AI, Ollama, LM Studio, etc. |

Override the Google embedding model via `GOOGLE_EMBEDDING_MODEL` env var.

---

## Security

### SSRF protection on baseUrl
`openai_compatible` configs accept a tenant-supplied `baseUrl`. The API validates it at save time and again at fetch time — private IP ranges (`10.x`, `192.168.x`, `169.254.x` IMDS, localhost, link-local IPv6) are rejected. Only HTTP and HTTPS are accepted.

### Test-connection error sanitisation
The `/test` endpoint returns sanitised error messages (e.g. "Authentication failed"). Raw provider error bodies (which could expose internal service content) are logged server-side only.

---

## Feature Flag

BYO-LLM is gated by the `BYO_LLM` feature flag (defaults **on**). Platform admins can disable it per-tenant via the feature toggles table. When disabled, the nav item is hidden and all API routes return 403.

---

## Follow-ups

- [ ] Per-agent `llmConfigId` picker in the Agent Builder UI
- [ ] Per-task routing (`chat`, `*` wildcard) so different agent tasks can use different configs
- [ ] Migrate secret storage to AWS Secrets Manager for production hardening
- [ ] Add `provider` + `configId` columns to `usage_counters` for per-provider cost attribution
- [ ] Health metrics (success rate, last error) per config
- [ ] DNS rebinding protection on baseUrl (current guard is IP-based, not post-resolution)
