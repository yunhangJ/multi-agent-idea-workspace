import { isTauri } from '@tauri-apps/api/core'
import { confirm, open, save } from '@tauri-apps/plugin-dialog'
import { readFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { MAX_CUSTOM_INSTRUCTION_LENGTH } from '../domain/agent-profiles'
import type { FileCard, Run, WorkspaceDocument } from '../domain/types'

const STORAGE_KEY = 'idea-workspace.document.v1'
const MAX_TEXT_CHARACTERS = 300_000
export const MAX_WORKSPACE_FILE_BYTES = 25 * 1024 * 1024

export interface WorkspaceProjectFile {
  document: WorkspaceDocument
  path: string | null
  name: string
}

export function loadLocalWorkspace(): WorkspaceDocument | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    return isWorkspaceDocument(value) ? value : null
  } catch {
    return null
  }
}

export function saveLocalWorkspace(document: WorkspaceDocument) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(document))
    return true
  } catch {
    return false
  }
}

export function downloadWorkspace(document: WorkspaceDocument) {
  const name = `${safeFileName(document.workspace.title)}.idea-workspace.json`
  const blob = new Blob([serializeWorkspaceDocument(document)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = window.document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
  return name
}

export async function readWorkspaceFile(file: File): Promise<WorkspaceDocument> {
  if (file.size > MAX_WORKSPACE_FILE_BYTES) throw new Error('工程文件超过 25 MB，已拒绝打开。')
  return parseWorkspaceText(await file.text())
}

export function serializeWorkspaceDocument(document: WorkspaceDocument) {
  return JSON.stringify(document, null, 2)
}

export function workspaceDocumentFingerprint(document: WorkspaceDocument) {
  const { savedAt: _savedAt, ...content } = document
  return JSON.stringify(content)
}

export function parseWorkspaceText(text: string): WorkspaceDocument {
  if (new TextEncoder().encode(text).byteLength > MAX_WORKSPACE_FILE_BYTES) {
    throw new Error('工程文件超过 25 MB，已拒绝打开。')
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('工程文件不是有效的 JSON。')
  }
  if (!isWorkspaceDocument(value)) throw new Error('这不是有效的 Idea Workspace 工程文件。')
  return value
}

export async function saveWorkspaceProject(
  document: WorkspaceDocument,
  currentPath: string | null,
  saveAs = false,
): Promise<WorkspaceProjectFile | null> {
  if (!isTauri()) {
    const name = downloadWorkspace(document)
    return { document, path: null, name }
  }

  let path = saveAs ? null : currentPath
  if (!path) {
    path = await save({
      title: saveAs ? '工程另存为' : '保存工程',
      defaultPath: currentPath ?? `${safeFileName(document.workspace.title)}.idea-workspace.json`,
      filters: [{ name: 'Idea Workspace 工程', extensions: ['json'] }],
    })
  }
  if (!path) return null
  if (!path.toLowerCase().endsWith('.json')) path += '.idea-workspace.json'
  await writeTextFile(path, serializeWorkspaceDocument(document))
  return { document, path, name: fileNameFromPath(path) }
}

export async function openWorkspaceProject(): Promise<WorkspaceProjectFile | null> {
  if (!isTauri()) {
    const file = await pickBrowserWorkspaceFile()
    if (!file) return null
    return { document: await readWorkspaceFile(file), path: null, name: file.name }
  }

  const selected = await open({
    title: '打开 Idea Workspace 工程',
    multiple: false,
    directory: false,
    filters: [{ name: 'Idea Workspace 工程', extensions: ['json'] }],
  })
  if (!selected || Array.isArray(selected)) return null
  const bytes = await readFile(selected)
  if (bytes.byteLength > MAX_WORKSPACE_FILE_BYTES) throw new Error('工程文件超过 25 MB，已拒绝打开。')
  const document = parseWorkspaceText(new TextDecoder().decode(bytes))
  return { document, path: selected, name: fileNameFromPath(selected) }
}

export async function confirmDiscardUnsavedChanges() {
  const message = '当前工程有尚未保存到工程文件的修改。继续操作不会删除本地恢复副本，但工程文件不会包含这些修改。是否继续？'
  if (!isTauri()) return window.confirm(message)
  return confirm(message, { title: '尚未保存的工程修改', kind: 'warning' })
}

export async function createFileCard(file: File, index: number): Promise<FileCard> {
  const extension = file.name.split('.').pop()?.toLowerCase()
  const fileType = extension === 'md' || extension === 'markdown'
    ? 'markdown'
    : extension === 'txt'
      ? 'text'
      : extension === 'pdf'
        ? 'pdf'
        : null
  if (!fileType) throw new Error(`${file.name}：目前只支持 Markdown、TXT 和 PDF。`)

  let contentText: string | undefined
  let parseStatus: FileCard['parseStatus'] = 'metadata_only'
  let summary = '文件已加入本地 Workspace，尚未提取正文。'
  if (fileType !== 'pdf') {
    try {
      const fullText = await file.text()
      contentText = fullText.slice(0, MAX_TEXT_CHARACTERS)
      parseStatus = 'ready'
      summary = fullText.length > MAX_TEXT_CHARACTERS
        ? `已读取前 ${MAX_TEXT_CHARACTERS.toLocaleString('zh-CN')} 个字符。`
        : `已读取 ${fullText.length.toLocaleString('zh-CN')} 个字符。`
    } catch {
      parseStatus = 'failed'
      summary = '文本读取失败，可以移除后重新导入。'
    }
  } else {
    summary = 'PDF 已作为真实文件加入；当前前端只保存元数据，正文解析将在模型接入阶段完成。'
  }

  return {
    id: `file-${Date.now().toString(36)}-${index}`,
    name: file.name,
    fileType,
    mimeType: file.type || (fileType === 'pdf' ? 'application/pdf' : 'text/plain'),
    sizeLabel: formatBytes(file.size),
    summary,
    contentText,
    parseStatus,
    lastModified: file.lastModified,
    position: { x: 980 + (index % 3) * 250, y: 390 + Math.floor(index / 3) * 160 },
  }
}

export function isWorkspaceDocument(value: unknown): value is WorkspaceDocument {
  if (!value || typeof value !== 'object') return false
  const document = value as Partial<WorkspaceDocument>
  return document.version === 1
    && Boolean(document.workspace
      && typeof document.workspace.id === 'string'
      && typeof document.workspace.title === 'string'
      && typeof document.workspace.subtitle === 'string')
    && Array.isArray(document.agents) && document.agents.every(hasPositionAndId)
    && Array.isArray(document.cards) && document.cards.every(hasPositionAndId)
    && Array.isArray(document.files)
    && Array.isArray(document.discussionZones) && document.discussionZones.every(hasPositionAndId)
    && Array.isArray(document.discussionRuns)
    && Array.isArray(document.agentMemories)
    && Array.isArray(document.runs) && document.runs.every(hasValidCustomInstruction)
    && Array.isArray(document.relations)
    && Array.isArray(document.snapshots)
    && hasUniqueIds(document.agents)
    && hasUniqueIds(document.cards)
    && hasUniqueIds(document.files)
}

function hasValidCustomInstruction(value: unknown): value is Run {
  if (!value || typeof value !== 'object') return false
  const instruction = (value as Partial<Run>).customInstruction
  return instruction === undefined
    || (typeof instruction === 'string' && instruction.length <= MAX_CUSTOM_INSTRUCTION_LENGTH)
}

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Idea Workspace'
}

function hasPositionAndId(value: unknown) {
  if (!value || typeof value !== 'object') return false
  const item = value as { id?: unknown; position?: { x?: unknown; y?: unknown } }
  return typeof item.id === 'string'
    && Boolean(item.id)
    && Boolean(item.position)
    && typeof item.position?.x === 'number'
    && Number.isFinite(item.position.x)
    && typeof item.position?.y === 'number'
    && Number.isFinite(item.position.y)
}

function hasUniqueIds(items: Array<{ id: string }>) {
  return new Set(items.map((item) => item.id)).size === items.length
}

function fileNameFromPath(path: string) {
  return path.split(/[\\/]/).at(-1) || 'Idea Workspace.idea-workspace.json'
}

function pickBrowserWorkspaceFile() {
  return new Promise<File | null>((resolve) => {
    const input = window.document.createElement('input')
    input.type = 'file'
    input.accept = '.json,.idea-workspace.json'
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.addEventListener('cancel', () => resolve(null), { once: true })
    input.click()
  })
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
