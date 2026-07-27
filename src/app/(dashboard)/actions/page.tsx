import { redirect } from 'next/navigation'

// The action queue now lives on the ward board (the "Actions" panel). Keep this
// route as an alias so existing links resolve.
export default function ActionsPage() {
  redirect('/dashboard')
}
