import { useCallback, useEffect, useRef, useState } from 'react'
import { IdeaCanvas } from '../canvas/IdeaCanvas'
import { AssignmentDialog } from '../components/AssignmentDialog'
import { AgentHistoryDialog } from '../components/AgentHistoryDialog'
import { CardEditorDialog } from '../components/CardEditorDialog'
import { AiConnection } from '../components/AiConnection'
import { DiscussionConfirmDialog } from '../components/DiscussionConfirmDialog'
import { Inspector } from '../components/Inspector'
import { RunBar } from '../components/RunBar'
import { SnapshotDialog } from '../components/SnapshotDialog'
import { VersionHistoryDialog } from '../components/VersionHistoryDialog'
import { WorkspaceManagerDialog } from '../components/WorkspaceManagerDialog'
import {
  confirmDiscardUnsavedChanges,
  loadLocalWorkspace,
  openWorkspaceProject,
  saveLocalWorkspace,
  saveWorkspaceProject,
  workspaceDocumentFingerprint,
} from '../services/workspace-persistence'
import { getSnapshotCandidates, getWorkspaceDocument, useWorkspaceStore } from '../store/workspace-store'

export default function App() {
  const [workspaceManagerOpen, setWorkspaceManagerOpen] = useState(false)
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [projectName, setProjectName] = useState<string | null>(null)
  const [projectDirty, setProjectDirty] = useState(true)
  const [projectBusy, setProjectBusy] = useState(false)
  const savedFingerprintRef = useRef<string | null>(null)
  const projectDirtyRef = useRef(true)
  const workspace = useWorkspaceStore((state) => state.workspace)
  const cards = useWorkspaceStore((state) => state.cards)
  const generateSnapshot = useWorkspaceStore((state) => state.generateSnapshot)
  const snapshots = useWorkspaceStore((state) => state.snapshots)
  const openHistory = useWorkspaceStore((state) => state.openHistory)
  const notice = useWorkspaceStore((state) => state.notice)
  const dismissNotice = useWorkspaceStore((state) => state.dismissNotice)
  const importWorkspaceDocument = useWorkspaceStore((state) => state.importWorkspaceDocument)
  const createWorkspace = useWorkspaceStore((state) => state.createWorkspace)
  const resetWorkspace = useWorkspaceStore((state) => state.resetWorkspace)
  const showNotice = useWorkspaceStore((state) => state.showNotice)
  const snapshotCount = getSnapshotCandidates(cards).length

  const saveProject = useCallback(async (saveAs = false) => {
    if (projectBusy) return false
    setProjectBusy(true)
    try {
      const document = getWorkspaceDocument(useWorkspaceStore.getState())
      const result = await saveWorkspaceProject(document, projectPath, saveAs)
      if (!result) return false
      savedFingerprintRef.current = workspaceDocumentFingerprint(result.document)
      setProjectPath(result.path)
      setProjectName(result.name)
      setProjectDirty(false)
      showNotice(result.path ? `工程已保存：${result.name}` : `工程副本已下载：${result.name}`)
      return true
    } catch (reason) {
      showNotice(`工程保存失败：${reason instanceof Error ? reason.message : '未知错误'}`)
      return false
    } finally {
      setProjectBusy(false)
    }
  }, [projectBusy, projectPath, showNotice])

  const openProject = useCallback(async () => {
    if (projectBusy) return false
    if (projectDirty && !await confirmDiscardUnsavedChanges()) return false
    setProjectBusy(true)
    try {
      const result = await openWorkspaceProject()
      if (!result) return false
      savedFingerprintRef.current = workspaceDocumentFingerprint(result.document)
      setProjectPath(result.path)
      setProjectName(result.name)
      importWorkspaceDocument(result.document)
      setProjectDirty(false)
      showNotice(`已打开工程：${result.name}`)
      return true
    } catch (reason) {
      showNotice(`工程打开失败：${reason instanceof Error ? reason.message : '未知错误'}`)
      return false
    } finally {
      setProjectBusy(false)
    }
  }, [importWorkspaceDocument, projectBusy, projectDirty, showNotice])

  const createProject = useCallback(async (title: string, idea: string) => {
    if (projectDirty && !await confirmDiscardUnsavedChanges()) return false
    createWorkspace(title, idea)
    savedFingerprintRef.current = null
    setProjectPath(null)
    setProjectName(null)
    setProjectDirty(true)
    return true
  }, [createWorkspace, projectDirty])

  const loadDemoProject = useCallback(async () => {
    if (projectDirty && !await confirmDiscardUnsavedChanges()) return false
    resetWorkspace()
    savedFingerprintRef.current = null
    setProjectPath(null)
    setProjectName(null)
    setProjectDirty(true)
    return true
  }, [projectDirty, resetWorkspace])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(dismissNotice, 3600)
    return () => window.clearTimeout(timer)
  }, [dismissNotice, notice])

  useEffect(() => {
    projectDirtyRef.current = projectDirty
  }, [projectDirty])

  useEffect(() => {
    const saved = loadLocalWorkspace()
    if (saved) importWorkspaceDocument(saved, true)
    let timer: number | undefined
    const unsubscribe = useWorkspaceStore.subscribe((state) => {
      window.clearTimeout(timer)
      const document = getWorkspaceDocument(state)
      const fingerprint = workspaceDocumentFingerprint(document)
      setProjectDirty(savedFingerprintRef.current === null || fingerprint !== savedFingerprintRef.current)
      timer = window.setTimeout(() => saveLocalWorkspace(document), 250)
    })
    const flushRecoveryCopy = () => saveLocalWorkspace(getWorkspaceDocument(useWorkspaceStore.getState()))
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      flushRecoveryCopy()
      if (!projectDirtyRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.clearTimeout(timer)
      flushRecoveryCopy()
      unsubscribe()
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [importWorkspaceDocument])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      if (event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveProject(event.shiftKey)
      }
      if (event.key.toLowerCase() === 'o') {
        event.preventDefault()
        void openProject()
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [openProject, saveProject])

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="workspace-title">
          <p className="eyebrow">IDEA WORKSPACE</p>
          <div>
            <h1>{workspace.title}</h1>
            <span className="workspace-state"><i />{workspace.subtitle}</span>
          </div>
        </div>
        <div className="topbar__spacer" />
        <AiConnection />
        <button className="secondary-button" onClick={() => setWorkspaceManagerOpen(true)} type="button">▣ Workspace</button>
        <button
          className={projectDirty ? 'secondary-button project-save-button project-save-button--dirty' : 'secondary-button project-save-button'}
          disabled={projectBusy}
          onClick={() => void saveProject(false)}
          title={projectPath ?? projectName ?? '尚未关联工程文件'}
          type="button"
        >
          {projectBusy ? '处理中…' : projectDirty ? '保存工程 *' : '工程已保存'}
        </button>
        <button className="secondary-button" onClick={openHistory} type="button">
          <span>⌘</span> 版本历史 {snapshots.length ? `(${snapshots.length})` : ''}
        </button>
        <button className="snapshot-button" onClick={generateSnapshot} type="button">
          生成 Snapshot <span>{snapshotCount}</span>
        </button>
      </header>

      <main className="workspace-grid">
        <IdeaCanvas />
        <Inspector />
      </main>

      <RunBar />
      <AssignmentDialog />
      <AgentHistoryDialog />
      <DiscussionConfirmDialog />
      <SnapshotDialog />
      <VersionHistoryDialog />
      <CardEditorDialog />
      <WorkspaceManagerDialog
        busy={projectBusy}
        dirty={projectDirty}
        fileName={projectName}
        filePath={projectPath}
        onClose={() => setWorkspaceManagerOpen(false)}
        onCreate={createProject}
        onLoadDemo={loadDemoProject}
        onOpen={openProject}
        onSave={saveProject}
        open={workspaceManagerOpen}
      />

      {notice && (
        <button className="toast" onClick={dismissNotice} type="button">
          <span>✓</span>{notice}<small>点击关闭</small>
        </button>
      )}
    </div>
  )
}
