import type { Metadata } from 'next'

import { GuideEmbed } from '@/components/about/guide-embed'

export const metadata: Metadata = { title: 'Roadmap · About' }

export default function AboutRoadmapPage() {
  return <GuideEmbed file="about-roadmap.html" />
}
