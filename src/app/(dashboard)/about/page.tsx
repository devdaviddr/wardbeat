import type { Metadata } from 'next'

import { GuideEmbed } from '@/components/about/guide-embed'

export const metadata: Metadata = { title: 'About' }

export default function AboutPage() {
  return <GuideEmbed file="about.html" />
}
