import type { Metadata } from 'next'

import { GuideEmbed } from '@/components/about/guide-embed'

export const metadata: Metadata = { title: 'Azure · About' }

export default function AboutAzurePage() {
  return <GuideEmbed file="about-azure.html" />
}
