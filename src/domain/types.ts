export type AgentId = 'explorer' | 'critic' | 'simplifier'

export type AgentStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'needs_user'
  | 'completed'
  | 'interrupted'
  | 'failed'

export type CardType = 'idea' | 'question' | 'assumption' | 'decision'

export type CardStatus =
  | 'unreviewed'
  | 'kept'
  | 'uncertain'
  | 'rejected'
  | 'decided'

export type AgentAction =
  | 'expand'
  | 'critique'
  | 'simplify'
  | 'answer'
  | 'opposite'
  | 'custom'

export type RelationType =
  | 'derived_from'
  | 'critiques'
  | 'answers'
  | 'merges'
  | 'contradicts'
  | 'compares'
  | 'discusses'

export type DiscussionStatus = 'draft' | 'ready' | 'running' | 'completed'

export type ZoneMemberKind = 'agent' | 'card' | 'file'

export interface Agent {
  id: AgentId
  name: string
  role: string
  description: string
  status: AgentStatus
  accent: string
  position: { x: number; y: number }
}

export interface IdeaCard {
  id: string
  type: CardType
  title: string
  content: string
  status: CardStatus
  creator: 'user' | AgentId
  sourceRunId?: string
  sourceDiscussionRunId?: string
  parentCardIds: string[]
  position: { x: number; y: number }
  visible: boolean
  hiddenByUser?: boolean
}

export interface FileCard {
  id: string
  name: string
  fileType: 'markdown' | 'pdf' | 'text'
  mimeType: string
  sizeLabel: string
  summary: string
  contentText?: string
  parseStatus: 'ready' | 'metadata_only' | 'failed'
  lastModified: number
  position: { x: number; y: number }
}

export interface DiscussionZone {
  id: string
  title: string
  description: string
  status: DiscussionStatus
  position: { x: number; y: number }
  size: { width: number; height: number }
  agentIds: AgentId[]
  cardIds: string[]
  fileIds: string[]
  lastRunId?: string
}

export interface AgentMemoryEntry {
  id: string
  agentId: AgentId
  source: 'independent' | 'directed' | 'discussion'
  runId: string
  inputCardIds: string[]
  inputFileIds: string[]
  outputCardIds: string[]
  privateSummary: string
  createdAt: string
}

export interface AgentContextSnapshot {
  agentId: AgentId
  currentSessionAgentIds: AgentId[]
  sharedCardIds: string[]
  sharedFileIds: string[]
  ownHistoryEntryIds: string[]
  blockedPeerHistoryEntryIds: string[]
  explicitlySharedPeerCardIds: string[]
}

export interface CardContextSnapshot {
  id: string
  title: string
  content: string
  position: { x: number; y: number }
}

export interface FileContextSnapshot {
  id: string
  name: string
  summary: string
  contentText?: string
  parseStatus: FileCard['parseStatus']
}

export interface DiscussionRun {
  id: string
  zoneId: string
  agentIds: AgentId[]
  sharedCardIds: string[]
  sharedFileIds: string[]
  contexts: AgentContextSnapshot[]
  /** Frozen content prevents board edits from changing an in-flight prompt. */
  sharedCardSnapshots?: CardContextSnapshot[]
  sharedFileSnapshots?: FileContextSnapshot[]
  status: AgentStatus
  outputCardId?: string
  outputCardIds?: string[]
  attempt?: number
  startedAt: string
  finishedAt?: string
  error?: string
}

export interface AgentVisibleContext {
  agentId: AgentId
  currentSessionAgentIds: AgentId[]
  sharedCards: IdeaCard[]
  sharedFiles: FileCard[]
  ownHistory: AgentMemoryEntry[]
  explicitlySharedPeerCardIds: string[]
}

export interface Run {
  id: string
  agentId: AgentId
  label: string
  action: AgentAction
  /** Frozen user-authored instruction for a custom action. Older v1 projects omit it. */
  customInstruction?: string
  inputCardIds: string[]
  inputSnapshots: CardContextSnapshot[]
  /** Frozen private-memory boundary for this run. Older v1 projects may omit it. */
  ownHistoryEntryIds?: string[]
  attempt?: number
  status: AgentStatus
  outputCount: number
  outputCardIds: string[]
  startedAt: string
  finishedAt?: string
  error?: string
}

export interface Relation {
  id: string
  type: RelationType
  fromCardIds: string[]
  toCardId: string
}

export interface AssignmentDraft {
  agentId: AgentId
  cardIds: string[]
  action: AgentAction
  customInstruction: string
}

export interface IdeaSnapshot {
  id: string
  title: string
  summary: string
  includedCardIds: string[]
  assumptions: string[]
  openQuestions: string[]
  decisions: string[]
  createdAt: string
}

export interface Workspace {
  id: string
  title: string
  subtitle: string
}

export interface WorkspaceDocument {
  version: 1
  savedAt: string
  workspace: Workspace
  agents: Agent[]
  cards: IdeaCard[]
  files: FileCard[]
  discussionZones: DiscussionZone[]
  discussionRuns: DiscussionRun[]
  agentMemories: AgentMemoryEntry[]
  runs: Run[]
  relations: Relation[]
  snapshots: IdeaSnapshot[]
}
