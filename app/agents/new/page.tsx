import { redirect } from 'next/navigation'

export default function NewAgentPage() {
  redirect('/agents/create-chat')
}
