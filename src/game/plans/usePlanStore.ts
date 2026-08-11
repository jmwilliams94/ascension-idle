import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'

export interface PlanItem {
  id: string
  created_at: string
  content: string
  position: number
}

interface ActionResult {
  ok: boolean
  error?: string
}

interface PlanState {
  items: PlanItem[]
  loaded: boolean
  busy: boolean
  loadPlans: () => Promise<void>
  addPlan: (content: string) => Promise<ActionResult>
  removePlan: (id: string) => Promise<ActionResult>
  reorderPlans: (orderedIds: string[]) => Promise<ActionResult>
}

// Plans (2026-08-21, requested by the user) -- re-adds the public roadmap
// list previously called "To-Do" (dropped when Suggestions replaced it, see
// supabase/migrations/20260821030000_suggestions_replace_todo.sql), this
// time with drag-and-drop reordering for the admin account only (see
// PlanPanel.tsx). Real enforcement is server-side in admin_add_plan/
// admin_remove_plan/admin_reorder_plans (all gated by is_admin()) -- this
// store doesn't gate anything itself.
export const usePlanStore = create<PlanState>((set, get) => ({
  items: [],
  loaded: false,
  busy: false,

  loadPlans: async () => {
    const { data, error } = await supabase
      .from('plan_items')
      .select('id, created_at, content, position')
      .order('position', { ascending: true })

    if (error) {
      console.error('Failed to load plan items', error)
      return
    }

    set({ items: (data ?? []) as PlanItem[], loaded: true })
  },

  addPlan: async (content) => {
    set({ busy: true })
    const { data, error } = await supabase.rpc('admin_add_plan', { p_content: content })
    set({ busy: false })

    if (error) {
      console.error('Add plan call failed', error)
      return { ok: false, error: 'rpc_failed' }
    }

    const result = data as ActionResult
    if (result.ok) {
      await get().loadPlans()
    }
    return result
  },

  removePlan: async (id) => {
    set({ busy: true })
    const { data, error } = await supabase.rpc('admin_remove_plan', { p_id: id })
    set({ busy: false })

    if (error) {
      console.error('Remove plan call failed', error)
      return { ok: false, error: 'rpc_failed' }
    }

    const result = data as ActionResult
    if (result.ok) {
      set((state) => ({ items: state.items.filter((item) => item.id !== id) }))
    }
    return result
  },

  // The caller (PlanPanel) already live-reorders its own local state
  // throughout the drag gesture -- this just persists the final order and
  // re-syncs `items` to match on success, or reloads the real order from
  // the server if the RPC failed (so the UI doesn't stay out of sync with
  // what actually got saved).
  reorderPlans: async (orderedIds) => {
    set({ busy: true })
    const { data, error } = await supabase.rpc('admin_reorder_plans', { p_ordered_ids: orderedIds })
    set({ busy: false })

    if (error) {
      console.error('Reorder plans call failed', error)
      await get().loadPlans()
      return { ok: false, error: 'rpc_failed' }
    }

    const result = data as ActionResult
    if (result.ok) {
      set((state) => ({
        items: orderedIds
          .map((id) => state.items.find((item) => item.id === id))
          .filter((item): item is PlanItem => item !== undefined),
      }))
    } else {
      await get().loadPlans()
    }
    return result
  },
}))
