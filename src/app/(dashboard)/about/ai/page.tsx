import type { Metadata } from 'next'

import { GuideEmbed } from '@/components/about/guide-embed'

export const metadata: Metadata = { title: 'AI · About' }

export default function AboutAiPage() {
  return <GuideEmbed file="about-ai.html" />
}
