import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_CUSTOM_INSTRUCTION_LENGTH } from '../domain/agent-profiles'
import type { AgentAction, AgentId, CardType, IdeaCard } from '../domain/types'
import { demoAgents, demoCards } from '../fixtures/demo-workspace'
import { getAgentVisibleContext, getSnapshotCandidates, getWorkspaceDocument, useWorkspaceStore } from './workspace-store'

beforeEach(() => {
  useWorkspaceStore.getState().resetWorkspace()
})

function createUserCard(type: CardType, title: string) {
  useWorkspaceStore.getState().createUserCard(type, title, `${title}的正文。`)
  return useWorkspaceStore.getState().selectedCardId
}

function runAgent(agentId: AgentId, cardIds: string[] = ['root-idea'], action?: AgentAction) {
  useWorkspaceStore.getState().selectCards(cardIds)
  useWorkspaceStore.getState().openAssignment(agentId)
  if (action) useWorkspaceStore.getState().setAssignmentAction(action)
  useWorkspaceStore.getState().confirmAssignment()
  const runId = useWorkspaceStore.getState().runs.at(-1)?.id
  expect(runId).toBeTruthy()
  useWorkspaceStore.getState().completeAgentRun(runId!)
  return useWorkspaceStore.getState().runs.find((run) => run.id === runId)?.outputCardIds[0]!
}

describe('getSnapshotCandidates', () => {
  it('只返回用户已经保留或确认的卡片', () => {
    const cards: IdeaCard[] = demoCards.map((card, index) => ({
      ...card,
      status: index === 0 ? 'kept' : index === 1 ? 'decided' : 'unreviewed',
    }))

    expect(getSnapshotCandidates(cards).map((card) => card.id)).toEqual([
      'root-idea',
      'explorer-branch',
    ])
  })

  it('排除 rejected 和 uncertain 卡片', () => {
    const cards: IdeaCard[] = demoCards.slice(0, 2).map((card, index) => ({
      ...card,
      status: index === 0 ? 'rejected' : 'uncertain',
    }))

    expect(getSnapshotCandidates(cards)).toEqual([])
  })
})

describe('假数据核心循环', () => {
  it('记录 Agent 选择，并高亮来源而不修改卡片', () => {
    useWorkspaceStore.getState().focusAgent('critic')
    expect(useWorkspaceStore.getState().selectedAgentId).toBe('critic')
    expect(useWorkspaceStore.getState().cards).toHaveLength(1)

    useWorkspaceStore.getState().focusAgent('critic')
    expect(useWorkspaceStore.getState().selectedAgentId).toBeNull()
  })

  it('保存白板上 Agent 卡片的位置', () => {
    useWorkspaceStore.getState().updateAgentPositions({
      explorer: { x: 240, y: 180 },
    })

    expect(useWorkspaceStore.getState().agents.find((agent) => agent.id === 'explorer')?.position)
      .toEqual({ x: 240, y: 180 })
    expect(useWorkspaceStore.getState().agents.find((agent) => agent.id === 'critic')?.position)
      .toEqual(demoAgents.find((agent) => agent.id === 'critic')?.position)
  })

  it('把所选卡片授权给目标 Agent，并保存 Run 输入与来源关系', () => {
    const store = useWorkspaceStore.getState()
    const assumptionId = createUserCard('assumption', '需要验证的假设')
    store.selectCards(['root-idea', assumptionId])
    store.openAssignment('explorer')
    useWorkspaceStore.getState().setAssignmentAction('opposite')
    useWorkspaceStore.getState().confirmAssignment()
    const pendingRunId = useWorkspaceStore.getState().runs.at(-1)?.id
    useWorkspaceStore.getState().completeAgentRun(pendingRunId!)

    const state = useWorkspaceStore.getState()
    const output = state.cards.at(-1)
    const run = state.runs.at(-1)
    const relation = state.relations.at(-1)

    expect(output?.creator).toBe('explorer')
    expect(output?.parentCardIds).toEqual(['root-idea', assumptionId])
    expect(run?.inputCardIds).toEqual(['root-idea', assumptionId])
    expect(run?.action).toBe('opposite')
    expect(relation).toMatchObject({ type: 'contradicts', toCardId: output?.id })
    expect(state.agentMemories.filter((memory) => memory.agentId === 'explorer')).toHaveLength(1)
    expect(state.agentMemories.at(-1)).toMatchObject({
      agentId: 'explorer',
      source: 'directed',
      inputCardIds: ['root-idea', assumptionId],
      outputCardIds: [output?.id],
    })
    expect(state.assignmentDraft).toBeNull()
    expect(state.selectedCardIds).toEqual([output?.id])
  })

  it('冻结自定义指令，并在中断重试时复用原指令', () => {
    const instruction = '把选中的卡片整理为两个面向独立创作者的使用场景。'
    useWorkspaceStore.getState().openAssignment('explorer', ['root-idea'])
    useWorkspaceStore.getState().setAssignmentAction('custom')
    useWorkspaceStore.getState().setAssignmentInstruction(`  ${instruction}  `)
    useWorkspaceStore.getState().confirmAssignment()

    let run = useWorkspaceStore.getState().runs.at(-1)!
    expect(run).toMatchObject({
      agentId: 'explorer',
      action: 'custom',
      label: '执行自定义指令',
      customInstruction: instruction,
      inputCardIds: ['root-idea'],
    })

    useWorkspaceStore.getState().interruptAgentRun(run.id)
    useWorkspaceStore.getState().retryAgentRun(run.id)
    run = useWorkspaceStore.getState().runs.find((candidate) => candidate.id === run.id)!
    expect(run.customInstruction).toBe(instruction)
    expect(run.attempt).toBe(2)

    useWorkspaceStore.getState().completeAgentRun(run.id)
    expect(useWorkspaceStore.getState().relations.at(-1)?.type).toBe('derived_from')
    expect(useWorkspaceStore.getState().cards.at(-1)?.content).toContain(instruction)

    useWorkspaceStore.getState().openAssignment('critic', ['root-idea'])
    expect(useWorkspaceStore.getState().assignmentDraft?.customInstruction).toBe('')
  })

  it('拒绝空白或超长自定义指令', () => {
    useWorkspaceStore.getState().openAssignment('critic', ['root-idea'])
    useWorkspaceStore.getState().setAssignmentAction('custom')
    useWorkspaceStore.getState().setAssignmentInstruction('   ')
    useWorkspaceStore.getState().confirmAssignment()

    expect(useWorkspaceStore.getState().runs).toHaveLength(0)
    expect(useWorkspaceStore.getState().assignmentDraft?.action).toBe('custom')
    expect(useWorkspaceStore.getState().notice).toContain('请输入自定义指令')

    useWorkspaceStore.getState().setAssignmentInstruction('x'.repeat(MAX_CUSTOM_INSTRUCTION_LENGTH + 50))
    useWorkspaceStore.getState().confirmAssignment()
    expect(useWorkspaceStore.getState().runs).toHaveLength(0)
    expect(useWorkspaceStore.getState().assignmentDraft?.customInstruction).toHaveLength(MAX_CUSTOM_INSTRUCTION_LENGTH + 50)
    expect(useWorkspaceStore.getState().notice).toContain(`不能超过 ${MAX_CUSTOM_INSTRUCTION_LENGTH}`)
  })

  it('提交真实结构化结果时可一次生成多张卡片，并冻结自己的历史边界', () => {
    const firstOutputId = runAgent('explorer')
    const firstMemoryId = useWorkspaceStore.getState().agentMemories.at(-1)?.id
    useWorkspaceStore.getState().selectCards(['root-idea', firstOutputId])
    useWorkspaceStore.getState().openAssignment('explorer')
    useWorkspaceStore.getState().confirmAssignment()
    const run = useWorkspaceStore.getState().runs.at(-1)

    expect(run?.ownHistoryEntryIds).toEqual([firstMemoryId])
    useWorkspaceStore.getState().completeAgentRun(run!.id, {
      cards: [
        { type: 'idea', title: '真实分支 A', content: '第一条可继续发展的分支。' },
        { type: 'question', title: '真实问题 B', content: '需要用户继续判断的问题。' },
      ],
      privateSummary: '我综合两张授权卡片形成了两个互补输出。',
    })

    const state = useWorkspaceStore.getState()
    const completed = state.runs.find((candidate) => candidate.id === run?.id)
    expect(completed?.outputCount).toBe(2)
    expect(completed?.outputCardIds).toHaveLength(2)
    expect(state.selectedCardIds).toEqual(completed?.outputCardIds)
    expect(state.agentMemories.at(-1)?.privateSummary).toBe('我综合两张授权卡片形成了两个互补输出。')
  })

  it('中断后忽略迟到的模型结果，不生成半成品卡片', () => {
    useWorkspaceStore.getState().openAssignment('critic', ['root-idea'])
    useWorkspaceStore.getState().confirmAssignment()
    const run = useWorkspaceStore.getState().runs.at(-1)!
    const beforeCount = useWorkspaceStore.getState().cards.length

    useWorkspaceStore.getState().interruptAgentRun(run.id)
    useWorkspaceStore.getState().completeAgentRun(run.id, {
      cards: [{ type: 'assumption', title: '迟到结果', content: '不应落到白板。' }],
      privateSummary: '不应保存。',
    })

    expect(useWorkspaceStore.getState().cards).toHaveLength(beforeCount)
    expect(useWorkspaceStore.getState().runs.at(-1)?.status).toBe('interrupted')
  })

  it('合并两张卡片但保留原卡片和来源', () => {
    const store = useWorkspaceStore.getState()
    const firstId = createUserCard('idea', '方向 A')
    const secondId = createUserCard('decision', '方向 B')
    store.selectCards([firstId, secondId])
    store.mergeSelectedCards()

    const state = useWorkspaceStore.getState()
    const merged = state.cards.at(-1)
    expect(state.cards).toHaveLength(4)
    expect(merged).toMatchObject({
      creator: 'user',
      type: 'idea',
      parentCardIds: [firstId, secondId],
    })
    expect(state.relations.at(-1)?.type).toBe('merges')
  })

  it('只用保留或决定的卡片生成、编辑并保存 Snapshot', () => {
    const store = useWorkspaceStore.getState()
    const keptId = createUserCard('idea', '保留方向')
    const uncertainId = createUserCard('assumption', '存疑方向')
    const decidedId = createUserCard('decision', '确定方向')
    store.updateCardStatus(keptId, 'kept')
    store.updateCardStatus(uncertainId, 'uncertain')
    store.updateCardStatus(decidedId, 'decided')
    store.generateSnapshot()

    const draft = useWorkspaceStore.getState().snapshotDraft
    expect(draft?.includedCardIds).toEqual([
      'root-idea',
      keptId,
      decidedId,
    ])

    useWorkspaceStore.getState().updateSnapshotSummary('用户编辑后的 Idea 版本')
    useWorkspaceStore.getState().saveSnapshot()
    const state = useWorkspaceStore.getState()
    expect(state.snapshots).toHaveLength(1)
    expect(state.snapshots[0].summary).toBe('用户编辑后的 Idea 版本')
    expect(state.snapshotDraft).toBeNull()

    state.openHistory()
    expect(useWorkspaceStore.getState().historyOpen).toBe(true)
    useWorkspaceStore.getState().closeHistory()
    expect(useWorkspaceStore.getState().historyOpen).toBe(false)
  })
})

describe('讨论区与 Agent 私有历史', () => {
  function moveIntoZone(kind: 'agent' | 'card' | 'file', id: string, x: number, y: number) {
    useWorkspaceStore.getState().syncZoneMembership(kind, id, { x, y })
  }

  function prepareDiscussion() {
    runAgent('explorer')
    const criticOutputId = runAgent('critic')
    runAgent('simplifier')
    const state = useWorkspaceStore.getState()
    const explorerMemoryId = state.agentMemories.find((memory) => memory.agentId === 'explorer')!.id
    const criticMemoryId = state.agentMemories.find((memory) => memory.agentId === 'critic')!.id
    const simplifierMemoryId = state.agentMemories.find((memory) => memory.agentId === 'simplifier')!.id
    moveIntoZone('agent', 'explorer', 990, -100)
    moveIntoZone('agent', 'critic', 1280, -100)
    moveIntoZone('card', 'root-idea', 1010, 90)
    moveIntoZone('card', criticOutputId, 1260, 90)
    moveIntoZone('file', 'file-product-brief', 1450, 100)
    return { criticOutputId, explorerMemoryId, criticMemoryId, simplifierMemoryId }
  }

  it('用卡片中心判断加入和移出，并据此更新讨论区状态', () => {
    moveIntoZone('agent', 'explorer', 990, -100)
    moveIntoZone('agent', 'critic', 1280, -100)
    moveIntoZone('card', 'root-idea', 1010, 90)

    let zone = useWorkspaceStore.getState().discussionZones[0]
    expect(zone.agentIds).toEqual(['explorer', 'critic'])
    expect(zone.cardIds).toEqual(['root-idea'])
    expect(zone.status).toBe('ready')

    moveIntoZone('agent', 'critic', 100, -100)
    zone = useWorkspaceStore.getState().discussionZones[0]
    expect(zone.agentIds).toEqual(['explorer'])
    expect(zone.status).toBe('draft')
  })

  it('冻结当前共享输入，同时只给每个 Agent 自己的历史', () => {
    vi.useFakeTimers()
    const { criticOutputId, explorerMemoryId, criticMemoryId, simplifierMemoryId } = prepareDiscussion()
    useWorkspaceStore.getState().startDiscussion('zone-main-workshop')
    expect(useWorkspaceStore.getState().discussionDraftZoneId).toBe('zone-main-workshop')
    useWorkspaceStore.getState().confirmDiscussion()
    expect(useWorkspaceStore.getState().discussionRuns.at(-1)?.status).toBe('running')
    vi.advanceTimersByTime(900)

    const state = useWorkspaceStore.getState()
    const run = state.discussionRuns.at(-1)
    const explorerContext = run?.contexts.find((context) => context.agentId === 'explorer')
    const criticContext = run?.contexts.find((context) => context.agentId === 'critic')

    expect(run).toMatchObject({
      agentIds: ['explorer', 'critic'],
      sharedCardIds: ['root-idea', criticOutputId],
      sharedFileIds: ['file-product-brief'],
      status: 'completed',
    })
    expect(explorerContext?.ownHistoryEntryIds).toEqual([explorerMemoryId])
    expect(explorerContext?.blockedPeerHistoryEntryIds).toEqual([
      criticMemoryId,
      simplifierMemoryId,
    ])
    expect(explorerContext?.explicitlySharedPeerCardIds).toEqual([criticOutputId])
    expect(criticContext?.ownHistoryEntryIds).toEqual([criticMemoryId])
    expect(criticContext?.explicitlySharedPeerCardIds).toEqual([])
    expect(state.cards.find((card) => card.id === run?.outputCardId)?.sourceDiscussionRunId).toBe(run?.id)

    const visibleContext = run
      ? getAgentVisibleContext(run, 'explorer', state.cards, state.files, state.agentMemories)
      : null
    expect(visibleContext?.ownHistory.map((memory) => memory.agentId)).toEqual(['explorer'])
    expect(visibleContext?.sharedCards.map((card) => card.id)).toContain(criticOutputId)
    expect(visibleContext).not.toHaveProperty('blockedPeerHistoryEntryIds')
    expect(JSON.stringify(visibleContext)).not.toContain(criticMemoryId)
    vi.useRealTimers()
  })

  it('下一轮能读取自己的讨论记忆，但仍隔离其他 Agent 的历史', () => {
    vi.useFakeTimers()
    const { explorerMemoryId, criticMemoryId } = prepareDiscussion()
    useWorkspaceStore.getState().startDiscussion('zone-main-workshop')
    useWorkspaceStore.getState().confirmDiscussion()
    vi.advanceTimersByTime(900)
    useWorkspaceStore.getState().startDiscussion('zone-main-workshop')
    useWorkspaceStore.getState().confirmDiscussion()
    vi.advanceTimersByTime(900)

    const runs = useWorkspaceStore.getState().discussionRuns
    const secondRun = runs.at(-1)
    const explorerContext = secondRun?.contexts.find((context) => context.agentId === 'explorer')
    const criticContext = secondRun?.contexts.find((context) => context.agentId === 'critic')

    expect(runs).toHaveLength(2)
    expect(explorerContext?.ownHistoryEntryIds).toHaveLength(2)
    expect(explorerContext?.ownHistoryEntryIds).toContain(explorerMemoryId)
    expect(explorerContext?.blockedPeerHistoryEntryIds).toContain(criticMemoryId)
    expect(criticContext?.ownHistoryEntryIds).toHaveLength(2)

    moveIntoZone('agent', 'explorer', 100, -100)
    const state = useWorkspaceStore.getState()
    expect(state.discussionZones[0].agentIds).not.toContain('explorer')
    expect(state.agentMemories.filter((memory) => memory.agentId === 'explorer')).toHaveLength(3)
    vi.useRealTimers()
  })

  it('运行中的讨论可以中断，并使用同一份冻结上下文重试', () => {
    vi.useFakeTimers()
    prepareDiscussion()
    useWorkspaceStore.getState().startDiscussion('zone-main-workshop')
    useWorkspaceStore.getState().confirmDiscussion()
    const runId = useWorkspaceStore.getState().discussionRuns.at(-1)?.id
    expect(runId).toBeTruthy()

    useWorkspaceStore.getState().interruptDiscussion(runId!)
    expect(useWorkspaceStore.getState().discussionRuns.at(-1)?.status).toBe('interrupted')
    expect(useWorkspaceStore.getState().cards.some((card) => card.sourceDiscussionRunId === runId)).toBe(false)
    const frozenCards = useWorkspaceStore.getState().discussionRuns.at(-1)?.sharedCardSnapshots

    useWorkspaceStore.getState().retryDiscussion(runId!)
    const retried = useWorkspaceStore.getState().discussionRuns.at(-1)
    expect(retried?.status).toBe('running')
    expect(retried?.attempt).toBe(2)
    expect(retried?.sharedCardSnapshots).toEqual(frozenCards)
    expect(useWorkspaceStore.getState().discussionDraftZoneId).toBeNull()
    vi.useRealTimers()
  })
})

describe('本地 Workspace 和用户编辑', () => {
  it('创建自己的 Workspace 并可序列化后重新打开', () => {
    useWorkspaceStore.getState().createWorkspace('我的新 Idea', '从一个真实问题开始。')
    let state = useWorkspaceStore.getState()
    expect(state.workspace.title).toBe('我的新 Idea')
    expect(state.cards[0]).toMatchObject({ title: '我的新 Idea', content: '从一个真实问题开始。' })
    expect(state.files).toEqual([])

    const document = getWorkspaceDocument(state)
    useWorkspaceStore.getState().resetWorkspace()
    useWorkspaceStore.getState().importWorkspaceDocument(document)
    state = useWorkspaceStore.getState()
    expect(state.workspace.title).toBe('我的新 Idea')
    expect(state.cards[0].content).toBe('从一个真实问题开始。')
  })

  it('允许用户新建、编辑、比较并标记两张卡片冲突', () => {
    const store = useWorkspaceStore.getState()
    store.createUserCard('question', '谁会使用？', '需要明确第一批用户。')
    const firstId = useWorkspaceStore.getState().selectedCardId
    useWorkspaceStore.getState().editCard(firstId, 'question', '第一批用户是谁？', '先聚焦个人创作者。')
    useWorkspaceStore.getState().createUserCard('assumption', '用户愿意整理', '需要访谈验证。')
    const secondId = useWorkspaceStore.getState().selectedCardId
    useWorkspaceStore.getState().selectCards([firstId, secondId])
    useWorkspaceStore.getState().contradictSelectedCards()
    expect(useWorkspaceStore.getState().relations.at(-1)).toMatchObject({
      type: 'contradicts',
      fromCardIds: [firstId],
      toCardId: secondId,
    })

    useWorkspaceStore.getState().compareSelectedCards()
    expect(useWorkspaceStore.getState().cards.at(-1)).toMatchObject({
      creator: 'user',
      parentCardIds: [firstId, secondId],
    })
    expect(useWorkspaceStore.getState().cards.find((card) => card.id === firstId)?.title).toBe('第一批用户是谁？')
  })

  it('永久删除卡片并原子清理白板关系、讨论区和未保存草稿', () => {
    const sourceId = createUserCard('idea', '准备删除的方向')
    useWorkspaceStore.getState().updateCardStatus(sourceId, 'kept')
    const outputId = runAgent('explorer', [sourceId])
    useWorkspaceStore.getState().syncZoneMembership('card', sourceId, { x: 1050, y: 50 })
    useWorkspaceStore.getState().generateSnapshot()
    useWorkspaceStore.getState().openAssignment('critic', [sourceId])

    useWorkspaceStore.getState().deleteCards([sourceId])
    let state = useWorkspaceStore.getState()

    expect(state.cards.some((card) => card.id === sourceId)).toBe(false)
    expect(state.cards.find((card) => card.id === outputId)?.parentCardIds).not.toContain(sourceId)
    expect(state.relations.some((relation) => (
      relation.toCardId === sourceId || relation.fromCardIds.includes(sourceId)
    ))).toBe(false)
    expect(state.discussionZones[0].cardIds).not.toContain(sourceId)
    expect(state.assignmentDraft).toBeNull()
    expect(state.snapshotDraft).toBeNull()
    expect(state.runs.find((run) => run.inputCardIds.includes(sourceId))?.inputSnapshots[0].title)
      .toBe('准备删除的方向')

    state.restoreHiddenCards()
    state = useWorkspaceStore.getState()
    expect(state.cards.some((card) => card.id === sourceId)).toBe(false)
  })

  it('根 Idea 永远保留，混合选择时只删除其他卡片', () => {
    const removableId = createUserCard('question', '可删除问题')
    useWorkspaceStore.getState().deleteCards(['root-idea', removableId])

    const state = useWorkspaceStore.getState()
    expect(state.cards.some((card) => card.id === 'root-idea')).toBe(true)
    expect(state.cards.some((card) => card.id === removableId)).toBe(false)
    expect(state.notice).toContain('根 Idea 已保留')
  })

  it('拒绝删除正在被 Agent 处理的输入卡片', () => {
    const activeId = createUserCard('idea', '运行中的输入')
    useWorkspaceStore.getState().openAssignment('explorer', [activeId])
    useWorkspaceStore.getState().confirmAssignment()
    const runId = useWorkspaceStore.getState().runs.at(-1)!.id

    useWorkspaceStore.getState().deleteCards([activeId])
    expect(useWorkspaceStore.getState().cards.some((card) => card.id === activeId)).toBe(true)
    expect(useWorkspaceStore.getState().notice).toContain('正在被 Agent 处理')
    useWorkspaceStore.getState().interruptAgentRun(runId)
  })

  it('移除文件时同步清理讨论区成员', () => {
    const file = useWorkspaceStore.getState().files[0]
    useWorkspaceStore.getState().syncZoneMembership('file', file.id, { x: 1100, y: 0 })
    expect(useWorkspaceStore.getState().discussionZones[0].fileIds).toContain(file.id)
    useWorkspaceStore.getState().removeFile(file.id)
    expect(useWorkspaceStore.getState().files.some((candidate) => candidate.id === file.id)).toBe(false)
    expect(useWorkspaceStore.getState().discussionZones[0].fileIds).not.toContain(file.id)
  })

  it('整理画布只调整位置，不改变讨论区授权成员', () => {
    const before = useWorkspaceStore.getState().discussionZones[0]
    const membership = {
      agentIds: [...before.agentIds],
      cardIds: [...before.cardIds],
      fileIds: [...before.fileIds],
    }
    const rootBefore = useWorkspaceStore.getState().cards.find((card) => card.id === 'root-idea')?.position

    useWorkspaceStore.getState().autoArrangeCanvas()

    const state = useWorkspaceStore.getState()
    const after = state.discussionZones[0]
    expect({ agentIds: after.agentIds, cardIds: after.cardIds, fileIds: after.fileIds }).toEqual(membership)
    expect(state.cards.find((card) => card.id === 'root-idea')?.position).not.toEqual(rootBefore)
    expect(state.notice).toBe('已按上下文归属自动整理画布。')
  })

  it('软删除和排除的卡片可以从画布统一恢复', () => {
    const hiddenId = createUserCard('idea', '稍后恢复的方向')
    const rejectedId = createUserCard('assumption', '暂时排除的假设')
    useWorkspaceStore.getState().hideCard(hiddenId)
    useWorkspaceStore.getState().updateCardStatus(rejectedId, 'rejected')
    let state = useWorkspaceStore.getState()
    expect(state.cards.find((card) => card.id === hiddenId)?.visible).toBe(false)
    expect(state.cards.find((card) => card.id === rejectedId)?.status).toBe('rejected')

    useWorkspaceStore.getState().restoreHiddenCards()
    state = useWorkspaceStore.getState()
    expect(state.cards.find((card) => card.id === hiddenId)?.visible).toBe(true)
    expect(state.cards.find((card) => card.id === rejectedId)?.status).toBe('unreviewed')
    expect(state.notice).toBe('已恢复 2 张隐藏或排除的卡片。')
  })
})
