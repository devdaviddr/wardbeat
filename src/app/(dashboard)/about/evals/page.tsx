import type { Metadata } from 'next'

import { GuideEmbed } from '@/components/about/guide-embed'

export const metadata: Metadata = { title: 'Evaluation · About' }

export default function AboutEvalsPage() {
  return <GuideEmbed file="about-evals.html" />
}
