import { useWorkspaceStore } from '../store/workspace-store'

export function VersionHistoryDialog() {
  const historyOpen = useWorkspaceStore((state) => state.historyOpen)
  const snapshots = useWorkspaceStore((state) => state.snapshots)
  const closeHistory = useWorkspaceStore((state) => state.closeHistory)

  if (!historyOpen) return null

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={closeHistory}>
      <section
        aria-labelledby="history-title"
        aria-modal="true"
        className="history-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="dialog-header">
          <div>
            <p className="eyebrow">VERSION HISTORY</p>
            <h2 id="history-title">Idea 版本历史</h2>
          </div>
          <button className="icon-button" onClick={closeHistory} type="button" aria-label="关闭版本历史">×</button>
        </div>
        <p className="dialog-copy">每个版本都保存当时明确保留或决定的卡片，不会自动吸收画布上的其他内容。</p>
        {snapshots.length ? (
          <div className="history-list">
            {[...snapshots].reverse().map((snapshot) => (
              <article className="history-item" key={snapshot.id}>
                <div className="history-item__heading">
                  <strong>{snapshot.title}</strong>
                  <time>{snapshot.createdAt}</time>
                </div>
                <p>{snapshot.summary}</p>
                <div className="snapshot-facts">
                  <span>纳入卡片 {snapshot.includedCardIds.length}</span>
                  <span>关键假设 {snapshot.assumptions.length}</span>
                  <span>未解决问题 {snapshot.openQuestions.length}</span>
                  <span>决定 {snapshot.decisions.length}</span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="history-empty">
            <span>◇</span>
            <strong>还没有保存版本</strong>
            <p>先审核卡片，再从顶部生成并保存 Snapshot。</p>
          </div>
        )}
        <div className="dialog-actions">
          <button className="primary-button" onClick={closeHistory} type="button">完成</button>
        </div>
      </section>
    </div>
  )
}
