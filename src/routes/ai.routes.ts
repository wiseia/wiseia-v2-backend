import { FastifyInstance } from "fastify";
import { chatWithAI } from "../services/aiService.js";

export default async function aiRoutes(app: FastifyInstance) {
    app.get("/ping", async (_request, reply) => {
    return reply.send({ message: "IA WISEIA v2 está online com gpt-4.1-mini." });
  });
app.post("/chat", async (request, reply) => {
    const { prompt } = request.body as { prompt?: string };

    if (!prompt) {
      return reply.status(400).send({ error: "Prompt é obrigatório." });
    }

    try {
      const response = await chatWithAI(prompt);
      return reply.send({ response });
    } catch (error) {
      console.error("Erro na IA:", error);
      return reply.status(500).send({ error: "Erro ao processar IA." });
    }
  });
}
