const LOCAL_APP_URL = 'http://localhost:3000'

export function resolveAppUrl(value: string | undefined): URL {
  return new URL(value?.trim() || LOCAL_APP_URL)
}
