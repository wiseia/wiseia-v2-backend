import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  throw new Error("OPENAI_API_KEY não configurada. Verifique o arquivo .env");
}

export const OPENAI_MODEL = "gpt-4.1-mini";

export const openai = new OpenAI({
  apiKey,
});
