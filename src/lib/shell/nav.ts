import {
  Activity,
  LayoutDashboard,
  Settings,
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
  { title: 'Settings', href: '/settings', icon: Settings },
]
