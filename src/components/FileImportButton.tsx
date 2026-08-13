import { useRef } from 'react'
import { createFileCard } from '../services/workspace-persistence'
import { useWorkspaceStore } from '../store/workspace-store'

export function FileImportButton() {
  const inputRef = useRef<HTMLInputElement>(null)
  const addFiles = useWorkspaceStore((state) => state.addFiles)
  const showNotice = useWorkspaceStore((state) => state.showNotice)

  return (
    <>
      <button className="canvas-tool-button" onClick={() => inputRef.current?.click()} type="button">＋ 导入文件</button>
      <input
        accept=".md,.markdown,.txt,.pdf,text/plain,text/markdown,application/pdf"
        hidden
        multiple
        ref={inputRef}
        type="file"
        onChange={async (event) => {
          const selected = [...(event.target.files ?? [])]
          const imported = []
          const errors: string[] = []
          for (const [index, file] of selected.entries()) {
            try {
              imported.push(await createFileCard(file, index))
            } catch (reason) {
              errors.push(reason instanceof Error ? reason.message : `${file.name} 导入失败。`)
            }
          }
          if (imported.length) addFiles(imported)
          if (errors.length) showNotice(errors.join(' '))
          event.target.value = ''
        }}
      />
    </>
  )
}
