export interface Storage {
  putLocalToRemote(localTmpPath: string, destRelPath: string): Promise<void>; // .part -> rename
  moveRemote(srcRel: string, destRel: string): Promise<void>;                 // rename atômico
  removeRemote(relPath: string): Promise<void>;                               // delete
  createReadStream(relPath: string): Promise<NodeJS.ReadableStream>;          // stream p/ download
  ensureDir(relDir: string): Promise<void>;
}
