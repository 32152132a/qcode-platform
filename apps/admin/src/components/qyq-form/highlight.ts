const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

export const buildHighlightHtml = (text: string, regex: RegExp | null) => {
  const source = text || ''

  if (!source || !regex) {
    return escapeHtml(source)
  }

  const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`
  const highlightRegex = new RegExp(regex.source, flags)
  let html = ''
  let lastIndex = 0
  let match: RegExpExecArray | null = null

  while ((match = highlightRegex.exec(source))) {
    if (!match[0]) {
      break
    }

    const start = match.index
    const end = start + match[0].length
    html += escapeHtml(source.slice(lastIndex, start))
    html += `<span class="search-highlight">${escapeHtml(match[0])}</span>`
    lastIndex = end
  }

  if (!html) {
    return escapeHtml(source)
  }

  return `${html}${escapeHtml(source.slice(lastIndex))}`
}
