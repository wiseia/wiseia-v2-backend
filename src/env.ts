import 'dotenv/config';

function required(name: string): string {
	const v = process.env[name];
	if (!v) throw new Error(`Missing env var: ${name}`);
	return v;
}

const SKIP_DB = String(process.env.SKIP_DB ?? '') === '1';

// Quando SKIP_DB=1, evitamos exigir variáveis DB obrigatórias para permitir
// iniciar o servidor sem uma instância SQL disponível (modo dev).
export const env = {
	PORT: Number(process.env.PORT ?? 9232),
	JWT_SECRET: required('JWT_SECRET'),
	SKIP_DB,

	DB: SKIP_DB
		? {
				host: process.env.DB_HOST ?? '',
				port: Number(process.env.DB_PORT ?? 1433),
				user: process.env.DB_USER ?? '',
				password: process.env.DB_PASSWORD ?? '',
				database: process.env.DB_NAME ?? '',
				poolMin: Number(process.env.DB_POOL_MIN ?? 2),
				poolMax: Number(process.env.DB_POOL_MAX ?? 10),
				trustServerCertificate: String(process.env.DB_TRUST_CERT ?? 'true') === 'true',
				encrypt: true,
			}
		: {
				host: required('DB_HOST'),
				port: Number(process.env.DB_PORT ?? 1433),
				user: required('DB_USER'),
				password: required('DB_PASSWORD'),
				database: required('DB_NAME'),
				poolMin: Number(process.env.DB_POOL_MIN ?? 2),
				poolMax: Number(process.env.DB_POOL_MAX ?? 10),
				trustServerCertificate: String(process.env.DB_TRUST_CERT ?? 'true') === 'true',
				encrypt: true,
			},
};
