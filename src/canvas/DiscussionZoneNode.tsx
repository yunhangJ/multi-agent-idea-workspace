import { type Node, type NodeProps } from '@xyflow/react'
import type { AgentStatus, DiscussionStatus } from '../domain/types'
import { useWorkspaceStore } from '../store/workspace-store'

export type DiscussionZoneNodeData = {
  zoneId: string
  title: string
  description: string
  status: DiscussionStatus
  width: number
  height: number
  agentCount: number
  cardCount: number
  fileCount: number
  memoryCount: number
  blockedHistoryCount: number
  activeRunId?: string
  activeRunStatus?: AgentStatus
  dragActive: boolean
}

export type DiscussionZoneFlowNode = Node<DiscussionZoneNodeData, 'discussion-zone'>

const statusLabels: Record<DiscussionStatus, string> = {
  draft: '等待组合',
  ready: '可以开始',
  running: '讨论中',
  completed: '本轮完成',
}

export function DiscussionZoneNode({ data }: NodeProps<DiscussionZoneFlowNode>) {
  const canStart = data.agentCount >= 2 && data.cardCount + data.fileCount > 0
  const running = data.activeRunStatus === 'running'
  const retryable = data.activeRunStatus === 'interrupted' || data.activeRunStatus === 'failed'

  return (
    <section
      className={`discussion-zone discussion-zone--${data.status}${data.dragActive ? ' discussion-zone--drag-active' : ''}`}
      data-zone-id={data.zoneId}
      style={{ width: data.width, height: data.height }}
    >
      <div className="discussion-zone__header">
        <div>
          <span className="discussion-zone__eyebrow">SHARED SESSION ZONE</span>
          <h2>{data.title}</h2>
          <p>{data.description}</p>
        </div>
        <span className="discussion-zone__status"><i />{statusLabels[data.status]}</span>
      </div>

      <div className="discussion-zone__empty-message">
        <strong>把对象拖进这张桌子</strong>
        <span>卡片中心进入边界后加入；移出后恢复独立处理。</span>
      </div>

      <div className="discussion-zone__footer">
        <div className="discussion-zone__counts">
          <span><b>{data.agentCount}</b> Agent</span>
          <span><b>{data.cardCount}</b> Idea</span>
          <span><b>{data.fileCount}</b> 文件</span>
        </div>
        <div className="discussion-zone__privacy">
          <strong>上下文边界</strong>
          <span>当前区内共享 · 本人历史 {data.memoryCount} 条 · 他人历史读取 0 条</span>
          {data.blockedHistoryCount > 0 && <small>已隔离 {data.blockedHistoryCount} 条其他 Agent 历史</small>}
        </div>
        <button
          className="nodrag"
          disabled={!running && !retryable && !canStart}
          onClick={(event) => {
            event.stopPropagation()
            const store = useWorkspaceStore.getState()
            if (running && data.activeRunId) store.interruptDiscussion(data.activeRunId)
            else if (retryable && data.activeRunId) store.retryDiscussion(data.activeRunId)
            else store.startDiscussion(data.zoneId)
          }}
          type="button"
        >
          {running ? '中断讨论' : retryable ? '重试讨论' : data.status === 'completed' ? '再次讨论' : '开始讨论'}
        </button>
      </div>
    </section>
  )
}
