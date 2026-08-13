interface FilesResponse {
  files?: Array<{ fileKey?: unknown }>
  error?: unknown
}

async function responseError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => ({}))) as FilesResponse
  return typeof payload.error === 'string' ? payload.error : fallback
}

export async function fetchAgentFileKeys(agentId: string): Promise<string[]> {
  const response = await fetch(`/api/agents/${agentId}/files?limit=1000`)
  if (!response.ok) {
    throw new Error(await responseError(response, 'Failed to load files'))
  }

  const payload = (await response.json()) as FilesResponse
  return Array.from(
    new Set(
      (payload.files ?? [])
        .map(file => file.fileKey)
        .filter(
          (key): key is string => typeof key === 'string' && key.length > 0
        )
    )
  )
}

export async function deleteAgentFile(
  agentId: string,
  fileKey: string
): Promise<void> {
  const response = await fetch(`/api/agents/${agentId}/files/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileKey })
  })
  if (!response.ok) {
    throw new Error(await responseError(response, 'Failed to delete file'))
  }
}
