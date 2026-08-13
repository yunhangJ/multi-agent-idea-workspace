import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { CSSProperties, DragEvent } from 'react'
import { agentRoleProfiles } from '../domain/agent-profiles'
import type { AgentId, AgentStatus } from '../domain/types'
import { useWorkspaceStore } from '../store/workspace-store'

export type AgentNodeData = {
  agentId: AgentId
  name: string
  role: string
  description: string
  status: AgentStatus
  accent: string
  outputCount: number
  memoryCount: number
  zoneTitle?: string
  active: boolean
}

export type AgentFlowNode = Node<AgentNodeData, 'agent'>

const icons: Record<AgentId, string> = {
  explorer: '✦',
  critic: '◇',
  simplifier: '↝',
}

const statusLabels: Record<AgentStatus, string> = {
  idle: '待命',
  queued: '排队中',
  running: '思考中',
  needs_user: '等待确认',
  completed: '已完成',
  interrupted: '已中断',
  failed: '失败',
}

export function AgentNode({ data }: NodeProps<AgentFlowNode>) {
  const profile = agentRoleProfiles[data.agentId]
  const acceptCards = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('application/x-idea-card-ids')) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
  }

  const receiveCards = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const cardIds = event.dataTransfer
      .getData('application/x-idea-card-ids')
      .split(',')
      .filter(Boolean)
    useWorkspaceStore.getState().openAssignment(data.agentId, cardIds)
  }

  return (
    <div
      className={`board-agent-card${data.active ? ' board-agent-card--active' : ''}${data.zoneTitle ? ' board-agent-card--shared' : ''}`}
      data-agent-id={data.agentId}
      onDragOver={acceptCards}
      onDrop={receiveCards}
      style={{ '--agent-accent': data.accent } as CSSProperties}
    >
      <Handle className="flow-handle flow-handle--agent" type="source" position={Position.Bottom} />
      <div className="board-agent-card__topline">
        <span className="board-agent-card__icon">{icons[data.agentId]}</span>
        <span className={`board-agent-card__status board-agent-card__status--${data.status}`}>
          <i />{statusLabels[data.status]}
        </span>
      </div>
      <div className="board-agent-card__identity">
        <strong>{data.name}</strong>
        <span>{data.role}</span>
      </div>
      <p>{profile.shortDescription}</p>
      <div className="board-agent-card__footer">
        <span>{data.zoneTitle ? `当前共享 · ${data.zoneTitle}` : `独立处理 · 私有历史 ${data.memoryCount}`}</span>
        <button
          className="nodrag"
          onClick={(event) => {
            event.stopPropagation()
            useWorkspaceStore.getState().openAgentHistory(data.agentId)
          }}
          type="button"
        >历史 {data.memoryCount}</button>
      </div>
    </div>
  )
}
