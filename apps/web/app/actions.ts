'use server'
import 'server-only'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { adminDb } from '@vibesboard/adapter-firebase/admin'
import { Collections } from '@vibesboard/contracts'
import {
  type Chat,
  type VibeAgent,
  type VibeAgentConversation
} from '@vibesboard/contracts'
import { getAgentsForTenant } from '@vibesboard/agents/server'
import { listAgentConversations } from '@vibesboard/agents/conversations'
import { getActiveTenant } from '@/lib/tenant-context'

export async function getChats(userId?: string | null) {
  if (!userId) return []

  try {
    const snapshot = await adminDb
      .collection(Collections.chats)
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get()

    return snapshot.docs.map((doc: any) => doc.data().payload as Chat)
  } catch {
    return []
  }
}

export async function getChat(id: string) {
  const doc = await adminDb.collection(Collections.chats).doc(id).get()
  return doc.exists ? ((doc.data()?.payload as Chat) ?? null) : null
}

export async function removeChat({ id, path }: { id: string; path: string }) {
  try {
    await adminDb.collection(Collections.chats).doc(id).delete()
    revalidatePath('/')
    return revalidatePath(path)
  } catch {
    return { error: 'Unauthorized' }
  }
}

export async function clearChats() {
  try {
    // Delete all chats — in production, scope this to the user
    const snapshot = await adminDb.collection(Collections.chats).get()
    const batch = adminDb.batch()
    snapshot.docs.forEach((doc: any) => batch.delete(doc.ref))
    await batch.commit()

    revalidatePath('/')
    return redirect('/')
  } catch (error) {
    console.log('clear chats error', error)
    return { error: 'Unauthorized' }
  }
}

export async function getSharedChat(id: string) {
  const doc = await adminDb.collection(Collections.chats).doc(id).get()
  if (!doc.exists) return null

  const payload = doc.data()?.payload as Chat | undefined
  return payload?.sharePath ? payload : null
}

export async function shareChat(chat: Chat) {
  const payload = {
    ...chat,
    sharePath: `/share/${chat.id}`
  }

  await adminDb.collection(Collections.chats).doc(chat.id).update({ payload })

  return payload
}

export async function getAgents(userId?: string | null): Promise<VibeAgent[]> {
  if (!userId) return []

  try {
    const activeTenantId = await getActiveTenant(userId)
    if (!activeTenantId) return []
    return await getAgentsForTenant(activeTenantId)
  } catch {
    return []
  }
}

export async function getAgentConversations(
  userId?: string | null
): Promise<VibeAgentConversation[]> {
  if (!userId) return []

  try {
    const activeTenantId = await getActiveTenant(userId)
    if (!activeTenantId) return []

    // Get all agents for the tenant, then their recent visitor conversations
    // (externalId set), newest first, capped per agent.
    const agentsList = await getAgentsForTenant(activeTenantId)

    const perAgent = await Promise.all(
      agentsList.map(async agent => {
        const convs = await listAgentConversations(activeTenantId, agent.id)
        return convs.filter(c => c.externalId != null).slice(0, 10)
      })
    )

    const conversations: VibeAgentConversation[] = []
    const seenIds = new Set<string>()
    for (const convs of perAgent) {
      for (const conv of convs) {
        if (!seenIds.has(conv.id)) {
          seenIds.add(conv.id)
          conversations.push(conv)
        }
      }
    }

    // Sort all conversations by updatedAt descending
    conversations.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )

    return conversations
  } catch {
    return []
  }
}
