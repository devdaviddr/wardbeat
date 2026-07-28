import type { Metadata } from 'next'

import { GuideEmbed } from '@/components/about/guide-embed'

export const metadata: Metadata = { title: 'Glossary · About' }

export default function AboutGlossaryPage() {
  return <GuideEmbed file="about-glossary.html" />
}
