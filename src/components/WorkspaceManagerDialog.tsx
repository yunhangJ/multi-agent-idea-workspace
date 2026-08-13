import { useState } from 'react'
import { useWorkspaceStore } from '../store/workspace-store'

interface WorkspaceManagerDialogProps {
  open: boolean
  busy: boolean
  dirty: boolean
  fileName: string | null
  filePath: string | null
  onClose: () => void
  onSave: (saveAs?: boolean) => Promise<boolean>
  onOpen: () => Promise<boolean>
  onCreate: (title: string, idea: string) => Promise<boolean>
  onLoadDemo: () => Promise<boolean>
}

export function WorkspaceManagerDialog({
  open,
  busy,
  dirty,
  fileName,
  filePath,
  onClose,
  onSave,
  onOpen,
  onCreate,
  onLoadDemo,
}: WorkspaceManagerDialogProps) {
  const workspace = useWorkspaceStore((state) => state.workspace)
  const [title, setTitle] = useState('')
  const [idea, setIdea] = useState('')

  if (!open) return null

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="workspace-dialog" role="dialog" aria-modal="true" aria-label="管理 Workspace">
        <div className="dialog-header">
          <div><p className="eyebrow">LOCAL WORKSPACE</p><h2>管理 Workspace</h2></div>
          <button className="icon-button" onClick={onClose} type="button" aria-label="关闭 Workspace 管理">×</button>
        </div>

        <div className="workspace-current">
          <span>当前 Workspace</span>
          <strong>{workspace.title}</strong>
          <small className={dirty ? 'workspace-save-state workspace-save-state--dirty' : 'workspace-save-state'}>
            {dirty ? '● 有尚未保存到工程文件的修改' : '● 工程文件已保存'}
          </small>
          <small className="workspace-file-path">{filePath ?? fileName ?? '尚未关联工程文件；首次保存时将选择路径。'}</small>
          <small>本机自动恢复副本会持续更新，但不能代替独立工程文件。</small>
        </div>

        <div className="workspace-dialog__actions">
          <button className="primary-button workspace-action-button" disabled={busy} onClick={() => void onSave(false)} type="button">保存工程</button>
          <button className="secondary-button workspace-action-button" disabled={busy} onClick={() => void onSave(true)} type="button">工程另存为…</button>
          <button className="secondary-button workspace-action-button" disabled={busy} onClick={async () => { if (await onOpen()) onClose() }} type="button">打开工程…</button>
          <button className="secondary-button workspace-action-button" disabled={busy} onClick={async () => { if (await onLoadDemo()) onClose() }} type="button">载入演示 Workspace</button>
        </div>

        <div className="workspace-create">
          <p className="section-label">创建新的本地 Idea</p>
          <label>名称<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：AI 头脑风暴工作台" /></label>
          <label>初始 Idea<textarea value={idea} onChange={(event) => setIdea(event.target.value)} placeholder="描述你想继续完善的想法……" /></label>
          <div className="dialog-actions">
            <button
              className="primary-button"
              disabled={busy || !title.trim() || !idea.trim()}
              onClick={async () => {
                if (!await onCreate(title, idea)) return
                setTitle('')
                setIdea('')
                onClose()
              }}
              type="button"
            >创建并打开</button>
          </div>
        </div>
      </section>
    </div>
  )
}
