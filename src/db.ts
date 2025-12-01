import knex, { Knex } from 'knex';
import { env } from './env.js';

const SKIP_DB = Boolean(env.SKIP_DB === true || String(process.env.SKIP_DB ?? '') === '1');

let _db: any = null;
let _pingDB: () => Promise<void>;

if (SKIP_DB) {
	// No DB mode: não inicializa knex, apenas fornece stubs para evitar crash na importação.
	_db = {} as any;
	_pingDB = async () => {
		// eslint-disable-next-line no-console
		console.warn('SKIP_DB=1 — pulando verificação de conexão com o banco de dados no startup.');
		return;
	};
} else {
	_db = knex({
		client: 'mssql',
		connection: {
			server: env.DB.host,
			port: env.DB.port,
			user: env.DB.user,
			password: env.DB.password,
			database: env.DB.database,
			options: {
				encrypt: env.DB.encrypt,
				trustServerCertificate: env.DB.trustServerCertificate,
				enableArithAbort: true,
			},
		},
		pool: {
			min: env.DB.poolMin,
			max: env.DB.poolMax,
		},
		useNullAsDefault: true,
	}) as Knex;

	_pingDB = async () => {
		await (_db as Knex).raw('SELECT 1 AS ok');
	};
}

export const db: Knex = _db as unknown as Knex;
export const pingDB = _pingDB;
