import type { Context } from "hono";
import type { Env } from "@/types/env";

/** Hono request context bound to the app `Env`. */
export type AppContext = Context<{ Bindings: Env }>;
