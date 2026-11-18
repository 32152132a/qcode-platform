export type DiffLine = { number: number; text: string; changed: boolean }
export type DiffRow = { before?: DiffLine; after?: DiffLine }

export function diffLines(before: string, after: string): DiffRow[] {
  const lines = (value: string) => value ? value.replace(/\r\n?/g, '\n').split('\n') : []
  const left = lines(before), right = lines(after)
  let prefix = 0, suffix = 0
  while (prefix < Math.min(left.length, right.length) && left[prefix] === right[prefix]) prefix++
  while (suffix < Math.min(left.length, right.length) - prefix && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]) suffix++
  const a = left.slice(prefix, left.length - suffix), b = right.slice(prefix, right.length - suffix)
  const rows: DiffRow[] = [], removed: DiffLine[] = [], added: DiffLine[] = []
  let oldNumber = 1, newNumber = 1
  function flush() {
    for (let index = 0; index < Math.max(removed.length, added.length); index++) rows.push({ before: removed[index], after: added[index] })
    removed.length = 0; added.length = 0
  }
  function unchanged(text: string) {
    flush()
    rows.push({ before: { number: oldNumber++, text, changed: false }, after: { number: newNumber++, text, changed: false } })
  }
  for (let index = 0; index < prefix; index++) unchanged(left[index]!)
  // Bound the alignment work for unusually fragmented documents; retain every line.
  if (a.length * b.length > 1_000_000) {
    for (const text of a) removed.push({ number: oldNumber++, text, changed: true })
    for (const text of b) added.push({ number: newNumber++, text, changed: true })
  } else {
    const width = b.length + 1, lengths = new Uint16Array((a.length + 1) * width)
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
      lengths[i * width + j] = a[i] === b[j] ? 1 + lengths[(i + 1) * width + j + 1]! : Math.max(lengths[(i + 1) * width + j]!, lengths[i * width + j + 1]!)
    }
    let i = 0, j = 0
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) unchanged(a[i++]!), j++
      else if (i < a.length && (j === b.length || lengths[(i + 1) * width + j]! >= lengths[i * width + j + 1]!)) removed.push({ number: oldNumber++, text: a[i++]!, changed: true })
      else added.push({ number: newNumber++, text: b[j++]!, changed: true })
    }
  }
  flush()
  for (let index = left.length - suffix; index < left.length; index++) unchanged(left[index]!)
  return rows
}
