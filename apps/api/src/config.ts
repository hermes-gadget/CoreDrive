import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().min(1).optional(),
  PUBLIC_BASE_URL: z.string().default("http://localhost:3011"),
});

export type Config = z.infer<typeof Env>;

export const config: Config = Env.parse(process.env);
