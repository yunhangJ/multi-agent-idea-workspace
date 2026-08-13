import { invoke, isTauri } from '@tauri-apps/api/core'
import type { CardType } from '../domain/types'

export type AiProtocol = 'openai-chat-completions' | 'openai-responses'
export type AiAuthMode = 'bearer' | 'none'

export interface AiRuntimeConfig {
  /** Empty means reuse the key already held by the current Rust process. */
  apiKey: string
  authMode: AiAuthMode
  protocol: AiProtocol
  requestUrl: string
  modelsUrl: string
  model: string
  jsonMode: boolean
  thinking: boolean
}

export interface AiRuntimeStatus {
  configured: boolean
  verified: boolean
  authMode: AiAuthMode
  protocol: AiProtocol
  requestUrl: string
  modelsUrl: string
  model: string
  jsonMode: boolean
  thinking: boolean
  keyHint?: string
  activeRunCount: number
  message: string
}

export interface AiModelListResult {
  models: string[]
  sourceUrl: string
  message: string
}

export interface AiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AiOutputCard {
  type: CardType
  title: string
  content: string
}

export interface AiUsage {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

export interface AiRunRequest {
  runId: string
  messages: AiMessage[]
  maxTokens?: number
  temperature?: number
}

export interface AiRunResult {
  cards: AiOutputCard[]
  privateSummary?: string
  /** Compatibility with early local runtime builds. */
  summary?: string
  usage?: AiUsage
  model?: string
  protocol?: AiProtocol
}

export const browserPreviewAiStatus: AiRuntimeStatus = {
  configured: false,
  verified: false,
  authMode: 'bearer',
  protocol: 'openai-responses',
  requestUrl: 'https://api.openai.com/v1/responses',
  modelsUrl: 'https://api.openai.com/v1/models',
  model: 'gpt-5.6',
  jsonMode: true,
  thinking: false,
  activeRunCount: 0,
  message: '浏览器预览不会发送真实 AI 请求。请启动桌面版后配置服务。',
}

export function isDesktopRuntime() {
  return isTauri()
}

function desktopOnlyError() {
  return new Error('真实 AI 运行仅在桌面版中可用。浏览器预览不会发送 API 请求。')
}

export async function getAiRuntimeStatus() {
  if (!isDesktopRuntime()) return browserPreviewAiStatus
  return invoke<AiRuntimeStatus>('get_ai_runtime_status')
}

export async function configureAiRuntime(config: AiRuntimeConfig) {
  if (!isDesktopRuntime()) throw desktopOnlyError()
  const result = await invoke<AiRuntimeStatus | null>('configure_ai_runtime', { config })
  return result ?? getAiRuntimeStatus()
}

export async function clearAiRuntimeConfig() {
  if (!isDesktopRuntime()) throw desktopOnlyError()
  const result = await invoke<AiRuntimeStatus | null>('clear_ai_runtime_config')
  return result ?? getAiRuntimeStatus()
}

export async function fetchAiModels(config: AiRuntimeConfig) {
  if (!isDesktopRuntime()) throw desktopOnlyError()
  return invoke<AiModelListResult>('fetch_ai_models', { config })
}

export async function testAiConnection() {
  if (!isDesktopRuntime()) throw desktopOnlyError()
  const result = await invoke<AiRuntimeStatus | string | null>('test_ai_connection')
  if (typeof result === 'string') {
    const status = await getAiRuntimeStatus()
    return { ...status, message: result }
  }
  return result ?? getAiRuntimeStatus()
}

export async function runAiRequest(request: AiRunRequest) {
  if (!isDesktopRuntime()) throw desktopOnlyError()
  return invoke<AiRunResult>('run_ai_request', { request })
}

export async function cancelAiRun(runId: string) {
  if (!isDesktopRuntime()) return false
  return invoke<boolean>('cancel_ai_run', { runId })
}
