import type { CardStatus, CardType } from '../domain/types'
import { getSnapshotCandidates, useWorkspaceStore } from '../store/workspace-store'

const typeLabels: Record<CardType, string> = {
  idea: 'Idea',
  question: 'Question',
  assumption: 'Assumption',
  decision: 'Decision',
}

const statusLabels: Record<CardStatus, string> = {
  unreviewed: '待审核',
  kept: '保留',
  uncertain: '存疑',
  rejected: '排除',
  decided: '已决定',
}

const creatorLabels = {
  user: '你',
  explorer: 'Explorer',
  critic: 'Critic',
  simplifier: 'Simplifier',
}

export function Inspector() {
  const cards = useWorkspaceStore((state) => state.cards)
  const selectedCardId = useWorkspaceStore((state) => state.selectedCardId)
  const selectedCardIds = useWorkspaceStore((state) => state.selectedCardIds)
  const files = useWorkspaceStore((state) => state.files)
  const selectedFileId = useWorkspaceStore((state) => state.selectedFileId)
  const updateCardStatus = useWorkspaceStore((state) => state.updateCardStatus)
  const hideCard = useWorkspaceStore((state) => state.hideCard)
  const openAssignment = useWorkspaceStore((state) => state.openAssignment)
  const mergeSelectedCards = useWorkspaceStore((state) => state.mergeSelectedCards)
  const compareSelectedCards = useWorkspaceStore((state) => state.compareSelectedCards)
  const contradictSelectedCards = useWorkspaceStore((state) => state.contradictSelectedCards)
  const openCardEditor = useWorkspaceStore((state) => state.openCardEditor)
  const removeFile = useWorkspaceStore((state) => state.removeFile)
  const selectFile = useWorkspaceStore((state) => state.selectFile)
  const card = cards.find((item) => item.id === selectedCardId) ?? cards[0]
  const file = files.find((item) => item.id === selectedFileId)
  const snapshotCount = getSnapshotCandidates(cards).length

  if (file) {
    return (
      <aside className="inspector">
        <div className="panel-heading panel-heading--inspector">
          <div><p className="eyebrow">INSPECTOR</p><h2>文件详情</h2></div>
          <button className="icon-button" onClick={() => selectFile(null)} type="button" aria-label="关闭文件详情">×</button>
        </div>
        <div className="type-badge type-badge--file">{file.fileType.toUpperCase()}</div>
        <h3 className="inspector__title">{file.name}</h3>
        <p className="inspector__content">{file.summary}</p>
        <div className="inspector__section metadata-list">
          <div><span>大小</span><strong>{file.sizeLabel}</strong></div>
          <div><span>类型</span><strong>{file.mimeType}</strong></div>
          <div><span>读取状态</span><strong>{file.parseStatus === 'ready' ? '正文已读取' : file.parseStatus === 'metadata_only' ? '仅元数据' : '读取失败'}</strong></div>
        </div>
        {file.contentText && (
          <div className="inspector__section">
            <p className="section-label">正文预览</p>
            <pre className="file-preview">{file.contentText.slice(0, 1800)}</pre>
          </div>
        )}
        <div className="inspector__section">
          <button className="danger-button" onClick={() => removeFile(file.id)} type="button">从 Workspace 移除文件</button>
        </div>
      </aside>
    )
  }

  return (
    <aside className="inspector">
      <div className="panel-heading panel-heading--inspector">
        <div>
          <p className="eyebrow">INSPECTOR</p>
          <h2>卡片详情</h2>
        </div>
        <button className="icon-button" type="button" aria-label="关闭详情">×</button>
      </div>

      <div className={`type-badge type-badge--${card.type}`}>{typeLabels[card.type]}</div>
      {selectedCardIds.length > 1 && <span className="multi-selection-badge">已多选 {selectedCardIds.length} 张</span>}
      <h3 className="inspector__title">{card.title}</h3>
      <p className="inspector__content">{card.content}</p>
      <button className="inspector-edit-button" onClick={() => openCardEditor(card.id)} type="button">编辑卡片内容</button>
      <button className="inspector-hide-button" disabled={card.id === 'root-idea'} onClick={() => hideCard(card.id)} type="button">
        {card.id === 'root-idea' ? '根 Idea 不可隐藏' : '从画布隐藏卡片'}
      </button>

      <div className="inspector__section">
        <p className="section-label">审核状态</p>
        <div className="status-grid">
          {(['kept', 'uncertain', 'rejected', 'decided'] as CardStatus[]).map((status) => (
            <button
              className={card.status === status ? 'status-button status-button--active' : 'status-button'}
              key={status}
              onClick={() => updateCardStatus(card.id, status)}
              type="button"
            >
              {statusLabels[status]}
            </button>
          ))}
        </div>
      </div>

      <div className="inspector__section metadata-list">
        <div>
          <span>创建者</span>
          <strong>{creatorLabels[card.creator]}</strong>
        </div>
        <div>
          <span>来源</span>
          <strong>{card.sourceDiscussionRunId ? 'Discussion Run' : card.sourceRunId ? 'Agent Run' : card.creator === 'user' && card.parentCardIds.length ? '用户操作' : '原始 Idea'}</strong>
        </div>
        <div>
          <span>上下文</span>
          <strong>{card.parentCardIds.length ? `${card.parentCardIds.length} 张输入卡片` : '根节点'}</strong>
        </div>
      </div>

      <div className="inspector__section">
        <div className="section-title-row">
          <p className="section-label">下一步</p>
          <span>{snapshotCount} 张已确认</span>
        </div>
        <button className="action-option" onClick={() => openAssignment('explorer', selectedCardIds)} type="button">
          <span>✦</span>
          <div><strong>继续扩展</strong><small>交给 Explorer</small></div>
          <span>→</span>
        </button>
        <button className="action-option" onClick={() => openAssignment('critic', selectedCardIds)} type="button">
          <span>◇</span>
          <div><strong>挑战这个观点</strong><small>交给 Critic</small></div>
          <span>→</span>
        </button>
        <button className="action-option" onClick={() => openAssignment('simplifier', selectedCardIds)} type="button">
          <span>↝</span>
          <div><strong>压缩为最小版本</strong><small>交给 Simplifier</small></div>
          <span>→</span>
        </button>
        {selectedCardIds.length > 1 && (
          <>
            <button className="action-option" onClick={compareSelectedCards} type="button">
              <span>⇄</span><div><strong>比较所选卡片</strong><small>保留差异和取舍</small></div><span>→</span>
            </button>
            <button className="action-option" onClick={mergeSelectedCards} type="button">
              <span>⧉</span><div><strong>合并所选卡片</strong><small>生成用户融合卡片</small></div><span>→</span>
            </button>
            <button className="action-option" disabled={selectedCardIds.length !== 2} onClick={contradictSelectedCards} type="button">
              <span>≠</span><div><strong>标记观点冲突</strong><small>恰好选择两张卡片</small></div><span>→</span>
            </button>
          </>
        )}
      </div>
    </aside>
  )
}
