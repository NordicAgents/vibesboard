'use server'
import 'server-only'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import { type Chat, type VibeAgent, type VibeAgentConversation } from '@/lib/types'
import { mapAgentDoc, mapConversationDoc } from '@/lib/agents/db'
import { getActiveTenant } from '@/lib/tenant-context'

export async function getChats(userId?: string | null) {
  if (!userId) return []

  try {
    const snapshot = await adminDb
      .collection(Collections.chats)
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get()

    return snapshot.docs.map(doc => doc.data().payload as Chat)
  } catch {
    return []
  }
}

export async function getChat(id: string) {
  const doc = await adminDb.collection(Collections.chats).doc(id).get()
  return doc.exists ? (doc.data()?.payload as Chat) ?? null : null
}

export async function removeChat({
  id,
  path
}: {
  id: string
  path: string
}) {
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
    snapshot.docs.forEach(doc => batch.delete(doc.ref))
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

  await adminDb
    .collection(Collections.chats)
    .doc(chat.id)
    .update({ payload })

  return payload
}

export async function getAgents(
  userId?: string | null
): Promise<VibeAgent[]> {
  if (!userId) return []

  try {
    const activeTenantId = await getActiveTenant(userId)

    if (activeTenantId) {
      const snapshot = await adminDb
        .collection(Collections.agents(activeTenantId))
        .orderBy('createdAt', 'desc')
        .get()

      return snapshot.docs.map(doc => mapAgentDoc(doc.data()))
    }

    // No active tenant — shouldn't happen with ensureActiveTenant but handle gracefully
    return []
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

    // Get all agents for the tenant
    const agentsSnapshot = await adminDb
      .collection(Collections.agents(activeTenantId))
      .get()

    const conversations: VibeAgentConversation[] = []

    // For each agent, get conversations for this user
    for (const agentDoc of agentsSnapshot.docs) {
      const convSnapshot = await adminDb
        .collection(
          Collections.conversations(activeTenantId, agentDoc.id)
        )
        .where('userId', '==', userId)
        .orderBy('updatedAt', 'desc')
        .get()

      conversations.push(
        ...convSnapshot.docs.map(doc => mapConversationDoc(doc.data()))
      )
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
