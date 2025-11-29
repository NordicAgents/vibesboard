'use server'
import 'server-only'
import { createServerActionClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { Database } from '@/lib/db_types'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { type Chat, type VibeAgent, type VibeAgentConversation } from '@/lib/types'
import { mapAgentRow, mapConversationRow } from '@/lib/agents/db'

export async function getChats(userId?: string | null) {
  if (!userId) {
    return []
  }
  try {
    const cookieStore = await cookies()
    const supabase = createServerActionClient<Database>({
      cookies: () => cookieStore as unknown as ReturnType<typeof cookies> as unknown as ReturnType<typeof cookies>
    })
    const { data } = await supabase
      .from('chats')
      .select('payload')
      .order('payload->createdAt', { ascending: false })
      .eq('user_id', userId)
      .throwOnError()

    return (data?.map(entry => entry.payload) as Chat[]) ?? []
  } catch (error) {
    return []
  }
}

export async function getChat(id: string) {
  const cookieStore = await cookies()
  const supabase = createServerActionClient<Database>({
    cookies: () => cookieStore as unknown as ReturnType<typeof cookies> as unknown as ReturnType<typeof cookies>
  })
  const { data } = await supabase
    .from('chats')
    .select('payload')
    .eq('id', id)
    .maybeSingle()

  return (data?.payload as Chat) ?? null
}

export async function removeChat({ id, path }: { id: string; path: string }) {
  try {
    const cookieStore = await cookies()
    const supabase = createServerActionClient<Database>({
      cookies: () => cookieStore as unknown as ReturnType<typeof cookies> as unknown as ReturnType<typeof cookies>
    })
    await supabase.from('chats').delete().eq('id', id).throwOnError()

    revalidatePath('/')
    return revalidatePath(path)
  } catch (error) {
    return {
      error: 'Unauthorized'
    }
  }
}

export async function clearChats() {
  try {
    const cookieStore = await cookies()
    const supabase = createServerActionClient<Database>({
      cookies: () => cookieStore as unknown as ReturnType<typeof cookies> as unknown as ReturnType<typeof cookies>
    })
    await supabase.from('chats').delete().throwOnError()
    revalidatePath('/')
    return redirect('/')
  } catch (error) {
    console.log('clear chats error', error)
    return {
      error: 'Unauthorized'
    }
  }
}

export async function getSharedChat(id: string) {
  const cookieStore = await cookies()
  const supabase = createServerActionClient<Database>({
    cookies: () => cookieStore as unknown as ReturnType<typeof cookies> as unknown as ReturnType<typeof cookies>
  })
  const { data } = await supabase
    .from('chats')
    .select('payload')
    .eq('id', id)
    .not('payload->sharePath', 'is', null)
    .maybeSingle()

  return (data?.payload as Chat) ?? null
}

export async function shareChat(chat: Chat) {
  const payload = {
    ...chat,
    sharePath: `/share/${chat.id}`
  }

  const cookieStore = await cookies()
  const supabase = createServerActionClient<Database>({
    cookies: () => cookieStore as unknown as ReturnType<typeof cookies> as unknown as ReturnType<typeof cookies>
  })
  await supabase
    .from('chats')
    .update({ payload: payload as any })
    .eq('id', chat.id)
    .throwOnError()

  return payload
}

export async function getAgents(userId?: string | null) {
  if (!userId) {
    return []
  }

  try {
    const cookieStore = await cookies()
    const supabase = createServerActionClient<Database>({
      cookies: () => cookieStore as unknown as ReturnType<typeof cookies> as unknown as ReturnType<typeof cookies>
    })
    const { data } = await supabase
      .from('vibe_agents')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    return (data ?? []).map(mapAgentRow) as VibeAgent[]
  } catch (error) {
    return []
  }
}

export async function getAgentConversations(userId?: string | null) {
  if (!userId) {
    return []
  }

  try {
    const cookieStore = await cookies()
    const supabase = createServerActionClient<Database>({
      cookies: () => cookieStore as unknown as ReturnType<typeof cookies> as unknown as ReturnType<typeof cookies>
    })
    const { data } = await supabase
      .from('vibe_agent_conversations')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })

    return (data ?? []).map(mapConversationRow) as VibeAgentConversation[]
  } catch (error) {
    return []
  }
}
