import {
  createAgentSessionInputSchema,
  runAgentInputSchema,
} from "../contracts/agent.js";
import { cycleInputSchema } from "../contracts/cycle.js";
import { createOpenTrekSession, runOpenTrekAgent } from "../clients/opentrek.js";
import { calculateCycle } from "../services/cycle.js";
import { publicProcedure, router } from "./core.js";

export const appRouter = router({
  agent: router({
    createSession: publicProcedure
      .input(createAgentSessionInputSchema)
      .mutation(({ input }) => createOpenTrekSession(input)),
    chat: publicProcedure
      .input(runAgentInputSchema)
      .mutation(({ input }) => runOpenTrekAgent(input)),
  }),
  cycle: router({
    calculate: publicProcedure
      .input(cycleInputSchema)
      .query(({ input }) => calculateCycle(input)),
  }),
});

export type AppRouter = typeof appRouter;
