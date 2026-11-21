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
import * as loader from "./loader.ts";
import * as profile from "./profile.ts";
import * as scene from "./scene.ts";
import * as slot from "./slot.ts";
import * as types from "./types.ts";

export interface Capabilities
  extends action.Capabilities,
    agent.Capabilities,
    exchange.Capabilities,
    graph.Capabilities,
    here.Capabilities,
    loader.Capabilities,
    profile.Capabilities,
    scene.Capabilities,
    slot.Capabilities,
    types.Capabilities {}

export type CapabilityKey = keyof Capabilities;

export const capabilities: Capability[] = [
  ...graph.capabilities,
  ...action.capabilities,
  ...agent.capabilities,
  ...exchange.capabilities,
  ...slot.capabilities,
  ...scene.capabilities,
  ...here.capabilities,
  ...types.capabilities,
  ...profile.capabilities,
  ...loader.capabilities,
];
