import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const app = await buildApp(loadConfig());
const port = Number(process.env.PORT ?? 3000);
await app.listen({ host: "0.0.0.0", port });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void app.close().finally(() => process.exit(0));
  });
}
