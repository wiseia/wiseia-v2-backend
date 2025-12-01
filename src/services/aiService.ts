import { openai, OPENAI_MODEL } from "../lib/openaiClient.js";

export async function chatWithAI(prompt: string) {
  const response = await openai.responses.create({
    model: OPENAI_MODEL,
    input: prompt,
  });

  // 👇 Fazemos um "cast" para any só para ler o conteúdo sem brigar com o TypeScript
  const anyResponse = response as any;

  const textObj =
    anyResponse.output?.[0]?.content?.[0]?.text ?? anyResponse.output_text;

  let output: string;

  if (typeof textObj === "string") {
    output = textObj;
  } else if (textObj?.value) {
    // formato comum: { value: "texto...", ... }
    output = textObj.value;
  } else {
    output = "Sem resposta da IA.";
  }

  return output;
}

