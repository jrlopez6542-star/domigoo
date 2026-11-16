import { createVercelHandler } from "../apps/api/dist/vercel.js";

const pending = createVercelHandler();

export default async function handler(request, response) {
  const server = await pending;
  server(request, response);
}
