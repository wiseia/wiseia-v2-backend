import { FastifyPluginAsync } from 'fastify';
import OpenAI from 'openai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import csv from 'csv-parser';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import z from 'zod';

export const chatRoutes: FastifyPluginAsync = async (app) => {
  const model = 'gpt-4o-mini'
  const instructions = 'Você é um assistente de IA chamado WiseBot. Se alguém te cumprimentar, responda usando seu nome. Seu papel é ajudar o usuário a **extrair dados de anexos** e gerar arquivos se solicitado. Seja técnico, claro e breve, em português do Brasil.'

  app.post(
    '/chat',
    { preHandler: (app as any).authenticate },
    async (req: any, reply) => {
      try {
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

        const schema = z.object({
          file: z.any().optional(),
          message: z.object({ value: z.string() }),
        });

        const { file, message } = schema.parse(req.body);
        console.log(message)
        if (!file) {
          const response = await openai.responses.create({
            model,
            instructions,
            input: [
              {
                role: 'user',
                content: [{ type: 'input_text', text: message.value }],
              },
            ],
          });

          return reply.send({ result: response.output_text });
        }

        const tempPath = path.join(os.tmpdir(), file.filename);
        const buffer = await file.toBuffer();
        await fs.promises.writeFile(tempPath, buffer);

        let extractedText = '';
        const ext = path.extname(file.filename).toLowerCase();

        if (ext === '.csv') {
          const rows: string[] = [];
          await new Promise<void>((resolve) => {
            fs.createReadStream(tempPath)
              .pipe(csv())
              .on('data', (row) => rows.push(JSON.stringify(row)))
              .on('end', resolve);
          });
          extractedText = rows.join('\n');
        } else if (ext === '.xlsx') {
          const buffer = await fs.promises.readFile(tempPath);
          const workbook = XLSX.read(buffer, { type: 'buffer' });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          extractedText = XLSX.utils.sheet_to_csv(sheet);

        } else if (ext === '.docx') {
          const { value } = await mammoth.extractRawText({ path: tempPath });
          extractedText = value;
        } else if (ext === '.txt') {
          extractedText = await fs.promises.readFile(tempPath, 'utf-8');
        } else if (ext === '.json') {
          const jsonData = JSON.parse(await fs.promises.readFile(tempPath, 'utf-8'));
          extractedText = JSON.stringify(jsonData, null, 2);
        } else if (ext === '.pdf') {
          const uploaded = await openai.files.create({
            file: fs.createReadStream(tempPath),
            purpose: 'assistants',
          });

          const response = await openai.responses.create({
            model,
            instructions,
            input: [
              {
                role: 'user',
                content: [
                  { type: 'input_text', text: message.value },
                  { type: 'input_file', file_id: uploaded.id },
                ],
              },
            ],
          });

          await openai.files.delete(uploaded.id)
          await fs.promises.unlink(tempPath);
          return reply.send({ result: response.output_text });
        } else {
          await fs.promises.unlink(tempPath);
          return reply.status(400).send({ error: `Formato de arquivo não suportado: ${ext}` });
        }

        await fs.promises.unlink(tempPath);

        const response = await openai.responses.create({
          model,
          instructions,
          input: [
            {
              role: 'user',
              content: [
                { type: 'input_text', text: `${message.value}\n\nConteúdo do arquivo:\n${extractedText.slice(0, 20000)}` },
              ],
            },
          ],
        });

        reply.send({ result: response.output_text });
      } catch (err: any) {
        console.error('❌ Erro no chat:', err);
        reply.status(500).send({
          error: 'Erro ao processar a solicitação.',
          details: err.message,
        });
      }
    }
  );
};
