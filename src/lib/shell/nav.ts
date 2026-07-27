import { Activity, Settings, type LucideIcon } from 'lucide-react'

export interface NavItem {
  title: string
  href: string
  icon: LucideIcon
}

/**
 * Primary navigation. The product is board-centric (v0.6.0): the copilot and the
 * flow briefing now live *on* the ward board (dock + header strip), so they're
 * no longer separate destinations. The Actions queue stays as a focused triage
 * view. The `/copilot` and `/briefing` routes remain reachable directly.
 */
export const navItems: NavItem[] = [
  // The ward board is the home/dashboard (`/dashboard`). The action queue lives
  // on the board (the "Actions" panel), so it's not a separate destination.
  { title: 'Ward board', href: '/dashboard', icon: Activity },
  { title: 'Settings', href: '/settings', icon: Settings },
]
