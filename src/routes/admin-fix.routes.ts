// Temporary admin route to check and fix user departments
import { FastifyPluginAsync } from 'fastify';
import { getPool } from '../db.js';

export const adminFixRoutes: FastifyPluginAsync = async (app) => {
    app.get('/admin/check-users', async (request, reply) => {
        const pool = await getPool();

        // 1. Get users
        const users = await pool.request().query(`
      SELECT 
        UserID, FullName, Email, Position, 
        DepartmentID, DivisionID, CompanyID
      FROM Users
      WHERE Email LIKE '%kmcargo%' OR Email LIKE '%brasilis%'
    `);

        // 2. Get KM CARGO departments
        const depts = await pool.request()
            .input('companyId', 'C5449303-F56D-445B-B443-B99B1427DB3E')
            .query(`
        SELECT DepartmentID, Name FROM Departments
        WHERE CompanyID = @companyId
      `);

        reply.send({
            users: users.recordset,
            departments: depts.recordset
        });
    });

    app.post('/admin/assign-department', async (request: any, reply) => {
        const { userId, departmentId } = request.body;
        const pool = await getPool();

        await pool.request()
            .input('userId', userId)
            .input('deptId', departmentId)
            .query(`
        UPDATE Users 
        SET DepartmentID = @deptId
        WHERE UserID = @userId
      `);

        reply.send({ success: true });
    });
};
