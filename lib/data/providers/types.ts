export interface AppendRowResult {
  success: boolean
  externalRef?: string // row number, Airtable record ID, etc.
}

export interface UpdateRowResult {
  success: boolean
  externalRef?: string
  matched: boolean // whether a matching row was found
}

export interface QueryRowsResult {
  rows: Record<string, any>[]
  totalMatched: number
}

export interface DeleteRowResult {
  success: boolean
  matched: boolean
}

export interface DataProvider {
  appendRow(data: Record<string, any>): Promise<AppendRowResult>
  updateRow(
    keyField: string,
    keyValue: string,
    data: Record<string, any>
  ): Promise<UpdateRowResult>
  queryRows?(
    keyField: string,
    keyValue: string,
    limit?: number
  ): Promise<QueryRowsResult>
  deleteRow?(
    keyField: string,
    keyValue: string
  ): Promise<DeleteRowResult>
  testConnection(): Promise<{ ok: boolean; error?: string }>
}
