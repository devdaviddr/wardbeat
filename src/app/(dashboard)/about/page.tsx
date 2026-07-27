import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'About' }

// The product guide (public/about.html, mirrored from docs/guide.html) is a
// self-contained document with its own global CSS. To render it *inside* the
// app shell without its styles leaking onto the rest of the app, we scope every
// rule to a wrapper id and inject the body markup inline.

const SCOPE = '#wb-guide'

function scopeSelector(sel: string, scope: string): string {
  const s = sel.trim()
  if (!s) return s
  // The document-level selectors all collapse onto the wrapper, so the guide's
  // :root variables and body styles apply to the embedded subtree only.
  if (s === ':root' || s === 'html' || s === 'body') return scope
  if (s === '*') return `${scope} *`
  if (s.startsWith('html ')) return `${scope} ${s.slice(5)}`
  if (s.startsWith('body ')) return `${scope} ${s.slice(5)}`
  return `${scope} ${s}`
}

function scopeCss(css: string, scope: string): string {
  let out = ''
  let i = 0
  while (i < css.length) {
    const start = i
    while (i < css.length && css[i] !== '{' && css[i] !== '}') i++
    if (i >= css.length) {
      out += css.slice(start)
      break
    }
    if (css[i] === '}') {
      out += css.slice(start, i + 1)
      i++
      continue
    }
    const prelude = css.slice(start, i)
    let depth = 1
    let j = i + 1
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++
      else if (css[j] === '}') depth--
      j++
    }
    const inner = css.slice(i + 1, j - 1)
    const t = prelude.trim()
    if (t.startsWith('@media') || t.startsWith('@supports')) {
      // Nested rules: scope the block's contents, keep the at-rule prelude.
      out += `${prelude}{${scopeCss(inner, scope)}}`
    } else if (t.startsWith('@')) {
      out += `${prelude}{${inner}}`
    } else {
      out += `${prelude
        .split(',')
        .map((sel) => scopeSelector(sel, scope))
        .join(', ')}{${inner}}`
    }
    i = j
  }
  return out
}

export default async function AboutPage() {
  const raw = await readFile(
    path.join(process.cwd(), 'public', 'about.html'),
    'utf8',
  )
  const css = raw.match(/<style>([\s\S]*?)<\/style>/i)?.[1] ?? ''
  let body = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? ''
  // Drop the guide's own sticky top bar; the app shell already provides chrome.
  body = body.replace(
    /<div class="topbar">[\s\S]*?(?=<header class="hero">)/,
    '',
  )
  const html = `<style>${scopeCss(css, SCOPE)}</style>${body}`
  return <div id="wb-guide" dangerouslySetInnerHTML={{ __html: html }} />
}
