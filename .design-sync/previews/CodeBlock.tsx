import { CodeBlock } from '@vibesboard/web'

const wrap: React.CSSProperties = { padding: 16, maxWidth: 620 }

const agentConfig = `{
  "name": "Support assistant",
  "model": "gpt-5.4-nano",
  "channels": ["whatsapp", "instagram"],
  "knowledge": {
    "sources": ["product-handbook.pdf", "help.acme.com"],
    "rag": true
  },
  "handoff": {
    "afterFailedAnswers": 3,
    "to": "human"
  }
}`

const curlSnippet = `curl https://api.vibesboard.ai/v1/agents/support/messages \\
  -H "Authorization: Bearer vb_live_8x2Kd9..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "channel": "whatsapp",
    "from": "+46701234567",
    "text": "When does my order ship?"
  }'`

export function AgentConfig() {
  return (
    <div style={wrap}>
      <CodeBlock language="json" value={agentConfig} />
    </div>
  )
}

export function ApiRequest() {
  return (
    <div style={wrap}>
      <CodeBlock language="shell" value={curlSnippet} />
    </div>
  )
}
