import { useEffect, useState } from 'react'
import { useTodoStore } from '../game/todo/useTodoStore'
import { useIsAdmin } from '../lib/adminConfig'

const CONTENT_MAX_LENGTH = 500

// To-Do board (2026-08-21, requested by the user) -- a public roadmap list,
// visible to every player. Only the admin account can add/remove entries
// (see admin_add_todo/admin_remove_todo,
// supabase/migrations/20260821010000_todo_and_bug_reports.sql) -- real
// enforcement is server-side, useIsAdmin() here only decides whether the
// add/remove controls render at all.
export default function TodoPanel() {
  const items = useTodoStore((state) => state.items)
  const loaded = useTodoStore((state) => state.loaded)
  const busy = useTodoStore((state) => state.busy)
  const loadTodos = useTodoStore((state) => state.loadTodos)
  const addTodo = useTodoStore((state) => state.addTodo)
  const removeTodo = useTodoStore((state) => state.removeTodo)
  const isAdmin = useIsAdmin()

  const [content, setContent] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!loaded) {
      void loadTodos()
    }
  }, [loaded, loadTodos])

  const handleAdd = async () => {
    const trimmed = content.trim()
    if (!trimmed) {
      return
    }
    setError(null)
    const result = await addTodo(trimmed)
    if (result.ok) {
      setContent('')
    } else {
      setError('Something went wrong adding that.')
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-white">To-Do</h2>
        <p className="text-sm text-slate-400">What's planned or being worked on next.</p>
      </div>

      {isAdmin && (
        <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={content}
              onChange={(event) => {
                setContent(event.target.value.slice(0, CONTENT_MAX_LENGTH))
                setError(null)
              }}
              placeholder="Add a new task…"
              className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-base text-slate-200"
            />
            <button
              type="button"
              disabled={!content.trim() || busy}
              onClick={() => void handleAdd()}
              className="shrink-0 rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Add
            </button>
          </div>
          {error && <p className="text-xs text-amber-400">{error}</p>}
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing on the list right now.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm text-slate-200"
            >
              <span className="whitespace-pre-wrap">{item.content}</span>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => void removeTodo(item.id)}
                  aria-label="Remove task"
                  title="Remove task"
                  className="shrink-0 text-slate-500 hover:text-rose-400"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
