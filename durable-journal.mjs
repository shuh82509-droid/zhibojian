import {randomUUID} from 'node:crypto';
import * as fs from 'node:fs/promises';
import {dirname} from 'node:path';

/** Persist a reminder intent before any external POST can begin.
 *
 * fsync(temp) makes the bytes durable; fsync(parent) after rename makes the
 * replacement durable. A failure after rename is intentionally ambiguous to
 * the caller: it must not proceed to send or retry an unknown delivery.
 */
export async function writeDurableJsonAtomic(path, value, {fileSystem=fs, nonce=randomUUID}={}) {
  if (typeof path !== 'string' || !path) throw new Error('Reminder journal path is required');
  const contents=JSON.stringify(value);
  if (typeof contents !== 'string') throw new Error('Reminder journal value is not JSON');
  const temporary=`${path}.${process.pid}.${nonce()}.tmp`;
  let created=false,renamed=false;
  try {
    const file=await fileSystem.open(temporary,'wx',0o600);
    created=true;
    try {
      await file.writeFile(contents,'utf8');
      await file.sync();
    } finally { await file.close(); }
    await fileSystem.rename(temporary,path);
    renamed=true;
    const directory=await fileSystem.open(dirname(path),'r');
    try { await directory.sync(); }
    finally { await directory.close(); }
  } catch(error) {
    if(created&&!renamed) {
      try { await fileSystem.unlink(temporary); }
      catch { /* Preserve the original failure; an unlinked/stray temp is not a send license. */ }
    }
    throw error;
  }
}
