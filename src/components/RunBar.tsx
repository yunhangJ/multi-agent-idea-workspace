import type { Run } from '../domain/types'
import { useWorkspaceStore } from '../store/workspace-store'

function taskLabel(run: Run) {
  if (run.action !== 'custom' || !run.customInstruction) return run.label
  const normalized = run.customInstruction.replace(/\s+/g, ' ').trim()
  return `自定义：${normalized.length > 24 ? `${normalized.slice(0, 24)}…` : normalized}`
}

export function RunBar() {
  const runs = useWorkspaceStore((state) => state.runs)
  const discussionRuns = useWorkspaceStore((state) => state.discussionRuns)
  const visibleRuns = runs.slice(-(discussionRuns.length ? 3 : 5))
  const latestDiscussion = discussionRuns.at(-1)
  const interruptDiscussion = useWorkspaceStore((state) => state.interruptDiscussion)
  const retryDiscussion = useWorkspaceStore((state) => state.retryDiscussion)
  const interruptAgentRun = useWorkspaceStore((state) => state.interruptAgentRun)
  const retryAgentRun = useWorkspaceStore((state) => state.retryAgentRun)

  const agentRunRunning = runs.some((run) => run.status === 'running')
  const latestAgentRun = runs.at(-1)

  return (
    <footer className="run-bar">
      <div className="run-bar__label">
        <span className={latestAgentRun?.status === 'completed' ? 'pulse-dot pulse-dot--done' : 'pulse-dot'} />
        <strong>{agentRunRunning ? '单 Agent 运行中' : latestAgentRun ? '最近一次单 Agent 运行已结束' : '选择卡片并交给一个 Agent'}</strong>
      </div>
      <div className="run-bar__items">
        {visibleRuns.map((run) => (
          <div className="run-item" key={run.id}>
            <span title={run.customInstruction}>{run.agentId} · {taskLabel(run)} · {run.inputCardIds.length} 个输入</span>
            <strong title={run.error}>{run.status === 'completed' ? `→ ${run.outputCount} 张输出` : run.status === 'running' ? 'AI 运行中' : run.status === 'interrupted' ? '已中断' : run.status === 'failed' ? '失败' : '待命'}</strong>
            {run.status === 'running' && <button onClick={() => interruptAgentRun(run.id)} type="button">中断</button>}
            {(run.status === 'interrupted' || run.status === 'failed') && <button onClick={() => retryAgentRun(run.id)} type="button">重试</button>}
          </div>
        ))}
        {latestDiscussion && (
          <div className="run-item run-item--discussion">
            <span>{latestDiscussion.agentIds.length} Agent 讨论 · {latestDiscussion.sharedCardIds.length + latestDiscussion.sharedFileIds.length} 个共享输入</span>
            <strong title={latestDiscussion.error}>{latestDiscussion.status === 'completed' ? `→ ${latestDiscussion.outputCardIds?.length ?? (latestDiscussion.outputCardId ? 1 : 0)} 张结论` : latestDiscussion.status === 'running' ? 'AI 运行中' : latestDiscussion.status === 'interrupted' ? '已中断' : '失败'}</strong>
            {latestDiscussion.status === 'running' && <button onClick={() => interruptDiscussion(latestDiscussion.id)} type="button">中断</button>}
            {(latestDiscussion.status === 'interrupted' || latestDiscussion.status === 'failed') && <button onClick={() => retryDiscussion(latestDiscussion.id)} type="button">重试</button>}
          </div>
        )}
      </div>
      <span className="run-bar__privacy">当前区内共享 · 他人历史隔离</span>
    </footer>
  )
}
