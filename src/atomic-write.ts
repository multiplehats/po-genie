import { closeSync, openSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'

/** Replace a file only after its complete replacement has been written nearby. */
export function writeFileAtomically(
  destination: string,
  content: string | Uint8Array,
  encoding?: BufferEncoding,
): void {
  const temporaryPath = join(
    dirname(destination),
    `.${basename(destination)}.${randomUUID()}.tmp`,
  )
  let temporaryCreated = false

  try {
    const descriptor = openSync(temporaryPath, 'wx')
    temporaryCreated = true
    closeSync(descriptor)

    writeFileSync(temporaryPath, content, encoding)
    renameSync(temporaryPath, destination)
  } catch (error) {
    if (temporaryCreated) {
      try {
        unlinkSync(temporaryPath)
      } catch {
        // The temporary file may not exist after a failed rename.
      }
    }
    throw error
  }
}
