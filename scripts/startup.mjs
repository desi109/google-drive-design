import { createServer } from "node:net";
import { resolve } from "node:path";

export function configuration(env, root) {
  const port = env.PORT ?? "8080";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error(
      "PORT must be a whole number from 1 to 65535. Example: PORT=8081 npm start",
    );
  }
  if (env.DRIVE_DATA === "")
    throw new Error(
      "DRIVE_DATA must not be empty. Set an absolute path or leave it unset for ./data.",
    );
  const seed = env.DRIVE_SEED ?? "true";
  if (!["true", "false"].includes(seed))
    throw new Error("DRIVE_SEED must be true or false.");
  return {
    root,
    host: env.HOST || "127.0.0.1",
    port: Number(port),
    data: resolve(root, env.DRIVE_DATA ?? "data"),
    seed,
  };
}

export async function ensurePortAvailable(host, port) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE")
        reject(
          new Error(
            `Port ${port} on ${host} is already in use. Choose another port: PORT=${port === 65535 ? 8081 : port + 1} npm start`,
          ),
        );
      else
        reject(
          new Error(
            `Cannot listen on ${host}:${port}: ${error.message}. Check HOST and PORT.`,
          ),
        );
    });
    server.listen({ host, port, exclusive: true }, () => server.close(resolve));
  });
}
