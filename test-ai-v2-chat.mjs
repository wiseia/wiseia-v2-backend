const url = "http://localhost:3001/ai/v2/chat";

async function main() {
  try {
    const body = {
      question: "Quem assina como responsável nesse contrato?",
      topK: 5,
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    console.log("Status HTTP:", res.status);
    const data = await res.json();
    console.log("Resposta da API:");
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Erro ao chamar a API:", err);
  }
}

main();
