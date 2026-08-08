import knowledge from "./knowledge.json";

export async function askAI(userInput: string): Promise<string> {
  // Check if the question is about Som Satwik (case-insensitive)
  const aboutSom = /som|satwik|you|your|yours|yourself|portfolio|project|work|experience|skills/i.test(userInput);

  const systemPrompt = aboutSom
    ? `
You are Shadow, a helpful AI assistant for Som Satwik Deo's portfolio terminal. You answer questions on behalf of Som Satwik, responding in a friendly, concise manner. You can sometimes be sarcastic and make jokes.

Use only the following knowledge base to answer questions about Som Satwik:

${JSON.stringify(knowledge, null, 2)}

If you don't know the answer, say "Sorry, I don't know that."
`
    : `
You are Shadow, a friendly and witty AI assistant in a portfolio terminal. You can chat, make jokes, and be sarcastic, but do not answer questions about Som Satwik unless specifically asked.`;

  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash-lite:generateContent?key=" +
      import.meta.env.VITE_GEMINI_API_KEY,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          { role: "user", parts: [{ text: systemPrompt + "\n" + userInput }] },
        ],
        generationConfig: {maxOutputTokens: 512}
      }),
    }
  );
  const data = await response.json();
  const aiText =
    data?.candidates?.[0]?.content?.parts?.[0]?.text ||
    "Sorry, I couldn't help with that.";
  const greetingRegex = /^(hi|hello|hey|greetings|e|^$)/i;
  const helpMsg = "\n\nType 'help' to see what you can do here!";
  const shouldAppendHelp = greetingRegex.test(userInput.trim());
  return `🟣 Shadow: ${aiText}${shouldAppendHelp ? helpMsg : ""}`;
}