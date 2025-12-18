// src/services/authService.ts
import jwt, { SignOptions, Secret } from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { getPool, sql } from '../db.js';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  companyId: string;
  isAdmin: boolean;
}

interface LoginResult {
  token: string;
  user: AuthUser;
}

const JWT_SECRET: Secret = (process.env.JWT_SECRET || 'dev-secret') as Secret;
const JWT_EXPIRES_IN: string | number = process.env.JWT_EXPIRES_IN || '7d';

export async function login(
  email: string,
  password: string
): Promise<LoginResult> {
  const pool = await getPool();

  const result = await pool
    .request()
    .input('email', sql.NVarChar, email)
    .query(`
      SELECT 
        u.UserID,
        u.FullName,
        u.Email,
        u.PasswordHash,
        u.CompanyID,
        u.IsAdmin,
        u.Active,
        u.Position
      FROM Users u
      WHERE u.Email = @email AND u.Active = 1
    `);

  if (result.recordset.length === 0) {
    throw new Error('Usuário não encontrado ou inativo');
  }

  const dbUser = result.recordset[0];

  // TEMPORARY: Direct password comparison for testing
  // TODO: Re-enable bcrypt after confirming login flow works
  console.log('[AUTH] Testing password:', password);
  console.log('[AUTH] Against hash:', dbUser.PasswordHash);

  const isPasswordValid = (password === dbUser.PasswordHash);

  /* ORIGINAL BCRYPT CODE - RE-ENABLE AFTER TESTING:
  const isPasswordValid = await bcrypt.compare(password, dbUser.PasswordHash);
  */

  if (!isPasswordValid) {
    console.log('[AUTH] Password validation FAILED');
    throw new Error('Senha inválida');
  }

  console.log('[AUTH] Password validation SUCCESS');

  // Get user's department and division
  const userDetailsResult = await pool
    .request()
    .input('userId', sql.UniqueIdentifier, dbUser.UserID)
    .query(`
      SELECT 
        DepartmentID,
        DivisionID,
        Position
      FROM Users
      WHERE UserID = @userId
    `);

  const userDetails = userDetailsResult.recordset[0] || {};

  // Map Position to standard role
  let role = 'user';
  const positionField = userDetails.Position || dbUser.Position || '';
  const positionLower = positionField.toLowerCase();

  if (positionLower.includes('superuser') || positionLower.includes('super')) {
    role = 'superuser';
  } else if (positionLower.includes('master')) {
    role = 'master';
  } else if (positionLower.includes('manager') || positionLower.includes('gerente')) {
    role = 'manager';
  } else if (positionLower.includes('coordinator') || positionLower.includes('coordenador')) {
    role = 'coordinator';
  } else {
    role = 'user';
  }

  const authUser: AuthUser = {
    id: dbUser.UserID,
    name: dbUser.FullName,
    email: dbUser.Email,
    companyId: dbUser.CompanyID,
    isAdmin: dbUser.IsAdmin,
  };

  // JWT payload with all required fields for authorization
  const payload = {
    userId: authUser.id,           // For CreatedBy/UpdatedBy
    companyId: authUser.companyId, // For multi-tenancy
    email: authUser.email,
    isAdmin: authUser.isAdmin,     // For admin checks
    role: role,                    // CRITICAL: superuser/master/manager/coordinator/user
    departmentId: userDetails.DepartmentID || null,  // CRITICAL: For permission filtering
    divisionId: userDetails.DivisionID || null,      // CRITICAL: For permission filtering
    cargo: dbUser.Position || '',  // For backward compatibility
    sub: authUser.id               // Standard JWT subject claim
  };

  console.log('[AUTH] JWT payload:', JSON.stringify(payload, null, 2));

  const signOptions: SignOptions = {
    expiresIn: JWT_EXPIRES_IN as any,
  };

  const token = jwt.sign(payload, JWT_SECRET, signOptions);

  return {
    token,
    user: authUser,
  };
}
