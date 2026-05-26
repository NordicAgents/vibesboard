export interface DataFieldMapping {
  collectionFieldId: string
  targetColumn: string
}

export interface DataConfig {
  fieldMappings: DataFieldMapping[]
  updateKeyField?: string | null
  allowQuery: boolean
  allowDelete: boolean
  autoSubmitOnComplete: boolean
}
