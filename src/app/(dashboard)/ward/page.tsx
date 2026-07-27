import { redirect } from 'next/navigation'

// The ward board is the dashboard now (v0.6.1). Keep this route as an alias so
// existing links (and the copilot's "→ board" references) still resolve.
export default function WardPage() {
  redirect('/dashboard')
}
