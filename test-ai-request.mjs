// test-ai-request.mjs
const url = "http://localhost:3001/api/ai/chat";

async function main() {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: "Diga exatamente: WISEIA v2 está funcionando com gpt-4.1-mini.",
      }),
    });

    console.log("Status HTTP:", res.status);

    const data = await res.json();
    console.log("Resposta da API:");
    console.log(data);
  } catch (err) {
    console.error("Erro ao chamar a API:", err);
  }
}

main();

