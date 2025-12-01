import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sftpStorage } from './sftp.js';

async function writeTmpFile(contents: string | Buffer, name = 'wiseia-test.txt') {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wiseia-'));
  const p = path.join(dir, name);
  await fs.promises.writeFile(p, contents);
  return p;
}

async function main() {
  const DEPT_DIR = 'financeiro';               // ajuste se quiser outro
  const DEST1 = `${DEPT_DIR}/hello.txt`;
  const DEST2 = `${DEPT_DIR}/hello-moved.txt`;

  console.log('1) ensureDir...');
  await sftpStorage.ensureDir(DEPT_DIR);

  console.log('2) upload (fastPut .part -> rename)...');
  const tmp = await writeTmpFile('Hello WISEIA via SFTP!\n');
  await sftpStorage.putLocalToRemote(tmp, DEST1);

  console.log('   stat após upload:');
  console.log(await sftpStorage.statRemote(DEST1));

  console.log('3) listDir do departamento:');
  const list1 = await sftpStorage.listDir(DEPT_DIR);
  console.table(list1.map((x: any) => ({ name: x.name, type: x.type, size: x.size })));

  console.log('4) move (rename atômico)...');
  await sftpStorage.moveRemote(DEST1, DEST2);
  console.log('   stat novo caminho:');
  console.log(await sftpStorage.statRemote(DEST2));

  console.log('5) read stream (primeiros bytes)...');
  const stream = await sftpStorage.createReadStream(DEST2);
  await new Promise<void>((resolve, reject) => {
    let read = 0;
    stream.on('data', (chunk: Buffer) => {
      read += chunk.length;
      if (read >= 32) stream.destroy(); // ler só um pouco
    });
    stream.on('close', () => {
      console.log(`   stream fechado (lidos ~${read} bytes)`);
      resolve();
    });
    stream.on('error', reject);
  });

  console.log('6) remove (delete)...');
  await sftpStorage.removeRemote(DEST2);

  console.log('7) conferir listagem final:');
  const list2 = await sftpStorage.listDir(DEPT_DIR);
  console.table(list2.map((x: any) => ({ name: x.name, type: x.type, size: x.size })));

  console.log('OK ✅ – smoke test concluído.');
}

main().catch((err) => {
  console.error('Falhou ❌', err);
  process.exit(1);
});
