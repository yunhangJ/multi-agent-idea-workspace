import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  type Edge,
  type NodeChange,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentId, IdeaCard, RelationType } from '../domain/types'
import { FileImportButton } from '../components/FileImportButton'
import { useWorkspaceStore } from '../store/workspace-store'
import { AgentNode, type AgentFlowNode } from './AgentNode'
import { DiscussionZoneNode, type DiscussionZoneFlowNode } from './DiscussionZoneNode'
import { FileCardNode, type FileCardFlowNode } from './FileCardNode'
import { IdeaCardNode, type IdeaCardFlowNode } from './IdeaCardNode'

type WorkspaceFlowNode = AgentFlowNode | IdeaCardFlowNode | FileCardFlowNode | DiscussionZoneFlowNode

const nodeTypes = {
  agent: AgentNode,
  'discussion-zone': DiscussionZoneNode,
  'file-card': FileCardNode,
  'idea-card': IdeaCardNode,
}

const agentButtons: Array<{ id: AgentId; label: string }> = [
  { id: 'explorer', label: 'Explorer' },
  { id: 'critic', label: 'Critic' },
  { id: 'simplifier', label: 'Simplifier' },
]

const relationLabels: Record<RelationType, string> = {
  derived_from: '延伸',
  critiques: '批评',
  answers: '回答',
  merges: '融合',
  contradicts: '相反',
  compares: '比较',
  discusses: '讨论输入',
}

const relationColors: Record<RelationType, string> = {
  derived_from: '#8790a4',
  critiques: '#e66a57',
  answers: '#7b58b4',
  merges: '#5262d7',
  contradicts: '#d55b78',
  compares: '#5567c8',
  discusses: '#2c8a73',
}

function cardNodeId(cardId: string) {
  return `card:${cardId}`
}

function agentNodeId(agentId: AgentId) {
  return `agent:${agentId}`
}

function fileNodeId(fileId: string) {
  return `file:${fileId}`
}

function zoneNodeId(zoneId: string) {
  return `zone:${zoneId}`
}

function getDraggedMember(node: WorkspaceFlowNode) {
  if (node.type === 'agent') return { kind: 'agent' as const, id: node.data.agentId, size: { width: 250, height: 158 } }
  if (node.type === 'idea-card') return { kind: 'card' as const, id: node.data.card.id, size: { width: 228, height: 178 } }
  if (node.type === 'file-card') return { kind: 'file' as const, id: node.data.file.id, size: { width: 220, height: 128 } }
  return null
}

export function IdeaCanvas() {
  const agents = useWorkspaceStore((state) => state.agents)
  const cards = useWorkspaceStore((state) => state.cards)
  const files = useWorkspaceStore((state) => state.files)
  const discussionZones = useWorkspaceStore((state) => state.discussionZones)
  const discussionRuns = useWorkspaceStore((state) => state.discussionRuns)
  const agentMemories = useWorkspaceStore((state) => state.agentMemories)
  const relations = useWorkspaceStore((state) => state.relations)
  const selectedCardIds = useWorkspaceStore((state) => state.selectedCardIds)
  const selectedAgentId = useWorkspaceStore((state) => state.selectedAgentId)
  const selectCards = useWorkspaceStore((state) => state.selectCards)
  const deleteCards = useWorkspaceStore((state) => state.deleteCards)
  const selectFile = useWorkspaceStore((state) => state.selectFile)
  const updateCardPositions = useWorkspaceStore((state) => state.updateCardPositions)
  const updateAgentPositions = useWorkspaceStore((state) => state.updateAgentPositions)
  const updateFilePositions = useWorkspaceStore((state) => state.updateFilePositions)
  const syncZoneMembership = useWorkspaceStore((state) => state.syncZoneMembership)
  const focusAgent = useWorkspaceStore((state) => state.focusAgent)
  const openAssignment = useWorkspaceStore((state) => state.openAssignment)
  const mergeSelectedCards = useWorkspaceStore((state) => state.mergeSelectedCards)
  const compareSelectedCards = useWorkspaceStore((state) => state.compareSelectedCards)
  const contradictSelectedCards = useWorkspaceStore((state) => state.contradictSelectedCards)
  const openCardEditor = useWorkspaceStore((state) => state.openCardEditor)
  const autoArrangeCanvas = useWorkspaceStore((state) => state.autoArrangeCanvas)
  const restoreHiddenCards = useWorkspaceStore((state) => state.restoreHiddenCards)
  const canvasShellRef = useRef<HTMLDivElement>(null)
  const pointerDragStartRef = useRef<{ x: number; y: number } | null>(null)
  const pointerDragPointRef = useRef<{ x: number; y: number } | null>(null)
  const [pointerDragPoint, setPointerDragPoint] = useState<{ x: number; y: number } | null>(null)
  const [dragOverZoneId, setDragOverZoneId] = useState<string | null>(null)
  const [cardContextMenu, setCardContextMenu] = useState<{
    x: number
    y: number
    cardIds: string[]
  } | null>(null)

  const visibleCards = useMemo(
    () => cards.filter((card) => card.visible && card.status !== 'rejected'),
    [cards],
  )
  const recoverableCardCount = cards.filter((card) => card.hiddenByUser || card.status === 'rejected').length

  const nodes = useMemo<WorkspaceFlowNode[]>(() => {
    const workspaceRunning = discussionZones.some((zone) => zone.status === 'running')
    const zoneNodes: DiscussionZoneFlowNode[] = discussionZones.map((zone) => {
      const activeRun = discussionRuns.find((run) => run.id === zone.lastRunId)
      const memoryCount = agentMemories.filter((memory) => zone.agentIds.includes(memory.agentId)).length
      const blockedHistoryCount = zone.agentIds.reduce(
        (count, agentId) => count + agentMemories.filter((memory) => memory.agentId !== agentId).length,
        0,
      )
      return {
        id: zoneNodeId(zone.id),
        type: 'discussion-zone',
        position: zone.position,
        draggable: false,
        selectable: false,
        zIndex: 0,
        data: {
          zoneId: zone.id,
          title: zone.title,
          description: zone.description,
          status: zone.status,
          width: zone.size.width,
          height: zone.size.height,
          agentCount: zone.agentIds.length,
          cardCount: zone.cardIds.length,
          fileCount: zone.fileIds.length,
          memoryCount,
          blockedHistoryCount,
          activeRunId: activeRun?.id,
          activeRunStatus: activeRun?.status,
          dragActive: dragOverZoneId === zone.id,
        },
      }
    })

    const agentNodes: AgentFlowNode[] = agents.map((agent) => ({
      id: agentNodeId(agent.id),
      type: 'agent',
      position: agent.position,
      selectable: false,
      draggable: !workspaceRunning,
      zIndex: 2,
      data: {
        agentId: agent.id,
        name: agent.name,
        role: agent.role,
        description: agent.description,
        status: agent.status,
        accent: agent.accent,
        outputCount: visibleCards.filter((card) => card.creator === agent.id).length,
        memoryCount: agentMemories.filter((memory) => memory.agentId === agent.id).length,
        zoneTitle: discussionZones.find((zone) => zone.agentIds.includes(agent.id))?.title,
        active: selectedAgentId === agent.id,
      },
    }))

    const cardNodes: IdeaCardFlowNode[] = visibleCards.map((card) => {
      const opacity = selectedAgentId
        ? card.creator === selectedAgentId
          ? 1
          : card.creator === 'user'
            ? 0.55
            : 0.16
        : 1
      return {
        id: cardNodeId(card.id),
        type: 'idea-card',
        position: card.position,
        selected: selectedCardIds.includes(card.id),
        draggable: !workspaceRunning,
        selectable: true,
        zIndex: 1,
        data: {
          card,
          opacity,
          zoneTitle: discussionZones.find((zone) => zone.cardIds.includes(card.id))?.title,
        },
      }
    })

    const fileNodes: FileCardFlowNode[] = files.map((file) => ({
      id: fileNodeId(file.id),
      type: 'file-card',
      position: file.position,
      draggable: !workspaceRunning,
      selectable: false,
      zIndex: 1,
      data: {
        file,
        zoneTitle: discussionZones.find((zone) => zone.fileIds.includes(file.id))?.title,
      },
    }))

    return [...zoneNodes, ...agentNodes, ...cardNodes, ...fileNodes]
  }, [agentMemories, agents, discussionRuns, discussionZones, dragOverZoneId, files, selectedAgentId, selectedCardIds, visibleCards])

  const edges = useMemo<Edge[]>(() => {
    const visibleIds = new Set(visibleCards.map((card) => card.id))
    const relationByPair = new Map<string, RelationType>()
    for (const relation of relations) {
      for (const sourceId of relation.fromCardIds) {
        relationByPair.set(`${sourceId}:${relation.toCardId}`, relation.type)
      }
    }

    const result: Edge[] = []
    const renderedRelationPairs = new Set<string>()
    for (const card of visibleCards) {
      for (const parentId of card.parentCardIds) {
        if (!visibleIds.has(parentId)) continue
        const relationType = relationByPair.get(`${parentId}:${card.id}`) ?? 'derived_from'
        result.push({
          id: `relation:${parentId}:${card.id}`,
          source: cardNodeId(parentId),
          target: cardNodeId(card.id),
          type: 'smoothstep',
          label: relationLabels[relationType],
          markerEnd: { type: MarkerType.ArrowClosed, width: 15, height: 15 },
          style: { stroke: relationColors[relationType], strokeWidth: 1.4 },
          labelStyle: { fill: relationColors[relationType], fontSize: 9, fontWeight: 700 },
          labelBgStyle: { fill: '#f5f6f9', fillOpacity: 0.94 },
        })
        renderedRelationPairs.add(`${parentId}:${card.id}`)
      }

      if (card.creator !== 'user') {
        result.push({
          id: `creator:${card.creator}:${card.id}`,
          source: agentNodeId(card.creator),
          target: cardNodeId(card.id),
          type: 'smoothstep',
          label: '产出',
          markerEnd: { type: MarkerType.ArrowClosed, width: 13, height: 13 },
          style: { stroke: '#b6bbc7', strokeWidth: 1, strokeDasharray: '4 5' },
          labelStyle: { fill: '#8d94a3', fontSize: 8 },
          labelBgStyle: { fill: '#f5f6f9', fillOpacity: 0.9 },
        })
      }
    }
    for (const relation of relations) {
      if (!visibleIds.has(relation.toCardId)) continue
      for (const sourceId of relation.fromCardIds) {
        const pair = `${sourceId}:${relation.toCardId}`
        if (!visibleIds.has(sourceId) || renderedRelationPairs.has(pair)) continue
        result.push({
          id: `relation:${relation.id}:${sourceId}`,
          source: cardNodeId(sourceId),
          target: cardNodeId(relation.toCardId),
          type: 'smoothstep',
          label: relationLabels[relation.type],
          markerEnd: { type: MarkerType.ArrowClosed, width: 15, height: 15 },
          style: { stroke: relationColors[relation.type], strokeWidth: 1.4 },
          labelStyle: { fill: relationColors[relation.type], fontSize: 9, fontWeight: 700 },
          labelBgStyle: { fill: '#f5f6f9', fillOpacity: 0.94 },
        })
      }
    }
    return result
  }, [relations, visibleCards])

  const handleNodesChange = useCallback((changes: NodeChange<WorkspaceFlowNode>[]) => {
    const cardPositions: Record<string, { x: number; y: number }> = {}
    const agentPositions: Partial<Record<AgentId, { x: number; y: number }>> = {}
    const filePositions: Record<string, { x: number; y: number }> = {}
    for (const change of changes) {
      if (change.type === 'position' && change.position) {
        if (change.id.startsWith('card:')) {
          cardPositions[change.id.slice('card:'.length)] = change.position
        } else if (change.id.startsWith('agent:')) {
          agentPositions[change.id.slice('agent:'.length) as AgentId] = change.position
        } else if (change.id.startsWith('file:')) {
          filePositions[change.id.slice('file:'.length)] = change.position
        }
      }
    }
    if (Object.keys(cardPositions).length) updateCardPositions(cardPositions)
    if (Object.keys(agentPositions).length) updateAgentPositions(agentPositions)
    if (Object.keys(filePositions).length) updateFilePositions(filePositions)
  }, [updateAgentPositions, updateCardPositions, updateFilePositions])

  const findZoneForNode = useCallback((node: WorkspaceFlowNode) => {
    const member = getDraggedMember(node)
    if (!member) return null
    const center = {
      x: node.position.x + member.size.width / 2,
      y: node.position.y + member.size.height / 2,
    }
    return discussionZones.find((zone) => (
      center.x >= zone.position.x
      && center.x <= zone.position.x + zone.size.width
      && center.y >= zone.position.y
      && center.y <= zone.position.y + zone.size.height
    )) ?? null
  }, [discussionZones])

  const handleNodeClick = useCallback<NodeMouseHandler<WorkspaceFlowNode>>((_event, node) => {
    setCardContextMenu(null)
    if (node.type === 'agent') focusAgent(node.data.agentId)
    if (node.type === 'file-card') selectFile(node.data.file.id)
  }, [focusAgent, selectFile])

  const handleNodeContextMenu = useCallback<NodeMouseHandler<WorkspaceFlowNode>>((event, node) => {
    if (node.type !== 'idea-card') {
      setCardContextMenu(null)
      return
    }
    event.preventDefault()
    const state = useWorkspaceStore.getState()
    const cardId = node.data.card.id
    const cardIds = state.selectedCardIds.includes(cardId)
      ? state.selectedCardIds.filter((id) => state.cards.some((card) => card.id === id && card.visible))
      : [cardId]
    state.selectCards(cardIds)
    setCardContextMenu({
      x: Math.min(event.clientX, window.innerWidth - 220),
      y: Math.min(event.clientY, window.innerHeight - 120),
      cardIds,
    })
  }, [])

  const handlePaneClick = useCallback(() => {
    setCardContextMenu(null)
    selectCards([])
    selectFile(null)
    if (useWorkspaceStore.getState().selectedAgentId) focusAgent(null)
  }, [focusAgent, selectCards, selectFile])

  useEffect(() => {
    if (!cardContextMenu) return
    const closeMenu = (event: PointerEvent) => {
      if ((event.target as Element | null)?.closest('.card-context-menu')) return
      setCardContextMenu(null)
    }
    document.addEventListener('pointerdown', closeMenu)
    return () => document.removeEventListener('pointerdown', closeMenu)
  }, [cardContextMenu])

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const start = pointerDragStartRef.current
      if (!start) return
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 8) return
      event.preventDefault()
      const point = { x: event.clientX, y: event.clientY }
      pointerDragPointRef.current = point
      setPointerDragPoint(point)
    }

    const handlePointerUp = (event: PointerEvent) => {
      const didDrag = Boolean(pointerDragPointRef.current)
      pointerDragStartRef.current = null
      pointerDragPointRef.current = null
      setPointerDragPoint(null)
      if (!didDrag) return

      const receiver = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>('[data-agent-id]')
      const agentId = receiver?.dataset.agentId as AgentId | undefined
      if (agentId && agentButtons.some((agent) => agent.id === agentId)) openAssignment(agentId)
    }

    document.addEventListener('pointermove', handlePointerMove, { passive: false })
    document.addEventListener('pointerup', handlePointerUp)
    document.addEventListener('pointercancel', handlePointerUp)
    return () => {
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', handlePointerUp)
      document.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [openAssignment])

  const selectedCards = selectedCardIds
    .map((id) => cards.find((card) => card.id === id))
    .filter((card): card is IdeaCard => Boolean(card && card.visible && card.status !== 'rejected'))

  const contextDeletableCount = cardContextMenu?.cardIds.filter((id) => id !== 'root-idea').length ?? 0
  const contextIncludesRoot = cardContextMenu?.cardIds.includes('root-idea') ?? false

  return (
    <div
      aria-label="Idea 白板"
      className="canvas-shell"
      onKeyDown={(event) => {
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
        if (event.key === 'Escape') {
          setCardContextMenu(null)
          return
        }
        if (event.key !== 'Delete' || event.repeat || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return
        const target = event.target as HTMLElement
        if (target.closest('input, textarea, select, button, a, [contenteditable="true"], .nokey')) return
        if (!selectedCardIds.length) return
        event.preventDefault()
        setCardContextMenu(null)
        deleteCards(selectedCardIds)
      }}
      onPointerDownCapture={(event) => {
        const target = event.target as HTMLElement
        if (event.button === 0 && !target.closest('button, a, input, textarea, select, [contenteditable="true"]')) {
          canvasShellRef.current?.focus({ preventScroll: true })
        }
      }}
      ref={canvasShellRef}
      tabIndex={-1}
    >
      <ReactFlow<WorkspaceFlowNode, Edge>
        colorMode="light"
        defaultEdgeOptions={{ interactionWidth: 18 }}
        edges={edges}
        elementsSelectable
        fitView
        fitViewOptions={{ padding: 0.18, minZoom: 0.45, maxZoom: 1 }}
        maxZoom={1.8}
        minZoom={0.2}
        multiSelectionKeyCode="Shift"
        deleteKeyCode={null}
        nodeTypes={nodeTypes}
        nodes={nodes}
        nodesConnectable={false}
        onNodeClick={handleNodeClick}
        onNodeContextMenu={handleNodeContextMenu}
        onNodeDrag={(_event, node) => {
          setCardContextMenu(null)
          setDragOverZoneId(findZoneForNode(node)?.id ?? null)
        }}
        onNodeDragStop={(_event, node) => {
          setDragOverZoneId(null)
          const member = getDraggedMember(node)
          if (member) syncZoneMembership(member.kind, member.id, node.position)
        }}
        onNodesChange={handleNodesChange}
        onPaneClick={handlePaneClick}
        onMoveStart={() => setCardContextMenu(null)}
        panOnDrag={[1, 2]}
        selectionOnDrag
      >
        <Background color="#cdd1dc" gap={22} size={1} />
        <Controls position="bottom-left" showInteractive={false} />
      </ReactFlow>

      <div className="canvas-label">
        <span className="canvas-label__dot" />
        {selectedAgentId ? `已选择 ${selectedAgentId} · 正在高亮其产出` : 'React Flow · 把 Agent、Idea 与文件拖进讨论区'}
      </div>

      <div className="canvas-toolbar">
        <FileImportButton />
        <button className="canvas-tool-button" onClick={() => openCardEditor()} type="button">＋ 新建卡片</button>
        <button className="canvas-tool-button" onClick={autoArrangeCanvas} type="button">整理画布</button>
        {recoverableCardCount > 0 && (
          <button className="canvas-tool-button" onClick={restoreHiddenCards} type="button">恢复卡片 {recoverableCardCount}</button>
        )}
      </div>

      {selectedCards.length > 0 && (
        <div
          className="selection-tray"
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData('application/x-idea-card-ids', selectedCards.map((card) => card.id).join(','))
            event.dataTransfer.effectAllowed = 'copy'
          }}
        >
          <div
            className="selection-tray__summary"
            onPointerDown={(event) => {
              if (event.button !== 0) return
              pointerDragStartRef.current = { x: event.clientX, y: event.clientY }
              pointerDragPointRef.current = null
              setPointerDragPoint(null)
            }}
          >
            <span>{selectedCards.length}</span>
            <div><strong>已选择卡片</strong><small>拖到画布上的 Agent，或直接点击分配</small></div>
          </div>
          <div className="selection-tray__actions">
            {agentButtons.map((agent) => (
              <button key={agent.id} onClick={() => openAssignment(agent.id)} type="button">
                → {agent.label}
              </button>
            ))}
            <button disabled={selectedCards.length < 2} onClick={mergeSelectedCards} type="button">合并</button>
            <button disabled={selectedCards.length < 2} onClick={compareSelectedCards} type="button">比较</button>
            <button disabled={selectedCards.length !== 2} onClick={contradictSelectedCards} type="button">标记冲突</button>
          </div>
        </div>
      )}

      {pointerDragPoint && (
        <div
          className="selection-drag-preview"
          style={{ left: pointerDragPoint.x, top: pointerDragPoint.y }}
        >
          <span>{selectedCards.length}</span>
          张卡片
        </div>
      )}

      {cardContextMenu && (
        <div
          aria-label="卡片操作"
          className="card-context-menu"
          onContextMenu={(event) => event.preventDefault()}
          role="menu"
          style={{ left: cardContextMenu.x, top: cardContextMenu.y }}
        >
          <button
            disabled={!contextDeletableCount}
            onClick={() => {
              deleteCards(cardContextMenu.cardIds)
              setCardContextMenu(null)
            }}
            role="menuitem"
            type="button"
          >
            <span>{contextDeletableCount > 1 ? `永久删除 ${contextDeletableCount} 张卡片` : contextDeletableCount ? '永久删除卡片' : '根 Idea 不可删除'}</span>
            <kbd>Delete</kbd>
          </button>
          <small>{contextIncludesRoot && contextDeletableCount ? '根 Idea 会保留；其他选中卡片将删除。' : '无法恢复；冻结的运行与 Snapshot 历史仍保留。'}</small>
        </div>
      )}

      <div className="canvas-help">拖入讨论区＝本轮共享 · 拖出＝恢复独立 · 当前共享与私有历史严格分离</div>
    </div>
  )
}
