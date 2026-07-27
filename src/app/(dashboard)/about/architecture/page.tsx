import type { Metadata } from 'next'

import { GuideEmbed } from '@/components/about/guide-embed'

export const metadata: Metadata = { title: 'Architecture · About' }

export default function AboutArchitecturePage() {
  return <GuideEmbed file="about-architecture.html" />
}
