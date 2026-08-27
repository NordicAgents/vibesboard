export interface AgentOption {
  id: string
  name: string
  mode: string
}

export type HandoffAgentModeFilter = 'all' | 'provider' | 'collector'

export function filterHandoffAgents(
  agents: AgentOption[],
  query: string,
  mode: HandoffAgentModeFilter
): AgentOption[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()

  return agents.filter(agent => {
    const matchesMode = mode === 'all' || agent.mode === mode
    const matchesQuery =
      normalizedQuery === '' ||
      agent.name.toLocaleLowerCase().includes(normalizedQuery)

    return matchesMode && matchesQuery
  })
}
