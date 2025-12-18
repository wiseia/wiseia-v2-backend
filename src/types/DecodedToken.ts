export interface DecodedToken {
  sub: number;
  email: string;
  role: string;

  companyId: number | null;
  departmentId: number | null;
  divisionId: number | null;

  idUsuario?: number;
  idEmpresa?: number;
}
