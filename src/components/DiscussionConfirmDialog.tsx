import { useWorkspaceStore } from '../store/workspace-store'

export function DiscussionConfirmDialog() {
  const zoneId = useWorkspaceStore((state) => state.discussionDraftZoneId)
  const zone = useWorkspaceStore((state) => state.discussionZones.find((candidate) => candidate.id === zoneId))
  const agents = useWorkspaceStore((state) => state.agents)
  const cards = useWorkspaceStore((state) => state.cards)
  const files = useWorkspaceStore((state) => state.files)
  const memories = useWorkspaceStore((state) => state.agentMemories)
  const confirm = useWorkspaceStore((state) => state.confirmDiscussion)
  const cancel = useWorkspaceStore((state) => state.cancelDiscussionDraft)

  if (!zoneId || !zone) return null
  const zoneAgents = zone.agentIds.map((id) => agents.find((agent) => agent.id === id)).filter(Boolean)
  const zoneCards = zone.cardIds.map((id) => cards.find((card) => card.id === id)).filter(Boolean)
  const zoneFiles = zone.fileIds.map((id) => files.find((file) => file.id === id)).filter(Boolean)

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="discussion-confirm-dialog" role="dialog" aria-modal="true" aria-label="确认讨论上下文">
        <div className="dialog-header">
          <div><p className="eyebrow">CONTEXT CHECKPOINT</p><h2>确认本轮讨论上下文</h2></div>
          <button className="icon-button" onClick={cancel} type="button" aria-label="关闭讨论确认">×</button>
        </div>
        <p className="dialog-copy">点击开始后会冻结下列参与者和输入。运行期间暂时锁定画布对象，避免上下文悄悄变化。</p>

        <div className="context-confirm-grid">
          <section>
            <p className="section-label">参与 Agent</p>
            {zoneAgents.map((agent) => {
              if (!agent) return null
              const own = memories.filter((memory) => memory.agentId === agent.id)
              const blocked = memories.filter((memory) => memory.agentId !== agent.id)
              return (
                <div className="context-agent-row" key={agent.id}>
                  <strong>{agent.name}</strong>
                  <span>自己的历史 {own.length} 条</span>
                  <small>其他 Agent 历史 {blocked.length} 条不进入提示词</small>
                </div>
              )
            })}
          </section>
          <section>
            <p className="section-label">当前共享输入</p>
            <div className="context-input-list">
              {zoneCards.map((card) => card && <span key={card.id}>卡片 · {card.title}</span>)}
              {zoneFiles.map((file) => file && <span key={file.id}>文件 · {file.name} · {file.parseStatus === 'ready' ? '正文可用' : '仅元数据'}</span>)}
            </div>
          </section>
        </div>

        <div className="privacy-callout">
          <strong>隐私边界</strong>
          <span>当前区内内容共享；每个 Agent 只追加自己的历史。其他 Agent 的旧输出除非以卡片形式明确放入本区，否则不会进入上下文。</span>
        </div>
        <div className="dialog-actions">
          <button className="secondary-button" onClick={cancel} type="button">返回调整</button>
          <button className="primary-button" onClick={confirm} type="button">确认并开始讨论</button>
        </div>
      </section>
    </div>
  )
}
