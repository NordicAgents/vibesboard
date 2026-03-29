export interface AppendRowResult {
  success: boolean
  externalRef?: string // row number, Airtable record ID, etc.
}

export interface UpdateRowResult {
  success: boolean
  externalRef?: string
  matched: boolean // whether a matching row was found
}

export interface DataProvider {
  appendRow(data: Record<string, any>): Promise<AppendRowResult>
  updateRow(
    keyField: string,
    keyValue: string,
    data: Record<string, any>
  ): Promise<UpdateRowResult>
  testConnection(): Promise<{ ok: boolean; error?: string }>
}
