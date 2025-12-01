// src/routes/documentos.ts
import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { lookup as mimeFromExt } from 'mime-types';
import { sftpStorage } from '../storage/sftp.js';
import { requirePerm } from '../auth/requirePerm.js';

export const documentosRoutes: FastifyPluginAsync = async (app) => {
  // POST /documentos/upload  (mantido apenas autenticado)
  app.post(
    '/documentos/upload',
    { preHandler: (app as any).authenticate },
    async (req: any, reply) => {
      if (!req.isMultipart()) {
        return reply.unsupportedMediaType('Content-Type deve ser multipart/form-data');
      }

      const getField = (name: string) => {
        const v = req.body?.[name];
        if (v == null) return undefined;
        if (typeof v === 'object' && 'value' in v) return String((v as any).value);
        return String(v);
      };

      // ⚠️ NÃO copie métodos do objeto do multipart; retorne a própria referência!
      function findFileInBody(body: any) {
        if (!body || typeof body !== 'object') return null;
        for (const [, v] of Object.entries(body)) {
          if (
            v &&
            typeof v === 'object' &&
            (('file' in (v as any)) || typeof (v as any).toBuffer === 'function')
          ) {
            return v as {
              filename?: string;
              mimetype?: string;
              toBuffer?: () => Promise<Buffer>;
              file?: NodeJS.ReadableStream;
            };
          }
        }
        return null;
      }

      const rawTitulo = getField('titulo');
      const rawIdDep = getField('idDepartamento');
      const filePart = findFileInBody(req.body);

      const schema = z.object({
        titulo: z.string().min(1),
        idDepartamento: z.coerce.number().int().positive(),
      });
      const fields = schema.parse({ titulo: rawTitulo, idDepartamento: rawIdDep });

      if (!filePart) return reply.badRequest('arquivo é obrigatório');

      const originalName = String(filePart.filename ?? '');
      const ext = path.extname(originalName) || '';
      const mime = String(filePart.mimetype ?? (mimeFromExt(ext) || 'application/octet-stream'));

      const safeName =
        (originalName || 'arquivo')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^A-Za-z0-9._-]+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^[-_.]+|[-_.]+$/g, '')
          .slice(0, 120) || 'arquivo';

      // === Leia o arquivo como BUFFER (sem perder o this) ===
      let fileBuf: Buffer | null = null;
      let tmpCreatedPath: string | null = null;

      try {
        if (typeof filePart.toBuffer === 'function') {
          fileBuf = await filePart.toBuffer();
        } else if (filePart.file) {
          tmpCreatedPath = path.join(
            process.cwd(),
            'tmp_upload_' + crypto.randomBytes(8).toString('hex')
          );
          await new Promise<void>((resolve, reject) => {
            const ws = fs.createWriteStream(tmpCreatedPath!);
            filePart.file!.pipe(ws);
            ws.on('finish', resolve);
            ws.on('error', reject);
            filePart.file!.on('error', reject);
          });
          fileBuf = await fs.promises.readFile(tmpCreatedPath);
        } else {
          return reply.badRequest('arquivo inválido');
        }
      } catch (e) {
        req.log.error({ e }, 'upload:read-file-failed');
        throw e;
      }

      const bytes = fileBuf.length;
      req.log.info(
        { localBytes: bytes, filename: originalName, idDepartamento: fields.idDepartamento },
        'upload:local-bytes'
      );
      if (bytes <= 0) return reply.badRequest('arquivo vazio (0 bytes)');

      const sha256 = crypto.createHash('sha256').update(fileBuf).digest('hex');

      const baseDir = `empresas/${req.user.idEmpresa}/departamentos/${fields.idDepartamento}`;
      await sftpStorage.ensureDir(baseDir);

      const { idDocumento } = await db.transaction(async (trx) => {
        const baseInsert = {
          idEmpresa: req.user.idEmpresa,
          idDepartamento: fields.idDepartamento,
          titulo: fields.titulo,
          nomeOriginal: originalName,
          mime,
          tamanhoBytes: bytes,
          hashSha256: sha256,
          caminhoAtual: '__pending__',
          status: 'processing',
          uploadedBy: req.user.idUsuario,
          deleted_at: null,
        };

        const [idRow] = await trx('Documento')
          .insert(baseInsert)
          .returning('idDocumento')
          .catch(async (e) => {
            if (/returning/i.test(String(e))) {
              await trx('Documento').insert(baseInsert);
              const [{ idDocumento }] = await trx('Documento')
                .select('idDocumento')
                .where(baseInsert as any)
                .orderBy('idDocumento', 'desc')
                .limit(1);
              return [{ idDocumento }];
            }
            throw e;
          });

        const idDocumento = Number((idRow as any).idDocumento ?? idRow);
        const destRel = `${baseDir}/${idDocumento}-${safeName}`;

        await sftpStorage.putBuffer(fileBuf!, destRel);

        await trx('Documento').update({ caminhoAtual: destRel, status: 'ready' }).where({ idDocumento });
        await trx('DocumentoHistorico').insert({
          idDocumento,
          acao: 'upload',
          detalhe: JSON.stringify({ origem: 'upload' }),
          idUsuario: req.user.idUsuario,
        });

        try {
          const st = await sftpStorage.statRemote(destRel);
          req.log.info({ remoteBytes: st?.size, destRel }, 'upload:remote-bytes');
        } catch (e) {
          req.log.error({ e, destRel }, 'upload:stat-remote-failed');
        }

        return { idDocumento };
      });

      if (tmpCreatedPath) fs.rmSync(tmpCreatedPath, { force: true });

      return reply.code(201).send({ ok: true, idDocumento });
    }
  );

  // PATCH /documentos/:id/mover
  app.patch(
    '/documentos/:id/mover',
    { preHandler: [(app as any).authenticate, requirePerm('documents:archive')] },
    async (req: any, reply) => {
      const p = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
      const body = z.object({ novoDepartamento: z.coerce.number().int().positive() }).parse(req.body);

      const doc = await db('Documento')
        .where({ idDocumento: p.id, idEmpresa: req.user.idEmpresa })
        .first();
      if (!doc) return reply.notFound('documento não encontrado');
      if (doc.deleted_at) return reply.badRequest('documento deletado');

      const baseName = path.basename(doc.caminhoAtual);
      const novoCaminho = `empresas/${req.user.idEmpresa}/departamentos/${body.novoDepartamento}/${baseName}`;

      await db.transaction(async (trx) => {
        await sftpStorage.moveRemote(doc.caminhoAtual, novoCaminho);

        await trx('Documento')
          .update({
            idDepartamento: body.novoDepartamento,
            caminhoAtual: novoCaminho,
          })
          .where({ idDocumento: p.id });

        await trx('DocumentoHistorico').insert({
          idDocumento: p.id,
          acao: 'move',
          detalhe: JSON.stringify({ from: doc.idDepartamento, to: body.novoDepartamento }),
          idUsuario: req.user.idUsuario,
        });
      });

      return { ok: true };
    }
  );

  // DELETE /documentos/:id  (soft delete + mover para _trash/)
  app.delete(
    '/documentos/:id',
    { preHandler: [(app as any).authenticate, requirePerm('documents:delete')] },
    async (req: any, reply) => {
      const p = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);

      const doc = await db('Documento')
        .where({ idDocumento: p.id, idEmpresa: req.user.idEmpresa })
        .first();
      if (!doc) return reply.notFound('documento não encontrado');
      if (doc.deleted_at) return reply.badRequest('documento já deletado');

      const baseName = path.basename(doc.caminhoAtual);
      const trashDir = `_trash/${req.user.idEmpresa}`;
      const trashPath = `${trashDir}/${baseName}`;

      await db.transaction(async (trx) => {
        await sftpStorage.ensureDir(trashDir);
        await sftpStorage.moveRemote(doc.caminhoAtual, trashPath);

        await trx('Documento')
          .update({
            status: 'deleted',
            deleted_at: db.raw('SYSUTCDATETIME()'),
            caminhoAtual: trashPath,
          })
          .where({ idDocumento: p.id });

        await trx('DocumentoHistorico').insert({
          idDocumento: p.id,
          acao: 'delete',
          detalhe: JSON.stringify({ to: trashPath }),
          idUsuario: req.user.idUsuario,
        });
      });

      return { ok: true };
    }
  );

  // GET /documentos/:id/download
  app.get(
    '/documentos/:id/download',
    { preHandler: [(app as any).authenticate, requirePerm('documents:download')] },
    async (req: any, reply) => {
      const p = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);

      const doc = await db('Documento')
        .where({ idDocumento: p.id, idEmpresa: req.user.idEmpresa })
        .first();
      if (!doc) return reply.notFound('documento não encontrado');
      if (doc.deleted_at) return reply.badRequest('documento deletado');
      console.log(await sftpStorage.listDir('.'))
      const buf = await sftpStorage.readFile(doc.caminhoAtual);

      reply.header('Content-Type', doc.mime || 'application/octet-stream');
      reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.nomeOriginal)}"`);
      reply.header('Content-Length', String(buf.length));

      await db('DocumentoHistorico').insert({
        idDocumento: p.id,
        acao: 'download',
        detalhe: null,
        idUsuario: req.user.idUsuario,
      });

      return reply.send(buf);
    }
  );

  // GET /documentos  (lista/consulta)
  app.get(
    '/documentos',
    { preHandler: [(app as any).authenticate, requirePerm('documents:view')] },
    async (req: any) => {
      const q = z
        .object({
          departamento: z.coerce.number().int().positive().optional(),
          search: z.string().trim().optional(),
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(500).default(100),
        })
        .parse(req.query ?? {});

      let query = db('vw_Wiseia_Documentos').where('idEmpresa', req.user.idEmpresa);

      if (q.departamento) {
        query = query.andWhere('idDepartamento', q.departamento);
      }

      if (q.search) {
        const s = `%${q.search}%`;
        query = query.andWhere((b) =>
          b
            .whereILike('titulo', s)
            .orWhereILike('nomeOriginal', s)
            .orWhereILike('departamentoNome', s)
            .orWhereILike('uploadedByNome', s)
        );
      }

      query = query.orderBy('criadoEmUtc', 'desc');

      const page = q.page;
      const size = q.pageSize;

      const [items, totalRow] = await Promise.all([
        query.clone().limit(size).offset((page - 1) * size),

        db('vw_Wiseia_Documentos')
          .where('idEmpresa', req.user.idEmpresa)
          .modify((qb) => {
            if (q.departamento) qb.andWhere('idDepartamento', q.departamento);
            if (q.search) {
              const s = `%${q.search}%`;
              qb.andWhere((b) =>
                b
                  .whereILike('titulo', s)
                  .orWhereILike('nomeOriginal', s)
                  .orWhereILike('departamentoNome', s)
                  .orWhereILike('uploadedByNome', s)
              );
            }
          })
          .count<{ total: string | number }>({ total: '*' })
          .first(),
      ]);

      const total = Number((totalRow as any)?.total ?? 0);

      return { items, page, pageSize: size, total };
    }
  );

  // PATCH /documentos/:id/arquivar
  app.patch(
    '/documentos/:id/arquivar',
    { preHandler: [(app as any).authenticate, requirePerm('documents:archive')] },
    async (req: any, reply) => {
      const p = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);

      const doc = await db('Documento')
        .where({ idDocumento: p.id, idEmpresa: req.user.idEmpresa })
        .first();

      if (!doc) return reply.notFound('documento não encontrado');
      if (doc.deleted_at) return reply.badRequest('documento deletado');
      if (doc.status === 'archived') return reply.badRequest('documento já está arquivado');

      const baseName = path.basename(doc.caminhoAtual);
      const dirAtual = path.posix.dirname(doc.caminhoAtual);
      const archiveDir = path.posix.join(dirAtual, '_archive');
      const archivePath = path.posix.join(archiveDir, baseName);

      await db.transaction(async (trx) => {
        await sftpStorage.ensureDir(archiveDir);
        await sftpStorage.moveRemote(doc.caminhoAtual, archivePath);

        await trx('Documento')
          .update({
            caminhoAtual: archivePath,
            status: 'archived',
            updated_at: trx.raw('SYSUTCDATETIME()'),
          })
          .where({ idDocumento: p.id });

        await trx('DocumentoHistorico').insert({
          idDocumento: p.id,
          acao: 'archive',
          detalhe: JSON.stringify({ to: archivePath }),
          idUsuario: req.user.idUsuario,
        });
      });

      return { ok: true };
    }
  );

  // PATCH /documentos/:id/desarquivar
  app.patch(
    '/documentos/:id/desarquivar',
    { preHandler: [(app as any).authenticate, requirePerm('documents:unarchive')] },
    async (req: any, reply) => {
      const p = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);

      const doc = await db('Documento')
        .where({ idDocumento: p.id, idEmpresa: req.user.idEmpresa })
        .first();

      if (!doc) return reply.notFound('documento não encontrado');
      if (doc.deleted_at) return reply.badRequest('documento deletado');
      if (doc.status !== 'archived') return reply.badRequest('documento não está arquivado');

      const baseName = path.basename(doc.caminhoAtual);
      const dirAtual = path.posix.dirname(doc.caminhoAtual); // .../departamentos/{dep}/_archive
      const dirPai = path.posix.dirname(dirAtual); // .../departamentos/{dep}
      const target = path.posix.join(dirPai, baseName); // volta para a raiz do dep

      await db.transaction(async (trx) => {
        await sftpStorage.ensureDir(dirPai);
        await sftpStorage.moveRemote(doc.caminhoAtual, target);

        await trx('Documento')
          .update({
            caminhoAtual: target,
            status: 'ready',
            updated_at: trx.raw('SYSUTCDATETIME()'),
          })
          .where({ idDocumento: p.id });

        await trx('DocumentoHistorico').insert({
          idDocumento: p.id,
          acao: 'unarchive',
          detalhe: JSON.stringify({ to: target }),
          idUsuario: req.user.idUsuario,
        });
      });

      return { ok: true };
    }
  );

  // PATCH /documentos/:id/restaurar (da lixeira)
  app.patch(
    '/documentos/:id/restaurar',
    { preHandler: [(app as any).authenticate, requirePerm('trash:restore')] },
    async (req: any, reply) => {
      const p = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);

      const doc = await db('Documento')
        .where({ idDocumento: p.id, idEmpresa: req.user.idEmpresa })
        .first();

      if (!doc) return reply.notFound('documento não encontrado');
      if (!doc.deleted_at) return reply.badRequest('documento não está na lixeira');

      const baseName = path.basename(doc.caminhoAtual);
      const destDir = `empresas/${req.user.idEmpresa}/departamentos/${doc.idDepartamento}`;
      const destPath = `${destDir}/${baseName}`;

      await db.transaction(async (trx) => {
        await sftpStorage.ensureDir(destDir);
        await sftpStorage.moveRemote(doc.caminhoAtual, destPath);

        await trx('Documento')
          .update({
            caminhoAtual: destPath,
            status: 'ready',
            deleted_at: null,
          })
          .where({ idDocumento: p.id });

        await trx('DocumentoHistorico').insert({
          idDocumento: p.id,
          acao: 'restore',
          detalhe: JSON.stringify({ to: destPath }),
          idUsuario: req.user.idUsuario,
        });
      });

      return { ok: true };
    }
  );

  // GET /documentos/lixeira
  app.get(
    '/documentos/lixeira',
    { preHandler: [(app as any).authenticate, requirePerm('trash:view')] },
    async (req: any) => {
      const q = z
        .object({
          departamento: z.coerce.number().int().positive().optional(),
          search: z.string().trim().optional(),
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(500).default(100),
        })
        .parse(req.query ?? {});

      let query = db('Documento')
        .where('idEmpresa', req.user.idEmpresa)
        .whereNotNull('deleted_at'); // só lixeira

      if (q.departamento) query = query.andWhere('idDepartamento', q.departamento);
      if (q.search) {
        const s = `%${q.search}%`;
        query = query.andWhere((b) => b.whereILike('titulo', s).orWhereILike('nomeOriginal', s));
      }

      const page = q.page,
        size = q.pageSize;
      const [items, totalRow] = await Promise.all([
        query.clone().orderBy('deleted_at', 'desc').limit(size).offset((page - 1) * size),
        db('Documento')
          .where('idEmpresa', req.user.idEmpresa)
          .whereNotNull('deleted_at')
          .modify((qb) => {
            if (q.departamento) qb.andWhere('idDepartamento', q.departamento);
            if (q.search) {
              const s = `%${q.search}%`;
              qb.andWhere((b) => b.whereILike('titulo', s).orWhereILike('nomeOriginal', s));
            }
          })
          .count<{ total: string | number }>({ total: '*' })
          .first(),
      ]);

      const total = Number((totalRow as any)?.total ?? 0);
      return { items, page, pageSize: size, total };
    }
  );

  // DELETE /documentos/:id/purge  -> hard delete
  app.delete(
    '/documentos/:id/purge',
    { preHandler: [(app as any).authenticate, requirePerm('trash:purge')] },
    async (req: any, reply) => {
      const p = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);

      const doc = await db('Documento')
        .where({ idDocumento: p.id, idEmpresa: req.user.idEmpresa })
        .first();

      if (!doc) return reply.notFound('documento não encontrado');
      if (!doc.deleted_at) {
        return reply.badRequest('documento não está na lixeira');
      }

      await db.transaction(async (trx) => {
        try {
          await sftpStorage.removeRemote(doc.caminhoAtual);
        } catch (e) {
          req.log.warn({ e, path: doc.caminhoAtual }, 'purge:remove-remote-failed');
        }

        await trx('DocumentoHistorico').where({ idDocumento: p.id }).del();
        await trx('Documento').where({ idDocumento: p.id }).del();
      });

      return { ok: true };
    }
  );
};
