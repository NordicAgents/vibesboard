declare module 'openai-edge' {
  export { Configuration, OpenAIApi } from 'openai-edge/types/index'
  export type {
    CreateChatCompletionRequest,
    CreateCompletionRequest,
    CreateEmbeddingRequest,
    CreateImageRequest,
    CreateModerationRequest
  } from 'openai-edge/types/index'
}
