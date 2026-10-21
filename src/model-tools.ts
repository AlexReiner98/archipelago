// Connecting a workspace's own model account (src/model-account.ts), from the Workspace page. Humans only: a key is
// typed by the admin whose account it is, never handed over by an agent.

import { z } from 'zod';
import { connectModel, forgetModel, modelStatus, named, priceModel, priceOf, PROVIDERS } from './model-account.ts';
import { wholeMap } from './outbox.ts';
import { actorId } from './pelago.ts';
import type { Tool } from './tools.ts';

export const MODEL_TOOLS: Record<string, Tool> = {
  model_account: {
    description:
      'The model account this workspace runs on: what the agent on this server that reads pushes, and anything else here that asks a model, is paid for with. With nothing given: which account and model (a key only as its last four characters), and whether the server’s own model is offered when there is none. ' +
      'provider with key (and url for a compatible server, model unless Anthropic): connect one, replacing any before. It is tried first and refused, with the reason, if it does not answer. price_in and price_out (US$ a million tokens, from the provider’s price list): what each run is said to cost; given alone, they change the price of the account connected. remove: disconnect it. Admins only to connect, price or remove.',
    humanOnly: true,
    input: {
      provider: z.enum(PROVIDERS as [string, ...string[]]).optional().describe('anthropic, openai, or compatible (any server that answers OpenAI’s chat completions).'),
      key: z.string().max(500).optional().describe('The account’s API key. Kept sealed, never shown again.'),
      url: z.string().max(500).optional().describe('A compatible server’s address, with its version: https://api.example.com/v1'),
      model: z.string().max(200).optional().describe('The model to ask, as the account names it. Left out for Anthropic: the server’s reader model.'),
      price_in: z.number().optional().describe('US$ for a million tokens the model reads.'),
      price_out: z.number().optional().describe('US$ for a million tokens the model writes.'),
      remove: z.boolean().optional(),
    },
    run: async (l, actor, input) => {
      const whole = await wholeMap(l);
      const price = priceOf(input);
      if (!input.provider && !input.remove && !price) return modelStatus(whole, Boolean(actor.admin));
      if (!actor.admin) throw new Error('Only a workspace admin can connect, price or remove its model account.');
      if (!input.provider && !input.remove) {
        await priceModel(whole, price);
        await l.log(l.db, { actor: actorId(actor), action: 'workspace.set', reason: `Model price set: US$${price!.input} in, US$${price!.output} out, a million tokens` });
        return modelStatus(whole);
      }
      if (input.remove) {
        await forgetModel(whole);
        await l.log(l.db, { actor: actorId(actor), action: 'workspace.set', reason: 'Model account removed' });
        return modelStatus(whole);
      }
      const account = await connectModel(whole, { ...input, price } as Parameters<typeof connectModel>[1]);
      // The log says which account and by whom: never the key.
      await l.log(l.db, { actor: actorId(actor), action: 'workspace.set', reason: `Model account connected: ${named(account)}` });
      return modelStatus(whole);
    },
  },
};
