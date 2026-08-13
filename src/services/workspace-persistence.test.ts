import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_CUSTOM_INSTRUCTION_LENGTH } from '../domain/agent-profiles'
import { getWorkspaceDocument, useWorkspaceStore } from '../store/workspace-store'
import {
  isWorkspaceDocument,
  parseWorkspaceText,
  serializeWorkspaceDocument,
  workspaceDocumentFingerprint,
} from './workspace-persistence'

beforeEach(() => {
  useWorkspaceStore.getState().resetWorkspace()
})

describe('Workspace 工程文件', () => {
  it('完整序列化并重新读取工程数据', () => {
    useWorkspaceStore.getState().createWorkspace('保存测试', '验证工程文件往返不丢数据。')
    useWorkspaceStore.getState().createUserCard('question', '目标用户是谁？', '需要继续验证。')
    const original = getWorkspaceDocument(useWorkspaceStore.getState())
    const restored = parseWorkspaceText(serializeWorkspaceDocument(original))

    expect(restored).toEqual(original)
    expect(restored.workspace.title).toBe('保存测试')
    expect(restored.cards).toHaveLength(2)
  })

  it('保存自定义指令快照，并兼容没有该字段的旧 Run', () => {
    useWorkspaceStore.getState().openAssignment('simplifier', ['root-idea'])
    useWorkspaceStore.getState().setAssignmentAction('custom')
    useWorkspaceStore.getState().setAssignmentInstruction('只保留一个最小但完整的体验闭环。')
    useWorkspaceStore.getState().confirmAssignment()
    const original = getWorkspaceDocument(useWorkspaceStore.getState())
    const restored = parseWorkspaceText(serializeWorkspaceDocument(original))

    expect(restored.runs[0].customInstruction).toBe('只保留一个最小但完整的体验闭环。')

    const { customInstruction: _customInstruction, ...legacyRun } = restored.runs[0]
    expect(isWorkspaceDocument({ ...restored, runs: [legacyRun] })).toBe(true)
  })

  it('拒绝外来工程中的非字符串或超长自定义指令', () => {
    useWorkspaceStore.getState().openAssignment('critic', ['root-idea'])
    useWorkspaceStore.getState().setAssignmentAction('custom')
    useWorkspaceStore.getState().setAssignmentInstruction('检查最关键的失败条件。')
    useWorkspaceStore.getState().confirmAssignment()
    const original = getWorkspaceDocument(useWorkspaceStore.getState())

    expect(isWorkspaceDocument({
      ...original,
      runs: [{ ...original.runs[0], customInstruction: 123 }],
    })).toBe(false)
    expect(isWorkspaceDocument({
      ...original,
      runs: [{ ...original.runs[0], customInstruction: 'x'.repeat(MAX_CUSTOM_INSTRUCTION_LENGTH + 1) }],
    })).toBe(false)
  })

  it('savedAt 变化不会把相同内容判定为脏数据', () => {
    const original = getWorkspaceDocument(useWorkspaceStore.getState())
    const later = { ...original, savedAt: '2099-01-01T00:00:00.000Z' }

    expect(workspaceDocumentFingerprint(later)).toBe(workspaceDocumentFingerprint(original))
  })

  it('拒绝损坏 JSON、未知版本和重复 ID', () => {
    expect(() => parseWorkspaceText('{broken')).toThrow('不是有效的 JSON')

    const original = getWorkspaceDocument(useWorkspaceStore.getState())
    expect(isWorkspaceDocument({ ...original, version: 2 })).toBe(false)
    expect(isWorkspaceDocument({ ...original, cards: [...original.cards, original.cards[0]] })).toBe(false)
  })

  it('拒绝无效坐标，避免打开后破坏画布', () => {
    const original = getWorkspaceDocument(useWorkspaceStore.getState())
    const invalid = {
      ...original,
      cards: [{ ...original.cards[0], position: { x: Number.NaN, y: 0 } }],
    }

    expect(isWorkspaceDocument(invalid)).toBe(false)
  })

  it('工程序列化边界不会带入 AI 运行时凭据', () => {
    const secret = 'TEST_SECRET_WORKSPACE_MUST_NOT_PERSIST'
    const poisonedState = {
      ...useWorkspaceStore.getState(),
      runtimeConfig: { apiKey: secret },
    } as ReturnType<typeof useWorkspaceStore.getState>

    const document = getWorkspaceDocument(poisonedState)
    const serialized = serializeWorkspaceDocument(document)

    expect(document).not.toHaveProperty('runtimeConfig')
    expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain('apiKey')
  })
})
