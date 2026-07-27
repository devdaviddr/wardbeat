import {
  Activity,
  LayoutDashboard,
  ListChecks,
  Settings,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  title: string
  href: string
  icon: LucideIcon
}

/** Primary navigation shown in the sidebar / mobile drawer. */
export const navItems: NavItem[] = [
  { title: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { title: 'Ward board', href: '/ward', icon: Activity },
  { title: 'Copilot', href: '/copilot', icon: Sparkles },
  { title: 'Actions', href: '/actions', icon: ListChecks },
  { title: 'Settings', href: '/settings', icon: Settings },
]
