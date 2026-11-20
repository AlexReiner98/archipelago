/**
 * The spec's capabilities in one place: the key → interface map a runtime
 * declares on its context, and the list with each one's edition.
 */
import type { Capability } from "./common.ts";
import * as action from "./action.ts";
import * as agent from "./agent.ts";
import * as exchange from "./exchange.ts";
import * as graph from "./graph.ts";
import * as here from "./here.ts";
import * as slot from "./slot.ts";

export interface Capabilities
  extends action.Capabilities,
    agent.Capabilities,
    exchange.Capabilities,
    graph.Capabilities,
    here.Capabilities,
    slot.Capabilities {}

export type CapabilityKey = keyof Capabilities;

export const capabilities: Capability[] = [
  ...graph.capabilities,
  ...action.capabilities,
  ...agent.capabilities,
  ...exchange.capabilities,
  ...slot.capabilities,
  ...here.capabilities,
];
