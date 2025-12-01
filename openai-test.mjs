import 'dotenv/config';
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // mesmo nome que você usa no .env
});

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ Variável OPENAI_API_KEY não encontrada. Confira o arquivo .env.");
    return;
  }

  console.log("🔑 Lendo OPENAI_API_KEY do .env...");

  try {
    const response = await client.responses.create({
      model: "gpt-4.1-mini", // ou o modelo que você estiver usando como 'IA forte'
      input: "Responda exatamente: OK, WISEIA conectado com a nova chave.",
    });

    // Tenta pegar o texto da resposta no formato novo da API
    const output = response.output[0]?.content[0]?.text || response.output[0]?.content[0];
    console.log("✅ Resposta da OpenAI:");
    console.log(output);
  } catch (err) {
    console.error("❌ Erro ao chamar a OpenAI:");
    console.error(err?.response?.data || err?.message || err);
  }
}

main();
