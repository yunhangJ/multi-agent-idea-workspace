import { type Node, type NodeProps } from '@xyflow/react'
import type { FileCard } from '../domain/types'
import { useWorkspaceStore } from '../store/workspace-store'

export type FileCardNodeData = {
  file: FileCard
  zoneTitle?: string
}

export type FileCardFlowNode = Node<FileCardNodeData, 'file-card'>

const fileIcons: Record<FileCard['fileType'], string> = {
  markdown: 'MD',
  pdf: 'PDF',
  text: 'TXT',
}

export function FileCardNode({ data }: NodeProps<FileCardFlowNode>) {
  return (
    <article
      className={`flow-file-card${data.zoneTitle ? ' flow-file-card--shared' : ''}`}
      data-file-id={data.file.id}
      onPointerDown={(event) => {
        if (event.button === 0) useWorkspaceStore.getState().selectFile(data.file.id)
      }}
    >
      <div className="flow-file-card__topline">
        <span>{fileIcons[data.file.fileType]}</span>
        <small>{data.file.sizeLabel}</small>
      </div>
      <h3>{data.file.name}</h3>
      <p>{data.file.summary}</p>
      <div className="flow-file-card__footer">
        <span>{data.zoneTitle ? `当前共享 · ${data.zoneTitle}` : '本地文件 · 未共享'}</span>
      </div>
    </article>
  )
}
