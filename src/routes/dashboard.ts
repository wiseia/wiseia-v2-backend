import { FastifyPluginAsync } from 'fastify';
import { db } from '../db.js';

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
	app.get('/dashboard', { preHandler: (app as any).authenticate }, async (req: any) => {
		const row = await db('vw_Wiseia_DashboardTotais')
			.where('idEmpresa', req.user.idEmpresa)
			.first();

		return row ?? {};
	});
};
