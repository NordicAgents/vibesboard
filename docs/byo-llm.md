# Bring Your Own LLM (BYO-LLM)

Vibesboard lets each workspace connect its own LLM provider and API key. Agents in that workspace then run on the tenant's credentials instead of the platform default model.

---

## Admin Journey — Configuring a Provider

### 1. Navigate to LLM Providers settings

**Settings → LLM Providers** (`/settings/tenant/llm-providers`)

This page lists all provider configs for the active workspace. A fresh workspace shows an empty state with the note: _"No providers configured. Agents use the platform default model."_

---

### 2. Add a provider

Click **Add Provider**. Fill in the form:

| Field | Description |
|---|---|
| **Label** | Friendly name shown in the UI (e.g. "Our Anthropic Key") |
| **Provider** | `OpenAI`, `Anthropic`, or `OpenAI-Compatible` (covers Groq, Mistral, Together, etc.) |
| **Model ID** | The model string the provider expects (e.g. `claude-sonnet-5`, `gpt-4o`, `llama-3.3-70b-versatile`) |
| **API Key** | Your provider API key — stored encrypted at rest, never returned by the API |
| **Base URL** | _(OpenAI-Compatible only)_ The provider's OpenAI-compatible endpoint (e.g. `https://api.groq.com/openai/v1`) |
| **Set as default** | When checked, all agents in this workspace use this config unless they have an explicit override |

Click **Save Provider**. The config is stored immediately.

---

### 3. Test the connection

Click **Test** on a saved config. The platform makes a 1-token generation call to the provider using the stored credentials and returns either:

- ✅ _"Connection successful!"_
- ❌ _"Connection failed: \<error from provider\>"_

Test before marking a config as default so broken credentials don't silently degrade all agents.

---

### 4. Set a default

Click **Set default** on any config. This marks it as the workspace default — all agents without an explicit `llmConfigId` will use it. Only one config can be default at a time; setting a new one automatically clears the previous.

---

### 5. Enable / Disable

Toggle a config off to pause its use without deleting it. Disabled configs are skipped during model resolution — the runtime falls through to the next available config or the platform default.

---

### 6. Per-agent override _(via API / future UI)_

Each agent row has an optional `llmConfigId` field. When set, that agent always uses the specified config regardless of the workspace default. Useful for:

- Running one agent on a cheaper model for high-volume triage
- Running a premium agent on a different provider
- A/B testing two model configs side by side

---

### 7. Delete a config

Click the trash icon. The config row is removed. Any agent with `llmConfigId` pointing to this config will fall through to the workspace default on next inference.

---

## User Journey — Chatting with an Agent

The BYO-LLM layer is **transparent to end users**. There is no visible change to the chat interface.

### What changes under the hood

| Scenario | Model used |
|---|---|
| Workspace has no provider config | Platform default (`OPENAI_CHAT_MODEL` env var) |
| Workspace has a default config (enabled) | Tenant's configured model via tenant's API key |
| Agent has an explicit `llmConfigId` | That specific config's model, regardless of workspace default |
| Config is disabled / key is invalid | Falls through to platform default (or errors if platform key is also absent) |

### Agent preview (UI)

When a workspace admin previews an agent using the in-app **Agent Builder**, the preview always uses the **platform API key** (`previewToken`), not the tenant config. This ensures preview works even if the tenant's key has quota issues, and avoids billing tenant keys for internal testing.

---

## Resolution Order (runtime)

```
runAgentStream(agent, messages)
  │
  ├─ previewToken set?  ──yes──▶ platform model (OPENAI_CHAT_MODEL)
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

---

## Secret Storage

API keys are **never stored in plaintext**. They are encrypted with AES (CryptoJS) using the `ENCRYPTION_KEY` environment variable before being written to the `api_key_encrypted` column in the `tenant_llm_configs` table. The same encryption scheme is used for OAuth tokens across calendar and channel integrations.

The key is decrypted in-process at inference time and never returned through the API — `GET /api/tenants/llm-configs` omits the key field entirely.

---

## Supported Providers

| Kind | Use for |
|---|---|
| `openai` | OpenAI API (GPT-4o, o3, etc.) with your own key |
| `anthropic` | Anthropic API (Claude Sonnet, Opus, Haiku) |
| `openai_compatible` | Any OpenAI-compatible endpoint: Groq, Mistral, Together AI, Ollama, LM Studio, etc. |

---

## Feature Flag

BYO-LLM is gated by the `BYO_LLM` feature flag. Platform admins can disable it per-tenant via the feature toggles table. When disabled, the settings page and API routes should be blocked (guard not yet enforced in the current implementation — tracked as a follow-up).

---

## Follow-ups

- [ ] Gate `/settings/tenant/llm-providers` and API routes behind `BYO_LLM` feature flag check
- [ ] Per-agent `llmConfigId` picker in the Agent Builder UI
- [ ] Per-task routing (`chat`, `*` wildcard) so different agent tasks can use different configs
- [ ] Migrate secret storage to AWS Secrets Manager for production hardening
- [ ] Add `provider` + `configId` columns to `usage_counters` for per-provider cost attribution
- [ ] Health metrics (success rate, last error) per config
