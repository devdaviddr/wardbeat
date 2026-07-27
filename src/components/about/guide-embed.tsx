import { readFile } from 'node:fs/promises'
import path from 'node:path'

// Renders a self-contained guide document (public/<file>) *inside* the app
// shell. The guide ships its own global CSS, so every rule is scoped to a
// wrapper id and the markup is injected inline — its styles can't leak onto the
// rest of the app, and the app's styles can't bleed into it.

const SCOPE = '#wb-guide'

function scopeSelector(sel: string, scope: string): string {
  const s = sel.trim()
  if (!s) return s
  // Document-level selectors collapse onto the wrapper, so the guide's :root
  // variables and body styles apply to the embedded subtree only.
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

export async function GuideEmbed({ file }: { file: string }) {
  const raw = await readFile(path.join(process.cwd(), 'public', file), 'utf8')
  const css = raw.match(/<style>([\s\S]*?)<\/style>/i)?.[1] ?? ''
  let body = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? ''
  // Drop the guide's own sticky top bar; the app shell provides chrome and the
  // About sub-nav handles cross-page navigation.
  body = body.replace(
    /<div class="topbar">[\s\S]*?(?=<header class="hero">)/,
    '',
  )
  const html = `<style>${scopeCss(css, SCOPE)}</style>${body}`
  return <div id="wb-guide" dangerouslySetInnerHTML={{ __html: html }} />
}
