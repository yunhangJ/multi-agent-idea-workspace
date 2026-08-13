import type { AgentAction, AgentId } from '../domain/types'
import { agentRoleProfiles, MAX_CUSTOM_INSTRUCTION_LENGTH } from '../domain/agent-profiles'
import { useWorkspaceStore } from '../store/workspace-store'

const agentNames: Record<AgentId, string> = {
  explorer: 'Explorer',
  critic: 'Critic',
  simplifier: 'Simplifier',
}

const actions: Array<{ id: AgentAction; label: string }> = [
  { id: 'expand', label: '扩展这个方向' },
  { id: 'critique', label: '挑战这个观点' },
  { id: 'simplify', label: '简化这个方案' },
  { id: 'answer', label: '回答这个问题' },
  { id: 'opposite', label: '提出相反方案' },
  { id: 'custom', label: '自定义指令' },
]

export function AssignmentDialog() {
  const draft = useWorkspaceStore((state) => state.assignmentDraft)
  const cards = useWorkspaceStore((state) => state.cards)
  const setAssignmentAction = useWorkspaceStore((state) => state.setAssignmentAction)
  const setAssignmentInstruction = useWorkspaceStore((state) => state.setAssignmentInstruction)
  const cancelAssignment = useWorkspaceStore((state) => state.cancelAssignment)
  const confirmAssignment = useWorkspaceStore((state) => state.confirmAssignment)

  if (!draft) return null
  const inputs = draft.cardIds.map((id) => cards.find((card) => card.id === id)).filter(Boolean)
  const profile = agentRoleProfiles[draft.agentId]
  const instructionBlank = draft.action === 'custom' && !draft.customInstruction.trim()
  const instructionWhitespaceOnly = Boolean(draft.customInstruction) && !draft.customInstruction.trim()
  const instructionNearLimit = draft.customInstruction.length > MAX_CUSTOM_INSTRUCTION_LENGTH * 0.9

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={cancelAssignment}>
      <section
        aria-labelledby="assignment-title"
        aria-modal="true"
        className="action-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="dialog-header">
          <div>
            <p className="eyebrow">CONTEXT GRANT</p>
            <h2 id="assignment-title">交给 {agentNames[draft.agentId]}</h2>
          </div>
          <button className="icon-button" onClick={cancelAssignment} type="button" aria-label="取消分配">×</button>
        </div>

        <p className="dialog-copy"><strong>{profile.role}</strong> · {profile.shortDescription}。本次只授权以下 {inputs.length} 张卡片，其他 Agent 产出和整个白板不会自动进入上下文。</p>
        <div className="input-card-list">
          {inputs.map((card) => <span key={card?.id}>{card?.title}</span>)}
        </div>

        <p className="section-label action-dialog__label">选择明确动作</p>
        <div className="action-grid">
          {actions.map((action) => (
            <button
              className={draft.action === action.id ? 'dialog-action dialog-action--selected' : 'dialog-action'}
              key={action.id}
              onClick={() => setAssignmentAction(action.id)}
              aria-pressed={draft.action === action.id}
              type="button"
            >
              <strong>{action.label}</strong>
              <small>{profile.actionLenses[action.id]}</small>
            </button>
          ))}
        </div>

        {draft.action === 'custom' && (
          <label
            className={`custom-instruction-field${instructionWhitespaceOnly ? ' custom-instruction-field--invalid' : ''}`}
            htmlFor="custom-agent-instruction"
          >
            <span>告诉 {agentNames[draft.agentId]} 本轮具体要做什么</span>
            <textarea
              autoFocus
              aria-describedby={`custom-agent-instruction-help${instructionWhitespaceOnly ? ' custom-agent-instruction-error' : ''}`}
              aria-invalid={instructionBlank}
              id="custom-agent-instruction"
              maxLength={MAX_CUSTOM_INSTRUCTION_LENGTH}
              onChange={(event) => setAssignmentInstruction(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && draft.customInstruction.trim()) {
                  event.preventDefault()
                  confirmAssignment()
                }
              }}
              placeholder={profile.customInstructionPlaceholder}
              value={draft.customInstruction}
            />
            <p className="custom-instruction-boundary" id="custom-agent-instruction-help">
              自定义指令只改变本轮任务，不改变 {profile.role} 身份。{profile.actionLenses.custom}
            </p>
            {instructionBlank && (
              <em id="custom-agent-instruction-error">
                {instructionWhitespaceOnly ? '指令不能只包含空白字符。' : '请输入本轮具体任务。'}
              </em>
            )}
            <small>
              <span>指令会发送给当前模型，并随 Run 写入本地恢复副本和工程文件；仍只能读取以上卡片和该 Agent 自己的历史。不要填写 API Key、密码等秘密。</span>
              <strong className={instructionNearLimit ? 'custom-instruction-counter--warning' : undefined}>{draft.customInstruction.length}/{MAX_CUSTOM_INSTRUCTION_LENGTH}</strong>
            </small>
          </label>
        )}

        <div className="dialog-actions">
          <button className="secondary-button" onClick={cancelAssignment} type="button">取消</button>
          <button
            className="primary-button"
            disabled={instructionBlank}
            onClick={confirmAssignment}
            type="button"
          >确认并运行</button>
        </div>
      </section>
    </div>
  )
}
