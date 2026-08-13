import { create } from 'zustand'
import type {
  Agent,
  AgentAction,
  AgentMemoryEntry,
  AgentVisibleContext,
  AgentId,
  AssignmentDraft,
  CardStatus,
  DiscussionRun,
  DiscussionZone,
  FileCard,
  IdeaCard,
  IdeaSnapshot,
  Relation,
  RelationType,
  Run,
  Workspace,
  WorkspaceDocument,
  ZoneMemberKind,
} from '../domain/types'
import { MAX_CUSTOM_INSTRUCTION_LENGTH } from '../domain/agent-profiles'
import {
  demoAgents,
  demoCards,
  demoDiscussionZones,
  demoFiles,
  demoWorkspace,
} from '../fixtures/demo-workspace'
import {
  buildDirectedAgentMessages,
  buildDiscussionProposalMessages,
  buildDiscussionSynthesisMessages,
  type CurrentRoundProposal,
} from '../services/agent-prompts'
import {
  cancelAiRun,
  isDesktopRuntime,
  runAiRequest,
  type AiRunResult,
} from '../services/ai-runtime'

type DiscussionExecutionResult = {
  result: AiRunResult
  privateSummaries: Partial<Record<AgentId, string>>
}

interface WorkspaceState {
  workspace: Workspace
  agents: Agent[]
  cards: IdeaCard[]
  files: FileCard[]
  discussionZones: DiscussionZone[]
  discussionRuns: DiscussionRun[]
  discussionDraftZoneId: string | null
  agentMemories: AgentMemoryEntry[]
  runs: Run[]
  relations: Relation[]
  snapshots: IdeaSnapshot[]
  snapshotDraft: IdeaSnapshot | null
  historyOpen: boolean
  selectedCardId: string
  selectedCardIds: string[]
  selectedFileId: string | null
  selectedAgentId: AgentId | null
  assignmentDraft: AssignmentDraft | null
  cardEditorTarget: string | 'new' | null
  agentHistoryId: AgentId | null
  notice: string | null
  createWorkspace: (title: string, idea: string) => void
  importWorkspaceDocument: (document: WorkspaceDocument, silent?: boolean) => void
  addFiles: (files: FileCard[]) => void
  removeFile: (fileId: string) => void
  selectFile: (fileId: string | null) => void
  createUserCard: (type: IdeaCard['type'], title: string, content: string) => void
  editCard: (cardId: string, type: IdeaCard['type'], title: string, content: string) => void
  openCardEditor: (cardId?: string) => void
  closeCardEditor: () => void
  openAgentHistory: (agentId: AgentId) => void
  closeAgentHistory: () => void
  compareSelectedCards: () => void
  contradictSelectedCards: () => void
  completeAgentRun: (runId: string, result?: AiRunResult) => void
  failAgentRun: (runId: string, error: string) => void
  interruptAgentRun: (runId: string) => void
  retryAgentRun: (runId: string) => void
  selectCard: (cardId: string) => void
  selectCards: (cardIds: string[]) => void
  deleteCards: (cardIds: string[]) => void
  updateCardStatus: (cardId: string, status: CardStatus) => void
  hideCard: (cardId: string) => void
  restoreHiddenCards: () => void
  updateCardPositions: (positions: Record<string, { x: number; y: number }>) => void
  updateAgentPositions: (positions: Partial<Record<AgentId, { x: number; y: number }>>) => void
  updateFilePositions: (positions: Record<string, { x: number; y: number }>) => void
  autoArrangeCanvas: () => void
  syncZoneMembership: (kind: ZoneMemberKind, id: string, position: { x: number; y: number }) => void
  startDiscussion: (zoneId: string) => void
  confirmDiscussion: () => void
  completeDiscussionRun: (runId: string, execution?: DiscussionExecutionResult) => void
  failDiscussionRun: (runId: string, error: string) => void
  interruptDiscussion: (runId: string) => void
  retryDiscussion: (runId: string) => void
  cancelDiscussionDraft: () => void
  focusAgent: (agentId: AgentId | null) => void
  openAssignment: (agentId: AgentId, cardIds?: string[]) => void
  setAssignmentAction: (action: AgentAction) => void
  setAssignmentInstruction: (instruction: string) => void
  cancelAssignment: () => void
  confirmAssignment: () => void
  mergeSelectedCards: () => void
  generateSnapshot: () => void
  updateSnapshotSummary: (summary: string) => void
  saveSnapshot: () => void
  closeSnapshot: () => void
  openHistory: () => void
  closeHistory: () => void
  dismissNotice: () => void
  showNotice: (message: string) => void
  resetWorkspace: () => void
}

let generatedSequence = 0
const discussionTimers = new Map<string, ReturnType<typeof setTimeout>>()
const agentRunTimers = new Map<string, ReturnType<typeof setTimeout>>()

function clearDiscussionTimers() {
  for (const timer of discussionTimers.values()) clearTimeout(timer)
  discussionTimers.clear()
}

function clearAgentRunTimers() {
  for (const timer of agentRunTimers.values()) clearTimeout(timer)
  agentRunTimers.clear()
}

function scheduleAgentPreview(runId: string) {
  const timer = setTimeout(() => {
    agentRunTimers.delete(runId)
    useWorkspaceStore.getState().completeAgentRun(runId)
  }, 800)
  agentRunTimers.set(runId, timer)
}

function scheduleDiscussionPreview(runId: string) {
  const timer = setTimeout(() => {
    discussionTimers.delete(runId)
    useWorkspaceStore.getState().completeDiscussionRun(runId)
  }, 900)
  discussionTimers.set(runId, timer)
}

function runtimeErrorMessage(reason: unknown) {
  if (reason instanceof Error) return reason.message
  if (typeof reason === 'string') return reason
  if (reason && typeof reason === 'object' && 'message' in reason && typeof reason.message === 'string') {
    return reason.message
  }
  return '未知的 AI 运行错误'
}

async function dispatchAgentRun(runId: string) {
  const state = useWorkspaceStore.getState()
  const run = state.runs.find((candidate) => candidate.id === runId)
  const agent = run ? state.agents.find((candidate) => candidate.id === run.agentId) : undefined
  if (!run || !agent || run.status !== 'running') return
  const ownHistoryIds = new Set(run.ownHistoryEntryIds ?? [])
  const ownHistory = state.agentMemories.filter((memory) => (
    memory.agentId === run.agentId && ownHistoryIds.has(memory.id)
  ))

  try {
    const result = await runAiRequest({
      runId,
      messages: buildDirectedAgentMessages(agent, run.action, run.inputSnapshots, ownHistory, run.customInstruction),
    })
    useWorkspaceStore.getState().completeAgentRun(runId, result)
  } catch (reason) {
    useWorkspaceStore.getState().failAgentRun(runId, runtimeErrorMessage(reason))
  }
}

async function dispatchDiscussionRun(runId: string) {
  const state = useWorkspaceStore.getState()
  const run = state.discussionRuns.find((candidate) => candidate.id === runId)
  if (!run || run.status !== 'running') return
  const agents = run.agentIds
    .map((agentId) => state.agents.find((agent) => agent.id === agentId))
    .filter((agent): agent is Agent => Boolean(agent))
  const cards = run.sharedCardSnapshots ?? run.sharedCardIds
    .map((cardId) => state.cards.find((card) => card.id === cardId))
    .filter((card): card is IdeaCard => Boolean(card))
    .map((card) => ({ id: card.id, title: card.title, content: card.content, position: { ...card.position } }))
  const files = run.sharedFileSnapshots ?? run.sharedFileIds
    .map((fileId) => state.files.find((file) => file.id === fileId))
    .filter((file): file is FileCard => Boolean(file))
    .map((file) => ({
      id: file.id,
      name: file.name,
      summary: file.summary,
      contentText: file.contentText,
      parseStatus: file.parseStatus,
    }))
  const participantNames = agents.map((agent) => agent.name)

  try {
    const proposals = await Promise.all(agents.map(async (agent) => {
      const context = run.contexts.find((candidate) => candidate.agentId === agent.id)
      const ownHistoryIds = new Set(context?.ownHistoryEntryIds ?? [])
      const ownHistory = state.agentMemories.filter((memory) => (
        memory.agentId === agent.id && ownHistoryIds.has(memory.id)
      ))
      const result = await runAiRequest({
        runId: `${runId}--${agent.id}`,
        messages: buildDiscussionProposalMessages(
          agent,
          participantNames,
          cards,
          files,
          ownHistory,
        ),
      })
      return { agent, result }
    }))

    if (useWorkspaceStore.getState().discussionRuns.find((candidate) => candidate.id === runId)?.status !== 'running') return

    const currentRound: CurrentRoundProposal[] = proposals.map(({ agent, result }) => ({
      agentId: agent.id,
      agentName: agent.name,
      cards: result.cards,
    }))
    const result = await runAiRequest({
      runId: `${runId}--synthesis`,
      messages: buildDiscussionSynthesisMessages(cards, files, currentRound),
    })
    const privateSummaries = Object.fromEntries(proposals.map(({ agent, result: proposal }) => [
      agent.id,
      proposal.privateSummary || proposal.summary || `我在本轮讨论中提出了：${proposal.cards.map((card) => card.title).join('、')}。`,
    ])) as Partial<Record<AgentId, string>>
    useWorkspaceStore.getState().completeDiscussionRun(runId, { result, privateSummaries })
  } catch (reason) {
    for (const agentId of run.agentIds) {
      void cancelAiRun(`${runId}--${agentId}`).catch(() => undefined)
    }
    void cancelAiRun(`${runId}--synthesis`).catch(() => undefined)
    useWorkspaceStore.getState().failDiscussionRun(runId, runtimeErrorMessage(reason))
  }
}

const actionLabels: Record<AgentAction, string> = {
  expand: '扩展方向',
  critique: '挑战观点',
  simplify: '压缩方案',
  answer: '回答问题',
  opposite: '提出相反方案',
  custom: '执行自定义指令',
}

const defaultActions: Record<AgentId, AgentAction> = {
  explorer: 'expand',
  critic: 'critique',
  simplifier: 'simplify',
}

const relationByAction: Record<AgentAction, RelationType> = {
  expand: 'derived_from',
  critique: 'critiques',
  simplify: 'derived_from',
  answer: 'answers',
  opposite: 'contradicts',
  custom: 'derived_from',
}

function nextId(prefix: string) {
  generatedSequence += 1
  return `${prefix}-${Date.now().toString(36)}-${generatedSequence}`
}

const memberSizes: Record<ZoneMemberKind, { width: number; height: number }> = {
  agent: { width: 250, height: 158 },
  card: { width: 228, height: 178 },
  file: { width: 220, height: 128 },
}

function isInsideZone(
  kind: ZoneMemberKind,
  position: { x: number; y: number },
  zone: DiscussionZone,
) {
  const size = memberSizes[kind]
  const center = { x: position.x + size.width / 2, y: position.y + size.height / 2 }
  return center.x >= zone.position.x
    && center.x <= zone.position.x + zone.size.width
    && center.y >= zone.position.y
    && center.y <= zone.position.y + zone.size.height
}

function getZoneStatus(zone: DiscussionZone): DiscussionZone['status'] {
  const hasInput = zone.cardIds.length > 0 || zone.fileIds.length > 0
  return zone.agentIds.length >= 2 && hasInput ? 'ready' : 'draft'
}

function makeDiscussionOutput(
  zone: DiscussionZone,
  agents: Agent[],
  cards: IdeaCard[],
  files: FileCard[],
  runId: string,
): IdeaCard {
  const agentNames = zone.agentIds
    .map((agentId) => agents.find((agent) => agent.id === agentId)?.name ?? agentId)
    .join('、')
  const inputNames = [
    ...zone.cardIds.map((cardId) => cards.find((card) => card.id === cardId)?.title).filter(Boolean),
    ...zone.fileIds.map((fileId) => files.find((file) => file.id === fileId)?.name).filter(Boolean),
  ]
  return {
    id: nextId('discussion-result'),
    type: 'idea',
    title: `${zone.title}：阶段结论`,
    content: `${agentNames}围绕${inputNames.map((name) => `《${name}》`).join('、')}完成了一轮受控讨论。当前区内内容被共同处理，每个 Agent 只补充了自己的私有历史。`,
    status: 'unreviewed',
    creator: 'user',
    sourceDiscussionRunId: runId,
    parentCardIds: [...zone.cardIds],
    position: {
      x: zone.position.x + zone.size.width / 2 - 114,
      y: zone.position.y + zone.size.height + 90,
    },
    visible: true,
  }
}

function makeSimulatedOutput(
  agentId: AgentId,
  action: AgentAction,
  inputs: Run['inputSnapshots'],
  runId: string,
  customInstruction?: string,
): IdeaCard {
  const sourceTitle = inputs.map((card) => `《${card.title}》`).join('、')
  const centerX = inputs.reduce((sum, card) => sum + card.position.x, 0) / inputs.length
  const bottomY = Math.max(...inputs.map((card) => card.position.y))
  const base = {
    id: nextId(`${agentId}-card`),
    status: 'unreviewed' as const,
    creator: agentId,
    sourceRunId: runId,
    parentCardIds: inputs.map((card) => card.id),
    position: { x: centerX + (generatedSequence % 3) * 90 - 90, y: bottomY + 250 },
    visible: true,
  }

  if (action === 'custom') {
    const instruction = customInstruction?.trim().slice(0, 120) || '未提供有效指令'
    return {
      ...base,
      type: agentId === 'critic' ? 'assumption' : 'idea',
      title: '按自定义指令处理',
      content: `浏览器预览：${agentId} 将结合${sourceTitle}执行“${instruction}”。安装版会把冻结指令发送给真实 AI。`,
    }
  }

  if (agentId === 'critic') {
    return {
      ...base,
      type: action === 'answer' ? 'question' : 'assumption',
      title: action === 'opposite' ? '相反方向可能更简单' : '需要验证的关键假设',
      content: `${sourceTitle}依赖一个尚未被证明的前提：用户会愿意主动整理和授权上下文。建议先用一次完整任务验证。`,
    }
  }

  if (agentId === 'simplifier') {
    return {
      ...base,
      type: action === 'simplify' ? 'decision' : 'idea',
      title: '更小的可验证版本',
      content: `围绕${sourceTitle}，先只保留一次输入、一次定向处理和一张结果卡片，暂不增加自动讨论。`,
    }
  }

  return {
    ...base,
    type: action === 'answer' ? 'idea' : action === 'critique' ? 'question' : 'idea',
    title: action === 'opposite' ? '从反方向重新构造' : '可继续探索的新分支',
    content: `基于${sourceTitle}，可以把观点拆成独立分支，并让用户选择其中一个方向继续推进。`,
  }
}

function initialState() {
  return {
    workspace: demoWorkspace,
    agents: demoAgents.map((agent) => ({ ...agent, position: { ...agent.position } })),
    cards: demoCards.slice(0, 1).map((card) => ({ ...card, position: { ...card.position } })),
    files: demoFiles.map((file) => ({ ...file, position: { ...file.position } })),
    discussionZones: demoDiscussionZones.map((zone) => ({
      ...zone,
      position: { ...zone.position },
      size: { ...zone.size },
      agentIds: [...zone.agentIds],
      cardIds: [...zone.cardIds],
      fileIds: [...zone.fileIds],
    })),
    discussionRuns: [] as DiscussionRun[],
    discussionDraftZoneId: null as string | null,
    agentMemories: [] as AgentMemoryEntry[],
    runs: [] as Run[],
    relations: [] as Relation[],
    snapshots: [] as IdeaSnapshot[],
    snapshotDraft: null as IdeaSnapshot | null,
    historyOpen: false,
    selectedCardId: 'root-idea',
    selectedCardIds: ['root-idea'],
    selectedFileId: null as string | null,
    selectedAgentId: null as AgentId | null,
    assignmentDraft: null as AssignmentDraft | null,
    cardEditorTarget: null as string | 'new' | null,
    agentHistoryId: null as AgentId | null,
    notice: null as string | null,
  }
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  ...initialState(),

  createWorkspace: (title, idea) => {
    clearDiscussionTimers()
    clearAgentRunTimers()
    generatedSequence = 0
    const workspaceTitle = title.trim() || 'Untitled Idea'
    const ideaContent = idea.trim() || '在这里描述你的初始 Idea。'
    const rootCard: IdeaCard = {
      id: 'root-idea',
      type: 'idea',
      title: workspaceTitle,
      content: ideaContent,
      status: 'kept',
      creator: 'user',
      parentCardIds: [],
      position: { x: 360, y: 80 },
      visible: true,
    }
    set({
      workspace: {
        id: `workspace-${Date.now().toString(36)}`,
        title: workspaceTitle,
        subtitle: '本地 Idea · 草稿',
      },
      agents: demoAgents.map((agent) => ({ ...agent, status: 'idle', position: { ...agent.position } })),
      cards: [rootCard],
      files: [],
      discussionZones: demoDiscussionZones.map((zone) => ({
        ...zone,
        status: 'draft',
        position: { ...zone.position },
        size: { ...zone.size },
        agentIds: [],
        cardIds: [],
        fileIds: [],
        lastRunId: undefined,
      })),
      discussionRuns: [],
      discussionDraftZoneId: null,
      agentMemories: [],
      runs: [],
      relations: [],
      snapshots: [],
      snapshotDraft: null,
      historyOpen: false,
      selectedCardId: 'root-idea',
      selectedCardIds: ['root-idea'],
      selectedFileId: null,
      selectedAgentId: null,
      assignmentDraft: null,
      cardEditorTarget: null,
      agentHistoryId: null,
      notice: `已创建本地 Workspace“${workspaceTitle}”。`,
    })
  },

  importWorkspaceDocument: (document, silent = false) => {
    clearDiscussionTimers()
    clearAgentRunTimers()
    set({
      workspace: { ...document.workspace },
      agents: document.agents.map((agent) => ({ ...agent, position: { ...agent.position } })),
      cards: document.cards.map((card) => ({
        ...card,
        parentCardIds: [...card.parentCardIds],
        position: { ...card.position },
      })),
      files: document.files.map((file) => ({ ...file, position: { ...file.position } })),
      discussionZones: document.discussionZones.map((zone) => ({
        ...zone,
        status: zone.status === 'running' ? getZoneStatus(zone) : zone.status,
        position: { ...zone.position },
        size: { ...zone.size },
        agentIds: [...zone.agentIds],
        cardIds: [...zone.cardIds],
        fileIds: [...zone.fileIds],
      })),
      discussionRuns: document.discussionRuns.map((run) => ({
        ...run,
        status: run.status === 'running' || run.status === 'queued' ? 'interrupted' : run.status,
        agentIds: [...run.agentIds],
        sharedCardIds: [...run.sharedCardIds],
        sharedFileIds: [...run.sharedFileIds],
        sharedCardSnapshots: run.sharedCardSnapshots?.map((snapshot) => ({
          ...snapshot,
          position: { ...snapshot.position },
        })),
        sharedFileSnapshots: run.sharedFileSnapshots?.map((snapshot) => ({ ...snapshot })),
        outputCardIds: run.outputCardIds ? [...run.outputCardIds] : undefined,
        contexts: run.contexts.map((context) => ({
          ...context,
          currentSessionAgentIds: [...context.currentSessionAgentIds],
          sharedCardIds: [...context.sharedCardIds],
          sharedFileIds: [...context.sharedFileIds],
          ownHistoryEntryIds: [...context.ownHistoryEntryIds],
          blockedPeerHistoryEntryIds: [...context.blockedPeerHistoryEntryIds],
          explicitlySharedPeerCardIds: [...context.explicitlySharedPeerCardIds],
        })),
      })),
      discussionDraftZoneId: null,
      agentMemories: document.agentMemories.map((memory) => ({
        ...memory,
        inputCardIds: [...memory.inputCardIds],
        inputFileIds: [...memory.inputFileIds],
        outputCardIds: [...memory.outputCardIds],
      })),
      runs: document.runs.map((run) => ({
        ...run,
        status: run.status === 'running' || run.status === 'queued' ? 'interrupted' : run.status,
        inputCardIds: [...run.inputCardIds],
        inputSnapshots: (run.inputSnapshots ?? []).map((input) => ({ ...input, position: { ...input.position } })),
        ownHistoryEntryIds: run.ownHistoryEntryIds ? [...run.ownHistoryEntryIds] : [],
        outputCardIds: [...(run.outputCardIds ?? [])],
      })),
      relations: document.relations.map((relation) => ({ ...relation, fromCardIds: [...relation.fromCardIds] })),
      snapshots: document.snapshots.map((snapshot) => ({
        ...snapshot,
        includedCardIds: [...snapshot.includedCardIds],
        assumptions: [...snapshot.assumptions],
        openQuestions: [...snapshot.openQuestions],
        decisions: [...snapshot.decisions],
      })),
      snapshotDraft: null,
      historyOpen: false,
      selectedCardId: document.cards.some((card) => card.id === 'root-idea') ? 'root-idea' : document.cards[0]?.id ?? '',
      selectedCardIds: document.cards.length ? [document.cards.some((card) => card.id === 'root-idea') ? 'root-idea' : document.cards[0].id] : [],
      selectedFileId: null,
      selectedAgentId: null,
      assignmentDraft: null,
      cardEditorTarget: null,
      agentHistoryId: null,
      notice: silent ? null : `已打开 Workspace“${document.workspace.title}”。`,
    })
  },

  addFiles: (newFiles) =>
    set((state) => ({
      files: [...state.files, ...newFiles.filter((file) => !state.files.some((existing) => (
        existing.name === file.name && existing.lastModified === file.lastModified
      )))],
      notice: `已导入 ${newFiles.length} 个本地文件。`,
    })),

  removeFile: (fileId) =>
    set((state) => ({
      files: state.files.filter((file) => file.id !== fileId),
      discussionZones: state.discussionZones.map((zone) => {
        const nextZone = { ...zone, fileIds: zone.fileIds.filter((id) => id !== fileId) }
        return { ...nextZone, status: zone.status === 'running' ? zone.status : getZoneStatus(nextZone) }
      }),
      selectedFileId: state.selectedFileId === fileId ? null : state.selectedFileId,
      notice: '文件卡已从 Workspace 移除。',
    })),

  selectFile: (fileId) => set({ selectedFileId: fileId, selectedCardIds: [] }),

  createUserCard: (type, title, content) => {
    const state = get()
    const id = nextId('user-card')
    const card: IdeaCard = {
      id,
      type,
      title: title.trim() || '未命名卡片',
      content: content.trim(),
      status: 'unreviewed',
      creator: 'user',
      parentCardIds: [],
      position: {
        x: 80 + (state.cards.length % 4) * 260,
        y: 880 + Math.floor(state.cards.length / 4) * 220,
      },
      visible: true,
    }
    set((current) => ({
      cards: [...current.cards, card],
      selectedCardId: id,
      selectedCardIds: [id],
      selectedFileId: null,
      notice: '已创建一张用户卡片。',
    }))
  },

  openCardEditor: (cardId) => set({ cardEditorTarget: cardId ?? 'new' }),

  closeCardEditor: () => set({ cardEditorTarget: null }),

  openAgentHistory: (agentId) => set({ agentHistoryId: agentId }),

  closeAgentHistory: () => set({ agentHistoryId: null }),

  editCard: (cardId, type, title, content) =>
    set((state) => ({
      cards: state.cards.map((card) => card.id === cardId
        ? { ...card, type, title: title.trim() || card.title, content: content.trim() }
        : card),
      notice: '卡片内容已更新。',
    })),

  compareSelectedCards: () => {
    const state = get()
    const inputs = state.selectedCardIds
      .map((id) => state.cards.find((card) => card.id === id))
      .filter((card): card is IdeaCard => Boolean(card && card.visible && card.status !== 'rejected'))
    if (inputs.length < 2) {
      set({ notice: '至少选择两张卡片才能比较。' })
      return
    }
    const id = nextId('comparison-card')
    const comparison: IdeaCard = {
      id,
      type: 'idea',
      title: `比较：${inputs.map((card) => card.title).join(' ↔ ')}`,
      content: inputs.map((card, index) => `${index + 1}. ${card.title}：${card.content}`).join('\n'),
      status: 'unreviewed',
      creator: 'user',
      parentCardIds: inputs.map((card) => card.id),
      position: {
        x: inputs.reduce((sum, card) => sum + card.position.x, 0) / inputs.length,
        y: Math.max(...inputs.map((card) => card.position.y)) + 250,
      },
      visible: true,
    }
    set((current) => ({
      cards: [...current.cards, comparison],
      relations: [...current.relations, {
        id: nextId('relation'),
        type: 'compares',
        fromCardIds: inputs.map((card) => card.id),
        toCardId: id,
      }],
      selectedCardId: id,
      selectedCardIds: [id],
      notice: '已生成比较卡，原卡片保持不变。',
    }))
  },

  contradictSelectedCards: () => {
    const state = get()
    const inputs = state.selectedCardIds
      .map((id) => state.cards.find((card) => card.id === id))
      .filter((card): card is IdeaCard => Boolean(card && card.visible && card.status !== 'rejected'))
    if (inputs.length !== 2) {
      set({ notice: '请选择恰好两张卡片来标记冲突。' })
      return
    }
    set((current) => ({
      relations: [...current.relations, {
        id: nextId('relation'),
        type: 'contradicts',
        fromCardIds: [inputs[0].id],
        toCardId: inputs[1].id,
      }],
      notice: '已标记两张卡片互相冲突。',
    }))
  },

  completeAgentRun: (runId, result) => {
    const pendingTimer = agentRunTimers.get(runId)
    if (pendingTimer) clearTimeout(pendingTimer)
    agentRunTimers.delete(runId)
    const state = get()
    const run = state.runs.find((candidate) => candidate.id === runId)
    if (!run || run.status !== 'running') return
    const centerX = run.inputSnapshots.reduce((sum, card) => sum + card.position.x, 0) / run.inputSnapshots.length
    const bottomY = Math.max(...run.inputSnapshots.map((card) => card.position.y))
    const outputs = result
      ? result.cards.map((draft, index, all) => ({
          id: nextId(`${run.agentId}-card`),
          type: draft.type,
          title: draft.title,
          content: draft.content,
          status: 'unreviewed' as const,
          creator: run.agentId,
          sourceRunId: runId,
          parentCardIds: [...run.inputCardIds],
          position: {
            x: centerX + (index - (all.length - 1) / 2) * 258,
            y: bottomY + 250,
          },
          visible: true,
        }))
      : [makeSimulatedOutput(run.agentId, run.action, run.inputSnapshots, runId, run.customInstruction)]
    const relations: Relation[] = outputs.map((output) => ({
      id: nextId('relation'),
      type: relationByAction[run.action],
      fromCardIds: [...run.inputCardIds],
      toCardId: output.id,
    }))
    const memory: AgentMemoryEntry = {
      id: nextId(`memory-${run.agentId}`),
      agentId: run.agentId,
      source: 'directed',
      runId,
      inputCardIds: [...run.inputCardIds],
      inputFileIds: [],
      outputCardIds: outputs.map((output) => output.id),
      privateSummary: result?.privateSummary || result?.summary
        || `我曾执行“${actionLabels[run.action]}”${run.customInstruction ? `（${run.customInstruction.slice(0, 120)}）` : ''}，处理了 ${run.inputCardIds.length} 张用户授权卡片并生成${outputs.map((output) => `《${output.title}》`).join('、')}。`,
      createdAt: '刚刚',
    }
    set((current) => ({
      cards: [...current.cards, ...outputs],
      relations: [...current.relations, ...relations],
      agentMemories: [...current.agentMemories, memory],
      runs: current.runs.map((candidate) => candidate.id === runId
        ? { ...candidate, status: 'completed', outputCount: outputs.length, outputCardIds: outputs.map((output) => output.id), finishedAt: '刚刚' }
        : candidate),
      agents: current.agents.map((agent) => agent.id === run.agentId ? { ...agent, status: 'completed' } : agent),
      selectedCardId: outputs[0].id,
      selectedCardIds: outputs.map((output) => output.id),
      selectedFileId: null,
      notice: `${current.agents.find((agent) => agent.id === run.agentId)?.name} 已${result ? '通过 AI ' : '在浏览器预览中'}生成 ${outputs.length} 张卡片。`,
    }))
  },

  failAgentRun: (runId, error) => {
    const state = get()
    const run = state.runs.find((candidate) => candidate.id === runId)
    if (!run || run.status !== 'running') return
    set((current) => ({
      runs: current.runs.map((candidate) => candidate.id === runId
        ? { ...candidate, status: 'failed', error, finishedAt: '刚刚' }
        : candidate),
      agents: current.agents.map((agent) => agent.id === run.agentId ? { ...agent, status: 'failed' } : agent),
      notice: `${current.agents.find((agent) => agent.id === run.agentId)?.name} 运行失败：${error}`,
    }))
  },

  interruptAgentRun: (runId) => {
    const state = get()
    const run = state.runs.find((candidate) => candidate.id === runId)
    if (!run || run.status !== 'running') return
    const timer = agentRunTimers.get(runId)
    if (timer) clearTimeout(timer)
    agentRunTimers.delete(runId)
    if (isDesktopRuntime()) void cancelAiRun(runId).catch(() => undefined)
    set((current) => ({
      runs: current.runs.map((candidate) => candidate.id === runId
        ? { ...candidate, status: 'interrupted', finishedAt: '刚刚' }
        : candidate),
      agents: current.agents.map((agent) => agent.id === run.agentId ? { ...agent, status: 'interrupted' } : agent),
      notice: `${current.agents.find((agent) => agent.id === run.agentId)?.name} 的运行已中断。`,
    }))
  },

  retryAgentRun: (runId) => {
    const state = get()
    const run = state.runs.find((candidate) => candidate.id === runId)
    if (!run || (run.status !== 'interrupted' && run.status !== 'failed')) return
    set({
      runs: state.runs.map((candidate) => candidate.id === runId
        ? { ...candidate, status: 'running', error: undefined, finishedAt: undefined, attempt: (candidate.attempt ?? 1) + 1 }
        : candidate),
      agents: state.agents.map((agent) => agent.id === run.agentId ? { ...agent, status: 'running' } : agent),
      notice: '已重新开始该 Agent 运行。',
    })
    if (isDesktopRuntime()) {
      void dispatchAgentRun(runId)
    } else {
      scheduleAgentPreview(runId)
    }
  },

  selectCard: (cardId) => set({ selectedCardId: cardId, selectedCardIds: [cardId], selectedFileId: null }),

  selectCards: (cardIds) =>
    set((state) => ({
      selectedCardIds: cardIds,
      selectedCardId: cardIds.at(-1) ?? state.selectedCardId,
      selectedFileId: null,
    })),

  deleteCards: (cardIds) =>
    set((state) => {
      const requestedIds = new Set(cardIds)
      const deletableIds = state.cards
        .filter((card) => card.id !== 'root-idea' && requestedIds.has(card.id))
        .map((card) => card.id)
      if (!deletableIds.length) {
        return { notice: requestedIds.has('root-idea') ? '根 Idea 不能永久删除。' : '没有可删除的卡片。' }
      }

      const activeInputIds = new Set([
        ...state.runs
          .filter((run) => run.status === 'running')
          .flatMap((run) => run.inputCardIds),
        ...state.discussionRuns
          .filter((run) => run.status === 'running')
          .flatMap((run) => run.sharedCardIds),
      ])
      if (deletableIds.some((id) => activeInputIds.has(id))) {
        return { notice: '选中的卡片正在被 Agent 处理。请先等待完成或中断运行，再永久删除。' }
      }

      const deletedIds = new Set(deletableIds)
      const cards = state.cards
        .filter((card) => !deletedIds.has(card.id))
        .map((card) => ({
          ...card,
          parentCardIds: card.parentCardIds.filter((id) => !deletedIds.has(id)),
        }))
      const discussionZones = state.discussionZones.map((zone) => {
        const nextZone = { ...zone, cardIds: zone.cardIds.filter((id) => !deletedIds.has(id)) }
        return { ...nextZone, status: zone.status === 'running' ? zone.status : getZoneStatus(nextZone) }
      })
      const relations = state.relations.flatMap((relation) => {
        if (deletedIds.has(relation.toCardId)) return []
        const fromCardIds = relation.fromCardIds.filter((id) => !deletedIds.has(id))
        return fromCardIds.length ? [{ ...relation, fromCardIds }] : []
      })
      const survivingSelectedIds = state.selectedCardIds.filter((id) => (
        !deletedIds.has(id) && cards.some((card) => card.id === id)
      ))
      const fallback = cards.find((card) => card.id === 'root-idea')
        ?? cards.find((card) => card.visible && card.status !== 'rejected')
        ?? cards[0]
      const selectedCardIds = survivingSelectedIds.length
        ? survivingSelectedIds
        : fallback ? [fallback.id] : []
      const selectedCardId = !deletedIds.has(state.selectedCardId)
        && cards.some((card) => card.id === state.selectedCardId)
        ? state.selectedCardId
        : selectedCardIds.at(-1) ?? ''
      const assignmentCardIds = state.assignmentDraft?.cardIds.filter((id) => !deletedIds.has(id)) ?? []
      const snapshotDraftClosed = Boolean(state.snapshotDraft?.includedCardIds.some((id) => deletedIds.has(id)))
      const draftZone = discussionZones.find((zone) => zone.id === state.discussionDraftZoneId)
      const discussionDraftZoneId = draftZone && getZoneStatus(draftZone) === 'ready'
        ? state.discussionDraftZoneId
        : null
      const rootPreserved = requestedIds.has('root-idea')

      return {
        cards,
        relations,
        discussionZones,
        discussionDraftZoneId,
        selectedCardId,
        selectedCardIds,
        assignmentDraft: state.assignmentDraft && assignmentCardIds.length
          ? { ...state.assignmentDraft, cardIds: assignmentCardIds }
          : null,
        cardEditorTarget: typeof state.cardEditorTarget === 'string' && deletedIds.has(state.cardEditorTarget)
          ? null
          : state.cardEditorTarget,
        snapshotDraft: snapshotDraftClosed ? null : state.snapshotDraft,
        notice: `已永久删除 ${deletableIds.length} 张卡片，无法从“恢复卡片”找回。${rootPreserved ? '根 Idea 已保留。' : ''}${snapshotDraftClosed ? '未保存的 Snapshot 草稿已关闭。' : ''}`,
      }
    }),

  updateCardStatus: (cardId, status) =>
    set((state) => ({
      cards: state.cards.map((card) => (card.id === cardId ? { ...card, status } : card)),
      notice: status === 'rejected' ? '卡片已排除，来源记录仍然保留。' : '卡片审核状态已更新。',
    })),

  hideCard: (cardId) =>
    set((state) => {
      if (cardId === 'root-idea') return { notice: '根 Idea 不能从画布隐藏。' }
      const fallback = state.cards.find((card) => card.id === 'root-idea' && card.visible)
        ?? state.cards.find((card) => card.id !== cardId && card.visible && card.status !== 'rejected')
      return {
        cards: state.cards.map((card) => card.id === cardId ? { ...card, visible: false, hiddenByUser: true } : card),
        discussionZones: state.discussionZones.map((zone) => {
          const nextZone = { ...zone, cardIds: zone.cardIds.filter((id) => id !== cardId) }
          return { ...nextZone, status: zone.status === 'running' ? zone.status : getZoneStatus(nextZone) }
        }),
        selectedCardId: fallback?.id ?? '',
        selectedCardIds: fallback ? [fallback.id] : [],
        notice: '卡片已从画布隐藏，可在画布工具栏恢复。',
      }
    }),

  restoreHiddenCards: () =>
    set((state) => {
      const restoreCount = state.cards.filter((card) => card.hiddenByUser || card.status === 'rejected').length
      if (!restoreCount) return { notice: '没有需要恢复的卡片。' }
      return {
        cards: state.cards.map((card) => card.hiddenByUser || card.status === 'rejected' ? ({
          ...card,
          visible: true,
          hiddenByUser: false,
          status: card.status === 'rejected' ? 'unreviewed' : card.status,
        }) : card),
        notice: `已恢复 ${restoreCount} 张隐藏或排除的卡片。`,
      }
    }),

  updateCardPositions: (positions) =>
    set((state) => {
      let changed = false
      const cards = state.cards.map((card) => {
        const position = positions[card.id]
        if (!position || (position.x === card.position.x && position.y === card.position.y)) return card
        changed = true
        return { ...card, position }
      })
      return changed ? { cards } : state
    }),

  updateAgentPositions: (positions) =>
    set((state) => {
      let changed = false
      const agents = state.agents.map((agent) => {
        const position = positions[agent.id]
        if (!position || (position.x === agent.position.x && position.y === agent.position.y)) return agent
        changed = true
        return { ...agent, position }
      })
      return changed ? { agents } : state
    }),

  updateFilePositions: (positions) =>
    set((state) => {
      let changed = false
      const files = state.files.map((file) => {
        const position = positions[file.id]
        if (!position || (position.x === file.position.x && position.y === file.position.y)) return file
        changed = true
        return { ...file, position }
      })
      return changed ? { files } : state
    }),

  autoArrangeCanvas: () =>
    set((state) => {
      const running = state.discussionZones.some((zone) => zone.status === 'running')
      if (running) return { notice: '运行中暂不整理画布，避免改变正在冻结的上下文。' }
      let outsideCardIndex = 0
      let outsideFileIndex = 0
      const agents = state.agents.map((agent, index) => {
        const zone = state.discussionZones.find((candidate) => candidate.agentIds.includes(agent.id))
        if (!zone) return { ...agent, position: { x: 20 + index * 290, y: -210 } }
        const memberIndex = zone.agentIds.indexOf(agent.id)
        const step = zone.agentIds.length >= 3 ? 225 : 285
        return { ...agent, position: { x: zone.position.x + 25 + memberIndex * step, y: zone.position.y + 105 } }
      })
      const cards = state.cards.map((card) => {
        const zone = state.discussionZones.find((candidate) => candidate.cardIds.includes(card.id))
        if (zone) {
          const memberIndex = zone.cardIds.indexOf(card.id)
          return { ...card, position: {
            x: zone.position.x + 25 + (memberIndex % 2) * 345,
            y: zone.position.y + 255 + Math.floor(memberIndex / 2) * 200,
          } }
        }
        if (!card.visible || card.status === 'rejected') return card
        const index = outsideCardIndex++
        return { ...card, position: { x: 40 + (index % 3) * 280, y: 80 + Math.floor(index / 3) * 230 } }
      })
      const files = state.files.map((file) => {
        const zone = state.discussionZones.find((candidate) => candidate.fileIds.includes(file.id))
        if (zone) {
          const memberIndex = zone.fileIds.indexOf(file.id) + zone.cardIds.length
          return { ...file, position: {
            x: zone.position.x + 25 + (memberIndex % 2) * 345,
            y: zone.position.y + 255 + Math.floor(memberIndex / 2) * 200,
          } }
        }
        const index = outsideFileIndex++
        return { ...file, position: { x: 950 + (index % 3) * 240, y: 390 + Math.floor(index / 3) * 150 } }
      })
      return { agents, cards, files, notice: '已按上下文归属自动整理画布。' }
    }),

  syncZoneMembership: (kind, id, position) =>
    set((state) => {
      let membershipChanged = false
      const discussionZones = state.discussionZones.map((zone) => {
        const wasMember = kind === 'agent' ? zone.agentIds.includes(id as AgentId)
          : kind === 'card' ? zone.cardIds.includes(id)
            : zone.fileIds.includes(id)
        const willBeMember = isInsideZone(kind, position, zone)
        membershipChanged ||= wasMember !== willBeMember
        const agentIds = zone.agentIds.filter((memberId) => memberId !== id)
        const cardIds = zone.cardIds.filter((memberId) => memberId !== id)
        const fileIds = zone.fileIds.filter((memberId) => memberId !== id)
        if (willBeMember) {
          if (kind === 'agent') agentIds.push(id as AgentId)
          if (kind === 'card') cardIds.push(id)
          if (kind === 'file') fileIds.push(id)
        }
        const nextZone = { ...zone, agentIds, cardIds, fileIds }
        return { ...nextZone, status: wasMember === willBeMember ? zone.status : getZoneStatus(nextZone) }
      })
      const joinedZone = discussionZones.find((zone) => (
        kind === 'agent' ? zone.agentIds.includes(id as AgentId)
          : kind === 'card' ? zone.cardIds.includes(id)
            : zone.fileIds.includes(id)
      ))
      return {
        agents: kind === 'agent'
          ? state.agents.map((agent) => agent.id === id ? { ...agent, position } : agent)
          : state.agents,
        cards: kind === 'card'
          ? state.cards.map((card) => card.id === id ? { ...card, position } : card)
          : state.cards,
        files: kind === 'file'
          ? state.files.map((file) => file.id === id ? { ...file, position } : file)
          : state.files,
        discussionZones,
        notice: membershipChanged
          ? joinedZone
            ? `${kind === 'agent' ? 'Agent' : kind === 'file' ? '文件' : '卡片'}已加入“${joinedZone.title}”，将在用户开始讨论后进入共享上下文。`
            : `${kind === 'agent' ? 'Agent' : kind === 'file' ? '文件' : '卡片'}已移出讨论区。`
          : state.notice,
      }
    }),

  startDiscussion: (zoneId) => {
    const state = get()
    const zone = state.discussionZones.find((candidate) => candidate.id === zoneId)
    if (!zone) return
    if (zone.agentIds.length < 2) {
      set({ notice: '讨论区至少需要两个 Agent。' })
      return
    }
    if (!zone.cardIds.length && !zone.fileIds.length) {
      set({ notice: '讨论区至少需要一张 Idea 卡或文件卡。' })
      return
    }
    if (zone.status === 'running') {
      set({ notice: '该讨论区正在运行。' })
      return
    }
    set({ discussionDraftZoneId: zoneId, notice: null })
  },

  cancelDiscussionDraft: () => set({ discussionDraftZoneId: null }),

  confirmDiscussion: () => {
    const state = get()
    const zone = state.discussionZones.find((candidate) => candidate.id === state.discussionDraftZoneId)
    if (!zone || zone.agentIds.length < 2 || (!zone.cardIds.length && !zone.fileIds.length)) {
      set({ discussionDraftZoneId: null, notice: '讨论区配置已经变化，请重新确认。' })
      return
    }

    const busyAgentIds = new Set<AgentId>([
      ...state.runs.filter((run) => run.status === 'running').map((run) => run.agentId),
      ...state.discussionRuns
        .filter((run) => run.status === 'running')
        .flatMap((run) => run.agentIds),
    ])
    const busyAgent = zone.agentIds.find((agentId) => busyAgentIds.has(agentId))
    if (busyAgent) {
      const name = state.agents.find((agent) => agent.id === busyAgent)?.name ?? busyAgent
      set({ discussionDraftZoneId: null, notice: `${name} 正在执行另一项任务，请等待或先中断该任务。` })
      return
    }

    const runId = nextId('discussion-run')
    const contexts = zone.agentIds.map((agentId) => {
      const ownHistoryEntryIds = state.agentMemories
        .filter((memory) => memory.agentId === agentId)
        .map((memory) => memory.id)
      const blockedPeerHistoryEntryIds = state.agentMemories
        .filter((memory) => memory.agentId !== agentId)
        .map((memory) => memory.id)
      const explicitlySharedPeerCardIds = zone.cardIds.filter((cardId) => {
        const creator = state.cards.find((card) => card.id === cardId)?.creator
        return creator !== undefined && creator !== 'user' && creator !== agentId
      })
      return {
        agentId,
        currentSessionAgentIds: [...zone.agentIds],
        sharedCardIds: [...zone.cardIds],
        sharedFileIds: [...zone.fileIds],
        ownHistoryEntryIds,
        blockedPeerHistoryEntryIds,
        explicitlySharedPeerCardIds,
      }
    })
    const discussionRun: DiscussionRun = {
      id: runId,
      zoneId: zone.id,
      agentIds: [...zone.agentIds],
      sharedCardIds: [...zone.cardIds],
      sharedFileIds: [...zone.fileIds],
      contexts,
      sharedCardSnapshots: zone.cardIds
        .map((cardId) => state.cards.find((card) => card.id === cardId))
        .filter((card): card is IdeaCard => Boolean(card))
        .map((card) => ({
          id: card.id,
          title: card.title,
          content: card.content,
          position: { ...card.position },
        })),
      sharedFileSnapshots: zone.fileIds
        .map((fileId) => state.files.find((file) => file.id === fileId))
        .filter((file): file is FileCard => Boolean(file))
        .map((file) => ({
          id: file.id,
          name: file.name,
          summary: file.summary,
          contentText: file.contentText,
          parseStatus: file.parseStatus,
        })),
      status: 'running',
      attempt: 1,
      startedAt: '刚刚',
    }

    set((current) => ({
      discussionRuns: [...current.discussionRuns, discussionRun],
      discussionDraftZoneId: null,
      discussionZones: current.discussionZones.map((candidate) => candidate.id === zone.id
        ? { ...candidate, status: 'running', lastRunId: runId }
        : candidate),
      agents: current.agents.map((agent) => zone.agentIds.includes(agent.id)
        ? { ...agent, status: 'running' }
        : agent),
      notice: `“${zone.title}”正在运行；每个 Agent 会先独立处理自己的私有上下文。`,
    }))
    if (isDesktopRuntime()) {
      void dispatchDiscussionRun(runId)
    } else {
      scheduleDiscussionPreview(runId)
    }
  },

  completeDiscussionRun: (runId, execution) => {
    const pendingTimer = discussionTimers.get(runId)
    if (pendingTimer) clearTimeout(pendingTimer)
    discussionTimers.delete(runId)
    const state = get()
    const run = state.discussionRuns.find((candidate) => candidate.id === runId)
    const zone = run ? state.discussionZones.find((candidate) => candidate.id === run.zoneId) : null
    if (!run || !zone || run.status !== 'running') return
    const frozenZone: DiscussionZone = {
      ...zone,
      agentIds: [...run.agentIds],
      cardIds: [...run.sharedCardIds],
      fileIds: [...run.sharedFileIds],
    }
    const drafts = execution?.result.cards ?? []
    const outputs: IdeaCard[] = drafts.length
      ? drafts.map((draft, index, all) => ({
          id: nextId('discussion-result'),
          type: draft.type,
          title: draft.title,
          content: draft.content,
          status: 'unreviewed',
          creator: 'user',
          sourceDiscussionRunId: runId,
          parentCardIds: [...run.sharedCardIds],
          position: {
            x: zone.position.x + zone.size.width / 2 - 114 + (index - (all.length - 1) / 2) * 258,
            y: zone.position.y + zone.size.height + 90,
          },
          visible: true,
        }))
      : [makeDiscussionOutput(frozenZone, state.agents, state.cards, state.files, runId)]
    const memories: AgentMemoryEntry[] = run.agentIds.map((agentId) => ({
      id: nextId(`memory-${agentId}`),
      agentId,
      source: 'discussion',
      runId,
      inputCardIds: [...run.sharedCardIds],
      inputFileIds: [...run.sharedFileIds],
      outputCardIds: outputs.map((output) => output.id),
      privateSummary: execution?.privateSummaries[agentId]
        || `我参与了“${zone.title}”，处理了 ${run.sharedCardIds.length} 张卡片和 ${run.sharedFileIds.length} 个文件。其他 Agent 的历史未进入我的上下文。`,
      createdAt: '刚刚',
    }))
    set((current) => ({
      cards: [...current.cards, ...outputs],
      relations: run.sharedCardIds.length
        ? [...current.relations, ...outputs.map((output) => ({
            id: nextId('relation'),
            type: 'discusses' as const,
            fromCardIds: [...run.sharedCardIds],
            toCardId: output.id,
          }))]
        : current.relations,
      discussionRuns: current.discussionRuns.map((candidate) => candidate.id === runId
        ? {
            ...candidate,
            status: 'completed',
            outputCardId: outputs[0].id,
            outputCardIds: outputs.map((output) => output.id),
            finishedAt: '刚刚',
          }
        : candidate),
      agentMemories: [...current.agentMemories, ...memories],
      discussionZones: current.discussionZones.map((candidate) => candidate.id === run.zoneId
        ? { ...candidate, status: 'completed', lastRunId: runId }
        : candidate),
      agents: current.agents.map((agent) => run.agentIds.includes(agent.id)
        ? { ...agent, status: 'completed' }
        : agent),
      selectedCardId: outputs[0].id,
      selectedCardIds: outputs.map((output) => output.id),
      selectedFileId: null,
      notice: `“${zone.title}”已${execution ? '通过 AI ' : '在浏览器预览中'}完成讨论并生成 ${outputs.length} 张卡片；每个 Agent 只读取了自己的历史。`,
    }))
  },

  failDiscussionRun: (runId, error) => {
    const state = get()
    const run = state.discussionRuns.find((candidate) => candidate.id === runId)
    if (!run || run.status !== 'running') return
    set((current) => ({
      discussionRuns: current.discussionRuns.map((candidate) => candidate.id === runId
        ? { ...candidate, status: 'failed', error, finishedAt: '刚刚' }
        : candidate),
      discussionZones: current.discussionZones.map((zone) => zone.id === run.zoneId
        ? { ...zone, status: getZoneStatus(zone) }
        : zone),
      agents: current.agents.map((agent) => run.agentIds.includes(agent.id)
        ? { ...agent, status: 'failed' }
        : agent),
      notice: `讨论运行失败：${error}`,
    }))
  },

  interruptDiscussion: (runId) => {
    const state = get()
    const run = state.discussionRuns.find((candidate) => candidate.id === runId)
    if (!run || run.status !== 'running') return
    const timer = discussionTimers.get(runId)
    if (timer) clearTimeout(timer)
    discussionTimers.delete(runId)
    if (isDesktopRuntime()) {
      for (const agentId of run.agentIds) {
        void cancelAiRun(`${runId}--${agentId}`).catch(() => undefined)
      }
      void cancelAiRun(`${runId}--synthesis`).catch(() => undefined)
    }
    set((current) => ({
      discussionRuns: current.discussionRuns.map((candidate) => candidate.id === runId
        ? { ...candidate, status: 'interrupted', finishedAt: '刚刚' }
        : candidate),
      discussionZones: current.discussionZones.map((zone) => zone.id === run.zoneId
        ? { ...zone, status: getZoneStatus(zone) }
        : zone),
      agents: current.agents.map((agent) => run.agentIds.includes(agent.id)
        ? { ...agent, status: 'interrupted' }
        : agent),
      notice: '讨论已中断，未生成结果卡；冻结的输入记录仍然保留。',
    }))
  },

  retryDiscussion: (runId) => {
    const state = get()
    const run = state.discussionRuns.find((candidate) => candidate.id === runId)
    if (!run || (run.status !== 'interrupted' && run.status !== 'failed')) return
    const otherBusyAgentIds = new Set<AgentId>([
      ...state.runs.filter((candidate) => candidate.status === 'running').map((candidate) => candidate.agentId),
      ...state.discussionRuns
        .filter((candidate) => candidate.id !== runId && candidate.status === 'running')
        .flatMap((candidate) => candidate.agentIds),
    ])
    if (run.agentIds.some((agentId) => otherBusyAgentIds.has(agentId))) {
      set({ notice: '本轮参与者正在执行其他任务，暂时不能重试。' })
      return
    }
    set((current) => ({
      discussionRuns: current.discussionRuns.map((candidate) => candidate.id === runId
        ? { ...candidate, status: 'running', error: undefined, finishedAt: undefined, attempt: (candidate.attempt ?? 1) + 1 }
        : candidate),
      discussionZones: current.discussionZones.map((zone) => zone.id === run.zoneId
        ? { ...zone, status: 'running', lastRunId: runId }
        : zone),
      agents: current.agents.map((agent) => run.agentIds.includes(agent.id)
        ? { ...agent, status: 'running' }
        : agent),
      notice: '正在使用上次冻结的讨论上下文重试。',
    }))
    if (isDesktopRuntime()) {
      void dispatchDiscussionRun(runId)
    } else {
      scheduleDiscussionPreview(runId)
    }
  },

  focusAgent: (agentId) =>
    set((state) => ({
      selectedAgentId: state.selectedAgentId === agentId ? null : agentId,
      notice: agentId ? '已高亮该 Agent 的输出卡片。' : null,
    })),

  openAssignment: (agentId, explicitCardIds) => {
    const state = get()
    const cardIds = explicitCardIds?.length ? explicitCardIds : state.selectedCardIds
    const usableCardIds = cardIds.filter((id) => state.cards.some((card) => card.id === id && card.visible))
    if (!usableCardIds.length) {
      set({ notice: '请先在画布中选择至少一张卡片。' })
      return
    }
    set({
      selectedAgentId: agentId,
      selectedCardIds: usableCardIds,
      selectedCardId: usableCardIds.at(-1) ?? state.selectedCardId,
      assignmentDraft: { agentId, cardIds: usableCardIds, action: defaultActions[agentId], customInstruction: '' },
      notice: null,
    })
  },

  setAssignmentAction: (action) =>
    set((state) => ({
      assignmentDraft: state.assignmentDraft ? { ...state.assignmentDraft, action } : null,
    })),

  setAssignmentInstruction: (instruction) =>
    set((state) => ({
      assignmentDraft: state.assignmentDraft
        ? { ...state.assignmentDraft, customInstruction: instruction }
        : null,
    })),

  cancelAssignment: () => set({ assignmentDraft: null }),

  confirmAssignment: () => {
    const state = get()
    const draft = state.assignmentDraft
    if (!draft) return
    const customInstruction = draft.action === 'custom' ? draft.customInstruction.trim() : undefined
    if (draft.action === 'custom' && !customInstruction) {
      set({ notice: '请输入自定义指令后再运行。' })
      return
    }
    if (customInstruction && customInstruction.length > MAX_CUSTOM_INSTRUCTION_LENGTH) {
      set({ notice: `自定义指令不能超过 ${MAX_CUSTOM_INSTRUCTION_LENGTH} 个字符。` })
      return
    }
    const agentBusy = state.runs.some((run) => run.status === 'running' && run.agentId === draft.agentId)
      || state.discussionRuns.some((run) => run.status === 'running' && run.agentIds.includes(draft.agentId))
    if (agentBusy) {
      const name = state.agents.find((agent) => agent.id === draft.agentId)?.name ?? draft.agentId
      set({ assignmentDraft: null, notice: `${name} 正在执行另一项任务，请等待或先中断该任务。` })
      return
    }
    const inputs = draft.cardIds
      .map((id) => state.cards.find((card) => card.id === id))
      .filter((card): card is IdeaCard => Boolean(card))
    if (!inputs.length) {
      set({ assignmentDraft: null, notice: '输入卡片不存在，未创建运行。' })
      return
    }

    const runId = nextId('run')
    const run: Run = {
      id: runId,
      agentId: draft.agentId,
      label: actionLabels[draft.action],
      action: draft.action,
      customInstruction,
      inputCardIds: [...draft.cardIds],
      inputSnapshots: inputs.map((card) => ({
        id: card.id,
        title: card.title,
        content: card.content,
        position: { ...card.position },
      })),
      ownHistoryEntryIds: state.agentMemories
        .filter((memory) => memory.agentId === draft.agentId)
        .map((memory) => memory.id),
      status: 'running',
      attempt: 1,
      outputCount: 0,
      outputCardIds: [],
      startedAt: '刚刚',
    }

    set((current) => ({
      runs: [...current.runs, run],
      agents: current.agents.map((agent) =>
        agent.id === draft.agentId ? { ...agent, status: 'running' } : agent,
      ),
      assignmentDraft: null,
      notice: `${current.agents.find((agent) => agent.id === draft.agentId)?.name} 正在处理 ${draft.cardIds.length} 张冻结输入。`,
    }))
    if (isDesktopRuntime()) {
      void dispatchAgentRun(runId)
    } else {
      scheduleAgentPreview(runId)
    }
  },

  mergeSelectedCards: () => {
    const state = get()
    const inputs = state.selectedCardIds
      .map((id) => state.cards.find((card) => card.id === id))
      .filter((card): card is IdeaCard => Boolean(card && card.visible && card.status !== 'rejected'))
    if (inputs.length < 2) {
      set({ notice: '至少选择两张未排除的卡片才能合并。' })
      return
    }
    const mergedId = nextId('merged-card')
    const merged: IdeaCard = {
      id: mergedId,
      type: 'idea',
      title: `融合：${inputs.map((card) => card.title).join(' × ')}`,
      content: inputs.map((card) => card.content).join('；'),
      status: 'unreviewed',
      creator: 'user',
      parentCardIds: inputs.map((card) => card.id),
      position: {
        x: inputs.reduce((sum, card) => sum + card.position.x, 0) / inputs.length,
        y: Math.max(...inputs.map((card) => card.position.y)) + 260,
      },
      visible: true,
    }
    set((current) => ({
      cards: [...current.cards, merged],
      relations: [
        ...current.relations,
        { id: nextId('relation'), type: 'merges', fromCardIds: inputs.map((card) => card.id), toCardId: mergedId },
      ],
      selectedCardId: mergedId,
      selectedCardIds: [mergedId],
      notice: '已生成一张融合卡片，原卡片保持不变。',
    }))
  },

  generateSnapshot: () => {
    const candidates = getSnapshotCandidates(get().cards)
    if (!candidates.length) {
      set({ notice: '请先保留或确认至少一张卡片。' })
      return
    }
    const draft: IdeaSnapshot = {
      id: nextId('snapshot'),
      title: `Idea Snapshot ${get().snapshots.length + 1}`,
      summary: candidates.map((card) => `${card.title}：${card.content}`).join('\n\n'),
      includedCardIds: candidates.map((card) => card.id),
      assumptions: candidates.filter((card) => card.type === 'assumption').map((card) => card.title),
      openQuestions: candidates.filter((card) => card.type === 'question').map((card) => card.title),
      decisions: candidates.filter((card) => card.type === 'decision' || card.status === 'decided').map((card) => card.title),
      createdAt: new Date().toLocaleString('zh-CN'),
    }
    set({ snapshotDraft: draft, notice: null })
  },

  updateSnapshotSummary: (summary) =>
    set((state) => ({ snapshotDraft: state.snapshotDraft ? { ...state.snapshotDraft, summary } : null })),

  saveSnapshot: () =>
    set((state) => {
      if (!state.snapshotDraft) return state
      return {
        snapshots: [...state.snapshots, state.snapshotDraft],
        snapshotDraft: null,
        notice: `已保存 ${state.snapshotDraft.title}。`,
      }
    }),

  closeSnapshot: () => set({ snapshotDraft: null }),

  openHistory: () => set({ historyOpen: true }),

  closeHistory: () => set({ historyOpen: false }),

  dismissNotice: () => set({ notice: null }),

  showNotice: (message) => set({ notice: message }),

  resetWorkspace: () => {
    clearDiscussionTimers()
    clearAgentRunTimers()
    generatedSequence = 0
    set(initialState())
  },
}))

export function getSnapshotCandidates(cards: IdeaCard[]) {
  return cards.filter((card) => card.status === 'kept' || card.status === 'decided')
}

export function getWorkspaceDocument(state: WorkspaceState): WorkspaceDocument {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    workspace: state.workspace,
    agents: state.agents,
    cards: state.cards,
    files: state.files,
    discussionZones: state.discussionZones,
    discussionRuns: state.discussionRuns,
    agentMemories: state.agentMemories,
    runs: state.runs,
    relations: state.relations,
    snapshots: state.snapshots,
  }
}

export function getAgentVisibleContext(
  run: DiscussionRun,
  agentId: AgentId,
  cards: IdeaCard[],
  files: FileCard[],
  memories: AgentMemoryEntry[],
): AgentVisibleContext | null {
  const snapshot = run.contexts.find((context) => context.agentId === agentId)
  if (!snapshot) return null
  const sharedCardIds = new Set(snapshot.sharedCardIds)
  const sharedFileIds = new Set(snapshot.sharedFileIds)
  const ownHistoryEntryIds = new Set(snapshot.ownHistoryEntryIds)
  return {
    agentId,
    currentSessionAgentIds: [...snapshot.currentSessionAgentIds],
    sharedCards: cards.filter((card) => sharedCardIds.has(card.id)),
    sharedFiles: files.filter((file) => sharedFileIds.has(file.id)),
    ownHistory: memories.filter((memory) => (
      memory.agentId === agentId && ownHistoryEntryIds.has(memory.id)
    )),
    explicitlySharedPeerCardIds: [...snapshot.explicitlySharedPeerCardIds],
  }
}
