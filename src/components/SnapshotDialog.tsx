import { useWorkspaceStore } from '../store/workspace-store'

export function SnapshotDialog() {
  const draft = useWorkspaceStore((state) => state.snapshotDraft)
  const cards = useWorkspaceStore((state) => state.cards)
  const updateSnapshotSummary = useWorkspaceStore((state) => state.updateSnapshotSummary)
  const saveSnapshot = useWorkspaceStore((state) => state.saveSnapshot)
  const closeSnapshot = useWorkspaceStore((state) => state.closeSnapshot)

  if (!draft) return null
  const includedCards = draft.includedCardIds
    .map((id) => cards.find((card) => card.id === id))
    .filter(Boolean)

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={closeSnapshot}>
      <section
        aria-labelledby="snapshot-title"
        aria-modal="true"
        className="snapshot-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="dialog-header">
          <div>
            <p className="eyebrow">IDEA SNAPSHOT</p>
            <h2 id="snapshot-title">{draft.title}</h2>
          </div>
          <button className="icon-button" onClick={closeSnapshot} type="button" aria-label="关闭 Snapshot">×</button>
        </div>
        <p className="dialog-copy">只包含已标记为“保留”或“已决定”的卡片。保存前可以编辑整理结果。</p>
        <div className="snapshot-card-list">
          {includedCards.map((card) => <span key={card?.id}>{card?.title}</span>)}
        </div>
        <label className="snapshot-editor">
          <span>整理结果</span>
          <textarea value={draft.summary} onChange={(event) => updateSnapshotSummary(event.target.value)} />
        </label>
        <div className="snapshot-facts">
          <span>关键假设 {draft.assumptions.length}</span>
          <span>未解决问题 {draft.openQuestions.length}</span>
          <span>已确认决定 {draft.decisions.length}</span>
        </div>
        <div className="dialog-actions">
          <button className="secondary-button" onClick={closeSnapshot} type="button">取消</button>
          <button className="primary-button" onClick={saveSnapshot} type="button">保存版本</button>
        </div>
      </section>
    </div>
  )
}
