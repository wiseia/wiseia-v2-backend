// src/routes/api/v1/document-types.routes.ts
import { FastifyPluginAsync } from 'fastify';
import { getPool, sql } from '../../../db.js';

export const documentTypesApiRoutes: FastifyPluginAsync = async (fastify) => {

    /**
     * GET /api/v1/document-types
     * Lista todos os tipos de documentos (TEMPORARIAMENTE SEM FILTRO DE EMPRESA)
     */
    fastify.get('/document-types', async (request: any, reply: any) => {
        try {
            console.log('[DOCUMENT-TYPES] GET request received');

            // TEMPORÁRIO: Retornar todos os tipos sem filtro de empresa
            // TODO: Implementar autenticação JWT correta
            const pool = await getPool();
            const result = await pool
                .request()
                .query(`
SELECT
TypeID as typeId,
    Name as name,
    Description as description,
    Icon as icon,
    Color as color,
    DefaultTags as defaultTags,
    Active as active
                    FROM DocumentTypes
                    WHERE Active = 1
                    ORDER BY Name
    `);

            console.log('[DOCUMENT-TYPES] Query result count:', result.recordset.length);

            // Parse defaultTags de JSON string para array
            const types = result.recordset.map((type: any) => ({
                ...type,
                defaultTags: type.defaultTags ? JSON.parse(type.defaultTags) : []
            }));

            console.log('[DOCUMENT-TYPES] Returning types:', types.length);
            return reply.send(types);
        } catch (err) {
            console.error('[DOCUMENT-TYPES] ERRO DETALHADO:', err);
            fastify.log.error('[DOCUMENT-TYPES] Erro ao listar tipos:', err);
            return reply.status(500).send({ error: 'Erro ao buscar tipos de documentos' });
        }
    });

    /**
     * POST /api/v1/document-types
     * Cria um novo tipo de documento (apenas Managers/Admins)
     */
    fastify.post('/document-types', {
        preHandler: [fastify.authenticate as any]
    }, async (request: any, reply: any) => {
        try {
            // Get user from JWT token
            const user = request.user;

            // Check if user is Manager or Admin
            if (!user.isAdmin && !user.cargo?.toLowerCase().includes('manager')) {
                return reply.status(403).send({ error: 'Apenas Managers  podem criar tipos' });
            }

            const { name, description, icon, color, defaultTags } = request.body;

            if (!name) {
                return reply.status(400).send({ error: 'Nome do tipo é obrigatório' });
            }

            // Inserir novo tipo
            const pool = await getPool();
            await pool
                .request()
                .input('companyId', sql.UniqueIdentifier, user.companyId)
                .input('name', sql.NVarChar(100), name)
                .input('description', sql.NVarChar(500), description || null)
                .input('icon', sql.NVarChar(50), icon || 'FileText')
                .input('color', sql.NVarChar(7), color || '#4f46e5')
                .input('defaultTags', sql.NVarChar(sql.MAX), JSON.stringify(defaultTags || []))
                .input('createdBy', sql.UniqueIdentifier, user.userId)
                .query(`
                    INSERT INTO DocumentTypes(
        TypeID, CompanyID, Name, Description, Icon, Color, DefaultTags, CreatedBy
    )
                    OUTPUT INSERTED.TypeID
VALUES(
    NEWID(), @companyId, @name, @description, @icon, @color, @defaultTags, @createdBy
)
    `);

            return reply.status(201).send({
                message: 'Tipo criado com sucesso'
            });
        } catch (err) {
            console.error('[DOCUMENT-TYPES] ERRO COMPLETO AO CRIAR:', err);
            console.error('[DOCUMENT-TYPES] Stack:', err instanceof Error ? err.stack : 'No stack');
            fastify.log.error('[DOCUMENT-TYPES] Erro ao criar tipo:', err);
            return reply.status(500).send({ error: 'Erro ao criar tipo de documento' });
        }
    });

    /**
     * PATCH /api/v1/document-types/:id
     * Atualiza um tipo existente
     */
    fastify.patch('/document-types/:id', {
        preHandler: [fastify.authenticate as any]
    }, async (request: any, reply: any) => {
        try {
            const { id } = request.params;
            const user = request.user;

            // Check if user is Manager or Admin
            if (!user.isAdmin && !user.cargo?.toLowerCase().includes('manager')) {
                return reply.status(403).send({ error: 'Apenas Managers podem editar tipos' });
            }

            const { name, description, icon, color, defaultTags, active } = request.body;

            const pool = await getPool();
            await pool
                .request()
                .input('typeId', sql.UniqueIdentifier, id)
                .input('companyId', sql.UniqueIdentifier, user.companyId)
                .input('name', sql.NVarChar(100), name)
                .input('description', sql.NVarChar(500), description)
                .input('icon', sql.NVarChar(50), icon)
                .input('color', sql.NVarChar(7), color || null)
                .input('defaultTags', sql.NVarChar(sql.MAX), defaultTags ? JSON.stringify(defaultTags) : null)
                .input('active', sql.Bit, active !== undefined ? active : 1)
                .input('updatedBy', sql.UniqueIdentifier, user.userId)
                .query(`
                    UPDATE DocumentTypes
                    SET Name = @name,
    Description = @description,
    Icon = @icon,
    Color = @color,
    DefaultTags = @defaultTags,
    Active = @active,
    UpdatedAt = GETUTCDATE(),
    UpdatedBy = @updatedBy
                    WHERE TypeID = @typeId AND CompanyID = @companyId
    `);

            return reply.send({ message: 'Tipo atualizado com sucesso' });
        } catch (err) {
            fastify.log.error('[DOCUMENT-TYPES] Erro ao atualizar tipo:', err);
            return reply.status(500).send({ error: 'Erro ao atualizar tipo' });
        }
    });

    /**
     * DELETE /api/v1/document-types/:id
     * Exclui (soft-delete) um tipo de documento
     */
    fastify.delete('/document-types/:id', {
        preHandler: [fastify.authenticate as any]
    }, async (request: any, reply: any) => {
        try {
            const { id } = request.params;
            const user = request.user;

            // Check if user is Manager or Admin
            if (!user.isAdmin && !user.cargo?.toLowerCase().includes('manager')) {
                return reply.status(403).send({ error: 'Apenas Managers podem excluir tipos' });
            }

            // Soft delete - apenas marca como inativo
            const pool = await getPool();
            await pool
                .request()
                .input('typeId', sql.UniqueIdentifier, id)
                .input('companyId', sql.UniqueIdentifier, user.companyId)
                .input('updatedBy', sql.UniqueIdentifier, user.userId)
                .query(`
                    UPDATE DocumentTypes
                    SET Active = 0,
    UpdatedAt = GETUTCDATE(),
    UpdatedBy = @updatedBy
                    WHERE TypeID = @typeId AND CompanyID = @companyId
    `);

            return reply.send({ message: 'Tipo excluído com sucesso' });
        } catch (err) {
            fastify.log.error('[DOCUMENT-TYPES] Erro ao excluir tipo:', err);
            return reply.status(500).send({ error: 'Erro ao excluir tipo' });
        }
    });
};
