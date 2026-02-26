import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'

export async function isSuperAdminWithClient(
  _unused: any,
  userId: string
): Promise<boolean> {
  const userDoc = await adminDb
    .collection(Collections.users)
    .doc(userId)
    .get()

  return userDoc.exists && userDoc.data()?.isSuperAdmin === true
}
