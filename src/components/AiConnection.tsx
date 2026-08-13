import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  browserPreviewAiStatus,
  clearAiRuntimeConfig,
  configureAiRuntime,
  fetchAiModels,
  getAiRuntimeStatus,
  isDesktopRuntime,
  testAiConnection,
  type AiAuthMode,
  type AiProtocol,
  type AiRuntimeConfig,
  type AiRuntimeStatus,
} from '../services/ai-runtime'

type AiRuntimeDraft = Omit<AiRuntimeConfig, 'apiKey'>
type RuntimePresetId = 'openai-responses' | 'openai-chat-completions' | 'custom'

const PREFERENCE_KEY = 'idea-workspace.ai-runtime.preferences.v1'

const protocolLabels: Record<AiProtocol, string> = {
  'openai-chat-completions': 'OpenAI Chat Completions 兼容',
  'openai-responses': 'OpenAI Responses 兼容',
}

const presetDrafts: Record<Exclude<RuntimePresetId, 'custom'>, AiRuntimeDraft> = {
  'openai-responses': {
    authMode: 'bearer',
    protocol: 'openai-responses',
    requestUrl: 'https://api.openai.com/v1/responses',
    modelsUrl: 'https://api.openai.com/v1/models',
    model: 'gpt-5.6',
    jsonMode: true,
    thinking: false,
  },
  'openai-chat-completions': {
    authMode: 'bearer',
    protocol: 'openai-chat-completions',
    requestUrl: 'https://api.openai.com/v1/chat/completions',
    modelsUrl: 'https://api.openai.com/v1/models',
    model: 'gpt-5.6',
    jsonMode: true,
    thinking: false,
  },
}

const defaultDraft = presetDrafts['openai-responses']

function isProtocol(value: unknown): value is AiProtocol {
  return value === 'openai-chat-completions' || value === 'openai-responses'
}

function isAuthMode(value: unknown): value is AiAuthMode {
  return value === 'bearer' || value === 'none'
}

function loadPreferences(): AiRuntimeDraft {
  try {
    const raw = window.localStorage.getItem(PREFERENCE_KEY)
    if (!raw) return { ...defaultDraft }
    const value = JSON.parse(raw) as Partial<AiRuntimeDraft>
    if (
      !isAuthMode(value.authMode)
      || !isProtocol(value.protocol)
      || typeof value.requestUrl !== 'string'
      || typeof value.modelsUrl !== 'string'
      || typeof value.model !== 'string'
      || typeof value.jsonMode !== 'boolean'
      || typeof value.thinking !== 'boolean'
    ) return { ...defaultDraft }
    return {
      authMode: value.authMode,
      protocol: value.protocol,
      requestUrl: value.requestUrl,
      modelsUrl: value.modelsUrl,
      model: value.model,
      jsonMode: value.jsonMode,
      thinking: value.protocol === 'openai-chat-completions' && value.thinking,
    }
  } catch {
    return { ...defaultDraft }
  }
}

function savePreferences(draft: AiRuntimeDraft) {
  try {
    // Deliberately persist only non-secret preferences. API keys never enter localStorage.
    const safePreferences: AiRuntimeDraft = {
      authMode: draft.authMode,
      protocol: draft.protocol,
      requestUrl: draft.requestUrl,
      modelsUrl: draft.modelsUrl,
      model: draft.model,
      jsonMode: draft.jsonMode,
      thinking: draft.thinking,
    }
    window.localStorage.setItem(PREFERENCE_KEY, JSON.stringify(safePreferences))
  } catch {
    // A blocked localStorage must not prevent the desktop runtime from being configured.
  }
}

function presetForDraft(draft: AiRuntimeDraft): RuntimePresetId {
  for (const presetId of ['openai-responses', 'openai-chat-completions'] as const) {
    const presetDraft = presetDrafts[presetId]
    if (
      draft.authMode === presetDraft.authMode
      && draft.protocol === presetDraft.protocol
      && draft.requestUrl === presetDraft.requestUrl
      && draft.modelsUrl === presetDraft.modelsUrl
      && draft.model === presetDraft.model
      && draft.jsonMode === presetDraft.jsonMode
      && draft.thinking === presetDraft.thinking
    ) return presetId
  }
  return 'custom'
}

function draftFromStatus(status: AiRuntimeStatus): AiRuntimeDraft {
  return {
    authMode: status.authMode,
    protocol: status.protocol,
    requestUrl: status.requestUrl,
    modelsUrl: status.modelsUrl,
    model: status.model,
    jsonMode: status.jsonMode,
    thinking: status.protocol === 'openai-chat-completions' && status.thinking,
  }
}

function draftFromConfig(config: AiRuntimeConfig): AiRuntimeDraft {
  return {
    authMode: config.authMode,
    protocol: config.protocol,
    requestUrl: config.requestUrl,
    modelsUrl: config.modelsUrl,
    model: config.model,
    jsonMode: config.jsonMode,
    thinking: config.thinking,
  }
}

function errorMessage(reason: unknown) {
  if (reason instanceof Error) return reason.message
  if (typeof reason === 'string') return reason
  if (reason && typeof reason === 'object' && 'message' in reason && typeof reason.message === 'string') {
    return reason.message
  }
  return 'AI 服务操作失败，请检查请求地址、协议、模型名和认证信息。'
}

function normalized(value: string) {
  return value.trim().replace(/\/+$/, '')
}

export function AiConnection() {
  const desktop = isDesktopRuntime()
  const [status, setStatus] = useState<AiRuntimeStatus>(browserPreviewAiStatus)
  const [draft, setDraft] = useState<AiRuntimeDraft>(loadPreferences)
  const [preset, setPreset] = useState<RuntimePresetId>(() => presetForDraft(draft))
  const [apiKey, setApiKey] = useState('')
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [loading, setLoading] = useState(desktop)
  const [fetchingModels, setFetchingModels] = useState(false)
  const [open, setOpen] = useState(false)
  const [actionMessage, setActionMessage] = useState<string | null>(null)

  const applyStatus = useCallback((nextStatus: AiRuntimeStatus) => {
    setStatus(nextStatus)
    if (nextStatus.configured) {
      const nextDraft = draftFromStatus(nextStatus)
      setDraft(nextDraft)
      setPreset(presetForDraft(nextDraft))
      savePreferences(nextDraft)
    }
  }, [])

  const refresh = useCallback(async (openWhenMissing = false) => {
    setApiKey('')
    setLoading(true)
    try {
      const nextStatus = await getAiRuntimeStatus()
      applyStatus(nextStatus)
      if (openWhenMissing && desktop && !nextStatus.configured) setOpen(true)
    } catch (reason) {
      setStatus({ ...browserPreviewAiStatus, message: errorMessage(reason) })
      if (openWhenMissing && desktop) setOpen(true)
    } finally {
      setLoading(false)
    }
  }, [applyStatus, desktop])

  useEffect(() => {
    void refresh(true)
  }, [refresh])

  const hasReusableKey = useMemo(() => (
    status.configured
    && Boolean(status.keyHint)
    && draft.authMode === status.authMode
    && draft.protocol === status.protocol
    && normalized(draft.requestUrl) === normalized(status.requestUrl)
    && normalized(draft.modelsUrl) === normalized(status.modelsUrl)
  ), [draft.authMode, draft.modelsUrl, draft.protocol, draft.requestUrl, status])

  const makeConfig = useCallback((): AiRuntimeConfig => ({
    ...draft,
    apiKey: draft.authMode === 'bearer' ? apiKey.trim() : '',
    requestUrl: draft.requestUrl.trim(),
    modelsUrl: draft.modelsUrl.trim(),
    model: draft.model.trim(),
    thinking: draft.protocol === 'openai-chat-completions' && draft.thinking,
  }), [apiKey, draft])

  const validateConfig = useCallback((purpose: 'save' | 'models') => {
    if (!draft.requestUrl.trim()) return '请填写请求地址。'
    if (purpose === 'models' && !draft.modelsUrl.trim()) return '请填写模型列表地址。'
    if (purpose === 'save' && !draft.model.trim()) return '请填写模型名，或先获取模型列表。'
    if (draft.authMode === 'bearer' && !apiKey.trim() && !hasReusableKey) {
      return '当前协议、地址或认证方式没有可复用的 Key，请重新填写 API Key。'
    }
    return null
  }, [apiKey, draft, hasReusableKey])

  const updateDraft = <Key extends keyof AiRuntimeDraft>(key: Key, value: AiRuntimeDraft[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }))
    if (key === 'requestUrl' || key === 'modelsUrl' || key === 'authMode') setApiKey('')
    setPreset('custom')
  }

  const applyPreset = (nextPreset: RuntimePresetId) => {
    setPreset(nextPreset)
    setAvailableModels([])
    setActionMessage(null)
    if (nextPreset !== 'custom') {
      setApiKey('')
      setDraft({ ...presetDrafts[nextPreset] })
    }
  }

  const closeDialog = () => {
    setApiKey('')
    setOpen(false)
  }

  const saveAndTest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!desktop) return
    const validationError = validateConfig('save')
    if (validationError) {
      setActionMessage(validationError)
      return
    }

    setLoading(true)
    setActionMessage('正在把配置交给本机后端并测试连接…')
    try {
      const config = makeConfig()
      const configured = await configureAiRuntime(config)
      setApiKey('')
      applyStatus(configured)
      savePreferences(draftFromConfig(config))
      const nextStatus = await testAiConnection()
      applyStatus(nextStatus)
      setApiKey('')
      setActionMessage(nextStatus.message || '模型列表地址访问成功；请求地址将在实际生成时验证。')
    } catch (reason) {
      setActionMessage(errorMessage(reason))
      await refresh(false)
    } finally {
      setLoading(false)
    }
  }

  const loadModels = async () => {
    if (!desktop) return
    const validationError = validateConfig('models')
    if (validationError) {
      setActionMessage(validationError)
      return
    }

    setFetchingModels(true)
    setActionMessage('正在从模型列表地址读取可用模型…')
    try {
      const result = await fetchAiModels(makeConfig())
      const models = Array.from(new Set(result.models.map((item) => item.trim()).filter(Boolean)))
      setAvailableModels(models)
      if (!draft.model.trim() && models[0]) updateDraft('model', models[0])
      setActionMessage(result.message || `已从 ${result.sourceUrl} 获取 ${models.length} 个模型。`)
    } catch (reason) {
      setActionMessage(errorMessage(reason))
    } finally {
      setFetchingModels(false)
    }
  }

  const clearConfig = async () => {
    if (!desktop) return
    setLoading(true)
    setActionMessage(null)
    try {
      const nextStatus = await clearAiRuntimeConfig()
      setStatus(nextStatus)
      setApiKey('')
      setActionMessage('本次应用进程中的 API Key 和运行配置已清除；非秘密的表单偏好仍保留在本机。')
    } catch (reason) {
      setActionMessage(errorMessage(reason))
    } finally {
      setLoading(false)
    }
  }

  const busy = loading || fetchingModels
  const stateClass = loading
    ? 'runtime-chip--loading'
    : status.configured && status.verified
      ? 'runtime-chip--connected'
      : 'runtime-chip--offline'

  return (
    <>
      <button className={`runtime-chip ${stateClass}`} onClick={() => setOpen(true)} type="button">
        <i />
        {loading
          ? '检查 AI 服务'
          : !desktop
            ? '浏览器预览'
            : status.configured && status.verified
              ? '模型列表已验证'
              : status.configured
                ? 'AI 未验证'
                : '连接 AI 服务'}
      </button>

      {open && (
        <div className="runtime-dialog-backdrop" role="presentation">
          <section className="runtime-dialog runtime-dialog--wide" role="dialog" aria-modal="true" aria-label="AI 服务设置">
            <div className="runtime-dialog__header">
              <div className="runtime-logo runtime-logo--generic">AI</div>
              <div>
                <p className="eyebrow">AI RUNTIME</p>
                <h2>连接模型服务或中转站</h2>
              </div>
              <button className="icon-button" onClick={closeDialog} type="button" aria-label="关闭 AI 设置">×</button>
            </div>

            <div className={`runtime-state ${status.configured && status.verified ? 'runtime-state--connected' : ''}`}>
              <span>{status.configured && status.verified ? '✓' : desktop ? '!' : '◌'}</span>
              <div>
                <strong>
                  {loading
                    ? '正在处理连接'
                    : !desktop
                      ? '浏览器预览模式'
                      : status.configured && status.verified
                        ? `模型列表可访问 · ${status.model}${status.keyHint ? ` · ${status.keyHint}` : ''}`
                        : status.configured
                          ? '配置已进入本机内存，但尚未验证'
                          : '尚未配置 AI 服务'}
                </strong>
                <p>{status.message}</p>
              </div>
            </div>

            <dl className="runtime-details runtime-details--compact">
              <div><dt>协议</dt><dd>{protocolLabels[status.protocol]}</dd></div>
              <div><dt>当前模型</dt><dd>{status.model || '未设置'}</dd></div>
              <div><dt>活动请求</dt><dd>{status.activeRunCount}</dd></div>
              <div><dt>凭据保存</dt><dd>仅当前进程内存</dd></div>
            </dl>

            <form className="runtime-config-form" onSubmit={(event) => void saveAndTest(event)}>
              {!desktop && (
                <div className="runtime-preview-note">
                  <strong>浏览器预览不会发送请求</strong>
                  <p>可以检查表单布局，但获取模型、保存和测试功能只在安装后的桌面应用中可用。</p>
                </div>
              )}

              <label className="runtime-field">
                <span>快速预设</span>
                <select disabled={busy} onChange={(event) => applyPreset(event.target.value as RuntimePresetId)} value={preset}>
                  <option value="openai-responses">OpenAI 官方 · Responses</option>
                  <option value="openai-chat-completions">OpenAI 官方 · Chat Completions</option>
                  <option value="custom">自定义 / 中转站</option>
                </select>
                <small>预设只负责填入推荐值；协议、地址和模型名都可以继续修改。</small>
              </label>

              <div className="runtime-field-grid">
                <label className="runtime-field">
                  <span>请求协议</span>
                  <select
                    disabled={busy}
                    onChange={(event) => {
                      const protocol = event.target.value as AiProtocol
                      setDraft((current) => ({
                        ...current,
                        protocol,
                        thinking: protocol === 'openai-chat-completions' && current.thinking,
                      }))
                      setApiKey('')
                      setPreset('custom')
                    }}
                    value={draft.protocol}
                  >
                    <option value="openai-chat-completions">OpenAI Chat Completions</option>
                    <option value="openai-responses">OpenAI Responses</option>
                  </select>
                </label>

                <label className="runtime-field">
                  <span>认证方式</span>
                  <select disabled={busy} onChange={(event) => updateDraft('authMode', event.target.value as AiAuthMode)} value={draft.authMode}>
                    <option value="bearer">Bearer API Key</option>
                    <option value="none">无认证</option>
                  </select>
                </label>
              </div>

              <label className="runtime-field">
                <span>请求地址</span>
                <input
                  disabled={busy}
                  onChange={(event) => updateDraft('requestUrl', event.target.value)}
                  placeholder="https://example.com/v1/chat/completions"
                  spellCheck={false}
                  type="url"
                  value={draft.requestUrl}
                />
                <small>填写完整接口地址，不是控制台首页或仅包含域名的地址。</small>
              </label>

              <div className="runtime-model-row">
                <label className="runtime-field">
                  <span>模型列表地址</span>
                  <input
                    disabled={busy}
                    onChange={(event) => updateDraft('modelsUrl', event.target.value)}
                    placeholder="https://example.com/v1/models"
                    spellCheck={false}
                    type="url"
                    value={draft.modelsUrl}
                  />
                </label>
                <button className="secondary-button runtime-fetch-models" disabled={busy || !desktop} onClick={() => void loadModels()} type="button">
                  {fetchingModels ? '获取中…' : '获取模型列表'}
                </button>
              </div>

              <label className="runtime-field">
                <span>模型名</span>
                <input
                  disabled={busy}
                  list="ai-runtime-model-options"
                  onChange={(event) => updateDraft('model', event.target.value)}
                  placeholder="输入模型 ID，或先获取模型列表"
                  spellCheck={false}
                  value={draft.model}
                />
                <datalist id="ai-runtime-model-options">
                  {availableModels.map((model) => <option key={model} value={model} />)}
                </datalist>
                <small>{availableModels.length ? `已读取 ${availableModels.length} 个可选模型，也可以手动输入其他模型 ID。` : '模型名始终可手动编辑。'}</small>
              </label>

              <label className="runtime-field">
                <span>API Key</span>
                <input
                  autoComplete="new-password"
                  disabled={busy || draft.authMode === 'none'}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={draft.authMode === 'none' ? '当前认证方式不使用 Key' : hasReusableKey ? '留空则沿用当前地址在本次运行中的 Key' : '请填写当前服务的 API Key'}
                  spellCheck={false}
                  type="password"
                  value={apiKey}
                />
                <small>提交后，Key 只由本机 Rust 后端保存在进程内存中，不写入工程文件或 localStorage。更换协议、地址或认证方式后必须重新输入。</small>
              </label>

              <div className="runtime-toggle-grid">
                <label className="runtime-thinking-toggle">
                  <input checked={draft.jsonMode} disabled={busy} onChange={(event) => updateDraft('jsonMode', event.target.checked)} type="checkbox" />
                  <span><strong>JSON mode</strong><small>要求服务返回可解析的结构化结果。</small></span>
                </label>

                <label className={`runtime-thinking-toggle ${draft.protocol !== 'openai-chat-completions' ? 'runtime-thinking-toggle--disabled' : ''}`}>
                  <input
                    checked={draft.thinking}
                    disabled={busy || draft.protocol !== 'openai-chat-completions'}
                    onChange={(event) => updateDraft('thinking', event.target.checked)}
                    type="checkbox"
                  />
                  <span><strong>Thinking</strong><small>仅 Chat Completions 协议可用，服务端也必须支持。</small></span>
                </label>
              </div>

              <div className="runtime-security-warning">
                <strong>中转站安全提醒</strong>
                <p>如果填写第三方中转地址，该中转站会收到你的 API Key 和发送给 Agent 的全部授权内容。只使用你信任的服务，并自行确认其隐私政策。</p>
              </div>

              {actionMessage && <p className="runtime-action-message" role="status">{actionMessage}</p>}

              <div className="runtime-dialog__actions">
                {status.configured && desktop && (
                  <button className="secondary-button runtime-clear-button" disabled={busy} onClick={() => void clearConfig()} type="button">清除内存配置</button>
                )}
                <button className="secondary-button" disabled={busy || !desktop} onClick={() => void refresh(false)} type="button">刷新状态</button>
                <button className="primary-button" disabled={busy || !desktop} type="submit">{loading ? '测试中…' : '保存并测试模型列表'}</button>
              </div>
            </form>

            <p className="runtime-footnote">关闭应用后 Key 会从内存消失，下次启动需要重新填写；地址、协议和模型等非秘密偏好会保存在本机。</p>
          </section>
        </div>
      )}
    </>
  )
}
