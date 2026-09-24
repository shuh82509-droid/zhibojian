import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import { hostname as systemHostname } from 'node:os';
import { basename, dirname, join } from 'node:path';

const ownerFile = 'owner.json';

function defaultProbePid(pid) {
  try { process.kill(pid, 0); return 'alive'; }
  catch (error) { return error?.code === 'ESRCH' ? 'dead' : 'unknown'; }
}

function validOwner(value) {
  return value?.schemaVersion === 1
    && typeof value.host === 'string' && value.host.length > 0 && value.host.length <= 255
    && Number.isInteger(value.pid) && value.pid > 0
    && typeof value.nonce === 'string' && /^[0-9a-f-]{36}$/iu.test(value.nonce)
    && typeof value.acquiredAt === 'string' && !Number.isNaN(Date.parse(value.acquiredAt));
}

/** A lock is recoverable only after the original process is proven absent on this same host. */
export function createReminderJournalLock({lockPath, host = systemHostname(), pid = process.pid, probePid = defaultProbePid}) {
  if (!lockPath || !host || !Number.isInteger(pid) || pid <= 0) throw new Error('提醒锁配置无效。');
  const recoveryPath = `${lockPath}.recovery`;
  let lastRecovery = null;
  const ownerPath = path => join(path, ownerFile);
  const absent = error => error?.code === 'ENOENT';
  const status = (state, reason, owner = null) => ({state,reason,ownerPid:owner?.pid || null,sameHost:owner ? owner.host === host : null,acquiredAt:owner?.acquiredAt || null});

  async function readOwner(path) {
    const file = await lstat(ownerPath(path));
    if (!file.isFile() || file.isSymbolicLink()) throw new Error('提醒锁所有者记录不是普通文件。');
    const value = JSON.parse(await readFile(ownerPath(path),'utf8'));
    if (!validOwner(value)) throw new Error('提醒锁所有者记录无效。');
    return value;
  }

  async function inspect({ignoreRecovery = false} = {}) {
    if (!ignoreRecovery) {
      try { await lstat(recoveryPath); return status('blocked_unknown','恢复标记仍在；需人工核验原操作与进程，不能继续发送。'); }
      catch (error) { if (!absent(error)) return status('blocked_unknown','恢复标记状态无法核验。'); }
    }
    let file;
    try { file = await lstat(lockPath); }
    catch (error) { return absent(error) ? status('free','提醒发送记录未被占用。') : status('blocked_unknown','提醒锁路径无法核验。'); }
    if (!file.isDirectory() || file.isSymbolicLink()) return status('blocked_unknown','提醒锁路径类型异常，不能继续发送。');
    let owner;
    try { owner = await readOwner(lockPath); }
    catch { return status('blocked_unknown','提醒锁缺少有效的所有者记录，不能推定旧进程已退出。'); }
    if (owner.host !== host) return status('blocked_unknown','提醒锁来自另一主机或容器，无法核验原进程。',owner);
    if (owner.pid === pid) return status('active','本进程持有提醒锁，不能接管。',owner);
    let processState = 'unknown';
    try { processState = probePid(owner.pid); }
    catch { /* Probe failures are not evidence of process exit. */ }
    if (processState === 'dead') return status('stale_recoverable','同主机原进程已明确不存在；下次发送检查会归档旧锁。',owner);
    if (processState === 'alive') return status('active','同主机原进程仍存在，不能接管提醒锁。',owner);
    return status('blocked_unknown','无法证明原进程不存在，不能接管提醒锁。',owner);
  }

  async function archiveStaleLock() {
    const initial = await inspect();
    if (initial.state !== 'stale_recoverable') throw new Error(initial.reason);
    // The recovery marker serializes all new instances of this lock protocol.
    // An abandoned marker is deliberately never auto-bypassed.
    try { await mkdir(recoveryPath,{mode:0o700}); }
    catch { throw new Error('提醒锁恢复已由其他进程处理或状态不明，已停止发送。'); }
    try {
      const before = await readOwner(lockPath);
      const latest = await inspect({ignoreRecovery:true});
      if (latest.state !== 'stale_recoverable' || latest.ownerPid !== initial.ownerPid || before.host !== host) throw new Error('提醒锁所有者已变化，不能自动归档。');
      const archivePath = `${lockPath}.orphaned-${Date.now()}-${randomUUID()}`;
      await rename(lockPath,archivePath);
      const archived = await readOwner(archivePath);
      if (archived.nonce !== before.nonce) throw new Error('归档锁内容与核验记录不一致，已停止发送。');
      lastRecovery={at:new Date().toISOString(),oldPid:archived.pid,oldAcquiredAt:archived.acquiredAt,archiveName:basename(archivePath)};
      return archivePath;
    } finally {
      await rmdir(recoveryPath);
    }
  }

  async function acquire() {
    await mkdir(dirname(lockPath),{recursive:true});
    const inspected = await inspect();
    if (inspected.state === 'stale_recoverable') await archiveStaleLock();
    else if (inspected.state !== 'free') throw new Error(inspected.reason);
    if ((await inspect()).state !== 'free') throw new Error('提醒锁已被其他进程占用或状态不明。');
    const owner = {schemaVersion:1,host,pid,nonce:randomUUID(),acquiredAt:new Date().toISOString()};
    const claimPath = join(dirname(lockPath),`${basename(lockPath)}.claim-${owner.nonce}`);
    await mkdir(claimPath,{mode:0o700});
    await writeFile(ownerPath(claimPath),JSON.stringify(owner),{flag:'wx',mode:0o600});
    try { await rename(claimPath,lockPath); }
    catch {
      await unlink(ownerPath(claimPath));
      await rmdir(claimPath);
      throw new Error('提醒锁已被其他进程占用；已停止发送。');
    }
    return owner;
  }

  async function release(owner) {
    const current = await readOwner(lockPath);
    if (current.nonce !== owner.nonce || current.pid !== pid || current.host !== host) throw new Error('提醒锁所有者已变化，不能释放他人锁。');
    const releasedPath = `${lockPath}.released-${Date.now()}-${owner.nonce}`;
    await rename(lockPath,releasedPath);
    await unlink(ownerPath(releasedPath));
    await rmdir(releasedPath);
  }

  async function run(operation) {
    const owner = await acquire();
    try { return await operation(); }
    finally { await release(owner); }
  }

  return {inspect,run,recentRecovery:()=>lastRecovery};
}
