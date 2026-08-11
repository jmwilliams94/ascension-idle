import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'

export interface TodoItem {
  id: string
  created_at: string
  content: string
}

interface ActionResult {
  ok: boolean
  error?: string
}

interface TodoState {
  items: TodoItem[]
  loaded: boolean
  busy: boolean
  loadTodos: () => Promise<void>
  addTodo: (content: string) => Promise<ActionResult>
  removeTodo: (id: string) => Promise<ActionResult>
}

// To-Do board (2026-08-21, requested by the user) -- a public, read-only
// roadmap list (see supabase/migrations/20260821010000_todo_and_bug_reports.sql).
// Only the admin account can add/remove entries -- real enforcement is
// server-side inside admin_add_todo/admin_remove_todo (both independently
// compare auth.uid() against the hardcoded admin email, same pattern as
// every other admin RPC in this project); this store doesn't gate anything
// itself, a non-admin caller just gets back {ok:false, error:'not_admin'}.
export const useTodoStore = create<TodoState>((set, get) => ({
  items: [],
  loaded: false,
  busy: false,

  loadTodos: async () => {
    const { data, error } = await supabase
      .from('todo_items')
      .select('id, created_at, content')
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Failed to load todo items', error)
      return
    }

    set({ items: (data ?? []) as TodoItem[], loaded: true })
  },

  addTodo: async (content) => {
    set({ busy: true })
    const { data, error } = await supabase.rpc('admin_add_todo', { p_content: content })
    set({ busy: false })

    if (error) {
      console.error('Add todo call failed', error)
      return { ok: false, error: 'rpc_failed' }
    }

    const result = data as ActionResult
    if (result.ok) {
      await get().loadTodos()
    }
    return result
  },

  removeTodo: async (id) => {
    set({ busy: true })
    const { data, error } = await supabase.rpc('admin_remove_todo', { p_id: id })
    set({ busy: false })

    if (error) {
      console.error('Remove todo call failed', error)
      return { ok: false, error: 'rpc_failed' }
    }

    const result = data as ActionResult
    if (result.ok) {
      set((state) => ({ items: state.items.filter((item) => item.id !== id) }))
    }
    return result
  },
}))
