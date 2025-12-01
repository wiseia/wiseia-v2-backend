// src/storage/sftp.ts
// Versão simplificada (stub) – SFTP desativado por enquanto.
// Isso evita erros de inicialização e TypeScript, mas mantém a mesma "interface".

export const sftpStorage = {
  async putBuffer() {
    throw new Error('SFTP não está configurado neste ambiente (stub).');
  },

  async ensureDir() {
    throw new Error('SFTP não está configurado neste ambiente (stub).');
  },

  async putLocalToRemote() {
    throw new Error('SFTP não está configurado neste ambiente (stub).');
  },

  async moveRemote() {
    throw new Error('SFTP não está configurado neste ambiente (stub).');
  },

  async removeRemote() {
    throw new Error('SFTP não está configurado neste ambiente (stub).');
  },

  async readFile() {
    throw new Error('SFTP não está configurado neste ambiente (stub).');
  },

  async createReadStream() {
    throw new Error('SFTP não está configurado neste ambiente (stub).');
  },

  async listDir() {
    throw new Error('SFTP não está configurado neste ambiente (stub).');
  },

  async statRemote() {
    throw new Error('SFTP não está configurado neste ambiente (stub).');
  },
} as const;
