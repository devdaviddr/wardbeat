import type { Metadata } from 'next'

import { GuideEmbed } from '@/components/about/guide-embed'

export const metadata: Metadata = { title: 'Monitoring · About' }

export default function AboutMonitoringPage() {
  return <GuideEmbed file="about-monitoring.html" />
}
