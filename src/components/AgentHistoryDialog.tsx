import { agentRoleProfiles } from '../domain/agent-profiles'
import { useWorkspaceStore } from '../store/workspace-store'

const sourceLabels = {
  independent: '单独任务（旧记录）',
  directed: '定向处理',
  discussion: '共享讨论',
}

export function AgentHistoryDialog() {
  const agentId = useWorkspaceStore((state) => state.agentHistoryId)
  const agent = useWorkspaceStore((state) => state.agents.find((candidate) => candidate.id === agentId))
  const allMemories = useWorkspaceStore((state) => state.agentMemories)
  const runs = useWorkspaceStore((state) => state.runs)
  const cards = useWorkspaceStore((state) => state.cards)
  const files = useWorkspaceStore((state) => state.files)
  const discussionRuns = useWorkspaceStore((state) => state.discussionRuns)
  const close = useWorkspaceStore((state) => state.closeAgentHistory)

  if (!agentId || !agent) return null
  const profile = agentRoleProfiles[agentId]
  const memories = allMemories.filter((memory) => memory.agentId === agentId)
  const latestContext = [...discussionRuns]
    .reverse()
    .flatMap((run) => run.contexts)
    .find((context) => context.agentId === agentId)

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="agent-history-dialog" role="dialog" aria-modal="true" aria-label={`${agent.name} 历史`}>
        <div className="dialog-header">
          <div><p className="eyebrow">PRIVATE AGENT MEMORY</p><h2>{agent.name} 的处理历史</h2></div>
          <button className="icon-button" onClick={close} type="button" aria-label="关闭 Agent 历史">×</button>
        </div>
        <div className="privacy-callout">
          <strong>{profile.role} · {profile.shortDescription}</strong>
          <span>{profile.mission}</span>
          <span>以下摘要只属于 {agent.name}，可以进入它的后续上下文，但不会自动广播给其他 Agent。</span>
        </div>

        {latestContext && (
          <section className="agent-context-audit">
            <p className="section-label">最近一次冻结上下文</p>
            <div><span>当前共享卡片</span><strong>{latestContext.sharedCardIds.length}</strong></div>
            <div><span>当前共享文件</span><strong>{latestContext.sharedFileIds.length}</strong></div>
            <div><span>读取自己的历史</span><strong>{latestContext.ownHistoryEntryIds.length}</strong></div>
            <div><span>隔离其他 Agent 历史</span><strong>{latestContext.blockedPeerHistoryEntryIds.length}</strong></div>
            <div><span>本轮显式共享的他人卡片</span><strong>{latestContext.explicitlySharedPeerCardIds.length}</strong></div>
          </section>
        )}

        <div className="agent-memory-list">
          {memories.length ? [...memories].reverse().map((memory) => {
            const sourceRun = memory.source === 'directed'
              ? runs.find((run) => run.id === memory.runId)
              : undefined
            const inputNames = [
              ...memory.inputCardIds.map((id) => cards.find((card) => card.id === id)?.title).filter(Boolean),
              ...memory.inputFileIds.map((id) => files.find((file) => file.id === id)?.name).filter(Boolean),
            ]
            return (
              <article key={memory.id}>
                <div><span>{sourceLabels[memory.source]}</span><time>{memory.createdAt}</time></div>
                <p>{memory.privateSummary}</p>
                <small>{inputNames.length ? `处理输入：${inputNames.join('、')}` : '没有保存输入内容'}</small>
                {sourceRun?.customInstruction && (
                  <details className="agent-memory-instruction">
                    <summary>查看本轮自定义指令</summary>
                    <p>{sourceRun.customInstruction}</p>
                  </details>
                )}
              </article>
            )
          }) : (
            <div className="history-empty"><span>○</span><strong>还没有私有历史</strong><p>把指定卡片交给这个 Agent，或让它参加共享讨论后会记录。</p></div>
          )}
        </div>
      </section>
    </div>
  )
}
