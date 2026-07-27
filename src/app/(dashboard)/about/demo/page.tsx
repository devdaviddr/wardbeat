import type { Metadata } from 'next'

import { GuideEmbed } from '@/components/about/guide-embed'

export const metadata: Metadata = { title: 'Demo · About' }

export default function AboutDemoPage() {
  return <GuideEmbed file="about-demo.html" />
}
