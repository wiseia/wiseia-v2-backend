// src/routes/dashboardadm.ts
import { FastifyPluginAsync } from 'fastify'
import { db } from '../db.js'

export const dashboardAdmRoutes: FastifyPluginAsync = async (app) => {
  // Middleware local para garantir que a empresa logada é ADM
  const ensureAdm = async (req: any, reply: any) => {
    // já está autenticado pelo preHandler do fastify-jwt
    const { idEmpresa } = req.user ?? {}
    if (!idEmpresa) {
      return reply.code(401).send({ message: 'unauthenticated' })
    }

    const empresa = await db('Empresa')
      .select('tp_ADM')
      .where({ idEmpresa })
      .first()

    if (!empresa || empresa.tp_ADM !== 'S') {
      return reply.code(403).send({ message: 'forbidden: requires ADM company' })
    }
  }

  // Totais globais do Dashboard ADM (1 linha)
  app.get(
    '/adm/dashboard',
    { preHandler: [(app as any).authenticate, ensureAdm] },
    async (_req: any) => {
      const row = await db('vw_Wiseia_ADM_DashboardTotais').first()
      return row ?? {}
    }
  )

  // Distribuição por plano (Card 5)
  app.get(
    '/adm/dashboard/por-plano',
    { preHandler: [(app as any).authenticate, ensureAdm] },
    async (_req: any) => {
      const rows = await db('vw_Wiseia_ADM_TotalPorPlano').select()
      return rows ?? []
    }
  )
}

export default dashboardAdmRoutes
