/**
 * Client for interacting with the Lune API
 */

import OpenAI from "openai";
const openai = new OpenAI({
  apiKey: process.env.LUNE_API_KEY,
  baseURL: "https://api.lune.dev"
});

const main = async () => {
  const completion = await openai.chat.completions.create({
    model: "tycho",
    messages: [
      {
          role: "user",
          content: "What is the format of the AIMessageChunk object in Langchain?",
      },
  ],
});

  console.log(completion.choices[0].message);
}

main();

/**
 * Queries the Lune API for coding-related information
 * 
 * @param question - The coding question to ask
 * @param numResults - Maximum number of results to return
 * @returns The response data from Lune API
 */
export async function askLuneCodingQuestion(question: string, numResults: number = 5) {
  const response = await fetch('https://api.lune.dev/chat/get_chunks_from_lunes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 
      'Authorization': `Bearer ${process.env.LUNE_API_KEY}`
    },
    body: JSON.stringify({
      lune_ids: ['a437818f-2557-4490-928f-610fc2b3dd6b'],
      user_query: question,
      top_k: numResults
    })
  });

  if (!response.ok) {
    throw new Error(`Failed to query Lune API: ${response.statusText}`);
  }

  return await response.json();
} 
