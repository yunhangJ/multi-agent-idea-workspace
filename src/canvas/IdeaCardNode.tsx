import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { CSSProperties } from 'react'
import type { CardStatus, CardType, IdeaCard } from '../domain/types'
import { useWorkspaceStore } from '../store/workspace-store'

export type IdeaCardNodeData = {
  card: IdeaCard
  opacity: number
  zoneTitle?: string
}

export type IdeaCardFlowNode = Node<IdeaCardNodeData, 'idea-card'>

const typeLabels: Record<CardType, string> = {
  idea: 'IDEA',
  question: 'QUESTION',
  assumption: 'ASSUMPTION',
  decision: 'DECISION',
}

const statusLabels: Record<CardStatus, string> = {
  unreviewed: '待审核',
  kept: '保留',
  uncertain: '存疑',
  rejected: '已排除',
  decided: '已决定',
}

const creatorLabels = {
  user: '你',
  explorer: 'Explorer',
  critic: 'Critic',
  simplifier: 'Simplifier',
}

export function IdeaCardNode({ data, selected }: NodeProps<IdeaCardFlowNode>) {
  const { card, opacity } = data
  return (
    <article
      className={`flow-idea-card flow-idea-card--${card.type}${card.sourceDiscussionRunId ? ' flow-idea-card--discussion' : ''}${selected ? ' flow-idea-card--selected' : ''}${data.zoneTitle ? ' flow-idea-card--shared' : ''}`}
      data-card-id={card.id}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        const state = useWorkspaceStore.getState()
        const additive = event.shiftKey || event.ctrlKey || event.metaKey
        if (!additive) {
          if (state.selectedCardIds.length !== 1 || state.selectedCardIds[0] !== card.id) {
            state.selectCards([card.id])
          }
          return
        }
        state.selectCards(
          state.selectedCardIds.includes(card.id)
            ? state.selectedCardIds.filter((id) => id !== card.id)
            : [...state.selectedCardIds, card.id],
        )
      }}
      style={{ '--card-opacity': opacity } as CSSProperties}
    >
      <Handle className="flow-handle" type="target" position={Position.Top} />
      <div className="flow-idea-card__topline">
        <span>{typeLabels[card.type]}</span>
        <small>{statusLabels[card.status]}</small>
      </div>
      <h3>{card.title}</h3>
      <p>{card.content}</p>
      <div className="flow-idea-card__footer">
        <span>{creatorLabels[card.creator]}</span>
        <span>{data.zoneTitle ? '当前讨论共享' : card.parentCardIds.length ? `${card.parentCardIds.length} 张来源` : '根节点'}</span>
      </div>
      <Handle className="flow-handle" type="source" position={Position.Bottom} />
    </article>
  )
}
