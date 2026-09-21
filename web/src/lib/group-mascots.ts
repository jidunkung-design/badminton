import { createServerSupabase } from '@/lib/supabase/server'
import type { MascotAppearance } from '@/lib/cosmetics'

export async function getGroupMascots(groupId: string): Promise<Record<string, MascotAppearance>> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('group_mascots', { p_group_id: groupId })
  if (error || !Array.isArray(data)) return {}
  const rows = data as unknown as (MascotAppearance & { player_id: string })[]
  return Object.fromEntries(rows.map(row => [row.player_id, row]))
}
