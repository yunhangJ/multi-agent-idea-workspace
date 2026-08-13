import { useEffect, useState } from 'react'
import type { CardType } from '../domain/types'
import { useWorkspaceStore } from '../store/workspace-store'

const cardTypes: Array<{ value: CardType; label: string }> = [
  { value: 'idea', label: 'Idea' },
  { value: 'question', label: 'Question' },
  { value: 'assumption', label: 'Assumption' },
  { value: 'decision', label: 'Decision' },
]

export function CardEditorDialog() {
  const target = useWorkspaceStore((state) => state.cardEditorTarget)
  const cards = useWorkspaceStore((state) => state.cards)
  const createUserCard = useWorkspaceStore((state) => state.createUserCard)
  const editCard = useWorkspaceStore((state) => state.editCard)
  const close = useWorkspaceStore((state) => state.closeCardEditor)
  const [type, setType] = useState<CardType>('idea')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')

  useEffect(() => {
    const card = target && target !== 'new' ? cards.find((candidate) => candidate.id === target) : null
    setType(card?.type ?? 'idea')
    setTitle(card?.title ?? '')
    setContent(card?.content ?? '')
  }, [cards, target])

  if (!target) return null
  const editing = target !== 'new'

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="card-editor-dialog" role="dialog" aria-modal="true" aria-label={editing ? '编辑卡片' : '新建卡片'}>
        <div className="dialog-header">
          <div><p className="eyebrow">USER CARD</p><h2>{editing ? '编辑卡片' : '新建卡片'}</h2></div>
          <button className="icon-button" onClick={close} type="button" aria-label="关闭卡片编辑">×</button>
        </div>
        <label>卡片类型
          <select value={type} onChange={(event) => setType(event.target.value as CardType)}>
            {cardTypes.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>标题<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="一句话表达卡片内容" /></label>
        <label>正文<textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="补充依据、限制或下一步……" /></label>
        <div className="dialog-actions">
          <button className="secondary-button" onClick={close} type="button">取消</button>
          <button
            className="primary-button"
            disabled={!title.trim()}
            onClick={() => {
              if (editing) editCard(target, type, title, content)
              else createUserCard(type, title, content)
              close()
            }}
            type="button"
          >保存卡片</button>
        </div>
      </section>
    </div>
  )
}
