import { AboutTabs } from '@/components/about/about-tabs'

// The About section is a small multi-page area (Overview, Architecture, Azure).
// A shared sub-nav sits above the embedded guide content on every About page.
export default function AboutLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="space-y-4">
      <AboutTabs />
      {children}
    </div>
  )
}
